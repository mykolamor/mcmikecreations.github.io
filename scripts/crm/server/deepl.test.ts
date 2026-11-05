import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	DeeplError,
	FREE_URL,
	PRO_URL,
	deeplStub,
	deeplTarget,
	protect,
	restore,
	translateBatch
} from './deepl';
import { createApi, defaultRoutes, type ApiRequest } from './api';

type Call = {
	url: string;
	init: RequestInit;
	body: {
		text: string[];
		target_lang: string;
		source_lang: string;
		tag_handling: string;
		ignore_tags: string[];
		preserve_formatting: boolean;
	};
};

/** The stub as a fetch that records each request. */
function recording(answer: typeof fetch = deeplStub) {
	const calls: Call[] = [];
	const fetch = (async (url: string, init: RequestInit) => {
		calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
		return answer(url, init);
	}) as typeof globalThis.fetch;
	return { calls, fetch };
}

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a photo line, a link target, a URL, a mention and a {tag} are protected and restored exactly', () => {
	const text = [
		'## The way up',
		'',
		'![Road to Buchstein (1701 m) by [David Bilan](https://bilandavid.com/)](/images/x/2025-05-11-08.mp4 "autoplay")',
		'  ![](https://www.youtube.com/embed/abc)  ',
		'After Knorrhütte (2052 m) we took [the path](https://example.com/a_(b)?x=1&y=2) & saw <span lang="de">Gipfel</span>.',
		'- See https://www.alpenverein.de/huts, then `code <b>` and {count} more.',
		'> 1. Quoted'
	].join('\n');
	const { tagged, spans } = protect(text, 'markdown');
	for (const kept of [
		'## ',
		// A photo or video line keeps its markup and target; its caption is translated (a mention or link in it kept).
		'![',
		'](/images/x/2025-05-11-08.mp4 "autoplay")',
		'Buchstein (1701 m)',
		'](https://bilandavid.com/)',
		'  ![',
		'](https://www.youtube.com/embed/abc)  ',
		'Knorrhütte (2052 m)',
		'](https://example.com/a_(b)?x=1&y=2)',
		'<span lang="de">',
		'</span>',
		'- ',
		'https://www.alpenverein.de/huts',
		'`code <b>`',
		'{count}',
		'> 1. '
	])
		assert.ok(spans.includes(kept), kept);
	// What DeepL sees: the words to translate, escaped, and placeholders only.
	assert.ok(!/https?:|Knorrhütte|\{count\}|<span/.test(tagged), tagged);
	assert.match(
		tagged,
		/After <x id="\d+"\/> we took \[the path<x id="\d+"\/> &amp; saw <x id="\d+"\/>Gipfel<x id="\d+"\/>\./
	);
	assert.equal(restore(tagged, spans), text);
	// A translation keeps the placeholders and changes the words around them.
	const de = tagged.replace('The way up', 'Der Weg hinauf').replace('we took', 'nahmen wir');
	assert.equal(
		restore(de, spans),
		text.replace('The way up', 'Der Weg hinauf').replace('we took', 'nahmen wir')
	);

	const plain = protect('See https://x.org/a & {name} (1234 m)', 'plain');
	assert.deepEqual(plain.spans, ['https://x.org/a', '{name}']);
	assert.equal(plain.tagged, 'See <x id="0"/> &amp; <x id="1"/> (1234 m)');

	const table = protect('{count, plural, one {# hike} other {# hikes}} by {name}', 'table');
	assert.deepEqual(table.spans, ['{count, plural, one {# hike} other {# hikes}}', '{name}']);
	assert.equal(
		restore(table.tagged.replace(' by ', ' von '), table.spans),
		'{count, plural, one {# hike} other {# hikes}} von {name}'
	);
});

test('a table string protects its link targets and URLs, as well as its placeholders', () => {
	const text = 'See [tags](/hikes/tag/Climb/) and https://x.org for {count} hikes';
	const { tagged, spans } = protect(text, 'table');
	assert.deepEqual(spans, ['](/hikes/tag/Climb/)', 'https://x.org', '{count}']);
	// A DeepL that changes every word outside the tags: only the words change.
	const words = (s: string) => s.replace(/\p{L}+/gu, (w) => w.toUpperCase());
	const de = tagged.replace(/(<x id="\d+"\/>)|([^<]+)/g, (_, tag, rest) => tag ?? words(rest));
	assert.equal(
		restore(de, spans),
		'SEE [TAGS](/hikes/tag/Climb/) AND https://x.org FOR {count} HIKES'
	);
});

