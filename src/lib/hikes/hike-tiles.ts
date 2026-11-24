/**
 * The hike post's stat tiles, in the order the hero shows them: the five a
 * reader decides by first (they fill the strip over the photo), then the rest
 * behind "Show all", led by what searchers ask for. Framework-free: the hero
 * maps each tile's `icon` to a component.
 */

import { getDistance, getTime } from './build-statistics';
import { t } from '$lib/i18n/strings';
import { enumLabel, formatFerrata, formatMonths, hardestFerrata, label, seasonMonths } from './facts-format';
import type { HikeFacts, RouteType } from './hike-facts';
import type { HikeAuthoredFacts, Lang } from './facts-schema';

export type HikeTileKey = 'distance' | 'typical' | 'ascent' | 'difficulty' | 'season'
	| 'highPoint' | 'routeType' | 'carFree' | 'movingTime' | 'descent' | 'elapsed'
	| 'lowPoint' | 'exposure' | 'fitness';

export interface HikeTile {
	key: HikeTileKey;
	/** The key, except for the route type tile: its route type (picks loop/out-and-back/point-to-point). */
	icon: HikeTileKey | RouteType;
	/** Already carries its footnote mark: '*', '**', '***'. */
	label: string;
	value: string;
	hint?: string;
	href?: string;
}

export interface HikeTileInput {
	properties: { duration?: number | null; distance?: number | null; ascent?: number | null; descent?: number | null };
	durationSource: 'gpx' | 'manual' | 'planner';
	facts: HikeFacts;
	authoredFacts?: HikeAuthoredFacts | null;
}

export const TILE_ORDER: readonly HikeTileKey[] = [
	'distance', 'typical', 'ascent', 'difficulty', 'season',
	// The rest grouped: the elevation profile, the route, then my own times.
	'highPoint', 'lowPoint', 'descent', 'routeType', 'carFree', 'movingTime', 'elapsed', 'exposure', 'fitness'
];

/**
 * A moving time equal to the elapsed time to the minute means no breaks were
 * detected; showing the same number twice would only confuse.
 */
export function showElapsed(input: HikeTileInput): boolean {
	const elapsed = input.facts.elapsed;
	return elapsed != null && Math.abs(elapsed.minutes - (input.properties.duration ?? 0)) > 1;
}

export function hikeTiles(input: HikeTileInput, lang: Lang): HikeTile[] {
	const { properties: p, facts } = input;
	const d = input.authoredFacts?.difficulty;
	const ferrata = hardestFerrata(d?.viaFerrata);
	const grade = [d?.sac, ferrata ? formatFerrata(lang, ferrata) : '', d?.climbing?.grade].filter(Boolean).join(' · ');
	const season = formatMonths(lang, seasonMonths(input.authoredFacts?.season));
	const carFree = input.authoredFacts?.access?.carFree;

	const tiles: Partial<Record<HikeTileKey, Omit<HikeTile, 'key' | 'icon'> & { icon?: RouteType }>> = {
		distance: { label: t(lang, 'post.stats.distance'), value: getDistance(p.distance ?? 0) },
		ascent: { label: t(lang, 'post.stats.ascent'), value: getDistance(p.ascent ?? 0) },
		descent: { label: t(lang, 'post.stats.descent'), value: getDistance(p.descent ?? 0) },
		movingTime: {
			label: t(lang, input.durationSource === 'planner' ? 'post.stats.plannerEstimate' : 'post.stats.movingTime') + '*',
			value: getTime(p.duration ?? 0)
		}
	};
	if (facts.typicalDuration != null) {
		tiles.typical = { label: t(lang, 'post.stats.typical') + '***', value: '≈ ' + getTime(Math.round(facts.typicalDuration / 15) * 15) };
	}
	if (showElapsed(input) && facts.elapsed) {
		tiles.elapsed = {
			label: t(lang, 'post.stats.elapsed') + '**',
			value: (facts.elapsed.source === 'photos' ? '≥ ' : '') + getTime(facts.elapsed.minutes)
		};
	}
	if (facts.highPoint != null) tiles.highPoint = { label: t(lang, 'post.stats.highPoint'), value: t(lang, 'units.m', { value: facts.highPoint }) };
	if (facts.lowPoint != null) tiles.lowPoint = { label: t(lang, 'post.stats.lowPoint'), value: t(lang, 'units.m', { value: facts.lowPoint }) };
	if (facts.routeType) {
		tiles.routeType = { label: t(lang, 'post.stats.routeType'), value: enumLabel(lang, 'routeType', facts.routeType), icon: facts.routeType };
	}
	if (grade) {
		tiles.difficulty = {
			label: label(lang, 'difficulty'),
			value: grade,
			hint: d?.sacSource === 'computed' ? `${label(lang, 'sac')}: ${label(lang, 'sacComputed')}` : undefined
		};
	}
	if (d?.exposure) tiles.exposure = { label: label(lang, 'exposure'), value: enumLabel(lang, 'level4', d.exposure.level) };
	if (d?.fitness) tiles.fitness = { label: label(lang, 'fitness'), value: `${d.fitness} ${label(lang, 'fitnessOf')}` };
	if (season) tiles.season = { label: label(lang, 'season'), value: season };
	if (carFree) {
		// Only the answer: a journey is often train + bus + bus + a walk, which no
		// tile can hold. The connections are listed under "Getting there".
		tiles.carFree = { label: label(lang, 'carFree'), value: enumLabel(lang, 'carFree', carFree), hint: label(lang, 'access'), href: '#facts-access' };
	}

	return TILE_ORDER.flatMap((key) => {
		const tile = tiles[key];
		return tile ? [{ ...tile, key, icon: tile.icon ?? key }] : [];
	});
}
