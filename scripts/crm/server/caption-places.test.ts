import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionPlaces } from './caption-places';

const NODES = [
	{ ref: 'node/1', lat: 47.1, lon: 11.1, tags: { name: 'Wallberg', ele: '1722' } },
	{ ref: 'node/2', lat: 47.2, lon: 11.2, tags: { name: 'Palon de Tovre', ele: '1913' } },
	{ ref: 'node/3', lat: 47.3, lon: 11.3, tags: { name: 'Riederstein' } },
	{ ref: 'node/4', lat: 47.4, lon: 11.4, tags: { name: 'Tegernsee' } }
];

test('places named in a caption: references with a height and plain whole names, each once', () => {
	const got = captionPlaces('View from Riederstein towards Wallberg (1722 m) and Tovre (1913 m), Wallberg again', NODES);
	assert.deepEqual(got.map((p) => p.ref), ['node/3', 'node/1', 'node/2']);
	assert.deepEqual(got[1], { ref: 'node/1', name: 'Wallberg', lat: 47.1, lon: 11.1 });
});

test('link targets and lowercase words do not count; no nodes, no places', () => {
	assert.deepEqual(captionPlaces('by [tegernsee](https://x.example/Wallberg)', NODES), []);
	assert.deepEqual(captionPlaces('Wallberg', []), []);
	assert.deepEqual(captionPlaces('', NODES), []);
});
