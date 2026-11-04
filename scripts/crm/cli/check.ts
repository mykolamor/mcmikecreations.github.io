import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { libraryProblems, problemsFor, storeProblems, type Problem } from '../server/problems';
import { repoPaths } from '../server/paths';
import { OTHER_LANGS, type Lang } from '../../../src/lib/i18n/languages';
import { missingKeys } from '../../../src/lib/i18n/strings';
import { parsePlaceDoc } from '../../../src/lib/hikes/place-docs.server';
import { collectTranslations, type TranslationKind } from '../../../src/lib/hikes/translations.server';
import { isTranslationFile } from '../server/translations';
import type { Command } from './index';
import { plural, POST, postFiles } from './posts';

/** Errors and failed site builds count for `--strict`; warnings don't. */
const failing = (p: Problem) => p.level !== 'warning';

/**
 * Every problem of the repo, one `<file>: <level>: <message>` line each on stderr: each post's (problemsFor), each
 * place doc's (one that doesn't parse is an error), each translation's (parseTranslation, its source and media) and the OSM store's (storeProblems, the former check-nodes.js) and the facts library's (libraryProblems: a malformed record is an error, a record no hike uses a warning).
 * The site build problem, the same for every post, is printed once. Then, per non-English language, a warning for each
 * string its table (`src/lib/hikes/i18n/<lang>.json`) lacks; those never fail `--strict`. The summary comes last,
 * counting the missing strings apart from the warnings, then one count line per language that lacks any.
 *
 * `missing` gives a language's missing keys: the site's tables' `missingKeys` by default, a test's own tables' otherwise.
 */
export const checkCommand = (missing: (lang: Lang) => string[] = missingKeys): Command => ({
	name: 'check',
	summary: '[--strict]  print every problem of the posts, place docs, OSM store and facts library (--strict: exit 1 on an error)',
	flags: ['strict'],
	async run(root, args, out) {
		if (args.positional.length) {
			out.warn(`check takes no post names: ${args.positional.join(' ')}`);
			return 2;
		}
		const p = repoPaths(root);
		const lines = new Set<string>();
		const found: Problem[] = [];
		const report = (file: string, problems: Problem[]) => {
			for (const pr of problems) {
				const line = `${pr.file ?? (pr.level === 'site' ? 'site' : file)}: ${pr.level}: ${pr.message}`;
				if (lines.has(line)) continue;
				lines.add(line);
				found.push(pr);
				out.warn(line);
			}
		};
		const posts = postFiles(root, []);
		for (const file of posts) {
			const [, date, slug] = POST.exec(path.basename(file))!;
			try {
				report(path.relative(root, file), problemsFor(root, slug, date));
			} catch (e) {
				report(path.relative(root, file), [{ level: 'error', message: e instanceof Error ? e.message : String(e) }]);
			}
		}
		const mdFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);
		const places = mdFiles(p.places).filter((f) => !isTranslationFile(f));
		for (const f of places) {
			try {
				parsePlaceDoc(f, readFileSync(path.join(p.places, f), 'utf8'));
			} catch (e) {
				report(path.relative(root, path.join(p.places, f)), [{ level: 'error', message: e instanceof Error ? e.message : String(e) }]);
			}
		}
		// Each translation on its own: its name and keys, its source beside it, the photos and clips it shows.
		const translations = (kind: TranslationKind, dir: string, sources: string[]) => {
			for (const f of mdFiles(dir).filter(isTranslationFile)) {
				try {
					collectTranslations(kind, { [f]: readFileSync(path.join(dir, f), 'utf8') }, new Set(sources), { root });
				} catch (e) {
					report(path.relative(root, path.join(dir, f)), [{ level: 'error', message: e instanceof Error ? e.message : String(e) }]);
				}
			}
		};
		translations('post', p.markdown, posts.map((f) => path.basename(f)));
		translations('place', p.places, places);
		report(path.relative(root, p.osmStore), storeProblems(root));
		report(path.relative(root, p.factsLibrary), libraryProblems(root));

		const missingByLang = OTHER_LANGS.map((lang) => ({ lang, keys: missing(lang) }));
		for (const { lang, keys } of missingByLang) {
			for (const key of keys) out.warn(`src/lib/hikes/i18n/${lang}.json: warning: missing "${key}"`);
		}

		const errors = found.filter(failing).length;
		const missingCount = missingByLang.reduce((n, { keys }) => n + keys.length, 0);
		const plus = missingCount ? ` (plus ${plural(missingCount, 'missing string')})` : '';
		out.summary(`check: ${plural(errors, 'error')}, ${plural(found.length - errors, 'warning')}${plus} across ${plural(posts.length, 'post')}, ${plural(places.length, 'place doc')} and the OSM store`);
		for (const { lang, keys } of missingByLang) {
			if (keys.length) out.summary(`check: ${lang} is missing ${plural(keys.length, 'string')}`);
		}
		return args.flags.has('strict') && errors ? 1 : 0;
	}
});

export const check = checkCommand();
