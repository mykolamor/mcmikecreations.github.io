import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors';
import { withDocLock } from './doc-lock';
import { repoPaths } from './paths';

/** `{ "<post file>": { "<image key>": "<Immich asset id>" } }` */
export type Links = Record<string, Record<string, string>>;

const file = (root: string) => path.join(repoPaths(root).crmData, 'immich-links.json');

export function readLinks(root: string): Links {
	const f = file(root);
	let raw: string;
	try {
		raw = fs.readFileSync(f, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
		throw e;
	}
	try {
		const v = JSON.parse(raw);
		if (v && typeof v === 'object' && !Array.isArray(v)) return v as Links;
		throw new Error('not an object');
	} catch {
		// Never fall back to {}: the next write would silently wipe every link.
		const aside = `${f}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
		fs.renameSync(f, aside);
		throw new ApiError(500, `immich-links.json was unreadable — moved aside to ${aside}`);
	}
}

export function linkOf(root: string, postFile: string, key: string): string | undefined {
	const v = readLinks(root)[postFile]?.[key];
	return typeof v === 'string' ? v : undefined;
}

export function writeLinks(root: string, links: Links): void {
	const f = file(root);
	fs.mkdirSync(path.dirname(f), { recursive: true });
	const tmp = `${f}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(tmp, JSON.stringify(links, null, '\t') + '\n');
		fs.renameSync(tmp, f);
	} catch (e) {
		fs.rmSync(tmp, { force: true });
		throw e;
	}
}

/** Sets (or, with null, removes) one link. Serialised in-process; the file is replaced atomically. */
export function setLink(root: string, postFile: string, key: string, assetId: string | null): Promise<void> {
	return withDocLock('@links', () => {
		const links = readLinks(root);
		if (assetId === null) {
			if (!links[postFile]) return;
			delete links[postFile][key];
			if (!Object.keys(links[postFile]).length) delete links[postFile];
		} else {
			(links[postFile] ??= {})[key] = assetId;
		}
		writeLinks(root, links);
	});
}
