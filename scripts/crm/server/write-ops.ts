// Media operations of the Write tab: an mp4 upload (streamed to disk, numbered `<date>-NN.mp4` with the doc's photos)
// and a post's `videos.<id>` YouTube entry. Both run under the doc's lock with the base-version check (photo-ops.ts).
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, openSync, renameSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Document, Scalar, isMap, parse, type YAMLMap } from 'yaml';
import { STRINGIFY_OPTIONS, writeFrontmatterDoc } from '../lib/frontmatter';
import type { DocRef } from './doc-ref';
import { ApiError } from './errors';
import { writeAllAtomic } from './files';
import { ctxOf, finish, guarded, imagesAbs, keyDate, nextKey, readPost, versionOf, type PhotoDeps } from './photo-ops';
import { complete, videoEntry, videoFetcher, youtubeId, type VideoFetcher } from './video-meta';

export const VIDEO_MAX_BYTES = 2 * 1024 ** 3;
const POSTERS = 'static/images/projects/data-viz/hikes/videos';

export type VideoResult = { href: string; version: string; stamped: boolean; previous?: string | null };

const NOT_MP4 = 'Not an mp4 video (no ftyp box)';

/**
 * Copies `stream` to `file`, refusing (413) once more than `max` bytes came in and (400) as soon as the first 8 bytes
 * show no `ftyp` box: an ISO-BMFF file (mp4, mov) starts with a box whose type, bytes 4–8, is `ftyp`. Never holds more
 * than a chunk. Settles only once the file is closed, so the caller's cleanup can't race it.
 */
async function receive(stream: AsyncIterable<Uint8Array>, file: string, max: number): Promise<number> {
	let n = 0;
	let head: Buffer | null = Buffer.alloc(0);
	// Opened here, not lazily by the stream: an async open still pending when the pipeline fails would create the
	// file after the caller had removed it.
	const out = createWriteStream(file, { fd: openSync(file, 'wx') });
	try {
		await pipeline(
			stream,
			async function* (src: AsyncIterable<Uint8Array>) {
				for await (const chunk of src) {
					n += chunk.length;
					if (n > max) throw new ApiError(413, `The video is larger than ${Math.round(max / 1024 ** 2)} MB`);
					if (head) {
						head = Buffer.concat([head, chunk]);
						if (head.length >= 8) {
							if (head.subarray(4, 8).toString('latin1') !== 'ftyp') throw new ApiError(400, NOT_MP4);
							head = null;
						}
					}
					yield chunk;
				}
			},
			out
		);
	} finally {
		// pipeline rejects on an error without waiting for the destroyed file stream to close
		if (!out.closed) await once(out, 'close');
	}
	if (n && head) throw new ApiError(400, NOT_MP4);
	return n;
}

/**
 * Receives an mp4 into a temp file in the doc's own folder (streamed, at most `maxBytes`, 2 GB by default), checks its
 * `ftyp` box and renames it to the next `<date>-NN.mp4` (numbered with the photos). Adding a video stamps `updated:` on
 * a published post like a photo does. The front matter gets no entry: the text shows the video.
 */
export async function uploadVideo(root: string, ref: DocRef, stream: AsyncIterable<Uint8Array>, base: string, deps: PhotoDeps & { maxBytes?: number } = {}): Promise<VideoResult> {
	const c = ctxOf(root, ref);
	const dir = path.dirname(imagesAbs(root, c.own + 'x')!);
	// A stale base is refused before the (possibly large) file comes in.
	await guarded(c, base, async () => undefined);
	mkdirSync(dir, { recursive: true });
	const tmp = path.join(dir, `.upload-${randomBytes(6).toString('hex')}.part`);
	try {
		const size = await receive(stream, tmp, deps.maxBytes ?? VIDEO_MAX_BYTES);
		if (!size) throw new ApiError(400, 'Empty upload');
		return await guarded(c, base, async () => {
			const key = nextKey(c, keyDate(c, undefined, deps), '.mp4');
			renameSync(tmp, path.join(dir, key));
			const { key: _key, ...r } = await finish(c, key, deps);
			return r;
		});
	} finally {
		rmSync(tmp, { force: true });
	}
}

// ---------------------------------------------------------------- YouTube

/**
 * The style ruamel gives a scalar in a flow map: plain where it can, else single-quoted (double with a `'` inside).
 * Strings YAML 1.1 reads as something else (the `uploadDate` timestamp, `yes`, numbers) are quoted too.
 */
