import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoPaths } from '../server/paths';
import { makeTempRepo } from '../server/test-repo';
import { check, checkCommand } from './check';
import { parseArgs } from './index';
import { isTranslationFile } from '../server/translations';
import { missingKeys, stringTables } from '../../../src/lib/i18n/strings';
import { plural } from './posts';
import { recorder } from './test-output';

const go = (root: string, argv: string[] = [], cmd = check) => {
	const out = recorder();
	return cmd.run(root, parseArgs(['check', ...argv]), out).then((code) => ({ code, out }));
};

/**
 * A temp repo with no problems of its own, so every warning is a missing string. The real translated posts go: the temp
 * repo has no images, and a translation showing one that isn't there is an error.
 */
const emptyRepo = () => {
	const root = makeTempRepo();
	const { markdown, geojson } = repoPaths(root);
	mkdirSync(geojson, { recursive: true });
	for (const f of readdirSync(markdown)) if (isTranslationFile(f)) rmSync(path.join(markdown, f));
	return root;
};
/** Adds these records to the temp repo's library: the real hikes still need theirs, or they can't be read. */
const addRecords = (root: string, records: Record<string, Record<string, unknown>>) => {
	const file = repoPaths(root).factsLibrary;
	const library = JSON.parse(readFileSync(file, 'utf8'));
	for (const [kind, list] of Object.entries(records)) library[kind] = { ...library[kind], ...list };
	writeFileSync(file, JSON.stringify(library));
};
const EN = { a: 'A', b: { c: 'C', d: ['D'] } };
const lagging = checkCommand(stringTables({ en: EN, de: { a: 'Ä' } }).missingKeys);
const complete = checkCommand(stringTables({ en: EN, de: { a: 'Ä', b: { c: 'Ç', d: ['Ð'] } } }).missingKeys);

test('check --strict exits 1 on an error', async () => {
	const root = makeTempRepo();
	const p = repoPaths(root);
	mkdirSync(p.geojson, { recursive: true });
	writeFileSync(path.join(p.geojson, 'grosser_laber.json'), '{}');
	writeFileSync(path.join(p.places, 'bad-doc.md'), '---\ntitle: No description\n---\nText\n');

	const loose = await go(root);
	assert.equal(loose.code, 0);
	const line = 'static/_projects/data-viz/hikes/places/bad-doc.md: error: Place doc bad-doc.md: needs a description';
	assert.ok(loose.out.warnings.includes(line), loose.out.warnings.join('\n'));
	assert.ok(loose.out.warnings.every((w) => /^[^:]+: (error|warning|site): /.test(w)), loose.out.warnings.join('\n'));
	assert.match(loose.out.summaries.join('\n'), /^check: \d+ errors?, \d+ warnings?/);

	const strict = await go(root, ['--strict']);
	assert.equal(strict.code, 1);
});

test('check reports a translation with a disallowed key', async () => {
	const root = makeTempRepo();
	const p = repoPaths(root);
	mkdirSync(p.geojson, { recursive: true });
	writeFileSync(path.join(p.geojson, 'grosser_laber.json'), '{}');
	writeFileSync(path.join(p.places, 'hut.md'), '---\ntitle: Hut\ndescription: A hut.\n---\nText\n');
	writeFileSync(path.join(p.places, 'hut.de.md'), '---\ntitle: Hütte\ntags: [x]\n---\nText\n');
	writeFileSync(path.join(p.places, 'gone.de.md'), '---\ntitle: Weg\n---\nText\n');
	writeFileSync(path.join(p.places, 'hut.fr.md'), '---\ntitle: Cabane\n---\nText\n');
	writeFileSync(path.join(p.markdown, '2024-01-01-grosser_laber.md'), '---\ntitle: Laber\n---\nText\n');
	writeFileSync(path.join(p.markdown, '2024-01-01-grosser_laber.de.md'), '---\ntitle: Laber\n---\n![x](/images/nope.jpg)\n');

	const { code, out } = await go(root, ['--strict']);
	const rel = (f: string) => path.relative(root, f);
	const has = (file: string, re: RegExp) => out.warnings.some((w) => w.startsWith(`${rel(file)}: error: `) && re.test(w));
	assert.ok(has(path.join(p.places, 'hut.de.md'), /unknown front matter key "tags"/), out.warnings.join('\n'));
	assert.ok(has(path.join(p.places, 'gone.de.md'), /no gone\.md beside it/), out.warnings.join('\n'));
	assert.ok(has(path.join(p.places, 'hut.fr.md'), /Unknown language "fr"/), out.warnings.join('\n'));
	assert.ok(has(path.join(p.markdown, '2024-01-01-grosser_laber.de.md'), /\/images\/nope\.jpg does not exist/), out.warnings.join('\n'));
	assert.equal(code, 1);
	assert.doesNotMatch(out.summaries.join('\n'), /3 place docs/, 'translations are not counted as place docs');
});

