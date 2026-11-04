import type L from 'leaflet';

/** A short message over the bottom of the map. */
export function toast(map: L.Map, text: string, ms = 2500): () => void {
	const el = document.createElement('div');
	el.setAttribute('role', 'status');
	el.textContent = text;
	el.style.cssText =
		'position:absolute;left:50%;bottom:1rem;transform:translateX(-50%);z-index:1200;background:#222;color:#fff;padding:0.4rem 0.8rem;border-radius:4px;font-size:0.9rem;max-width:80%;pointer-events:none';
	map.getContainer().appendChild(el);
	const t = setTimeout(() => el.remove(), ms);
	return () => (clearTimeout(t), el.remove());
}

/** Shows "saving..." now and replaces it with the outcome once the save queue settles. Resolves true when saved. */
export async function settle(map: L.Map, session: { queue: { idle(): Promise<void>; status: string; error: string | null } }, done: string): Promise<boolean> {
	const hide = toast(map, 'Saving...', 30000);
	await session.queue.idle();
	hide();
	const ok = session.queue.status === 'saved';
	toast(map, ok ? done : `Not saved: ${session.queue.error ?? session.queue.status}`, ok ? 2500 : 5000);
	return ok;
}