test('a placeholder inside a table link target or URL goes with it', () => {
	const text = 'Go [there](/hikes/tag/{tag}/) or https://x.org/t/{tag}/ for {n, select, 1 {one} other {{n} hikes}} now';
	const { tagged, spans } = protect(text, 'table');
	assert.deepEqual(spans, ['](/hikes/tag/{tag}/)', 'https://x.org/t/{tag}/', '{n, select, 1 {one} other {{n} hikes}}']);
	const words = (s: string) => s.replace(/\p{L}+/gu, (w) => w.toUpperCase());
	const de = tagged.replace(/(<x id="\d+"\/>)|([^<]+)/g, (_, tag, rest) => tag ?? words(rest));
	assert.equal(restore(de, spans), 'GO [THERE](/hikes/tag/{tag}/) OR https://x.org/t/{tag}/ FOR {n, select, 1 {one} other {{n} hikes}} NOW');
});

test('numeric character references in an answer are decoded', () => {
	assert.equal(restore('It&#x27;s &#34;here&#X27; &#39;', []), `It's "here' '`);
});

test('a mangled placeholder refuses that text instead of writing it', async () => {
	const { tagged, spans } = protect('See https://x.org/a and {name}.', 'plain');
	assert.equal(restore(tagged.replace('<x id="0"/>', ''), spans), null, 'missing');
	assert.equal(restore(tagged.replace('<x id="1"/>', '<x id="0"/>'), spans), null, 'repeated');
	assert.equal(restore(tagged.replace('<x id="1"/>', '<x id="7"/>'), spans), null, 'unknown');
	assert.equal(restore(tagged.replace('<x id="1"/>', '<x id="1">'), spans), null, 'broken tag');

	// DeepL answers the URL rewritten for the first text: it is refused, the second is kept.
	const { calls, fetch } = recording(async (_url, init) => {
		const texts: string[] = JSON.parse(String(init!.body)).text;
		return json(200, {
			translations: texts.map((t, i) => ({
				detected_source_language: 'EN',
				text: i === 0 ? t.replace(/<x id="0"\/>/, 'https://x.org/b') : `DE ${t}`
			}))
		});
	});
	const out = await translateBatch(
		[
			{ id: 'a', text: 'See https://x.org/a here.', kind: 'plain' },
			{ id: 'b', text: 'Read {name}.', kind: 'plain' }
		],
		'de',
		{ key: 'k', fetch }
	);
	assert.equal(calls.length, 1);
	assert.deepEqual(out.texts, [{ id: 'b', text: 'DE Read {name}.' }]);
	assert.deepEqual(
		out.refused.map((r) => r.id),
		['a']
	);
	assert.match(out.refused[0].reason, /protected/);

	// A plain text whose line count changed is refused too (markdown's line breaks are put back: see below).
	const lines = recording(async (_url, init) =>
		json(200, {
			translations: JSON.parse(String(init!.body)).text.map((t: string) => ({
				text: t.replace('\n', ' ')
			}))
		})
	);
	const two = await translateBatch([{ id: 'p', text: 'One\nTwo', kind: 'plain' }], 'de', {
		key: 'k',
		fetch: lines.fetch
	});
	assert.deepEqual(two.texts, []);
	assert.deepEqual(
		two.refused.map((r) => r.id),
		['p']
	);
});

test('a photo caption is translated and its line kept', async () => {
	const text = 'Up we went.\n\n![The view from the top](/images/x/p1.jpg)\n![](/images/x/p2.jpg)';
	const answer = (edit: (t: string) => string) =>
		recording(async (_url, init) =>
			json(200, {
				translations: JSON.parse(String(init!.body)).text.map((t: string) => ({ text: edit(t) }))
			})
		).fetch;
	const ok = await translateBatch([{ id: 'p', text, kind: 'markdown' }], 'de', {
		key: 'k',
		fetch: answer((t) => t.replace('Up we went.', 'Wir stiegen auf.').replace('The view from the top', 'Der Blick vom Gipfel'))
	});
	assert.deepEqual(ok.texts, [{ id: 'p', text: 'Wir stiegen auf.\n\n![Der Blick vom Gipfel](/images/x/p1.jpg)\n![](/images/x/p2.jpg)' }]);
	// Words put after a photo's target: no photo line any more, refused.
	const broken = await translateBatch([{ id: 'b', text, kind: 'markdown' }], 'de', {
		key: 'k',
		fetch: answer((t) => t.replace('The view from the top', 'Der Blick').replace(/(<x id="\d+"\/>)$/, '$1 vom Gipfel'))
	});
	assert.deepEqual(broken.texts, []);
	assert.deepEqual(broken.refused, [{ id: 'b', reason: 'DeepL broke a photo or video line' }]);
});

