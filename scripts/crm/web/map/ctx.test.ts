import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeContext } from './ctx';

test('the context reads the newest payload and route, not the ones at creation', () => {
	let data: any = { height: 512 };
	let route: any = null;
	const ctx = makeContext({ map: {} as any, session: {} as any, select() {}, hover: { route() {}, leave() {} } }, () => data, () => route);
	assert.equal(ctx.data.height, 512);
	data = { height: 768 };
	route = { type: 'FeatureCollection' };
	assert.equal(ctx.data.height, 768);
	assert.deepEqual(ctx.routeGeojson, route);
});
