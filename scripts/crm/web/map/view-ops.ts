// Pure helpers of the map view panel: the "This post only" switch, pasted coordinates, size.
import type { FieldOp } from '../../shared/ops';

type Slots = { hike?: unknown; post?: unknown };
type DocLike = { fields: Record<string, unknown> };
const slots = (doc: DocLike, field: string): Slots => (doc.fields[field] ?? {}) as Slots;
const has = (v: unknown) => v !== undefined && v !== null;

/**
 * The op for flipping "This post only": on copies the current hike value into the post, off removes the post key.
 * Null when there is nothing to copy (on, but the hike has no value).
 */
export function overrideOps(field: string, doc: DocLike, on: boolean): Extract<FieldOp, { field: string }> | null {
	if (!on) return { field, scope: 'post', value: null };
	const hike = slots(doc, field).hike;
	return has(hike) ? { field, scope: 'post', value: hike } : null;
}

/** Turning the switch off discards the post value; ask first when it differs from the hike value. */
export function confirmOverrideOff(field: string, doc: DocLike): boolean {
	const s = slots(doc, field);
	return has(s.post) && JSON.stringify(s.post) !== JSON.stringify(s.hike);
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** "47.71877, 11.80515" (comma, semicolon or space separated, optional brackets) -> a 6-decimal origin, or null. */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
	const parts = text.replace(/[()[\]]/g, ' ').trim().split(/[\s,;]+/).filter(Boolean);
	if (parts.length !== 2) return null;
	const [lat, lon] = parts.map(Number);
	if (!Number.isFinite(lat) || !Number.isFinite(lon) || parts.some((p) => !/^-?\d+(\.\d+)?$/.test(p))) return null;
	if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
	return { lat: round6(lat), lon: round6(lon) };
}

/** The tile square size in px: a whole number, rounded to 16 px like the corner drag and clamped to 128-2048; null when not a number. */
export function parseSize(text: string): number | null {
	if (!/^\d+$/.test(text.trim())) return null;
	return Math.min(2048, Math.max(128, Math.round(Number(text) / 16) * 16));
}
