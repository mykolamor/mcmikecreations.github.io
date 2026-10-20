import { execFileSync } from 'node:child_process';

export const prerender = true;

/**
 * When the résumé last changed, for the ProfilePage `dateModified` and the
 * sitemap's `lastmod`: the newest commit touching its data or route, or today
 * if either has uncommitted changes. Null when git isn't available.
 */
function resumeDateModified(): string | null {
	const paths = ['src/lib/data/resume.json', 'src/routes/resume'];
	try {
		const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
		if (git(['status', '--porcelain', '--', ...paths])) return new Date().toISOString().slice(0, 10);
		return git(['log', '-1', '--format=%cs', '--', ...paths]) || null;
	} catch {
		return null;
	}
}

export function load() {
	return {
		dateModified: resumeDateModified(),
		footer: {
			pinBottom: false,
			showSocials: false,
		},
	};
}
