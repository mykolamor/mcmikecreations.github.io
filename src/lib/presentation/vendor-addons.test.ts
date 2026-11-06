// Run with: node_modules/.bin/jiti src/lib/presentation/vendor-addons.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addonClosure, importSpecifiers, joinRelative } from './vendor-addons.js';

test('import specifiers cover static, bare, re-export and dynamic imports', () => {
	const src = `
		import * as THREE from 'three';
		import { OrbitControls } from "three/addons/controls/OrbitControls.js";
		import './side-effect.js';
		export { x } from '../utils/x.js';
		const m = await import('three/addons/loaders/GLTFLoader.js');
	`;
	assert.deepEqual(importSpecifiers(src), [
		'three',
		'three/addons/controls/OrbitControls.js',
		'./side-effect.js',
		'../utils/x.js',
		'three/addons/loaders/GLTFLoader.js'
	]);
});

test('relative joins normalise and refuse to leave the add-ons folder', () => {
	assert.equal(joinRelative('loaders', '../utils/BufferGeometryUtils.js'), 'utils/BufferGeometryUtils.js');
	assert.equal(joinRelative('', './controls/OrbitControls.js'), 'controls/OrbitControls.js');
	assert.equal(joinRelative('loaders', '../../build/three.module.js'), null);
});

test('the closure follows add-on imports transitively and reports missing files', () => {
	const addons: Record<string, string> = {
		'loaders/GLTFLoader.js': `import { a } from 'three'; import { b } from '../utils/BufferGeometryUtils.js';`,
		'utils/BufferGeometryUtils.js': `import { c } from 'three';`,
		'controls/OrbitControls.js': `import { d } from 'three'; /** @three_import import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; */`
	};
	const content = [
		`import * as THREE from 'three'; import { OrbitControls } from 'three/addons/controls/OrbitControls.js';`,
		`import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; import 'three/addons/nope.js'; import x from 'd3';`
	];
	const { files, missing } = addonClosure(content, 'three/addons/', (f) => addons[f] ?? null);
	assert.deepEqual([...files].sort(), ['controls/OrbitControls.js', 'loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js']);
	assert.deepEqual(missing, ['nope.js']);
});

test('no content imports means no add-ons', () => {
	assert.equal(addonClosure([`import * as d3 from 'd3';`], 'three/addons/', () => '').files.size, 0);
});