test('check lists the missing keys of the tables it is given as warnings', async () => {
	const { code, out } = await go(emptyRepo(), [], lagging);
	assert.equal(code, 0);
	const missing = out.warnings.filter((w) => w.includes('i18n/'));
	assert.deepEqual(missing, ['src/lib/hikes/i18n/de.json: warning: missing "b.c"', 'src/lib/hikes/i18n/de.json: warning: missing "b.d"']);
	assert.ok(out.summaries.includes('check: de is missing 2 strings'), out.summaries.join('\n'));
	assert.match(out.summaries[0], /^check: 0 errors, \d+ warnings? \(plus 2 missing strings\) across /);
});

test('check prints no missing keys for a complete table', async () => {
	const { out } = await go(emptyRepo(), [], complete);
	assert.deepEqual(out.warnings.filter((w) => w.includes('i18n/')), []);
	assert.ok(!out.summaries.some((s) => /missing/.test(s)), out.summaries.join('\n'));
});

test('check prints every warning before its summary', async () => {
	const { out } = await go(emptyRepo(), [], lagging);
	const firstSummary = out.lines.findIndex((l) => l.startsWith('check: '));
	const lastWarning = out.lines.findLastIndex((l) => !l.startsWith('check: '));
	assert.ok(firstSummary > lastWarning, out.lines.join('\n'));
});

test('check reads the site\'s own tables by default', async () => {
	const { out } = await go(emptyRepo());
	const missing = missingKeys('de');
	assert.deepEqual(out.warnings.filter((w) => w.includes('i18n/')), missing.map((key) => `src/lib/hikes/i18n/de.json: warning: missing "${key}"`));
	assert.equal(out.summaries.includes(`check: de is missing ${plural(missing.length, 'string')}`), missing.length > 0, out.summaries.join('\n'));
});

test('--strict ignores missing keys', async () => {
	const { code, out } = await go(emptyRepo(), ['--strict'], lagging);
	assert.ok(out.warnings.some((w) => w.startsWith('src/lib/hikes/i18n/de.json: warning: missing ')));
	assert.equal(code, 0, out.warnings.filter((w) => !w.includes('de.json')).join('\n'));
});

const LIBRARY = 'facts-library.json';

test('check reports a malformed library record', async () => {
	const root = emptyRepo();
	writeFileSync(repoPaths(root).factsLibrary, JSON.stringify({ transport: { 'Bad Id': { mode: 'bus' } } }));
	const { code, out } = await go(root, ['--strict']);
	assert.equal(code, 1);
	const line = out.warnings.find((w) => w.startsWith(`${LIBRARY}: error: `));
	assert.ok(line, out.warnings.join('\n'));
	assert.match(line, /transport\.Bad Id/);

	writeFileSync(repoPaths(root).factsLibrary, '{ not json');
	const broken = await go(root, ['--strict']);
	assert.equal(broken.code, 1);
	assert.ok(broken.out.warnings.some((w) => w.startsWith(`${LIBRARY}: error: `)), broken.out.warnings.join('\n'));
});

