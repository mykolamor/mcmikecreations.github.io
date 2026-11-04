// What both the server and the CRM's Fill button know of DeepL: the languages it fills, and the no-key explanation.
import type { Lang } from '$lib/i18n/languages';

export const NO_KEY = 'Add `deeplKey` to scripts/crm/data/settings.json (or DEEPL_API_KEY) to fill from DeepL';

const TARGETS: Partial<Record<string, string>> = { de: 'DE', uk: 'UK', cs: 'CS' };

/** DeepL's target code for a language, or null for one it can't translate into (English, the source). */
export function deeplTarget(lang: Lang): string | null {
	return TARGETS[lang] ?? null;
}
