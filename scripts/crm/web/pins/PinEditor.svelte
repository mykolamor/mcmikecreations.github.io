<script lang="ts">
	import L from 'leaflet';
	import 'leaflet/dist/leaflet.css';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { api } from '../api';
	import type { createDocSession } from '../doc-session';
	import { docQuery, photoWrite } from '../photos/photo-api';
	import type { PostPhoto } from '../photos/types';
	import PinPicker from './PinPicker.svelte';
	import { containedBox } from '$lib/hikes/photo-pins';
	import { NO_ZOOM, SHIFT_STEPS, clampView, ensureInStore, escapeAction, pinImageSrc, pinOps, pointerFraction, serialRunner, zoomAt, type LatLon, type Pin, type PlaceItem, type View } from './pin-ops';

	let {
		session,
		photos,
		key: startKey,
		onclose
	}: {
		session: ReturnType<typeof createDocSession>;
		/** The post's photos, for `[` / `]`. */
		photos: PostPhoto[];
		key: string;
		onclose: () => void;
	} = $props();

	type PinView = Pin & { name: string | null; ele: number | null; lat: number | null; lon: number | null; missing: boolean };
	type State = { key: string; href: string; w?: number; h?: number; lat?: number; lon?: number; pins: PinView[]; pinsReview: boolean; caption: string | null; captionState: 'ok' | 'missing' | 'ambiguous' };
	type MapInfo = { origin: LatLon | null; nodes: { ref: string; name: string | null; kind: string | null; lat: number; lon: number }[] };
	type Info = { name: string | null; ele: number | null; lat: number | null; lon: number | null };

	const LONG_PRESS_MS = 600;
	const DRAG_PX = 5;

	let dlg: HTMLDialogElement;
	let key = $state(untrack(() => startKey));
	let st = $state.raw<State | null>(null);
	let pins = $state.raw<Pin[]>([]);
	/** Name, height and position per ref (from the pin state, or a picked element until the state reloads). */
	let info = $state.raw<Record<string, Info>>({});
	let selected = $state<number | null>(null);
	let pending = $state<{ x: number; y: number } | null>(null);
	let error = $state<string | null>(null);
	let mapInfo = $state.raw<MapInfo>({ origin: null, nodes: [] });
	let natural = $state<{ w: number; h: number } | null>(null);
	let imgFailed = $state(false);
	let gen = 0;

	let photo = $derived(photos.find((p) => p.key === key) ?? null);
	let index = $derived(photos.findIndex((p) => p.key === key));
	let photoPos = $derived<LatLon | null>(st && st.lat !== undefined && st.lon !== undefined ? { lat: st.lat, lon: st.lon } : null);
	let hikeNodes = $derived<PlaceItem[]>(mapInfo.nodes.map((n) => ({ ...n, inStore: true })));
	let imgW = $derived(st?.w ?? natural?.w ?? 0);
	let imgH = $derived(st?.h ?? natural?.h ?? 0);
	/** Set once the photo is zoomed in; stays until the next photo so the image does not swap back and forth. */
	let hiRes = $state(false);
	let src = $derived(st ? (imgFailed ? st.href : pinImageSrc(st.href, st.w, st.h, hiRes ? 2560 : 1280)) : '');

	/**
	 * `keepDraft`: a reload of the same photo keeps the caption being typed. `infoOnly`: only names, heights and the
	 * photo's fields are taken; the pins on screen stay (an edit made meanwhile must not be reverted).
	 */
	async function load(k: string, keepDraft = false, infoOnly = false) {
		const mine = ++gen;
		error = null;
		try {
			const s = await api<State>('GET', `/api/photos/pins?${docQuery(session, { key: k })}`);
			if (mine !== gen) return;
			st = s;
			if (!infoOnly) pins = s.pins.map(({ ref, x, y }) => ({ ref, x, y }));
			info = { ...info, ...Object.fromEntries(s.pins.map((p) => [p.ref, { name: p.name, ele: p.ele, lat: p.lat, lon: p.lon }])) };
			if (!keepDraft) captionDraft = s.caption ?? '';
		} catch (e) {
			if (mine === gen) error = e instanceof Error ? e.message : String(e);
		}
	}

	// ---- saving: pin and caption writes go through one serial runner (each gets the base the previous returned);
	// the newest pin list wins, and nudges wait a moment so a run of presses is one write.
	const runWrite = serialRunner();
	let queued: { key: string; pins: Pin[] } | null = null;
	let writes = $state(0);
	let saving = $derived(writes > 0);
	let nudgeTimer: ReturnType<typeof setTimeout> | undefined;

	function write<T>(fn: () => Promise<T>): Promise<T> {
		writes++;
		return runWrite(fn).finally(() => writes--);
	}
	function commit(next: Pin[], delay = 0) {
		pins = next;
		queued = { key, pins: next };
		clearTimeout(nudgeTimer);
		if (delay) nudgeTimer = setTimeout(() => void flush(), delay);
		else void flush();
	}
	/** Sends the queued pin list (if any) and resolves once every write sent so far is done. */
	function flush(): Promise<void> {
		clearTimeout(nudgeTimer);
		nudgeTimer = undefined;
		return write(async () => {
			const job = queued;
			queued = null;
			if (!job) return;
			try {
				await photoWrite<{ version: string }>(session, 'POST', '/api/photos/pins', { key: job.key, pins: job.pins });
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
				// Show what is on disk again, unless newer edits are waiting to be saved.
				if (job.key === key && !queued) await load(key, true);
			}
		});
	}

	// ---- photo stage geometry
	let stage = $state<HTMLDivElement | null>(null);
	let box = $state({ width: 0, height: 0 });
	let drawn = $derived.by(() => {
		const d = containedBox(box.width, box.height, imgW, imgH);
		return d.width && d.height ? d : null;
	});
	const fraction = (e: PointerEvent | MouseEvent, clamp = false) => (stage && imgW && imgH ? pointerFraction(e.clientX, e.clientY, stage.getBoundingClientRect(), imgW, imgH, clamp, view) : null);

	// ---- zoom and pan: wheel (or a trackpad pinch) at the pointer, two-finger pinch, one-finger/mouse drag while zoomed,
	// the + − buttons and keys. Pins stay their size on screen.
	let view = $state.raw<View>(NO_ZOOM);
	let panning = $state(false);
	function setView(v: View) {
		view = v;
		if (v.z > 1.2) hiRes = true;
	}
	function zoomBy(factor: number, px = box.width / 2, py = box.height / 2) {
		if (drawn) setView(zoomAt(view, factor, px, py, box, drawn));
	}
	// A resize (rotation, window) keeps the zoom but pulls the photo back onto the stage.
	$effect(() => {
		const d = drawn;
		const b = box;
		if (d) view = clampView(untrack(() => view), b, d);
	});
	function onwheel(e: WheelEvent) {
		if (!stage || !drawn) return;
		e.preventDefault();
		const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.height : 1;
		// ctrlKey: a trackpad pinch, which sends small deltas
		const factor = Math.exp(-e.deltaY * px * (e.ctrlKey ? 0.01 : 0.0015));
		const r = stage.getBoundingClientRect();
		zoomBy(factor, e.clientX - r.left, e.clientY - r.top);
	}

	/** Pointers down on the stage itself (not on a pin, the picker or the zoom buttons). */
	const touches = new Map<number, { x: number; y: number }>();
	let gesture: { x: number; y: number; moved: boolean } | null = null;
	/** The last pointers' release ended a pan or a pinch: the click that follows must not add a pin. */
	let gestured = false;
	const mid = (r: DOMRect) => {
		const ps = [...touches.values()];
		return { x: (ps[0].x + ps[1].x) / 2 - r.left, y: (ps[0].y + ps[1].y) / 2 - r.top, d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) };
	};
	function stageDown(e: PointerEvent) {
		if ((e.pointerType === 'mouse' && e.button !== 0) || (e.target as Element).closest('.pick, .zoomctl')) return;
		if (!touches.size) gestured = false;
		touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (touches.size === 1) gesture = { x: e.clientX, y: e.clientY, moved: false };
		else if (touches.size === 2) {
			// a pinch: both pointers are followed off the stage too
			for (const id of touches.keys()) if (stage?.hasPointerCapture(id) === false) stage.setPointerCapture(id);
			gestured = true;
		}
	}
	function stageMove(e: PointerEvent) {
		const prev = touches.get(e.pointerId);
		if (!prev || !stage || !drawn) return;
		const r = stage.getBoundingClientRect();
		if (touches.size >= 2) {
			const a = mid(r);
			touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
			const b = mid(r);
			if (!a.d || !b.d) return;
			const z = zoomAt(view, b.d / a.d, a.x, a.y, box, drawn);
			setView(clampView({ z: z.z, x: z.x + b.x - a.x, y: z.y + b.y - a.y }, box, drawn));
			return;
		}
		touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
		const g = gesture;
		if (!g || view.z <= 1) return; // unzoomed, a sloppy tap still adds a pin where it lifts
		if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_PX) return;
		if (!g.moved) {
			g.moved = true;
			gestured = true;
			panning = true;
			stage.setPointerCapture(e.pointerId);
		}
		setView(clampView({ ...view, x: view.x + e.clientX - prev.x, y: view.y + e.clientY - prev.y }, box, drawn));
	}
	function stageUp(e: PointerEvent) {
		if (!touches.delete(e.pointerId)) return;
		if (touches.size === 1) {
			// pinch down to one finger: it pans from here
			const [p] = touches.values();
			gesture = { x: p.x, y: p.y, moved: true };
		} else if (!touches.size) {
			gesture = null;
			panning = false;
		}
	}

	// ---- pointer: tap to add, drag to move, long-press to remove
	let press: { i: number; x: number; y: number; id: number; dragging: boolean; timer: ReturnType<typeof setTimeout>; removed: boolean } | null = null;
	let suppressClick = false;

	function pinDown(e: PointerEvent, i: number) {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		selected = i;
		pending = null;
		const p = { i, x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false, removed: false, timer: setTimeout(() => {}, 0) };
		p.timer = setTimeout(() => {
			if (press !== p || p.dragging) return;
			p.removed = true;
			// The pin is gone before the finger lifts: that release must not add a pin where it was.
			suppressClick = true;
			window.addEventListener('pointerup', () => setTimeout(() => (suppressClick = false), 0), { once: true });
			remove(i);
		}, LONG_PRESS_MS);
		press = p;
	}
	function pinMove(e: PointerEvent) {
		const p = press;
		if (!p || p.id !== e.pointerId || p.removed) return;
		if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_PX) return;
		if (!p.dragging) {
			p.dragging = true;
			clearTimeout(p.timer);
		}
		const f = fraction(e, true);
		if (f) pins = pinOps.move(pins, p.i, f.x, f.y);
	}
	function pinUp(e: PointerEvent) {
		const p = press;
		if (!p || p.id !== e.pointerId) return;
		clearTimeout(p.timer);
		press = null;
		suppressClick = true;
		setTimeout(() => (suppressClick = false), 0);
		if (p.dragging && e.type === 'pointerup') commit(pins);
		else if (p.dragging) void load(key, true); // cancelled mid-drag: back to what is saved
	}
	function stageClick(e: MouseEvent) {
		if (suppressClick || gestured || !st) return;
		const f = fraction(e);
		if (!f) return;
		selected = null;
		pending = f;
	}

	// ---- edits
	function remove(i: number) {
		const next = pinOps.remove(pins, i);
		selected = next.length ? Math.min(i, next.length - 1) : null;
		commit(next);
	}
	async function picked(item: PlaceItem) {
		const at = pending;
		if (!at) return;
		error = null;
		try {
			await ensureInStore(item);
		} catch (e) {
			error = `Could not add ${item.name ?? item.ref} to the store: ${e instanceof Error ? e.message : String(e)}`;
			return;
		}
		info = { ...info, [item.ref]: { name: item.name, ele: null, lat: item.lat, lon: item.lon } };
		pending = null;
		commit(pinOps.add(pins, item.ref, at.x, at.y));
		selected = pins.length - 1;
		await flush();
		void load(key, true, true); // names and heights from the store
	}
	function pinNamed(ref: string, place: Info) {
		info = { ...info, [ref]: place };
		commit(pinOps.add(pins, ref, 0.5, 0.5));
		selected = pins.length - 1;
	}

	async function go(delta: number) {
		const next = photos[index + delta];
		if (!next) return;
		await flush();
		pending = null;
		selected = null;
		natural = null;
		imgFailed = false;
		view = NO_ZOOM;
		hiRes = false;
		key = next.key;
		st = null;
		pins = [];
		await load(next.key);
	}
	async function close() {
		await flush();
		dlg.close();
	}

	// On the window, not the dialog: keys keep working when focus falls back to <body> (after a pick, after clicking the
	// photo or a pin). The editor exists only while open. The picker's input stops its own keys.
	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented) return;
		const t = e.target as HTMLElement | null;
		if (e.key === 'Escape') {
			e.preventDefault();
			const inCaption = t?.id === 'pin-caption';
			const what = escapeAction({ pending: !!pending, inCaption, captionDirty: !!st && captionDraft.trim() !== (st.caption ?? '') });
			if (what === 'cancel-pin') pending = null;
			else if (what === 'blur') t?.blur(); // the draft stays; a second Esc closes
			else void close();
			return;
		}
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
		if ((e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0') && !e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			if (e.key === '0') view = NO_ZOOM;
			else zoomBy(e.key === '-' ? 1 / 1.5 : 1.5);
		} else if (e.key === '[' || e.key === ']') {
			e.preventDefault();
			void go(e.key === '[' ? -1 : 1);
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) {
			e.preventDefault();
			remove(selected);
		} else if (e.key.startsWith('Arrow') && selected !== null) {
			e.preventDefault();
			const n = e.shiftKey ? SHIFT_STEPS : 1;
			const dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0;
			const dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0;
			commit(pinOps.nudge(pins, selected, dx, dy), 400);
		}
	}

	// ---- caption
	let captionDraft = $state('');
	let captionBusy = $state(false);
	let captionError = $state<string | null>(null);
	let named = $state.raw<{ ref: string; name: string | null; lat: number; lon: number }[]>([]);
	let namedTimer: ReturnType<typeof setTimeout> | undefined;
	let namedGen = 0;
	let notPinned = $derived(named.filter((n) => !pins.some((p) => p.ref === n.ref)));

	$effect(() => {
		const text = captionDraft;
		clearTimeout(namedTimer);
		const mine = ++namedGen;
		namedTimer = setTimeout(async () => {
			if (!text.trim()) return void (named = []);
			try {
				const r = await api<{ places: typeof named }>('GET', `/api/photos/caption-places?${docQuery(session, { text })}`);
				if (mine === namedGen) named = r.places;
			} catch {
				/* the hint is optional */
			}
		}, 300);
	});
	async function saveCaption() {
		if (!st) return;
		captionBusy = true;
		captionError = null;
		const k = key;
		const text = captionDraft;
		try {
			if (queued) void flush(); // queued pins go first
			const r = await write(() => photoWrite<{ version: string; caption: string }>(session, 'POST', '/api/photos/caption', { key: k, text }));
			if (k === key && st) {
				st = { ...st, caption: r.caption };
				captionDraft = r.caption;
			}
		} catch (e) {
			captionError = e instanceof Error ? e.message : String(e);
		} finally {
			captionBusy = false;
		}
	}

	// ---- mini map: the photo position and the pinned elements
	let mapEl = $state<HTMLDivElement | null>(null);
	let map: L.Map | null = null;
	let layer: L.LayerGroup | null = null;
	// Only which elements are pinned matters here, not where on the photo: dragging must not redraw the map.
	let pinnedRefs = $derived(pins.map((p) => p.ref).join(' '));
	let mapReady = $state(false);
	$effect(() => {
		const pos = photoPos;
		const list = (pinnedRefs ? pinnedRefs.split(' ') : []).map((ref) => ({ ref, ...(info[ref] ?? { lat: null, lon: null, name: null }) }));
		const sel = selected;
		if (!mapReady) return;
		if (!map || !layer) return;
		layer.clearLayers();
		const pts: L.LatLngExpression[] = [];
		list.forEach((p, i) => {
			if (p.lat === null || p.lon === null) return;
			if (pos) L.polyline([[pos.lat, pos.lon], [p.lat, p.lon]], { color: '#c25e00', weight: 1.5, opacity: 0.5 }).addTo(layer!);
			L.circleMarker([p.lat, p.lon], { radius: i === sel ? 7 : 5, color: '#1f5fbf', weight: 2, fillColor: '#1f5fbf', fillOpacity: 0.8 })
				.bindTooltip(p.name ?? p.ref)
				.addTo(layer!);
			pts.push([p.lat, p.lon]);
		});
		if (pos) {
			L.circleMarker([pos.lat, pos.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#c25e00', fillOpacity: 1 }).bindTooltip('Photo').addTo(layer);
			pts.push([pos.lat, pos.lon]);
		}
		if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [12, 12], maxZoom: 15 });
		else if (pts.length === 1) map.setView(pts[0], 13);
		else if (mapInfo.origin) map.setView([mapInfo.origin.lat, mapInfo.origin.lon], 11);
	});

	let resize: ResizeObserver | null = null;
	onMount(() => {
		dlg.showModal();
		void load(key);
		api<MapInfo>('GET', `/api/map?${docQuery(session)}`)
			.then((m) => (mapInfo = { origin: m.origin, nodes: m.nodes }))
			.catch(() => {});
		if (mapEl) {
			map = L.map(mapEl, { zoomControl: false, attributionControl: true });
			L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
			layer = L.layerGroup().addTo(map);
			map.setView([47.5, 11.5], 8);
			mapReady = true;
		}
		if (stage) {
			// not passive: the wheel zooms the photo instead of scrolling the page
			stage.addEventListener('wheel', onwheel, { passive: false });
			resize = new ResizeObserver(() => {
				if (stage) box = { width: stage.clientWidth, height: stage.clientHeight };
			});
			resize.observe(stage);
		}
	});
	onDestroy(() => {
		gen++;
		namedGen++;
		clearTimeout(namedTimer);
		// a nudge still waiting for its save is sent now
		if (nudgeTimer !== undefined || queued) void flush();
		resize?.disconnect();
		stage?.removeEventListener('wheel', onwheel);
		map?.remove();
		map = null;
		layer = null;
	});

	const label = (ref: string) => {
		const i = info[ref];
		if (!i?.name) return ref;
		return i.ele !== null ? `${i.name} (${i.ele} m)` : i.name;
	};
	const time = (taken?: string) => (taken ? taken.slice(11, 16) : '');