test('check warns about an unused record', async () => {
	const root = emptyRepo();
	addRecords(root, {
		stops: { 'way/60315210': { kind: 'restaurant' }, 'node/1': { kind: 'shelter' } },
		transport: { 'rb60-munich-ehrwald': { mode: 'train', from: 'Munich', to: 'Ehrwald' } },
		lifts: { 'old-lift': { name: 'Old lift' } },
		parking: { 'old-lot': { name: 'Old lot' } },
		tickets: { 'old-ticket': { name: 'Old ticket' } }
	});
	const { code, out } = await go(root, ['--strict']);
	assert.equal(code, 0, out.warnings.join('\n'));
	const unused = out.warnings.filter((w) => w.startsWith(`${LIBRARY}: warning: `));
	assert.deepEqual(unused, [
		`${LIBRARY}: warning: stop "node/1" is used by no hike`,
		`${LIBRARY}: warning: transport "rb60-munich-ehrwald" is used by no hike`,
		`${LIBRARY}: warning: lift "old-lift" is used by no hike`,
		`${LIBRARY}: warning: parking "old-lot" is used by no hike`,
		`${LIBRARY}: warning: ticket "old-ticket" is used by no hike`
	]);
});

/** A hike of its own in the temp repo (no post), with these facts. */
const addHike = (root: string, slug: string, facts: unknown) => {
	const p = repoPaths(root);
	const base = JSON.parse(readFileSync(path.join(p.markdown, 'mahnkopf.hike.json'), 'utf8'));
	writeFileSync(path.join(p.markdown, `${slug}.hike.json`), JSON.stringify({ ...base, facts }));
};
const libraryLines = (warnings: string[]) => warnings.filter((w) => w.startsWith(`${LIBRARY}: `));

test('check does not warn about a record a hike uses or a stop attaches', async () => {
	const root = emptyRepo();
	addRecords(root, {
		stops: { 'node/1638504578': { kind: 'shelter' }, 'node/1': { kind: 'shelter' } },
		transport: { x: { mode: 'bus', from: 'A', to: 'B' }, y: { mode: 'bus', from: 'C', to: 'D' } }
	});
	addHike(root, 'probe_used', { access: { transport: [{ use: 'x' }] }, stops: [{ at: { ref: 'node/1638504578' } }] });
	const { out } = await go(root);
	assert.deepEqual(libraryLines(out.warnings), [
		`${LIBRARY}: warning: stop "node/1" is used by no hike`,
		`${LIBRARY}: warning: transport "y" is used by no hike`
	]);
});

test('check names the hikes it could not read on an unused-record warning', async () => {
	const root = emptyRepo();
	addRecords(root, { transport: { y: { mode: 'bus', from: 'C', to: 'D' } } });
	addHike(root, 'probe_broken', { access: { transport: [{ use: 'nowhere' }] } });
	const { out } = await go(root);
	assert.deepEqual(libraryLines(out.warnings), [`${LIBRARY}: warning: transport "y" is used by no hike (could not read: probe_broken)`]);
});

test('check reports a mistyped use as an error naming the hike file and the id', async () => {
	const root = emptyRepo();
	writeFileSync(repoPaths(root).factsLibrary, JSON.stringify({ transport: { y: { mode: 'bus', from: 'C', to: 'D' } } }));
	addHike(root, 'probe_typo', { access: { transport: [{ use: 'typo-id' }] } });
	const { code, out } = await go(root, ['--strict']);
	assert.equal(code, 1);
	const line = out.warnings.find((w) => w.startsWith('static/_projects/data-viz/hikes/markdown/probe_typo.hike.json: error: '));
	assert.ok(line, out.warnings.join('\n'));
	assert.match(line, /typo-id/);
});

test('check reads every post of the real data, so an unused-record warning names no unread hike', async () => {
	const root = emptyRepo();
	addRecords(root, { transport: { y: { mode: 'bus', from: 'C', to: 'D' } } });
	const { out } = await go(root);
	assert.deepEqual(libraryLines(out.warnings), [`${LIBRARY}: warning: transport "y" is used by no hike`]);
});
