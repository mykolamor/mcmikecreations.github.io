import { json } from '@sveltejs/kit';
import { heroCandidates } from '$lib/hikes/hero-map.server';

export const prerender = true;

/** The hero map's candidates, for client-side navigation to Home (a full load inlines them). */
export function GET() {
	return json(heroCandidates);
}
