import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHikeFacts } from '$lib/hikes/facts.server';
import { LIBRARY_KINDS, type FactsLibrary } from '$lib/hikes/facts-library.server';
import { bailoutFiles, isNamedSpot, namedLabel, placeLabel, placeValue, pointName, spotName, spotNameOf, spotPlace, tapPick, withPointName } from './place-value';

test('placeValue writes a ref for an element and a point for a tap', async () => {
	assert.deepEqual(placeValue({ kind: 'element', ref: 'node/12' }), { ref: 'node/12' });
	assert.deepEqual(placeValue({ kind: 'km', km: 7.5 }), { km: 7.5 });
	// Lat/lon at 7 decimals; the name trimmed, as {en} (English only); demEle when the terrain has one.
	assert.deepEqual(placeValue({ kind: 'tap', lat: 47.123456789, lon: 11.98765432109, name: ' Bench ', demEle: 1577 }), {
		lat: 47.1234568,
		lon: 11.9876543,
		name: { en: 'Bench' },
		demEle: 1577
	});
	assert.deepEqual(placeValue({ kind: 'tap', lat: 47.1, lon: 11.2, name: '', demEle: null }), { lat: 47.1, lon: 11.2 });

	// The height comes from the terrain endpoint.
	const asked: string[] = [];
	const request = async <T>(method: string, path: string): Promise<T> => (asked.push(`${method} ${path}`), { demEle: 812.5 } as T);
	assert.deepEqual(await tapPick(47.123456789, 11.2, 'Cross', request), { kind: 'tap', lat: 47.123456789, lon: 11.2, name: 'Cross', demEle: 812.5 });
	assert.deepEqual(asked, ['GET /api/terrain/height?lat=47.123456789&lon=11.2']);

	// The site reads every form placeValue writes.
	const library = Object.fromEntries(LIBRARY_KINDS.map((k) => [k, {}])) as unknown as FactsLibrary;
	const coords = [[11.2, 47.1, 800], [11.3, 47.1, 900]];
	const nodes = [{ ref: 'node/12', name: 'Gatterl', lat: 47.1, lon: 11.25 }];
	for (const at of [placeValue({ kind: 'element', ref: 'node/12' }), placeValue({ kind: 'km', km: 2 }), placeValue({ kind: 'tap', lat: 47.1000001, lon: 11.27, name: 'Bench', demEle: 850 })]) {
		const { facts } = readHikeFacts({
			sidecar: { water: [{ at }] }, sidecarSource: 's.hike.json', postSource: 's.hike.json', nodes, storeNodes: nodes,
			origin: null, height: null, ownRefs: ['node/12'], coords, distanceFactor: 1, library, readGpx: () => null
		} as any);
		assert.equal(facts!.water!.length, 1, JSON.stringify(at));
	}
});

test('a spot keeps its name when it is placed, and its place when the name goes', () => {
	assert.deepEqual(spotPlace(undefined, { ref: 'node/1' }), { ref: 'node/1' });
	// A plain string spot is its name (the site reads it as "may just be a name"), kept when a place is picked.
	assert.deepEqual(spotPlace('Hut', { km: 3 }), { name: 'Hut', at: { km: 3 } });
	assert.deepEqual(spotPlace('km 1', { km: 3 }), { km: 3 });
	assert.deepEqual(spotPlace({ name: 'Car park' }, { km: 0 }), { name: 'Car park', at: { km: 0 } });
	assert.deepEqual(spotPlace({ name: 'Car park', at: 'km 1' }, { ref: 'node/1' }), { name: 'Car park', at: { ref: 'node/1' } });
	assert.deepEqual(spotName(undefined, 'Car park'), { name: 'Car park' });
	// A placed spot keeps its place as `at`.
	assert.deepEqual(spotName({ ref: 'node/1' }, { en: 'Car park', de: 'Parkplatz' }), { name: { en: 'Car park', de: 'Parkplatz' }, at: { ref: 'node/1' } });
	assert.deepEqual(spotName({ km: 3 }, 'Lot'), { name: 'Lot', at: { km: 3 } });
	assert.deepEqual(spotName({ lat: 47.1, lon: 11.2, name: 'Bench' }, 'Lot'), { name: 'Lot', at: { lat: 47.1, lon: 11.2, name: 'Bench' } });
	assert.deepEqual(spotName('km 2', 'Lot'), { name: 'Lot', at: 'km 2' });
	// A string that is not a km is the spot's name: typing replaces it.
	assert.deepEqual(spotName('Nowhere Alm', 'Lot'), { name: 'Lot' });
	assert.equal(spotName('Nowhere Alm', undefined), undefined);
	assert.equal(spotNameOf('Nowhere Alm'), 'Nowhere Alm');
	assert.equal(spotNameOf('km 2'), undefined);
	assert.deepEqual(spotNameOf({ name: { en: 'Lot', de: 'Platz' }, at: 'km 1' }), { en: 'Lot', de: 'Platz' });
	assert.equal(spotNameOf({ ref: 'node/1' }), undefined);
	assert.deepEqual(spotName({ name: 'Car park', at: { km: 0 } }, 'Lot'), { name: 'Lot', at: { km: 0 } });
	assert.deepEqual(spotName({ name: 'Car park', at: { km: 0 } }, undefined), { km: 0 });
	assert.equal(spotName({ name: 'Car park' }, undefined), undefined);
	// The validator's test: a name without lat (so `{ref, name}`, which the site refuses as a spot, counts as named).
	assert.equal(isNamedSpot({ ref: 'node/1', name: 'X' }), true);
	assert.equal(isNamedSpot({ lat: 1, lon: 2, name: 'X' }), false);
});

