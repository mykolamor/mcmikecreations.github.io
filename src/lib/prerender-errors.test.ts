// Run with: node_modules/.bin/jiti src/lib/prerender-errors.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePrerenderHttpError } from './prerender-errors.js';

test('a missing optional file only warns', () => {
	const warned: string[] = [];
	const original = console.warn;
	console.warn = (m: string) => warned.push(m);
	try {
		handlePrerenderHttpError({ status: 404, path: '/x.gpx', referrer: '/p/', referenceType: 'fetched', message: '404 /x.gpx' });
	} finally {
		console.warn = original;
	}
	assert.deepEqual(warned, ['404 /x.gpx']);
});

test('a page that failed to render stops the build', () => {
	assert.throws(
		() => handlePrerenderHttpError({ status: 500, path: '/hikes/2026-07-19-x/', referrer: null, referenceType: 'linked', message: '500 /hikes/2026-07-19-x/' }),
		/500 \/hikes\/2026-07-19-x\//
	);
});
