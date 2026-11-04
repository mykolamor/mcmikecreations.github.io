import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listLibrary } from './photo-library';
import { ApiError } from './errors';

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), 'photo-library-'));
	const img = join(root, 'static/images');
	const files = [
		'hikes/topo/buchstein.jpg',
		'hikes/topo/buchstein-640.avif',
		'hikes/topo/buchstein-1280.avif',
		'hikes/topo/bruennstein.png',
		'hikes/topo/bruennstein-640.avif',
		'hikes/topo/notes.md',
		'hikes/topo/.hidden.jpg',
		'hikes/topo/plain.webp',
		'hikes/topo/Shot.JPEG',
		'hikes/topo/orphan-blur.webp',
		'hikes/topo/sub/a.jpg',
		'projects/data-viz/hikes/stories/bar/2023-05-05-02-640.avif',
		'projects/data-viz/hikes/stories/bar/2023-05-05-02-1280.avif',
		'projects/data-viz/hikes/stories/bar/2023-05-05-02-2560.avif',
		'projects/data-viz/hikes/stories/bar/2023-05-05-03-640.avif',
		'projects/data-viz/hikes/stories/bar/2023-05-05-03-blur.webp',
		'projects/data-viz/hikes/stories/bar/standalone.avif'
	];
	for (const f of files) {
		mkdirSync(join(img, f, '..'), { recursive: true });
		writeFileSync(join(img, f), 'x');
	}
	mkdirSync(join(img, 'hikes/.cache'), { recursive: true });
	return root;
}

const repoOnce = repo();

test('a lone blur file is not an image; lists folders and images, tiers and blur collapsed into the base href', () => {
	const root = repo();
	assert.deepEqual(listLibrary(root, 'hikes/topo'), {
		dir: 'hikes/topo',
		folders: ['sub'],
		images: [
			{ href: '/images/hikes/topo/Shot.JPEG' },
			{ href: '/images/hikes/topo/bruennstein.png' },
			{ href: '/images/hikes/topo/buchstein.jpg' },
			{ href: '/images/hikes/topo/plain.webp' }
		]
	});
});

test('tier-only story photos list as the .jpg href addFromLibrary expects; a non-tier .avif is skipped', () => {
	const r = listLibrary(repoOnce, 'projects/data-viz/hikes/stories/bar/');
	assert.equal(r.dir, 'projects/data-viz/hikes/stories/bar');
	assert.deepEqual(r.images, [
		{ href: '/images/projects/data-viz/hikes/stories/bar/2023-05-05-02.jpg' },
		{ href: '/images/projects/data-viz/hikes/stories/bar/2023-05-05-03.jpg' }
	]);
});
test('the root lists top-level folders; hidden folders are left out', () => {
	assert.deepEqual(listLibrary(repoOnce, ''), { dir: '', folders: ['hikes', 'projects'], images: [] });
	assert.deepEqual(listLibrary(repoOnce, 'hikes').folders, ['topo']);
});

test('paths outside static/images are refused with 400, a missing folder with 404', () => {
	for (const bad of ['..', '../_projects', 'hikes/../../x', '/etc', 'hikes/./../..', 'C:\\x', 'hikes\\..\\..']) {
		assert.throws(() => listLibrary(repoOnce, bad), (e) => e instanceof ApiError && e.status === 400, bad);
	}
	assert.throws(() => listLibrary(repoOnce, 'nope'), (e) => e instanceof ApiError && e.status === 404);
	assert.throws(() => listLibrary(repoOnce, 'hikes/topo/buchstein.jpg'), (e) => e instanceof ApiError && e.status === 404);
});
