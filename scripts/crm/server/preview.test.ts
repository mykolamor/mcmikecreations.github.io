import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { previewHtml } from './preview';
import { repoPaths } from './paths';
import { makeTempRepo } from './test-repo';

const REAL_ROOT = path.resolve(__dirname, '../../..');

// The site's own modules, through the site's Vite config (its globs and caches), as the page loader runs them.
let vite: ViteDevServer | null = null;
async function site(): Promise<ViteDevServer> {
	return (vite ??= await createServer({ root: REAL_ROOT, configFile: path.join(REAL_ROOT, 'vite.config.ts'), logLevel: 'error', server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' }));
}
after(() => vite?.close());

// The loader fetches served paths; answer from static/ (read-only).
const fetchStatic = async (url: string, init?: { method?: string }) => {
	try {
		const body = readFileSync(path.join(REAL_ROOT, 'static', url));
		return new Response(init?.method === 'OPTIONS' ? null : body, { status: 200 });
	} catch {
		return new Response(null, { status: 404 });
	}
};

test('preview of a real post matches the site renderer\'s body HTML', async () => {
	const s = await site();
	const { load } = await s.ssrLoadModule('/src/routes/hikes/[slug]/+page.server.ts');
	const { parseMarkdown } = await s.ssrLoadModule('/src/lib/hikes/hikes-info.ts');
	const { storeNodes } = await s.ssrLoadModule('/src/lib/data/hikes-db.ts');
	const data = await load({ fetch: fetchStatic, params: { slug: '2025-06-21-zugspitze_reintal' }, locals: {} });
	const raw = readFileSync(path.join(repoPaths(REAL_ROOT).markdown, '2025-06-21-zugspitze_reintal.md'), 'utf8');
	// The loader's own inputs to parseMarkdown, without photo stops (the preview has none).
	const body = (await parseMarkdown(raw, data.post.tags, { nodes: storeNodes(), origin: data.origin, height: data.height, ownRefs: data.ownRefs, placeDocs: data.placeRefs, pinNodes: data.pinNodes })).html;
	assert.ok(data.places.length > 0, 'the post lists a place doc');

	const { html } = await previewHtml(REAL_ROOT, { kind: 'post', slug: 'zugspitze_reintal', date: '2025-06-21' });
	assert.ok(html.startsWith(body), 'the body is the renderer\'s HTML, byte for byte');
	// Then each place doc as the loader renders it (media indices continuing), in its own section.
	let at = body.length;
	for (const place of data.places as { slug: string; html: string }[]) {
		const section = html.indexOf(`id="place-${place.slug}"`, at);
		assert.ok(section > 0, `section for ${place.slug}`);
		const doc = html.indexOf(place.html, section);
		assert.ok(doc > section, `${place.slug} is the loader's HTML`);
		at = doc + place.html.length;
	}
});

test('preview of a place doc renders its body', async () => {
	const s = await site();
	const { parseMarkdown } = await s.ssrLoadModule('/src/lib/hikes/hikes-info.ts');
	const { storeNodes } = await s.ssrLoadModule('/src/lib/data/hikes-db.ts');
	const { pinNodesFor } = await s.ssrLoadModule('/src/lib/hikes/photo-pins.server.ts');
	const { readHikeFrontmatter } = await s.ssrLoadModule('/src/lib/hikes/frontmatter.server.ts');
	const raw = readFileSync(path.join(repoPaths(REAL_ROOT).places, 'knorrhuette.md'), 'utf8');
	const pinNodes = pinNodesFor([{ data: readHikeFrontmatter(raw).data, source: 'places/knorrhuette.md' }]);
	const expected = (await parseMarkdown(raw, [], { nodes: storeNodes(), widgets: false, styles: true, pinNodes })).html;

	const { html } = await previewHtml(REAL_ROOT, { kind: 'place', slug: 'knorrhuette' });
	assert.ok(html.includes(expected), 'the doc body as the renderer makes it, with its style block');
	assert.match(html, /id="place-knorrhuette"/);
	assert.match(html, /Knorrhütte/);
	assert.match(html, /DAV hut at 2051 m/);
});

test('preview uses osm.json as it is on disk now', async () => {
	const root = makeTempRepo();
	const ref = { kind: 'post' as const, slug: 'zugspitze_reintal', date: '2025-06-21' };
	const linked = /<a class="mk-place"[^>]*>Knorrhütte/;
	assert.match((await previewHtml(root, ref)).html, linked);

	// The hut is renamed in the store (another tab, the IDE): the next preview no longer links its old name.
	const file = repoPaths(root).osmStore;
	const store = JSON.parse(readFileSync(file, 'utf8'));
	const hut = Object.keys(store).find((r) => store[r].tags?.name === 'Knorrhütte');
	assert.ok(hut, 'the store has the hut');
	store[hut].local = { ...store[hut].local, name: 'Knorrhaus' };
	writeFileSync(file, JSON.stringify(store, null, 2) + '\n');
	assert.doesNotMatch((await previewHtml(root, ref)).html, linked);
});
