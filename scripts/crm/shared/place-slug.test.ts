import { test } from 'node:test';
import assert from 'node:assert/strict';
import schemaKeys from '$lib/hikes/schema-keys.json';
import { PLACE_SLUG as SERVER_PLACE_SLUG } from '../server/doc-ref';
import { isPlaceSlug } from './place-slug';

test('place slug validation matches the server regex', () => {
	// one regex, from the site's schema, for the Open screen's live check and the server's refusal
	assert.equal(SERVER_PLACE_SLUG.source, schemaKeys.placeDoc.slug);
	for (const s of ['knorrhuette', 'zugspitz-platt', 'a--b', 'Knorrhuette', '-a', 'hütte', 'a.b']) assert.equal(isPlaceSlug(s), SERVER_PLACE_SLUG.test(s), s);
	assert.deepEqual([isPlaceSlug('zugspitz-platt'), isPlaceSlug('a--b'), isPlaceSlug('hütte')], [true, false, false]);
});
