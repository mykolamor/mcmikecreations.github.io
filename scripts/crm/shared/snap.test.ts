import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snap } from './snap';

const p = { lat: 47.7, lon: 11.5 };
const northBy = (m: number, tag: string) => ({ lat: p.lat + m / 111194.9266, lon: p.lon, tag });

test('nearest within 30 m wins, 31 m is null', () => {
	assert.equal(snap(p, [northBy(25, 'far'), northBy(10, 'near')])?.tag, 'near');
	assert.equal(snap(p, [northBy(31, 'x')]), null);
	assert.equal(snap(p, []), null);
});

test('ties go to the earlier candidate; radius is configurable', () => {
	assert.equal(snap(p, [northBy(10, 'a'), { ...northBy(10, 'b') }])?.tag, 'a');
	assert.equal(snap(p, [northBy(50, 'x')], 60)?.tag, 'x');
});
