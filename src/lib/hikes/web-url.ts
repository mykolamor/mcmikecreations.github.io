/**
 * Links built from OSM tags. OSM is anyone's to edit, so a tag value never
 * chooses a URL scheme or a host the site didn't intend. Browser-safe.
 */

const HTTP = /^https?:\/\//i;
/** Wikipedia language editions: `en`, `de`, `zh-yue`, `be-tarask`. */
const WIKI_LANG = /^[a-z]{2,3}(?:-[a-z]+)*$/;
const WIKIDATA_ITEM = /^Q\d+$/;

/** A website tag as a link: an http(s) URL stays as it is, anything else gets `https://`. */
export function webUrl(value: string): string {
	const v = value.trim();
	return HTTP.test(v) ? v : `https://${v}`;
}

/** A `wikipedia` tag (`de:Zugspitze`, or a bare title) as its article URL. */
export function wikipediaUrl(value: string): string {
	const i = value.indexOf(':');
	const prefix = i > 0 ? value.slice(0, i) : '';
	const [lang, title] = WIKI_LANG.test(prefix) ? [prefix, value.slice(i + 1)] : ['en', value];
	return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`;
}

/** A `wikidata` tag as its item URL, or null when it isn't an item id. */
export function wikidataUrl(value: string): string | null {
	return WIKIDATA_ITEM.test(value) ? `https://www.wikidata.org/wiki/${value}` : null;
}
