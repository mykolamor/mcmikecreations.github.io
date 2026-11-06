import type { Lang, Localized } from './types';

export function pick<T>(value: T | Localized<T>, lang: Lang): T {
	if (value !== null && typeof value === 'object' && !Array.isArray(value) && 'en' in value) {
		const l = value as Localized<T>;
		return l[lang] ?? l.en;
	}
	return value as T;
}
