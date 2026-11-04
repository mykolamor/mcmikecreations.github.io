import type { Output } from './index';

/** An Output that keeps what a command printed, per kind and, in `lines`, all of it in order. */
export function recorder(): Output & { changes: string[]; warnings: string[]; summaries: string[]; lines: string[] } {
	const changes: string[] = [];
	const warnings: string[] = [];
	const summaries: string[] = [];
	const lines: string[] = [];
	const keep = (list: string[], line: string) => {
		list.push(line);
		lines.push(line);
	};
	return {
		changes,
		warnings,
		summaries,
		lines,
		change: (path, what) => keep(changes, `${path}: ${what}`),
		warn: (msg) => keep(warnings, msg),
		summary: (msg) => keep(summaries, msg)
	};
}