test('an answer that moves a list or heading marker off its line start is refused', async () => {
	const text = '## The way up\n- First\n- Second';
	const answer = (edit: (t: string) => string) =>
		recording(async (_url, init) =>
			json(200, {
				translations: JSON.parse(String(init!.body)).text.map((t: string) => ({ text: edit(t) }))
			})
		).fetch;
	// The second marker moved to the middle of its line, the line count kept.
	const moved = await translateBatch([{ id: 'm', text, kind: 'markdown' }], 'de', {
		key: 'k',
		fetch: answer((t) => t.replace('\n<x id="2"/>Second', '\nZweite <x id="2"/>'))
	});
	assert.deepEqual(moved.texts, []);
	assert.deepEqual(moved.refused, [{ id: 'm', reason: 'DeepL moved a list or heading marker' }]);
	// Words around the markers translated, the markers where they were: kept.
	const kept = await translateBatch([{ id: 'k', text, kind: 'markdown' }], 'de', {
		key: 'k',
		fetch: answer((t) => t.replace('The way up', 'Der Weg hinauf'))
	});
	assert.deepEqual(kept.texts, [{ id: 'k', text: '## Der Weg hinauf\n- First\n- Second' }]);
	// The stub keeps a leading marker at the start: its prefix goes after it.
	const stub = await translateBatch([{ id: 's', text, kind: 'markdown' }], 'de', {
		key: 'k',
		fetch: deeplStub
	});
	assert.deepEqual(stub.texts, [{ id: 's', text: '## ⟨de⟩ The way up\n- First\n- Second' }]);
});

test('texts over 50 go in several requests in order', async () => {
	const { calls, fetch } = recording();
	const texts = Array.from({ length: 120 }, (_, i) => ({
		id: `t${i}`,
		text: `Text ${i} at https://x.org/${i}`,
		kind: 'markdown' as const
	}));
	const out = await translateBatch(texts, 'de', { key: 'k', fetch });
	assert.deepEqual(
		calls.map((c) => c.body.text.length),
		[50, 50, 20]
	);
	assert.deepEqual(
		out.texts.map((t) => t.id),
		texts.map((t) => t.id)
	);
	assert.equal(out.texts[73].text, '⟨de⟩ Text 73 at https://x.org/73');
	assert.deepEqual(out.refused, []);
	const b = calls[0].body;
	assert.deepEqual(
		{
			source_lang: b.source_lang,
			target_lang: b.target_lang,
			tag_handling: b.tag_handling,
			ignore_tags: b.ignore_tags,
			preserve_formatting: b.preserve_formatting
		},
		{
			source_lang: 'EN',
			target_lang: 'DE',
			tag_handling: 'xml',
			ignore_tags: ['x'],
			preserve_formatting: true
		}
	);
	assert.equal(calls[0].init.method, 'POST');
	assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'DeepL-Auth-Key k');
	assert.equal(deeplTarget('de'), 'DE');
	assert.equal(deeplTarget('en'), null);
});

test('the free key uses the free endpoint', async () => {
	const { calls, fetch } = recording();
	await translateBatch([{ id: 'a', text: 'Hi', kind: 'plain' }], 'de', { key: 'abc:fx', fetch });
	await translateBatch([{ id: 'a', text: 'Hi', kind: 'plain' }], 'de', { key: 'abc', fetch });
	assert.deepEqual(
		calls.map((c) => c.url),
		[FREE_URL, PRO_URL]
	);
	assert.equal(FREE_URL, 'https://api-free.deepl.com/v2/translate');
	assert.equal(PRO_URL, 'https://api.deepl.com/v2/translate');
});

