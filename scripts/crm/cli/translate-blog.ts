import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Document } from 'yaml';
import { isLang, type Lang } from '$lib/i18n/languages';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { writeAllAtomic } from '../server/files';
import { loadSettings } from '../server/settings';
import { NO_KEY, deeplLangs, deeplStub, translateBatch, type DeeplText } from '../server/deepl';
import { isTranslationFile } from '../server/translations';
import type { Command, Output, ParsedArgs } from './index';
import { BLOG_DIR } from './images';

/** One run of a blog body: a block to translate, or text kept byte for byte (blank lines, code, link definitions). */
export type BodyPart = { text: string; translate: boolean };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED = /^(?: {4}|\t)/;
const LINK_DEF = /^ {0,3}\[[^\]]+\]:\s/;

/**
 * Splits a markdown body into its blocks (runs of lines between blank lines), in order, concatenating back to the
 * body exactly. Fenced and indented code, and link reference definitions, are kept as they are: DeepL never sees
 * them. A fence may contain blank lines; an unclosed one runs to the end.
 */
export function splitBody(body: string): BodyPart[] {
	const parts: BodyPart[] = [];
	const lines = body.split(/(?<=\n)/);
	let block: string[] = [];
	const flush = () => {
		if (!block.length) return;
		const nonBlank = block.filter((l) => l.trim());
		const keep = nonBlank.every((l) => INDENTED.test(l)) || nonBlank.every((l) => LINK_DEF.test(l));
		parts.push({ text: block.join(''), translate: !keep });
		block = [];
	};
	const keep = (text: string) => {
		const last = parts[parts.length - 1];
		if (last && !last.translate) last.text += text;
		else parts.push({ text, translate: false });
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fence = FENCE.exec(line);
		if (fence) {
			flush();
			const close = new RegExp(`^ {0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
			let code = line;
			while (++i < lines.length) {
				code += lines[i];
				if (close.test(lines[i])) break;
			}
			keep(code);
		} else if (!line.trim()) {
			flush();
			keep(line);
		} else block.push(line);
	}
	flush();
	return parts;
}

/** The blog post `name` names: its file stem (`2024-03-01-ecs`) or its slug without the date (`ecs`). */
export function findBlogPost(root: string, name: string): string | null {
	const dir = path.join(root, BLOG_DIR);
	if (!existsSync(dir)) return null;
	const stem = name.replace(/\.md$/, '');
	const posts = readdirSync(dir).filter((f) => f.endsWith('.md') && !isTranslationFile(f));
	const hit = posts.find((f) => f === `${stem}.md`) ?? posts.filter((f) => f.replace(/^\d{4}-\d{2}-\d{2}-/, '') === `${stem}.md`);
	if (typeof hit === 'string') return path.join(dir, hit);
	return hit.length === 1 ? path.join(dir, hit[0]) : null;
}

/** The front-matter texts a blog translation carries, in the order it writes them. */
const FIELDS = ['title', 'description', 'section'] as const;

/**
 * `pnpm crm translate-blog <post> <lang>`: drafts `<post>.<lang>.md` beside a blog post with DeepL. `title`,
 * `description` and an explicit `section` are translated, and every block of the body but code (fenced or indented)
 * and link definitions, which stay byte for byte. A block DeepL can't return intact stays English, with a warning.
 * Never overwrites: an existing translation is refused. `fetcher` replaces DeepL (tests; `CRM_DEEPL_STUB=1`).
 */
export async function runTranslateBlog(root: string, args: ParsedArgs, out: Output, fetcher?: typeof fetch): Promise<number> {
	const [name, lang] = args.positional;
	if (!name || !lang || args.positional.length !== 2) {
		out.warn('Usage: pnpm crm translate-blog <post> <lang> [--dry-run]');
		return 2;
	}
	const targets = deeplLangs();
	if (!isLang(lang) || !targets.includes(lang)) {
		out.warn(`translate-blog: "${lang}" is not a language DeepL fills here (${targets.join(', ')})`);
		return 2;
	}
	const file = findBlogPost(root, name);
	if (!file) {
		out.warn(`translate-blog: no single blog post named "${name}" in ${BLOG_DIR}`);
		return 1;
	}
	const target = file.replace(/\.md$/, `.${lang}.md`);
	const rel = path.relative(root, target);
	if (existsSync(target)) {
		out.warn(`${rel}: exists already; translate-blog never overwrites a translation`);
		return 1;
	}

	const stub = process.env.CRM_DEEPL_STUB === '1';
	const key = loadSettings(root).deeplKey ?? (stub || fetcher ? 'stub' : undefined);
	if (!key) {
		out.warn(`translate-blog: ${NO_KEY}`);
		return 1;
	}

	const { doc, body } = readFrontmatterDoc(readFileSync(file, 'utf8'));
	const front = (doc.toJS() ?? {}) as Record<string, unknown>;
	const parts = splitBody(body);
	const texts: DeeplText[] = [];
	for (const k of FIELDS) {
		const v = front[k];
		if (typeof v === 'string' && v.trim()) texts.push({ id: k, text: v.trim(), kind: 'plain' });
	}
	parts.forEach((p, i) => {
		// The block's trailing line break isn't DeepL's to keep.
		if (p.translate) texts.push({ id: `b${i}`, text: p.text.replace(/\n$/, ''), kind: 'markdown' });
	});
	const blocks = parts.filter((p) => p.translate).length;
	if (args.flags.has('dry-run')) {
		out.change(rel, `would translate ${texts.length - blocks} field(s) and ${blocks} block(s) into ${lang} (dry run, nothing sent or written)`);
		return 0;
	}

	const result = await translateBatch(texts, lang as Lang, { key, fetch: fetcher ?? (stub ? deeplStub : fetch) });
	const got = new Map(result.texts.map((t) => [t.id, t.text]));
	for (const r of result.refused) {
		const src = texts.find((t) => t.id === r.id)!.text;
		out.warn(`${rel}: kept in English (${r.reason}): ${src.split('\n')[0].slice(0, 60)}`);
	}

	const tr = new Document({});
	for (const k of FIELDS) if (got.has(k)) tr.set(k, got.get(k));
	const translated = parts.map((p, i) => (p.translate && got.has(`b${i}`) ? `${got.get(`b${i}`)}${p.text.endsWith('\n') ? '\n' : ''}` : p.text)).join('');
	writeAllAtomic([[target, writeFrontmatterDoc(tr, translated)]]);
	const kept = result.refused.length;
	out.change(rel, `created: ${result.texts.length} text(s) translated into ${lang}${kept ? `, ${kept} kept in English` : ''}; review it before committing`);
	return 0;
}

export const translateBlog: Command = {
	name: 'translate-blog',
	summary: 'draft <post>.<lang>.md beside a blog post with DeepL (code left as is); never overwrites',
	flags: ['dry-run'],
	run: (root, args, out) => runTranslateBlog(root, args, out)
};
