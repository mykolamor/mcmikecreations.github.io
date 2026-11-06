// Run with: node_modules/.bin/jiti src/lib/presentation/vendor-manifest.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importMap, vendorDir } from './vendor-manifest.js';

test('the import map points each bare specifier at its versioned vendor file', () => {
	const m = importMap({ d3: '7.9.0', animejs: '4.3.6', three: '0.184.0' });
	assert.equal(m.imports['d3'], '/vendor/d3@7.9.0/d3.esm.js');
	assert.equal(m.imports['animejs'], '/vendor/animejs@4.3.6/anime.esm.min.js');
	assert.equal(m.imports['three'], '/vendor/three@0.184.0/three.module.min.js');
	assert.equal(m.imports['three/addons/'], '/vendor/three@0.184.0/addons/');
	assert.equal(vendorDir('d3', '7.9.0'), '/vendor/d3@7.9.0/');
});