test('quota and network errors are reported by kind', async () => {
	const one = [{ id: 'a', text: 'Hi', kind: 'plain' as const }];
	const kindOf = async (fetch: typeof globalThis.fetch) => {
		try {
			await translateBatch(one, 'de', { key: 'k', fetch });
		} catch (e) {
			assert.ok(e instanceof DeeplError);
			return e.kind;
		}
		return 'none';
	};
	assert.equal(await kindOf(async () => json(456, { message: 'Quota exceeded' })), 'quota');
	assert.equal(await kindOf(async () => json(429, { message: 'Too many requests' })), 'rate');
	assert.equal(await kindOf(async () => json(403, { message: 'Forbidden' })), 'http');
	assert.equal(await kindOf(async () => json(503, { message: 'Unavailable' })), 'http');
	assert.equal(await kindOf(async () => new Response('<html>', { status: 200 })), 'http');
	assert.equal(
		await kindOf(async () => {
			throw new TypeError('fetch failed');
		}),
		'network'
	);

	// The route maps them to 502 with the kind, and writes nothing.
	const api = createApi(
		'/tmp/none',
		defaultRoutes({
			settings: () => ({ deeplKey: 'k' }),
			deeplFetch: async () => json(456, { message: 'Quota exceeded' })
		})
	);
	const res = await api(post({ lang: 'de', texts: one }));
	assert.equal(res.status, 502);
	assert.equal((res.json as { error: string }).error, 'quota');
});

const post = (json: unknown): ApiRequest => ({
	method: 'POST',
	path: '/api/deepl/translate',
	query: new URLSearchParams(),
	headers: {},
	json
});

test('no key answers no-key without a request', async () => {
	const { calls, fetch } = recording();
	const api = createApi('/tmp/none', defaultRoutes({ settings: () => ({}), deeplFetch: fetch }));
	const res = await api(post({ lang: 'de', texts: [{ id: 'a', text: 'Hi', kind: 'plain' }] }));
	assert.equal(res.status, 503);
	assert.equal((res.json as { error: string }).error, 'no-key');
	assert.match((res.json as { message: string }).message, /deeplKey.*DEEPL_API_KEY/);
	assert.equal(calls.length, 0);
	const status = await api({ ...post(undefined), method: 'GET', path: '/api/deepl/status' });
	assert.deepEqual(status.json, { configured: false, targets: ['de', 'uk'] });

	// With a key: the stub's answer, restored.
	const keyed = createApi(
		'/tmp/none',
		defaultRoutes({ settings: () => ({ deeplKey: 'k' }), deeplFetch: fetch })
	);
	const ok = await keyed(
		post({ lang: 'de', texts: [{ id: 'a', text: 'Go to https://x.org', kind: 'markdown' }] })
	);
	assert.deepEqual(ok, {
		status: 200,
		json: { texts: [{ id: 'a', text: '⟨de⟩ Go to https://x.org' }], refused: [] }
	});
	assert.deepEqual(
		(await keyed({ ...post(undefined), method: 'GET', path: '/api/deepl/status' })).json,
		{ configured: true, targets: ['de', 'uk'] }
	);
	for (const bad of [
		{ lang: 'en', texts: [] },
		{ lang: 'de', texts: [{ id: 'a', text: 1, kind: 'plain' }] },
		{ lang: 'de', texts: [{ id: 'a', text: 'x', kind: 'html' }] },
		{ lang: 'de' }
	])
		assert.equal((await keyed(post(bad))).status, 400, JSON.stringify(bad));
});

test('the key is never in an error message', async () => {
	const key = 'secret-1234-abcd:fx';
	const one = [{ id: 'a', text: 'Hi', kind: 'plain' as const }];
	const answers: (typeof globalThis.fetch)[] = [
		async () => json(403, { message: `Wrong key ${key}` }),
		async () => json(500, { message: `Internal error for ${key}` }),
		async () => {
			throw new Error(`connect failed with DeepL-Auth-Key ${key}`);
		}
	];
	for (const fetch of answers) {
		const err = await translateBatch(one, 'de', { key, fetch }).then(
			() => null,
			(e: unknown) => e
		);
		assert.ok(err instanceof DeeplError);
		assert.ok(!err.message.includes(key), err.message);
		assert.ok(!String(err.stack).includes(key));
		assert.ok(!JSON.stringify(err).includes(key));
		const api = createApi(
			'/tmp/none',
			defaultRoutes({ settings: () => ({ deeplKey: key }), deeplFetch: fetch })
		);
		const res = await api(post({ lang: 'de', texts: one }));
		assert.equal(res.status, 502);
		assert.ok(!JSON.stringify(res.json).includes(key));
	}
});

