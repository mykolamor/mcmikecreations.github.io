// The Facts tab's near-duplicates: the groups (GET /api/facts/near-duplicates) that hold an entry of the open hike, and
// the record id a merge proposes. Browser-safe.
import type { ListedGroup as NearDuplicateGroup } from '../../lib/facts-near-duplicates';
import { newRecordId, type LibraryState } from './shared';

export type { NearDuplicateGroup };

/** The open doc as far as a merge's id needs it. */
export type NearDoc = { slug: string; date: string | null; facts: { hike: unknown; post: unknown } };

/** Whether `file` is this hike's sidecar or one of its posts. */
const ofHike = (file: string, slug: string): boolean => file === `${slug}.hike.json` || new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.md$`).test(file);

/** The groups with an entry in this hike's sidecar or posts. */
export function hikeGroups(groups: NearDuplicateGroup[], slug: string): NearDuplicateGroup[] {
	return groups.filter((g) => g.entries.some((e) => ofHike(e.file, slug)));
}

/** `access.transport[1]` as a path below `facts`. */
export function entryPath(text: string): (string | number)[] {
	return text.split('.').flatMap((part) => {
		const m = /^(.+)\[(\d+)\]$/.exec(part);
		return m ? [m[1], Number(m[2])] : [part];
	});
}

/**
 * The id "Merge into a shared record" proposes: a stop's is its place's ref (the group's key), any other the Plan 2
 * rule over this doc's entry (the group's entries share what the rule reads), past the ids a hike uses. A group some
 * of whose entries take a record already (a merge that stopped part way) proposes that record, so a retry finishes it.
 */
export function mergeId(group: NearDuplicateGroup, doc: NearDoc, state: LibraryState): string {
	if (group.kind === 'stops') return group.key;
	if (group.record) return group.record;
	const files = { [`${doc.slug}.hike.json`]: doc.facts.hike, ...(doc.date ? { [`${doc.date}-${doc.slug}.md`]: doc.facts.post } : {}) };
	const mine = group.entries.find((e) => e.file in files);
	const entry = mine && entryPath(mine.path).reduce<unknown>((at, k) => (at && typeof at === 'object' ? (at as Record<string | number, unknown>)[k] : undefined), files[mine.file]);
	return newRecordId(group.kind, (entry ?? {}) as Record<string, unknown>, state);
}
