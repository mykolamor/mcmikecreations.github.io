import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editSidecar } from './sidecar-file';

const DIR = fileURLToPath(new URL('../../../static/_projects/data-viz/hikes/markdown/', import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith('.hike.json'));
const sample = readFileSync(join(DIR, 'aiplspitz.hike.json'), 'utf8');

test('every real sidecar is unchanged by a no-op edit', () => {
	assert.ok(files.length > 10);
	for (const f of files) {
		const raw = readFileSync(join(DIR, f), 'utf8');
		assert.equal(editSidecar(raw, []), raw, f);
	}
});

test('setting name changes only that line', () => {
	const out = editSidecar(sample, [{ path: ['name'], value: 'Aipl' }]);
	const a = sample.split('\n'), b = out.split('\n');
	assert.equal(a.length, b.length);
	const diff = a.map((l, i) => (l === b[i] ? null : [l, b[i]])).filter(Boolean);
	assert.deepEqual(diff, [['  "name": "Aiplspitz",', '  "name": "Aipl",']]);
});

test('removing description removes its line and the comma', () => {
	const out = editSidecar(sample, [{ path: ['description'], value: undefined }]);
	const a = sample.split('\n');
	assert.deepEqual(out.split('\n'), a.filter((l) => !l.startsWith('  "description"')));
	assert.doesNotThrow(() => JSON.parse(out));
});

test('numbers like 47.4095595 and 1577.0 elsewhere keep their text', () => {
	const raw = '{\n  "name": "A",\n  "lat": 47.4095595,\n  "h": 1577.0,\n  "c": [1.0, 2.50]\n}\n';
	const out = editSidecar(raw, [{ path: ['name'], value: 'B' }]);
	assert.equal(out, raw.replace('"A"', '"B"'));
});

function addedOnly(before: string, after: string, expectedAdded: string[]) {
	const a = before.split('\n'), b = after.split('\n');
	assert.equal(b.length, a.length + expectedAdded.length);
	// every original line survives in order, optionally gaining a trailing comma
	let j = 0;
	const added: string[] = [];
	for (const line of b) {
		if (j < a.length && (line === a[j] || line === a[j] + ',')) j++;
		else added.push(line);
	}
	assert.equal(j, a.length);
	assert.deepEqual(added, expectedAdded);
}

test('inserting a top-level key into every real sidecar adds only its line', () => {
	for (const f of files) {
		const raw = readFileSync(join(DIR, f), 'utf8');
		const out = editSidecar(raw, [{ path: ['zzz'], value: 'v' }]);
		assert.equal(JSON.parse(out).zzz, 'v', f);
		addedOnly(raw, out, ['  "zzz": "v"']);
	}
});

test('inserting a nested key and an array leaves siblings alone', () => {
	const raw = '{\n  "facts": {\n    "b": [1, 2],\n    "c": {\n      "x": 1\n    }\n  },\n  "e": {}\n}\n';
	const out = editSidecar(raw, [{ path: ['facts', 'c', 'd'], value: [3, 4] }]);
	addedOnly(raw, out, ['      "d": [3, 4]']);
	const out2 = editSidecar(raw, [{ path: ['e', 'k'], value: 'v' }]);
	assert.deepEqual(JSON.parse(out2).e, { k: 'v' });
	assert.ok(out2.includes('"b": [1, 2],'));
});

test('reordering checkpoints in every real sidecar changes only the checkpoints block', () => {
	let n = 0;
	for (const f of files) {
		const raw = readFileSync(join(DIR, f), 'utf8');
		const cps = JSON.parse(raw).checkpoints as number[][] | undefined;
		if (!cps || cps.length < 3) continue;
		n++;
		const swapped = cps.slice();
		[swapped[0], swapped[2]] = [swapped[2], swapped[0]];
		const out = editSidecar(raw, [{ path: ['checkpoints'], value: swapped }]);
		assert.deepEqual(JSON.parse(out).checkpoints, swapped, f);
		const a = raw.split('\n'), b = out.split('\n');
		assert.equal(a.length, b.length, f);
		const start = a.findIndex((l) => l.startsWith('  "checkpoints"'));
		const end = a.findIndex((l, i) => i > start && l.startsWith('  ]'));
		for (let i = 0; i < a.length; i++) if (i < start || i > end) assert.equal(b[i], a[i], `${f}:${i}`);
		assert.equal(b[start + 1] !== a[start + 1] || b[start + 3] !== a[start + 3], true, f);
		assert.equal(b[start], a[start], f);
		assert.equal(b[end], a[end], f);
	}
	assert.ok(n > 10);
});

test('adding a node ref changes only the nodes line', () => {
	for (const f of files) {
		const raw = readFileSync(join(DIR, f), 'utf8');
		const nodes = JSON.parse(raw).nodes as string[] | undefined;
		if (!nodes) continue;
		const out = editSidecar(raw, [{ path: ['nodes'], value: [...nodes, 'node/999'] }]);
		const a = raw.split('\n'), b = out.split('\n');
		assert.equal(a.length, b.length, f);
		const diff = a.map((l, i) => (l === b[i] ? -1 : i)).filter((i) => i >= 0);
		assert.equal(diff.length, 1, f);
		assert.ok(a[diff[0]].startsWith('  "nodes"'), f);
		assert.equal(b[diff[0]], a[diff[0]].replace(/\](,?)$/, ', "node/999"]$1'), f);
	}
});

test('changing origin lat leaves lon and layout alone', () => {
	const raw = readFileSync(join(DIR, 'aiplspitz.hike.json'), 'utf8');
	const o = JSON.parse(raw).origin;
	const out = editSidecar(raw, [{ path: ['origin'], value: { lat: 1.5, lon: o.lon } }]);
	assert.equal(out, raw.replace(/"lat": [\d.]+/, '"lat": 1.5'));
});

test('swapping checkpoints permutes the original lines byte-for-byte', () => {
	let n = 0;
	for (const f of files) {
		const raw = readFileSync(join(DIR, f), 'utf8');
		const cps = JSON.parse(raw).checkpoints as number[][] | undefined;
		if (!cps || cps.length < 3) continue;
		n++;
		const swapped = cps.slice();
		[swapped[0], swapped[2]] = [swapped[2], swapped[0]];
		const out = editSidecar(raw, [{ path: ['checkpoints'], value: swapped }]);
		const a = raw.split('\n'), b = out.split('\n');
		const strip = (l: string) => l.replace(/,$/, '');
		assert.deepEqual(b.map(strip).sort(), a.map(strip).sort(), f);
	}
	assert.ok(n > 10);
	const raw = '{\n  "checkpoints": [\n    [83.8240430, 28.4095174],\n    [1.0, 2.0],\n    [3.50, 4.0]\n  ]\n}\n';
	const out = editSidecar(raw, [{ path: ['checkpoints'], value: [[3.5, 4], [83.824043, 28.4095174], [1, 2]] }]);
	assert.equal(out, '{\n  "checkpoints": [\n    [3.50, 4.0],\n    [83.8240430, 28.4095174],\n    [1.0, 2.0]\n  ]\n}\n');
});
