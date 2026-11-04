import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBase, type BaseDef } from './base-pick';

const defs = (trace: boolean): BaseDef<any>[] => [
	{ id: 'tracestrack', label: 'T', layer: trace ? ({} as any) : null },
	{ id: 'osm', label: 'O', layer: {} as any },
	{ id: 'mapy', label: 'M', layer: {} as any }
];

test('default base is Tracestrack with a key, else Mapy; a saved usable choice wins', () => {
	assert.equal(pickBase(defs(true), null).id, 'tracestrack');
	assert.equal(pickBase(defs(false), null).id, 'mapy');
	assert.equal(pickBase(defs(false), 'tracestrack').id, 'mapy');
	assert.equal(pickBase(defs(true), 'osm').id, 'osm');
});
