import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGpx } from './gpx';

test('parses trkpt and rtept', () => {
	const trk = '<gpx><trk><trkseg><trkpt lat="47.1" lon="11.2"><ele>1000.5</ele></trkpt><trkpt lon="11.3" lat="47.2"/></trkseg></trk><rte><rtept lat="1" lon="2"/></rte></gpx>';
	assert.deepEqual(parseGpx(trk), [[47.1, 11.2, 1000.5], [47.2, 11.3]]);
	assert.deepEqual(parseGpx('<gpx><rte><rtept lat="1" lon="2"><ele>5</ele></rtept></rte></gpx>'), [[1, 2, 5]]);
	assert.deepEqual(parseGpx('nope'), []);
});
