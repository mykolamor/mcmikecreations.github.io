/**
 * When a post's content last changed, for `dateModified` and the sitemap's
 * `lastmod`.
 *
 * Read from git history, counting only commits that changed the post *body*.
 * Bulk front-matter commits (the AVIF `images:` map, photo coordinates for the
 * maps) touch every post at once without changing what a reader sees, and must
 * not make every post look freshly updated.
 *
 * Server-only: shells out to git, which only exists at build time.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stripFrontmatter } from '$lib/hikes/frontmatter';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const cache = new Map<string, string | null>();

function git(args: string[]): string {
	return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

/** The body with front matter dropped and whitespace runs collapsed. */
function normalizedBody(raw: string): string {
	return stripFrontmatter(raw).replace(/\s+/g, ' ').trim();
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * The date (`YYYY-MM-DD`) of the newest commit that changed `file`'s body, or
 * today if the working copy's body differs from HEAD. Null when git has no
 * history for the file (or isn't available).
 */
function lastBodyChange(file: string): string | null {
	if (cache.has(file)) return cache.get(file)!;

	let result: string | null = null;
	try {
		const current = normalizedBody(readFileSync(file, 'utf-8'));

		// Newest first; --follow plus --name-only gives the path at each commit,
		// so a renamed post keeps its history.
		const log = git(['log', '--follow', '--format=%x00%H %cs', '--name-only', '--', file]);
		const commits = log
			.split('\0')
			.filter(Boolean)
			.map((chunk) => {
				const [header, ...rest] = chunk.trim().split('\n');
				const [hash, date] = header.split(' ');
				return { hash, date, path: rest.find((l) => l.trim())?.trim() ?? file };
			});

		if (commits.length > 0) {
			const bodyAt = (c: (typeof commits)[number]) => normalizedBody(git(['show', `${c.hash}:${c.path}`]));
			const bodies = commits.map(bodyAt);

			if (current !== bodies[0]) {
				result = today();
			} else {
				// The oldest commit created the file, which always counts.
				result = commits[commits.length - 1].date;
				for (let i = 0; i < commits.length - 1; i++) {
					if (bodies[i] !== bodies[i + 1]) {
						result = commits[i].date;
						break;
					}
				}
			}
		}
	} catch {
		result = null;
	}

	cache.set(file, result);
	return result;
}

/** A front-matter `updated:` value as `YYYY-MM-DD`, if it is a valid date. */
function readOverride(value: unknown): string | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
	if (typeof value === 'string' && ISO_DATE.test(value.trim())) return value.trim();
	return null;
}

/**
 * `dateModified` for a post: the front-matter `updated:` override if present,
 * else the last body change from git, never earlier than `published`.
 *
 * @param file Path to the markdown file, relative to the repo root.
 * @param published The post's publication date, `YYYY-MM-DD`.
 * @param updated The front-matter `updated:` value, if any.
 */
export function postDateModified(file: string, published: string, updated?: unknown): string {
	const modified = readOverride(updated) ?? lastBodyChange(file) ?? published;
	return modified > published ? modified : published;
}