test('typing a name keeps a placed spot\'s place, as the site reads it', () => {
	const library = Object.fromEntries(LIBRARY_KINDS.map((k) => [k, {}])) as unknown as FactsLibrary;
	const coords = [[11.2, 47.1, 800], [11.3, 47.1, 900]];
	const nodes = [{ ref: 'node/12', name: 'Gatterl', lat: 47.1, lon: 11.25 }];
	const placed = [placeValue({ kind: 'element', ref: 'node/12' }), placeValue({ kind: 'km', km: 2 }), placeValue({ kind: 'tap', lat: 47.1, lon: 11.27, name: 'Bench', demEle: 850 })];
	for (const at of placed) {
		const start = spotName(at, { en: 'Car park', de: 'Parkplatz' }) as Record<string, unknown>;
		assert.deepEqual(start.at, at);
		const { facts } = readHikeFacts({
			sidecar: { route: { start } }, sidecarSource: 's.hike.json', postSource: 's.hike.json', nodes, storeNodes: nodes,
			origin: null, height: null, ownRefs: ['node/12'], coords, distanceFactor: 1, library, readGpx: () => null
		} as any);
		const read = facts!.route!.start!;
		assert.deepEqual(read.name, { en: 'Car park', de: 'Parkplatz' });
		assert.ok(read.km != null, JSON.stringify(at));
	}
});

test('a point\'s name is edited as a text when the point is the value', () => {
	const pt = { lat: 47.1, lon: 11.2, name: 'Bench', demEle: 812 };
	assert.equal(pointName(pt), 'Bench');
	// A named spot's `at`: the site shows the spot's name, so the point's has no field.
	assert.equal(pointName({ name: 'Lot', at: { lat: 47.1, lon: 11.2, name: { en: 'Bench', de: 'Bank' } } }), null);
	// Not a point: no name field.
	assert.equal(pointName({ ref: 'node/1' }), null);
	assert.equal(pointName({ name: 'Lot', at: { km: 1 } }), null);
	assert.equal(pointName({ lat: 47.1, lon: 11.2 }), undefined);
	assert.deepEqual(withPointName(pt, { en: 'Bench', de: 'Bank' }), { lat: 47.1, lon: 11.2, name: { en: 'Bench', de: 'Bank' }, demEle: 812 });
	// Cleared: the point stays, unnamed.
	assert.deepEqual(withPointName(pt, undefined), { lat: 47.1, lon: 11.2, demEle: 812 });
	assert.deepEqual(withPointName({ lat: 47.1, lon: 11.2 }, 'Cross'), { lat: 47.1, lon: 11.2, name: 'Cross' });
	assert.deepEqual(withPointName({ name: 'Lot', at: pt }, 'Bank'), { name: 'Lot', at: pt });
});

test('placeLabel shows every written form', () => {
	assert.equal(placeLabel(undefined), '');
	// The old strings: a node name, a km.
	assert.equal(placeLabel('Gatterl'), 'Gatterl');
	assert.equal(placeLabel('km 7.5'), 'km 7.5');
	assert.equal(placeLabel({ node: 'node/12' }), 'node/12');
	assert.equal(placeLabel({ ref: 'node/12' }), 'node/12');
	assert.equal(placeLabel({ ref: 'node/12' }, { name: { en: 'Gatterl' }, ref: 'node/12', resolved: true }), 'Gatterl (node/12)');
	assert.equal(placeLabel({ ref: 'node/12', name: { en: 'Cross', de: 'Kreuz' } }), 'Cross (node/12)');
	assert.equal(placeLabel({ km: 3 }), 'km 3');
	assert.equal(placeLabel({ lat: 47.1, lon: 11.2 }), '47.1, 11.2');
	assert.equal(placeLabel({ lat: 47.1, lon: 11.2, name: 'Bench', demEle: 812 }), 'Bench (47.1, 11.2)');
	assert.equal(placeLabel({ name: { en: 'Car park', de: 'Parkplatz' }, at: 'km 0' }), 'Car park (km 0)');
	assert.equal(placeLabel({ name: 'Car park', at: { ref: 'node/1' } }), 'Car park (node/1)');
	assert.equal(placeLabel({ name: 'Car park' }), 'Car park');
	assert.equal(placeLabel('/_projects/data-viz/hikes/gpx/bailouts/x_out.gpx'), '/_projects/data-viz/hikes/gpx/bailouts/x_out.gpx');
	assert.equal(placeLabel({ foo: 1 }), '{"foo":1}');
	// Named from the store, by a lookup.
	const names = (ref: string) => (ref === 'node/12' ? 'Gatterl' : undefined);
	assert.equal(namedLabel({ ref: 'node/12' }, names), 'Gatterl (node/12)');
	assert.equal(namedLabel({ name: 'Pass', at: { ref: 'node/12' } }, names), 'Pass (Gatterl (node/12))');
	assert.equal(namedLabel({ ref: 'node/13' }, names), 'node/13');
	assert.equal(namedLabel('km 1', names), 'km 1');
});

test('bailoutFiles lists the doc’s bailout routes', () => {
	assert.deepEqual(bailoutFiles({ bailouts: [{ route: '/a.gpx', at: 'X', km: 1 }, { route: '/b.gpx', at: '', km: null }] }), ['/a.gpx', '/b.gpx']);
	assert.deepEqual(bailoutFiles(undefined), []);
	assert.deepEqual(bailoutFiles({ bailouts: 'x' }), []);
});
