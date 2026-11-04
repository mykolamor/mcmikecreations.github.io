import type { FactsBand } from '$lib/hikes/facts-overlay';
import type { HikeAuthoredFacts, Place } from '$lib/hikes/facts-schema';
import { FACTS, type Spec } from '$lib/hikes/facts-spec';
import { cumulativeKm, routeCoords } from '$lib/hikes/hike-metrics';
import type { FieldOp } from '../../shared/ops';
import type { DocRef } from '../../server/doc-ref';
import { localFacts, type Scope } from './facts-state';
import { inheritedRows } from './inherit';

/**
 * What the preview sends to `POST /api/facts/preview`: the local facts of each scope with facts ops queued or in flight
 * (null when the edits left it none); the server reads the files for the rest. A hike without a post has its sidecar only.
 */
export function previewDraft(doc: { facts?: { hike: unknown; post: unknown } } | null | undefined, pending: FieldOp[], ref: DocRef): { hike?: unknown; post?: unknown } {
	const scopes: Scope[] = ref.kind === 'post' ? ['hike', 'post'] : ['hike'];
	const draft: { hike?: unknown; post?: unknown } = {};
	for (const scope of scopes) {
		if (pending.some((op) => 'kind' in op && op.kind === 'facts' && op.scope === scope)) draft[scope] = localFacts(doc, pending, scope) ?? null;
	}
	return draft;
}

/**
 * Runs requests answered in any order and shows each answer unless a newer request has answered already: an older
 * answer arriving late never replaces a newer one.
 */
export function latestOnly<T>(onValue: (v: T) => void, onError: (e: unknown) => void) {
	let issued = 0;
	let shown = 0;
	return (request: Promise<T>): Promise<void> => {
		const mine = ++issued;
		const current = () => mine > shown && ((shown = mine), true);
		return request.then(
			(v) => void (current() && onValue(v)),
			(e) => void (current() && onError(e))
		);
	};
}

/**
 * The selected route list entry's index in the list the preview draws (the post's merged over the hike's). "This visit"
 * selects in that list already; "Hike defaults" selects a hike entry, which the visit may hide (none) or have entries
 * hidden before it. A visit's `legs: null` leaves no list.
 */
export function previewIndex(scope: Scope, index: number | null, hikeLegs: unknown, postLegs: unknown, hasPost: boolean): number | null {
	if (index === null || scope === 'post' || !hasPost) return index;
	if (postLegs === null) return null;
	const list = FACTS.f.legs as Extract<Spec, { t: 'list' }>;
	const rows = inheritedRows(list, Array.isArray(hikeLegs) ? hikeLegs : undefined, Array.isArray(postLegs) ? postLegs : undefined);
	if (!rows[index] || rows[index].removed) return null;
	return rows.slice(0, index).filter((r) => !r.removed).length;
}

/**
 * The selected entry's stretch as a band on the chart's hazard row: its resolved ends' km (as the overlay's band of an
 * entry on the profile), an absent end being the route's start or end. None when an end isn't on the route.
 */
export function highlightBand(facts: HikeAuthoredFacts | null | undefined, index: number | null, coords: number[][], distanceFactor: number): FactsBand | null {
	const leg = index === null ? undefined : facts?.legs?.[index];
	if (!leg) return null;
	const end = (p: Place | undefined, open: number) => (p ? p.km : open);
	const from = end(leg.from, 0);
	const to = end(leg.to, cumulativeKm(routeCoords(coords), distanceFactor).at(-1) ?? 0);
	if (from == null || to == null || from === to) return null;
	return { from: Math.min(from, to), to: Math.max(from, to), row: 1, color: '#e65100', title: 'Selected' };
}

/** The route as the chart reads it: a feature collection of the coordinates the facts were resolved on. */
export function routeGeojson(coords: number[][]) {
	return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] };
}

/** The metrics that give the chart the preview's distance factor (it stretches the track to `distance`, in m). */
export function chartMetrics(coords: number[][], distanceFactor: number): { distance: number } {
	return { distance: (cumulativeKm(routeCoords(coords)).at(-1) ?? 0) * distanceFactor * 1000 };
}