/** `text` (markdown) translated by a DeepL that answers `answer`. */
async function answered(text: string, answer: string) {
	const { fetch } = recording(async () => json(200, { translations: [{ text: answer }] }));
	return translateBatch([{ id: 'x', text, kind: 'markdown' }], 'de', { key: 'k', fetch });
}

test('line breaks DeepL added around two photo lines are undone', async () => {
	// DeepL's real answers for two blocks of a post.
	const below = await answered(
		'![Kühzagl-Alm (1064 m) from below](/i/08.jpg)\n![View from the road towards Rohrkopf (1316 m)](/i/09.jpg)',
		'<x id="0"/>\n<x id="1"/>\nvon unten <x id="2"/>\n\n<x id="3"/>\nBlick von der Straße in Richtung <x id="4"/>\n<x id="5"/>'
	);
	assert.deepEqual(below, {
		texts: [{ id: 'x', text: '![Kühzagl-Alm (1064 m) von unten](/i/08.jpg)\n![Blick von der Straße in Richtung Rohrkopf (1316 m)](/i/09.jpg)' }],
		refused: []
	});
	const alpacas = await answered(
		'![View from Kühzagl towards Wallberg (1722 m)](/i/10.jpg)\n![Alpacas on a farm](/i/11.jpg)',
		'<x id="0"/>\nBlick von Kühzagl in Richtung <x id="1"/><x id="2"/>\n\n<x id="3"/>\nAlpakas auf einem Bauernhof<x id="4"/>'
	);
	assert.deepEqual(alpacas.texts[0].text, '![Blick von Kühzagl in Richtung Wallberg (1722 m)](/i/10.jpg)\n![Alpakas auf einem Bauernhof](/i/11.jpg)');
});

test('a wrapped paragraph keeps its number of lines, with no space before punctuation or inside a link', async () => {
	const text = 'Near [the hike](/404/) it is nice. [Wallberg (1722 m) up close](/404/),\n[Blauberge far](/b/), easily seen\n[Leonhardstein (1452 m)](/404/) too.';
	const out = await answered(
		text,
		'Bei [der Wanderung<x id="0"/>\nist es schön. [<x id="1"/>\naus der Nähe<x id="2"/>\n,\n[die Blauberge<x id="3"/>\n, gut zu sehen\n[<x id="4"/><x id="5"/>\nebenfalls.'
	);
	assert.deepEqual(out.refused, []);
	assert.equal(out.texts[0].text.split('\n').length, 3);
	assert.equal(
		out.texts[0].text.replaceAll('\n', ' '),
		'Bei [der Wanderung](/404/) ist es schön. [Wallberg (1722 m) aus der Nähe](/404/), [die Blauberge](/b/), gut zu sehen [Leonhardstein (1452 m)](/404/) ebenfalls.'
	);
});

test('a line break is not put where it would start a list', async () => {
	const out = await answered('Aaaaaaaa bbb\ncc', 'Wirklich - a');
	assert.deepEqual(out.texts, [{ id: 'x', text: 'Wirklich -\na' }]);
});

test('a word DeepL moved out of a photo caption is still refused', async () => {
	const out = await answered(
		'![The road towards Krainsbergkogel (1037 m)](/i/01.jpg)',
		'<x id="0"/>Die Straße in Richtung <x id="1"/><x id="2"/> führt'
	);
	assert.deepEqual(out.refused, [{ id: 'x', reason: 'DeepL broke a photo or video line' }]);
});

test('line breaks that mean something are not rebuilt: the answer stays refused', async () => {
	for (const text of ['One  \nTwo', 'One\\\nTwo', '- One\n  two', '| a |\n| b |', '```\nOne\n```']) {
		const out = await answered(text, protect(text, 'markdown').tagged.replaceAll('\n', ' '));
		assert.deepEqual(out.refused.map((r) => r.reason), ['DeepL changed the line breaks'], JSON.stringify(text));
	}
});

test('photo lines DeepL put in another order are not rebuilt', async () => {
	const out = await answered('![A](/i/1.jpg)\n![B](/i/2.jpg)', '<x id="2"/>Zwei<x id="3"/>\n\n<x id="0"/>Eins<x id="1"/>');
	assert.deepEqual(out.texts, []);
	assert.equal(out.refused.length, 1);
});
