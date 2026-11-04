import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Marked, type Tokens } from 'marked';
import { isMap } from 'yaml';
import { readFrontmatterDoc, writeFrontmatterDoc } from '../lib/frontmatter';
import { writeAllAtomic } from '../server/files';
import { complete, videoEntry, videoFetcher, youtubeId, type VideoFetcher } from '../server/video-meta';
import { setVideoEntry } from '../server/write-ops';
import type { Command, Output, ParsedArgs } from './index';
import { dryRunNote, forEachPost, plural } from './posts';

const POSTERS = 'static/images/projects/data-viz/hikes/videos';

/** Runs `fn` with console.warn (what videoEntry reports through) going to `out.warn`, indented under the post. */
async function warningsTo<T>(out: Output, rel: string, fn: () => Promise<T>): Promise<T> {
	const original = console.warn;
	console.warn = (...parts: unknown[]) => out.warn(`${rel}: ${parts.join(' ')}`);
	try {
		return await fn();
	} finally {
		console.warn = original;
	}
}

/**
 * The id the site's renderer (src/lib/hikes/hikes-info.ts `image`) looks an embed up by: an image whose href includes
 * youtube.com, by its `v` parameter. Anything else (a youtu.be image, a link) is not shown as a video there.
 */
function embedId(href: string): string | null {
	if (!href.includes('youtube.com')) return null;
	const id = youtubeId(href.trim());
	return id && new URL(href.trim()).searchParams.get('v') === id ? id : null;
}

/** The YouTube ids of the body's embedded videos, in document order: every image token marked finds, as the site renders them. */
function embeddedIds(body: string): string[] {
	const ids: string[] = [];
	const marked = new Marked();
	marked.walkTokens(marked.lexer(body), (t) => {
		const id = t.type === 'image' ? embedId((t as Tokens.Image).href ?? '') : null;
		if (id && !ids.includes(id)) ids.push(id);
	});
	return ids;
}

/** Port of the former scripts/matches/video_meta.py: `videos.<id>` for each embedded YouTube video, and its self-hosted poster. */
export async function fetchVideoMeta(root: string, args: ParsedArgs, out: Output, fetcher?: VideoFetcher): Promise<number> {
	const refresh = args.flags.has('refresh');
	const dryRun = args.flags.has('dry-run');
	let updated = 0;
	let removed = 0;
	let posts = 0;
	let offline: VideoFetcher | undefined = fetcher;
	const failed = await forEachPost(root, args.positional, out, async ({ file, rel }) => {
		const { doc, body } = readFrontmatterDoc(readFileSync(file, 'utf8'));
		const videos = ((doc.toJS() as Record<string, any> | null)?.videos ?? {}) as Record<string, Record<string, unknown>>;
		const ids = embeddedIds(body);
		const stale = Object.keys(videos).filter((id) => !ids.includes(id));
		const todo = ids.filter((id) => refresh || !complete(videos[id]) || !existsSync(path.join(root, POSTERS, `${id}.jpg`)));
		if (!todo.length && !stale.length) return;
		let set = 0;
		// Fetching writes the poster, so a dry run only says what it would fetch.
		if (dryRun) set = todo.length;
		else for (const id of todo) {
			offline ??= videoFetcher();
			const old = videos[id] && typeof videos[id] === 'object' ? videos[id] : null;
			const entry = await warningsTo(out, rel, () => videoEntry(root, id, old, offline!, { refresh }));
			if (!entry || (old && isDeepStrictEqual(old, entry) && Object.keys(old).join() === Object.keys(entry).join())) continue;
			setVideoEntry(doc, id, entry);
			set++;
		}
		const map = doc.get('videos', true);
		if (isMap(map)) {
			for (const id of stale) map.delete(id);
			if (!map.items.length) doc.delete('videos');
		}
		if (!set && !stale.length) return;
		if (!dryRun) writeAllAtomic([[file, writeFrontmatterDoc(doc, body)]]);
		const what = [];
		if (set) what.push(`${dryRun ? 'would fetch' : 'set'} ${set} video(s)`);
		if (stale.length) what.push(`${dryRun ? 'would remove' : 'removed'} ${stale.length} video(s)`);
		out.change(rel, what.join(', '));
		updated += set;
		removed += stale.length;
		posts++;
	});
	const parts = [`${plural(updated, 'video')} ${dryRun ? 'to update' : 'updated'}`];
	if (removed) parts.push(`${removed} removed`);
	if (failed) parts.push(`${failed} failed`);
	out.summary(`video-meta: ${parts.join(', ')} across ${plural(posts, 'post')}${dryRunNote(dryRun)}`);
	return failed ? 1 : 0;
}

export const videoMeta: Command = {
	name: 'video-meta',
	summary: '[posts…] [--refresh]  date, duration, texts and a self-hosted poster for each embedded YouTube video',
	flags: ['refresh', 'dry-run'],
	run: (root, args, out) => fetchVideoMeta(root, args, out)
};
