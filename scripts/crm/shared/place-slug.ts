import schemaKeys from '$lib/hikes/schema-keys.json';

/** `knorrhuette`, `zugspitz-platt`: the site's place doc file name rule (shared with place-docs.server.ts). */
export const PLACE_SLUG = new RegExp(schemaKeys.placeDoc.slug);

/** The Open screen's live check; the server refuses the same slugs (`assertPlaceSlug`). */
export const isPlaceSlug = (slug: string): boolean => PLACE_SLUG.test(slug);
