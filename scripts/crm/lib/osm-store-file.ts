// Reads and writes the OSM store file (static/_projects/data-viz/hikes/osm.json)
// byte-for-byte as the former scripts/matches/osmstore.py `save_store` did: refs sorted by
// type (node, way, relation) then numeric id; entry keys lat, lon, demEle,
// local, tags, fetched, then the rest; 2-space indent; non-ASCII unescaped;
// trailing newline; and floats Python prints with a ".0" (`1577.0`) keep it.
//
// JSON.parse would lose that ".0", so readStore wraps such numbers in
// `WholeFloat` (a Number subclass: arithmetic and JSON.stringify still work,
// `typeof` is 'object') and writeStore prints them back with the ".0".
import { readFileSync, writeFileSync } from 'node:fs';

export class WholeFloat extends Number {}

export type StoreEntry = Record<string, any>;
export type Store = Record<string, StoreEntry>;

const TYPES = ['node', 'way', 'relation'];
const ENTRY_KEYS = ['lat', 'lon', 'demEle', 'local', 'tags', 'fetched'];

export function readStore(path: string): Store {
	return parseStore(readFileSync(path, 'utf-8'));
}

export function parseStore(text: string): Store {
	return JSON.parse(text, (_key, value, ctx?: { source?: string }) =>
		typeof value === 'number' && ctx?.source && /^-?\d+\.0+$/.test(ctx.source) ? new WholeFloat(value) : value
	);
}

function sortKey(ref: string): [number, number] {
	const [kind, num] = ref.split('/');
	return [TYPES.indexOf(kind), Number(num)];
}

function ordered(entry: StoreEntry): StoreEntry {
	const out: StoreEntry = {};
	for (const k of ENTRY_KEYS) if (k in entry) out[k] = entry[k];
	for (const [k, v] of Object.entries(entry)) if (!(k in out)) out[k] = v;
	return out;
}

// Python json.dumps(indent=2, ensure_ascii=False) layout.
function dump(value: any, depth: number): string {
	if (value instanceof WholeFloat) return `${value.valueOf()}.0`;
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	const pad = '  '.repeat(depth + 1);
	const end = '  '.repeat(depth);
	if (Array.isArray(value)) {
		if (!value.length) return '[]';
		return `[\n${value.map((v) => pad + dump(v, depth + 1)).join(',\n')}\n${end}]`;
	}
	const keys = Object.keys(value);
	if (!keys.length) return '{}';
	return `{\n${keys.map((k) => `${pad}${JSON.stringify(k)}: ${dump(value[k], depth + 1)}`).join(',\n')}\n${end}}`;
}

export function serializeStore(store: Store): string {
	const refs = Object.keys(store).sort((a, b) => {
		const [ta, na] = sortKey(a);
		const [tb, nb] = sortKey(b);
		return ta - tb || na - nb;
	});
	const out: Store = {};
	for (const ref of refs) out[ref] = ordered(store[ref]);
	return dump(out, 0) + '\n';
}

export function writeStore(path: string, store: Store): void {
	writeFileSync(path, serializeStore(store), 'utf-8');
}
