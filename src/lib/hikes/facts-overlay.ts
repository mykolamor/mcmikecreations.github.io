/**
 * The facts layer drawn onto the elevation charts and the 2D map: pins for
 * hazards, bailout points and water at a single place; bands for the SAC
 * grade of each section and for hazards along a stretch; and the route slices
 * those stretches cover, for the map.
 *
 * Places come resolved from `facts.server.ts`, with `km` on the chart's own
 * distance scale, so the chart needs nothing more. The map slices the route
 * by the same scale (`distanceFactor`).
 *
 * Framework-free and browser-safe.
 */

import { cumulativeKm, pointAtKm, routeCoords } from './hike-metrics';
import { sacTop, textIn, type HikeAuthoredFacts, type Lang, type Place } from './facts-schema';
import { enumLabel, formatBailoutWhere, formatGrades, formatKm, formatRouteStats, formatWater, label } from './facts-format';

export type FactsPinKind = 'hazard' | 'bailout' | 'water';

export interface FactsPinItem {
	kind: FactsPinKind;
	emoji: string;
	color: string;
	/** One line: "Rockfall (medium)", "Bailout → Ehrwald, lift, 15 min". */
	title: string;
	note?: string;
}

/** Everything the facts say about one place. */
export interface FactsPin {
	name: string;
	lat: number;
	lon: number;
	/** Absent when the place is off the route: map only. */
	km?: number;
	ele?: number;
	/** The 3D map's terrain height there; without it the pin stays off the 3D map. */
	demEle?: number;
	/** On one of the hike's POI nodes, which has its own marker on the map. */
	onNode: boolean;
	/** That node's id: the maps fold the pin into the node's marker (see `pinsByNode`). */
	node?: number;
	items: FactsPinItem[];
}

export interface FactsBand {
	/** km on the chart's scale. */
	from: number;
	to: number;
	/** 0: SAC grade by section; 1: hazards along a stretch. */
	row: 0 | 1;
	color: string;
	/** Text inside the band when it fits, e.g. "T3". */
	text?: string;
	title: string;
}

export interface FactsLine {
	/** `[lat, lon]` along the route. */
	coords: [number, number][];
	color: string;
	title: string;
}

/** A bailout's planned route, drawn dashed on the map. */
export interface FactsRoute {
	/** `[lat, lon]` along the route. */
	coords: [number, number][];
	color: string;
	title: string;
}

export interface FactsOverlay {
	pins: FactsPin[];
	bands: FactsBand[];
	lines: FactsLine[];
	routes: FactsRoute[];
}

/** The facts layer's marks on the 2D and 3D maps: all but the chart's bands. */
export type FactsMarks = Omit<FactsOverlay, 'bands'>;

const SEVERITY_COLOR = { high: '#dc2626', medium: '#f59e0b', low: '#6b7280' } as const;
const BAILOUT_COLOR = '#16a34a';
const WATER_COLOR = '#0ea5e9';
/** Close to the SAC trail-marking colours: yellow, white-red-white, white-blue-white, deepening with the grade. */
const SAC_COLOR: Record<string, string> = {
	T1: '#eab308', T2: '#f87171', T3: '#dc2626', T4: '#3b82f6', T5: '#1d4ed8', T6: '#1e3a8a'
};
const UNGRADED_COLOR = '#9ca3af';
/** Pins on the chart this close together (km) share one marker. */
const SAME_KM = 0.05;

function located(p: Place | undefined): p is Place & { lat: number; lon: number } {
	return !!p && p.lat != null && p.lon != null;
}