function scalarType(s: string): Scalar.Type {
	const probe = new Document([0]);
	const sc = new Scalar(s);
	sc.type = Scalar.PLAIN;
	const seq = probe.contents as unknown as { flow: boolean; items: unknown[] };
	seq.flow = true;
	seq.items[0] = sc;
	let plain = probe.toString(STRINGIFY_OPTIONS) === `[${s}]\n`;
	if (plain) {
		try {
			plain = typeof parse(s, { version: '1.1' }) === 'string';
		} catch {
			plain = false;
		}
	}
	return plain ? Scalar.PLAIN : s.includes("'") ? Scalar.QUOTE_DOUBLE : Scalar.QUOTE_SINGLE;
}

function flowNode(doc: Document, value: Record<string, unknown>): YAMLMap {
	const map = doc.createNode({}) as YAMLMap;
	map.flow = true;
	for (const [k, v] of Object.entries(value)) {
		if (v === undefined) continue;
		if (v && typeof v === 'object') {
			map.set(k, flowNode(doc, v as Record<string, unknown>));
			continue;
		}
		const sc = new Scalar(v);
		if (typeof v === 'string') sc.type = scalarType(v);
		map.set(k, sc);
	}
	return map;
}

/** Sets `videos.<id>` to `entry` as one flow map in the entry's own key order (an existing entry keeps its place). */
export function setVideoEntry(doc: Document, id: string, entry: Record<string, unknown>): void {
	let videos = doc.get('videos', true);
	if (!isMap(videos)) {
		doc.set('videos', doc.createNode({}));
		videos = doc.get('videos', true) as YAMLMap;
	}
	(videos as YAMLMap).set(id, flowNode(doc, entry));
}

function videoOf(doc: Document, id: string): Record<string, unknown> | null {
	const v = (doc.toJS() as Record<string, any> | null)?.videos?.[id];
	return v && typeof v === 'object' ? v : null;
}

const enTitle = (entry: Record<string, unknown> | null): string | null => {
	const t = entry?.title as Record<string, unknown> | undefined;
	return t && typeof t === 'object' && typeof t.en === 'string' ? t.en : null;
};

export type YoutubeResult = { id: string; title: string | null; version: string; unavailable?: true };

/**
 * Writes the post's `videos.<id>` entry for a YouTube link (dates, titles and descriptions per language, poster). An
 * entry that is complete and has its poster is left alone (no call, no write). 502 when YouTube can't be reached; then
 * nothing is written. A video that isn't public gets `{unavailable: true}`.
 */
export async function addYoutube(root: string, ref: DocRef, url: string, base: string, deps: { fetcher?: VideoFetcher } = {}): Promise<YoutubeResult> {
	if (ref?.kind === 'place') throw new ApiError(400, 'A place doc has no videos');
	const c = ctxOf(root, ref);
	const id = typeof url === 'string' ? youtubeId(url.trim()) : null;
	if (!id) throw new ApiError(400, `Not a YouTube video link: ${url}`);
	const present = (): YoutubeResult | undefined => {
		const old = videoOf(readPost(c).doc, id);
		return complete(old) && existsSync(path.join(root, POSTERS, `${id}.jpg`)) ? { id, title: enTitle(old), version: versionOf(c) } : undefined;
	};
	// `base` is checked first, on the no-op path too: a stale request neither fetches nor leaves a poster behind, and
	// the client never adopts a version that includes a change it hasn't seen.
	const early = await guarded(c, base, async () => present());
	if (early) return early;
	// Fetched outside the lock (several requests and a poster encode); the lock is only held for the write.
	const entry = await videoEntry(root, id, videoOf(readPost(c).doc, id), deps.fetcher ?? videoFetcher(), { refresh: false });
	if (!entry) throw new ApiError(502, 'YouTube unreachable — nothing was written');
	return guarded(c, base, async () => {
		const done = present();
		if (done) return done;
		const { doc, body } = readPost(c);
		setVideoEntry(doc, id, entry);
		writeAllAtomic([[c.pp, writeFrontmatterDoc(doc, body)]]);
		const r: YoutubeResult = { id, title: enTitle(entry), version: versionOf(c) };
		return entry.unavailable === true ? { ...r, unavailable: true } : r;
	});
}
