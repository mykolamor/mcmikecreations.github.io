/**
 * Consistent phone numbers for OSM tags and authored facts.
 *
 * Server/build side only: never import this from client code. It pulls in
 * libphonenumber-js and country-coder, which the browser has no use for.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { iso1A2Code } from '@rapideditor/country-coder';

export const PHONE_TAGS = ['phone', 'contact:phone', 'mobile', 'contact:mobile', 'fax', 'contact:fax'];

/**
 * One number as international format; a number written with an extension
 * (`+49836293988-19`) is left as written, since formatting would fold it in.
 *
 * @param {string} part
 * @param {import('libphonenumber-js').CountryCode | undefined} country
 * @returns {string | null} null when `part` is not a valid number
 */
function formatOne(part, country) {
	const parsed = parsePhoneNumberFromString(part, country);
	if (!parsed?.isValid()) return null;
	if (parsed.ext || /\d-\d{1,3}$/.test(part)) return part;
	return parsed.formatInternational();
}

/**
 * Each number in `raw` (separated by `;`, or by `,` when every comma-separated
 * part is a number) in international format, joined with `'; '`. A national
 * number takes its country from the coordinates; text that is not a phone
 * number stays as written, commas and all.
 *
 * @param {string} raw
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function formatPhones(raw, lat, lon) {
	const country = /** @type {import('libphonenumber-js').CountryCode | undefined} */ (
		iso1A2Code([lon, lat]) ?? undefined
	);
	return raw
		.split(';')
		.map((seg) => seg.trim())
		.filter(Boolean)
		.map((seg) => {
			const parts = seg.split(',').map((p) => p.trim());
			const formatted = parts.map((p) => formatOne(p, country));
			return formatted.every((f) => f !== null) ? formatted.join('; ') : seg;
		})
		.join('; ');
}

/**
 * `tags` with every phone-like tag formatted; a new object.
 *
 * @param {Record<string, any>} tags
 * @param {number} lat
 * @param {number} lon
 * @returns {Record<string, any>}
 */
export function formatPhoneTags(tags, lat, lon) {
	const out = { ...tags };
	for (const key of PHONE_TAGS) {
		if (typeof out[key] === 'string') out[key] = formatPhones(out[key], lat, lon);
	}
	return out;
}