function placeKey(p: Place & { lat: number; lon: number }): string {
	return p.node != null ? `node:${p.node}` : `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
}

/** The km a span covers: an open end runs to the route's start or end; an unresolved end drops it. */
function spanKm(from: Place | undefined, to: Place | undefined, total: number): [number, number] | null {
	if ((from && from.km == null) || (to && to.km == null)) return null;
	const a = from?.km ?? 0;
	const b = to?.km ?? total;
	return a === b ? null : [Math.min(a, b), Math.max(a, b)];
}

/** `[lat, lon]` points of the route between two distances (chart scale), ends interpolated. */
export function routeSlice(coords: number[][], distanceFactor: number, fromKm: number, toKm: number): [number, number][] {
	const out: [number, number][] = [];
	const cum = cumulativeKm(coords, distanceFactor);
	const at = (km: number): [number, number] => {
		const p = pointAtKm(coords, cum, km);
		return [p.lat, p.lon];
	};
	if (coords.length && fromKm <= 0) out.push([coords[0][1], coords[0][0]]);
	for (let i = 1; i < coords.length; i++) {
		const prev = cum[i - 1];
		if (prev < fromKm && cum[i] >= fromKm) out.push(at(fromKm));
		if (cum[i] > fromKm && cum[i] < toKm) out.push([coords[i][1], coords[i][0]]);
		if (prev < toKm && cum[i] >= toKm) {
			out.push(at(toKm));
			break;
		}
	}
	return out;
}

/**
 * @param coords The route GeoJSON's coordinates, `[lon, lat, ele?]`.
 * @param distanceFactor The chart's distance stretch (`computeMetricScales`).
 */
export function buildFactsOverlay(
	facts: HikeAuthoredFacts | null | undefined,
	lang: Lang,
	coords: number[][] | null | undefined,
	distanceFactor: number
): FactsOverlay {
	const overlay: FactsOverlay = { pins: [], bands: [], lines: [], routes: [] };
	if (!facts) return overlay;
	const route = routeCoords(coords);
	const total = cumulativeKm(route, distanceFactor).at(-1) ?? 0;

	const pins = new Map<string, FactsPin>();
	const pin = (place: Place & { lat: number; lon: number }, item: FactsPinItem) => {
		const key = placeKey(place);
		let p = pins.get(key);
		if (!p) {
			p = { name: textIn(place.name, lang), lat: place.lat, lon: place.lon, km: place.km, ele: place.ele, demEle: place.demEle, onNode: place.node != null, node: place.node, items: [] };
			pins.set(key, p);
		}
		p.items.push(item);
	};

	for (const h of facts.hazards ?? []) {
		const severity = h.severity ?? 'medium';
		const title = `${enumLabel(lang, 'hazard', h.kind, h.label)} (${enumLabel(lang, 'severity', severity)})`;
		const note = h.note ? textIn(h.note, lang) : undefined;
		if (located(h.at)) {
			pin(h.at, { kind: 'hazard', emoji: '⚠️', color: SEVERITY_COLOR[severity], title, note });
		} else if (h.from || h.to) {
			const km = spanKm(h.from, h.to, total);
			if (!km) continue;
			const name = [h.from, h.to].filter(Boolean).map((p) => textIn(p!.name, lang)).join(' – ');
			const spanTitle = `${title}: ${name}${note ? `. ${note}` : ''}`;
			overlay.bands.push({ from: km[0], to: km[1], row: 1, color: SEVERITY_COLOR[severity], title: spanTitle });
			const slice = routeSlice(route, distanceFactor, km[0], km[1]);
			if (slice.length > 1) overlay.lines.push({ coords: slice, color: SEVERITY_COLOR[severity], title: spanTitle });
		}
		// Hazards with no place at all (cold, lightning) apply everywhere: listed above the story only.
	}

	for (const b of facts.bailouts ?? []) {
		if (!located(b.at)) continue;
		const where = formatBailoutWhere(lang, b).join(', ');
		if (b.route) {
			const r = b.route;
			const stats = formatRouteStats(lang, r)
				// Each stat stays on one line when the tooltip wraps.
				.map((part) => part.replace(/ /g, '\u00a0'))
				.join(' · ');
			overlay.routes.push({
				coords: r.coords,
				color: b.last ? SEVERITY_COLOR.high : BAILOUT_COLOR,
				// Stats on a line of their own; the map tooltip keeps the break (`facts-tooltip`).
				title: `${label(lang, 'bailoutRoute')}: ${textIn(b.at.name, lang)}${b.to ? ` → ${textIn(b.to, lang)}` : ''}\n${stats}`
			});
		}
		pin(b.at, {
			kind: 'bailout',
			emoji: '🛟',
			color: b.last ? SEVERITY_COLOR.high : BAILOUT_COLOR,
			title: `${label(lang, 'bailouts')}${where ? ` → ${where}` : ''}${b.last ? ` (${label(lang, 'lastChance')})` : ''}`,
			note: b.note ? textIn(b.note, lang) : undefined
		});
	}

	for (const w of facts.water ?? []) {
		if (!located(w.at)) continue;
		const what = formatWater(lang, w).join(', ');
		pin(w.at, {
			kind: 'water',
			emoji: '💧',
			color: WATER_COLOR,
			title: `${label(lang, 'water')}${what ? `: ${what}` : ''}`,
			note: w.note ? textIn(w.note, lang) : undefined
		});
	}

	for (const s of facts.difficulty?.sections ?? []) {
		const km = spanKm(s.from, s.to, total);
		if (!km) continue;
		const grade = formatGrades(lang, s);
		const name = [s.from, s.to].filter(Boolean).map((p) => textIn(p!.name, lang)).join(' – ');
		overlay.bands.push({
			from: km[0],
			to: km[1],
			row: 0,
			color: (s.sac && SAC_COLOR[sacTop(s.sac).slice(0, 2)]) || UNGRADED_COLOR,
			text: grade || undefined,
			title: `${grade}${name ? ` ${name}` : ''}${s.note ? `: ${textIn(s.note, lang)}` : ''}`
		});
	}

	overlay.pins = [...pins.values()].sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
	return overlay;
}

export interface XY { x: number; y: number }

/** Distance from `p` to the segment `a`–`b`. */
function segmentDistance(p: XY, a: XY, b: XY): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const f = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
	return Math.hypot(p.x - (a.x + dx * f), p.y - (a.y + dy * f));
}

/**
 * Pushes the points of `line` sideways where it runs along `main`, so the two
 * draw side by side instead of on top of each other. Works in screen pixels
 * (the caller projects at the current zoom), since that's where they'd overlap.
 *
 * Each point moves along the normal of the line's own direction there (its
 * neighbours' chord; one-sided at the ends), by `offset` pixels when it's
 * within `near` of `main`, fading to nothing at `far`. A positive `offset`
 * goes to the left of the line's direction, negative to the right.
 */
export function offsetNearRoute(line: XY[], main: XY[], offset: number, near: number, far: number): XY[] {
	if (line.length < 2 || main.length < 2) return line;
	// Drop main-route points closer than a pixel to the last kept one: a
	// recorded track has tens of thousands, most of them sub-pixel apart.
	const simple: XY[] = [main[0]];
	for (const p of main) {
		const last = simple[simple.length - 1];
		if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) >= 1) simple.push(p);
	}
	if (simple.length < 2) simple.push(main[main.length - 1]);

	return line.map((p, i) => {
		let d = Infinity;
		for (let j = 1; j < simple.length && d > 0; j++) {
			const a = simple[j - 1];
			const b = simple[j];
			// Cheap reject: the segment's box, grown by `far`, doesn't hold the point.
			if (p.x < Math.min(a.x, b.x) - far || p.x > Math.max(a.x, b.x) + far ||
				p.y < Math.min(a.y, b.y) - far || p.y > Math.max(a.y, b.y) + far) continue;
			d = Math.min(d, segmentDistance(p, a, b));
		}
		const w = d <= near ? 1 : d >= far ? 0 : (far - d) / (far - near);
		if (w === 0) return p;
		const prev = line[Math.max(0, i - 1)];
		const next = line[Math.min(line.length - 1, i + 1)];
		const tx = next.x - prev.x;
		const ty = next.y - prev.y;
		const len = Math.hypot(tx, ty);
		if (len === 0) return p;
		// Screen y points down, so (ty, -tx) is the left-hand normal.
		return { x: p.x + (ty / len) * offset * w, y: p.y + (-tx / len) * offset * w };
	});
}

/** Pins along the route merged where they'd overlap on the chart, for its markers. */
export function chartPins(pins: FactsPin[]): FactsPin[] {
	const out: FactsPin[] = [];
	for (const p of pins) {
		if (p.km == null) continue;
		const last = out[out.length - 1];
		if (last && Math.abs(last.km! - p.km) < SAME_KM) {
			out[out.length - 1] = { ...last, name: `${last.name}, ${p.name}`, items: [...last.items, ...p.items] };
		} else {
			out.push(p);
		}
	}
	return out;
}

/** The kinds of item at a pin, in a fixed order: hazard, bailout, water. */
export function pinKinds(pin: FactsPin): FactsPinKind[] {
	return (['hazard', 'bailout', 'water'] as const).filter((k) => pin.items.some((i) => i.kind === k));
}

/** A pin's emojis, one per kind (see `pinKinds`). */
export function pinEmojis(pin: FactsPin): string {
	return pinKinds(pin).map((k) => pin.items.find((i) => i.kind === k)!.emoji).join('');
}

/** The colour that stands for a pin: its most severe hazard, else its first item's. */
export function pinColor(pin: FactsPin): string {
	for (const c of [SEVERITY_COLOR.high, SEVERITY_COLOR.medium]) if (pin.items.some((i) => i.color === c)) return c;
	return pin.items[0].color;
}

/** Plain-text summary for a tooltip. */
export function pinText(pin: FactsPin): string {
	return [pin.name + (pin.ele != null ? ` (${pin.ele} m)` : ''), ...pin.items.map((i) => `${i.emoji} ${i.title}${i.note ? ` — ${i.note}` : ''}`)].join('\n');
}


/** Map pin size (px): the pill's height, width per emoji, and the pointer below it. */
export const FACTS_PIN_H = 22;
export const FACTS_PIN_EMOJI_W = 16;
export const FACTS_PIN_POINTER = 6;

/** The pin's width on a map: one emoji per kind of item. */
export function factsPinWidth(pin: FactsPin): number {
	return pinKinds(pin).length * FACTS_PIN_EMOJI_W + 10;
}

/** A map pin: a pill of emojis with a pointer at the bottom, outlined in the pin's colour. Shared by the 2D and 3D maps. */
export function factsPinIconHtml(pin: FactsPin, width: number): string {
	const color = pinColor(pin);
	return `<div style="position:relative;width:${width}px;height:${FACTS_PIN_H + FACTS_PIN_POINTER}px;">`
		+ `<div style="box-sizing:border-box;height:${FACTS_PIN_H}px;border:2px solid ${color};border-radius:${FACTS_PIN_H / 2}px;background:white;display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;box-shadow:0 2px 4px rgba(0,0,0,.3);cursor:pointer;">${pinEmojis(pin)}</div>`
		+ `<div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:${FACTS_PIN_POINTER}px solid ${color};"></div>`
		+ `</div>`;
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A pin's items as popup rows. */
function pinRowsHtml(pin: FactsPin): string {
	return pin.items
		.map((i) => `<div style="margin-top:4px;"><span style="color:${i.color};font-weight:600;">${i.emoji} ${escapeHtml(i.title)}</span>${i.note ? `<div style="font-size:11px;color:#4b5563;">${escapeHtml(i.note)}</div>` : ''}</div>`)
		.join('');
}

/** Popup body for a pin on the map. */
export function pinPopupHtml(pin: FactsPin): string {
	const head = `<div style="margin-bottom:6px;"><b>${escapeHtml(pin.name)}</b>${pin.ele != null ? ` (${pin.ele} m)` : ''}${pin.km != null ? ` · ${formatKm(pin.km)}` : ''}</div>`;
	return head + pinRowsHtml(pin);
}

/**
 * Splits the pins between the hike's POI nodes and the rest. A pin whose place
 * is one of `nodeIds` (the same node, not just nearby) shows on that node's
 * marker instead of as a pin of its own: one marker per place.
 */
export function pinsByNode(pins: FactsPin[], nodeIds: Iterable<number | undefined>): { onNodes: Map<number, FactsPin>; loose: FactsPin[] } {
	const ids = new Set(nodeIds);
	const onNodes = new Map<number, FactsPin>();
	const loose: FactsPin[] = [];
	for (const pin of pins) {
		if (pin.node != null && ids.has(pin.node)) onNodes.set(pin.node, pin);
		else loose.push(pin);
	}
	return { onNodes, loose };
}

/** Where a node's facts badge starts, from the marker's left edge (px). */
const NODE_BADGE_LEFT = 14;

/**
 * The badge a node's marker wears for the facts about it: the pin's emojis in a
 * small pill at the marker's top right, outlined in the pin's colour. Water at
 * a node already drawn as water (💧) adds nothing; '' when nothing is left.
 */
export function nodeFactsBadgeHtml(pin: FactsPin, nodeEmoji: string): string {
	const emojis = pinKinds(pin)
		.filter((k) => !(k === 'water' && nodeEmoji === '💧'))
		.map((k) => pin.items.find((i) => i.kind === k)!.emoji)
		.join('');
	if (!emojis) return '';
	return `<div style="position:absolute;top:-7px;left:${NODE_BADGE_LEFT}px;box-sizing:border-box;height:15px;padding:0 2px;border:1.5px solid ${pinColor(pin)};border-radius:8px;background:white;display:flex;align-items:center;font-size:9px;line-height:1;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.3);pointer-events:none;">${emojis}</div>`;
}

/** The facts rows a node's popup gets below its own tags. */
export function nodeFactsPopupHtml(pin: FactsPin): string {
	return `<div style="margin-top:8px;border-top:1px solid #e5e7eb;padding-top:4px;">${pinRowsHtml(pin)}</div>`;
}