</script>

<svelte:window {onkeydown} />

<!-- Esc is handled in onkeydown (it may first cancel a new pin); the native cancel would close without saving. -->
<dialog bind:this={dlg} oncancel={(e) => e.preventDefault()} onclose={onclose} aria-label="Edit pins">
	<header>
		<strong class="key">{key}</strong>
		<span class="sub">{[st?.caption, time(photo?.taken)].filter(Boolean).join(' · ')}</span>
		<span class="hint">Tap to add · drag to move · long-press or × to remove · wheel or pinch to zoom, drag to pan · keys: [ ] photo, arrows nudge, + − 0 zoom, Del, Esc</span>
		<span class="nav">
			<button type="button" onclick={() => go(-1)} disabled={index <= 0} aria-label="Previous photo">‹</button>
			<span>{index + 1}/{photos.length}</span>
			<button type="button" onclick={() => go(1)} disabled={index < 0 || index >= photos.length - 1} aria-label="Next photo">›</button>
		</span>
		<button type="button" class="x" aria-label="Close" onclick={close}>×</button>
	</header>
	{#if error}<p class="err" role="alert">{error} <button type="button" onclick={() => (error = null)}>Dismiss</button></p>{/if}
	<div class="body">
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="stage"
			class:panning
			bind:this={stage}
			onclick={stageClick}
			onpointerdown={stageDown}
			onpointermove={stageMove}
			onpointerup={stageUp}
			onpointercancel={stageUp}
		>
			<!-- the zoomed photo is clipped to the stage; the picker and the buttons (outside the clip) are not -->
			<div class="clip">
				<div class="zoom" style:transform="translate({view.x}px, {view.y}px) scale({view.z})" style:--z={view.z}>
					{#if st}
						<img
							{src}
							alt={st.caption ?? key}
							draggable="false"
							onload={(e) => (natural = { w: (e.currentTarget as HTMLImageElement).naturalWidth, h: (e.currentTarget as HTMLImageElement).naturalHeight })}
							onerror={() => (imgFailed = true)}
						/>
					{/if}
					{#if drawn}
						<div class="layer" style:left="{drawn.left}px" style:top="{drawn.top}px" style:width="{drawn.width}px" style:height="{drawn.height}px">
							{#each pins as p, i (i)}
								<button
									type="button"
									class="pin"
									class:sel={i === selected}
									style:left="{p.x * 100}%"
									style:top="{p.y * 100}%"
									aria-label={`Pin ${label(p.ref)}`}
									title={label(p.ref)}
									onpointerdown={(e) => pinDown(e, i)}
									onpointermove={pinMove}
									onpointerup={pinUp}
									onpointercancel={pinUp}
									oncontextmenu={(e) => e.preventDefault()}
									onfocus={() => (selected = i)}
									onclick={(e) => e.stopPropagation()}
								></button>
								{#if i === selected}<span class="tag" style:left="{p.x * 100}%" style:top="{p.y * 100}%">{label(p.ref)}</span>{/if}
							{/each}
							{#if pending}
								<span class="pin new" style:left="{pending.x * 100}%" style:top="{pending.y * 100}%"></span>
							{/if}
						</div>
					{/if}
				</div>
			</div>
			{#if drawn}
				{#if pending}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div
						class="pick"
						style:--px="{Math.min(Math.max(0, view.x + view.z * (drawn.left + pending.x * drawn.width) + 16), Math.max(0, box.width - 340))}px"
						style:--py="{Math.min(Math.max(0, view.y + view.z * (drawn.top + pending.y * drawn.height) + 16), Math.max(0, box.height - 300))}px"
						onclick={(e) => e.stopPropagation()}
					>
						<PinPicker photo={photoPos} origin={mapInfo.origin} {hikeNodes} onpick={picked} oncancel={() => (pending = null)} />
					</div>
				{/if}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div class="zoomctl" onclick={(e) => e.stopPropagation()}>
					<button type="button" aria-label="Zoom out" disabled={view.z <= 1} onclick={() => zoomBy(1 / 1.5)}>−</button>
					<button type="button" class="pct" aria-label="Reset zoom" title="Reset zoom (0)" disabled={view.z <= 1} onclick={() => (view = NO_ZOOM)}>{Math.round(view.z * 100)}%</button>
					<button type="button" aria-label="Zoom in" disabled={view.z >= 8} onclick={() => zoomBy(1.5)}>+</button>
				</div>
			{/if}
		</div>
		<aside>
			<strong>Pins ({pins.length}){#if saving}<span class="saving"> · saving…</span>{/if}</strong>
			{#if st?.pinsReview}<p class="note">The photo changed shape since these were placed: check them; saving clears the mark.</p>{/if}
			<ul class="pins">
				{#each pins as p, i (i)}
					<li class:sel={i === selected}>
						<button type="button" class="pick-pin" onclick={() => (selected = i)}>
							<span class="dot"></span>
							<span class="name">{label(p.ref)}</span>
						</button>
						<button type="button" class="rm" aria-label={`Remove ${label(p.ref)} pin`} onclick={() => remove(i)}>×</button>
					</li>
				{/each}
				{#if pending}
					<li><span class="dot new"></span><span class="name pend">New pin · choose a place</span></li>
				{/if}
				{#if !pins.length && !pending}<li class="empty">No pins yet: tap the photo.</li>{/if}
			</ul>
			<hr />
			<label for="pin-caption"><strong>Caption</strong></label>
			<textarea id="pin-caption" rows="3" bind:value={captionDraft} disabled={st?.captionState !== 'ok' || captionBusy}></textarea>
			{#if st && st.captionState !== 'ok'}
				<span class="small">{st.captionState === 'missing' ? 'Not placed in the text yet: add the photo in Write to give it a caption.' : 'In the text more than once: edit its captions in Write.'}</span>
			{:else}
				<div class="row">
					<button type="button" onclick={saveCaption} disabled={!st || captionBusy || captionDraft.trim() === (st.caption ?? '')}>Save caption</button>
					{#if captionError}<span class="err-inline" role="alert">{captionError}</span>{/if}
				</div>
			{/if}
			<span class="small">Places named in the caption but not pinned: {#if !notPinned.length}none{/if}</span>
			{#if notPinned.length}
				<ul class="named">
					{#each notPinned as n (n.ref)}
						<li>
							<span>{n.name ?? n.ref}</span>
							<button type="button" onclick={() => pinNamed(n.ref, { name: n.name, ele: null, lat: n.lat, lon: n.lon })}>Pin</button>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="mini" bind:this={mapEl} role="img" aria-label="Mini map: the photo position and the pinned places"></div>
		</aside>
	</div>
</dialog>

<style>
	dialog {
		width: min(75rem, calc(100vw - 1rem));
		height: min(46rem, calc(100vh - 1rem));
		max-width: none;
		max-height: none;
		box-sizing: border-box;
		border: 0;
		border-radius: 10px;
		padding: 0;
		overflow: hidden;
	}
	dialog[open] {
		display: flex;
		flex-direction: column;
	}
	dialog::backdrop {
		background: rgba(30, 32, 28, 0.75);
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.75rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #e6e6e1;
	}
	.key {
		overflow-wrap: anywhere;
	}
	.sub {
		color: #5c5f58;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1 1 10rem;
	}
	.hint {
		color: #5c5f58;
		font-size: 0.75rem;
	}
	.nav {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.85rem;
	}
	.nav button,
	.x {
		min-width: 2.75rem;
		min-height: 2.75rem;
	}
	.err {
		margin: 0;
		padding: 0.3rem 0.75rem;
		font-weight: 600;
		background: #fff7ed;
	}
	.body {
		flex: 1;
		display: flex;
		min-height: 0;
	}
	.stage {
		flex: 1 1 0;
		position: relative;
		background: #2b2d29;
		min-width: 0;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		cursor: crosshair;
	}
	.stage.panning {
		cursor: grabbing;
	}
	.clip {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	.zoom {
		position: absolute;
		inset: 0;
		transform-origin: 0 0;
	}
	.zoomctl {
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		z-index: 1;
		display: flex;
		gap: 1px;
		border-radius: 6px;
		overflow: hidden;
		cursor: default;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
	}
	.zoomctl button {
		min-width: 2.75rem;
		min-height: 2.75rem;
		border: 0;
		border-radius: 0;
		background: rgba(255, 255, 255, 0.92);
		font: inherit;
		font-size: 1.1rem;
	}
	.zoomctl .pct {
		font-size: 0.8rem;
		min-width: 3.5rem;
	}
	.stage img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		pointer-events: none;
	}
	.layer {
		position: absolute;
	}
	.pin {
		position: absolute;
		width: 1.1rem;
		height: 1.1rem;
		min-height: 0;
		padding: 0;
		border-radius: 50%;
		background: #fff;
		border: 3px solid #1f5fbf;
		/* the same size on screen at any zoom */
		transform: translate(-50%, -50%) scale(calc(1 / var(--z, 1)));
		touch-action: none;
		cursor: grab;
	}
	/* a bigger invisible target for fingers */
	.pin::after {
		content: '';
		position: absolute;
		inset: -0.9rem;
		border-radius: 50%;
	}
	.pin.sel {
		box-shadow: 0 0 0 3px #fff, 0 0 0 5px #1f5fbf;
	}
	.pin.new {
		background: #c25e00;
		border-color: #fff;
		box-shadow: 0 0 0 2px #c25e00;
		pointer-events: none;
	}
	.tag {
		position: absolute;
		transform: scale(calc(1 / var(--z, 1))) translate(0.9rem, -150%);
		transform-origin: 0 0;
		background: #fff;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		font-size: 0.75rem;
		white-space: nowrap;
		pointer-events: none;
	}
	.pick {
		position: absolute;
		left: var(--px);
		top: var(--py);
		width: min(21rem, calc(100% - 1rem));
		z-index: 2;
		cursor: default;
	}
	aside {
		width: 19rem;
		flex: none;
		border-left: 1px solid #e6e6e1;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow: auto;
	}
	.saving {
		font-weight: 400;
		color: #5c5f58;
	}
	.note {
		margin: 0;
		font-size: 0.85rem;
		background: #fff7ed;
		padding: 0.3rem;
		border-radius: 4px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.pins li,
	.named li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.pins li.sel {
		background: #eef3fb;
		border-radius: 4px;
	}
	.pick-pin {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: 0;
		background: none;
		text-align: left;
		font: inherit;
		min-height: 2.75rem;
		padding: 0 0.3rem;
	}
	.dot {
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 50%;
		border: 2px solid #1f5fbf;
		flex: none;
	}
	.dot.new {
		background: #c25e00;
		border-color: #c25e00;
	}
	.name {
		overflow-wrap: anywhere;
	}
	.pend {
		color: #a34b00;
	}
	.rm {
		min-width: 2.75rem;
		min-height: 2.75rem;
	}
	.empty {
		color: #5c5f58;
		font-size: 0.85rem;
	}
	.named li span {
		flex: 1;
	}
	hr {
		border: 0;
		border-top: 1px solid #e6e6e1;
		width: 100%;
		margin: 0.25rem 0;
	}
	textarea {
		font: inherit;
		padding: 0.5rem;
		border: 1px solid #c9c9c3;
		border-radius: 6px;
		resize: vertical;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.small {
		color: #5c5f58;
		font-size: 0.8rem;
	}
	.err-inline {
		font-weight: 600;
		font-size: 0.85rem;
	}
	.mini {
		height: 10rem;
		flex: none;
		border-radius: 6px;
		margin-top: auto;
	}
	@media (max-width: 719px) {
		dialog {
			width: 100vw;
			height: 100dvh;
			border-radius: 0;
		}
		.hint {
			display: none;
		}
		.body {
			flex-direction: column;
			overflow: auto;
		}
		.stage {
			flex: none;
			height: 58dvh;
		}
		aside {
			width: auto;
			border-left: 0;
			border-top: 1px solid #e6e6e1;
			overflow: visible;
		}
		.pick {
			left: 0.5rem;
			right: 0.5rem;
			top: auto;
			bottom: 0.5rem;
			width: auto;
		}
	}
</style>
