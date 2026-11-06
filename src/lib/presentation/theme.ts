import type { SlideContext, Theme } from './types';

export type ColorName = Parameters<SlideContext['color']>[0];

/** The site's theme, read from the `dark` class on `<html>`. */
export function readTheme(): Theme {
	return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Calls `fn` whenever the `dark` class on `<html>` flips. Returns a stop function. */
export function watchTheme(fn: (t: Theme) => void): () => void {
	let last = readTheme();
	const observer = new MutationObserver(() => {
		const now = readTheme();
		if (now === last) return;
		last = now;
		fn(now);
	});
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
	return () => observer.disconnect();
}

/** Resolved value of the `--pres-<name>` custom property as seen from `el`. */
export function color(el: Element, name: ColorName): string {
	return getComputedStyle(el).getPropertyValue('--pres-' + name).trim();
}
