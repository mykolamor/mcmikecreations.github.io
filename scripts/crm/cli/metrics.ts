import { ApiError } from '../server/errors';
import { computedMetrics, currentMetrics, METRIC_KEYS, writeMetrics } from '../server/metrics';
import type { TrackMetrics } from '../server/track-metrics';
import type { Command } from './index';
import { dryRunNote, forEachPost, plural } from './posts';

/** Port of the former scripts/track_metrics.py: distance, ascent, descent and moving time from each post's recorded GPX. */
export const metrics: Command = {
	name: 'metrics',
	summary: "[posts…] [--missing-only]  distance, ascent, descent and moving time from each post's recorded GPX",
	flags: ['missing-only', 'dry-run'],
	async run(root, args, out) {
		const missingOnly = args.flags.has('missing-only');
		const dryRun = args.flags.has('dry-run');
		let changed = 0;
		let planned = 0;
		const failed = await forEachPost(root, args.positional, out, async ({ rel, date, slug }) => {
			const existing = currentMetrics(root, slug, date);
			if (missingOnly && METRIC_KEYS.every((k) => k in existing)) return;
			const computed = await computedMetrics(root, slug, date).catch((e) => (e instanceof ApiError && e.status === 404 ? undefined : Promise.reject(e)));
			if (computed === undefined) return; // no GPX
			if (computed === null) {
				planned++;
				return;
			}
			const changes: Partial<TrackMetrics> = {};
			for (const k of METRIC_KEYS) {
				const v = computed[k];
				if (v === undefined || existing[k] === v || (missingOnly && k in existing)) continue;
				changes[k] = v;
			}
			const keys = METRIC_KEYS.filter((k) => changes[k] !== undefined);
			if (!keys.length) return;
			if (!dryRun) writeMetrics(root, slug, date, changes);
			out.change(rel, keys.map((k) => `${k} ${existing[k] ?? '-'}->${changes[k]}`).join(', '));
			changed++;
		});
		const parts = [`${plural(changed, 'post')} ${dryRun ? 'to change' : 'changed'}`];
		if (planned) parts.push(`${plural(planned, 'planned track')} skipped`);
		if (failed) parts.push(`${failed} failed`);
		out.summary(`metrics: ${parts.join(', ')}${dryRunNote(dryRun)}`);
		return failed ? 1 : 0;
	}
};
