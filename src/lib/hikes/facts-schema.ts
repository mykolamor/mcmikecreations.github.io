/**
 * The hand-written facts a hike post can carry under `facts:` (and its sidecar
 * under `facts`), as the page receives them: validated, merged and with every
 * place resolved. See docs/superpowers/specs/2026-10-04-hike-facts-schema-design.md
 * for the authored (YAML) side.
 *
 * The enum value lists are the single source of truth: the validator in
 * `facts.server.ts` checks against them, the types derive from them, and
 * `facts-strings.ts` must translate every one (a test checks).
 *
 * Framework-free and browser-safe.
 */

export const LANGS = ['en', 'de'] as const;
export type Lang = (typeof LANGS)[number];

export const LEVEL4 = ['none', 'low', 'moderate', 'high'] as const;
export const SEVERITIES = ['low', 'medium', 'high'] as const;
export const MARKINGS = ['good', 'partial', 'poor', 'none'] as const;
export const FERRATA_SCALES = ['schall', 'huesler', 'french', 'italian'] as const;
export const CLIMB_SCALES = ['uiaa', 'french', 'yds'] as const;
export const SNOWSHOE_GRADES = ['WT1', 'WT2', 'WT3', 'WT4', 'WT5', 'WT6'] as const;
export const SKI_GRADES = ['L', 'WS', 'ZS', 'S', 'SS', 'AS', 'EX'] as const;
export const ROUTE_TYPES = ['loop', 'out-and-back', 'point-to-point', 'lollipop', 'traverse'] as const;
export const TERRAINS = [
	'road', 'forest-road', 'path', 'meadow', 'forest', 'ski-slope',
	'rocky', 'scree', 'boulders', 'scramble', 'ridge', 'secured',
	'snow', 'glacier', 'ice', 'mud', 'overgrown', 'steps', 'beach', 'urban'
] as const;
export const HAZARD_KINDS = [
	'exposure', 'unsecured-ridge', 'fall-risk', 'rockfall', 'loose-rock', 'scree',
	'snowfield', 'ice', 'glacier', 'crevasses', 'avalanche', 'cornice',
	'river-crossing', 'flooding', 'slippery', 'mud',
	'lightning', 'heat', 'cold', 'wind', 'fog', 'sun',
	'altitude', 'remoteness', 'darkness', 'long-day',
	'navigation', 'poor-marking', 'overgrown',
	'cattle', 'guard-dogs', 'wildlife', 'ticks', 'hunting',
	'traffic', 'crowding', 'closure', 'construction', 'no-water', 'no-signal'
] as const;
export const BAILOUT_VIA = ['trail', 'lift', 'road', 'bus', 'taxi', 'hut'] as const;
export const WATER_KINDS = ['tap', 'fountain', 'spring', 'stream', 'lake', 'hut', 'shop'] as const;
export const RELIABILITY = ['yes', 'seasonal', 'no', 'unknown'] as const;
export const SIGNAL_QUALITY = ['none', 'patchy', 'good'] as const;
export const STOP_KINDS = [
	'alpine-hut', 'wilderness-hut', 'restaurant', 'cafe', 'kiosk', 'shelter',
	'teahouse', 'hotel', 'camping', 'shop'
] as const;
export const CAR_FREE = ['yes', 'partial', 'no'] as const;
export const TRANSPORT_MODES = [
	'train', 'bus', 'tram', 'metro', 'ferry', 'taxi', 'jeep', 'flight', 'car', 'bike'
] as const;
export const DIRECTIONS = ['there', 'back', 'both'] as const;
export const PARKING_SIZES = ['small', 'medium', 'large'] as const;
export const PARKING_FILLS = ['never', 'weekends', 'summer', 'always'] as const;
export const LIFT_KINDS = [
	'gondola', 'cable-car', 'chairlift', 'drag-lift', 'rack-railway', 'funicular', 'elevator'
] as const;
export const LIFT_DIRECTIONS = ['up', 'down', 'both'] as const;
export const PRICE_PER = ['person', 'adult', 'child', 'car', 'day', 'night', 'trip', 'return'] as const;
export const RULE_KINDS = [
	'protected-area', 'no-camping', 'no-fires', 'no-drones', 'no-dogs', 'dogs-on-leash',
	'no-bikes', 'private-land', 'seasonal-closure', 'wildlife-zone', 'military', 'fee'
] as const;
export const KIDS = ['yes', 'older', 'no'] as const;
export const DOGS = ['yes', 'leash', 'no'] as const;
export const BIKE = ['yes', 'partial', 'no'] as const;
export const WINTER = ['yes', 'with-gear', 'no'] as const;
export const EXPERIENCED = ['yes', 'experienced', 'no'] as const;
export const WEATHER = [
	'clear', 'sunny', 'partly-cloudy', 'overcast', 'fog', 'haze',
	'drizzle', 'rain', 'showers', 'thunderstorm', 'snow', 'wind', 'hail'
] as const;
export const VISIBILITY = ['excellent', 'good', 'moderate', 'poor'] as const;
export const TRACTION = ['none', 'poles', 'microspikes', 'crampons'] as const;
export const TRAIL_STATES = ['dry', 'wet', 'muddy', 'icy', 'snow', 'overgrown', 'washed-out', 'damaged'] as const;
export const CROWDING = ['alone', 'quiet', 'moderate', 'busy', 'crowded'] as const;
export const DEVIATION_KINDS = [
	'solo', 'night', 'unroped', 'off-trail', 'no-gear', 'weather', 'late-start', 'closed-route', 'fatigue'
] as const;
export const GEAR_NEED = ['essential', 'conditional', 'optional'] as const;
export const GEAR_KINDS = [
	'boots', 'trail-shoes', 'approach-shoes', 'poles', 'backpack',
	'water', 'food', 'electrolytes', 'filter',
	'headlamp', 'batteries', 'power-bank', 'phone', 'gps', 'offline-map', 'paper-map', 'compass',
	'rain-shell', 'insulation', 'base-layer', 'gloves', 'hat', 'buff', 'spare-socks',
	'sun-protection', 'sunglasses', 'sunscreen', 'insect-repellent',
	'first-aid', 'emergency-blanket', 'whistle', 'knife',
	'helmet', 'harness', 'via-ferrata-set', 'rope', 'slings', 'gloves-ferrata',
	'microspikes', 'crampons', 'ice-axe', 'gaiters', 'snowshoes', 'avalanche-kit',
	'sleeping-bag', 'hut-sleeping-bag', 'tent', 'mat', 'stove',
	'cash', 'id', 'permit', 'swimwear', 'towel'
] as const;
export const SOURCE_KINDS = ['video', 'guidebook', 'website', 'map', 'forum', 'official', 'weather'] as const;

/** Every enum the string table has to translate, by group name. */
export const ENUMS = {
	level4: LEVEL4, severity: SEVERITIES, marking: MARKINGS, ferrataScale: FERRATA_SCALES,
	climbScale: CLIMB_SCALES, routeType: ROUTE_TYPES, terrain: TERRAINS, hazard: HAZARD_KINDS,
	bailoutVia: BAILOUT_VIA, water: WATER_KINDS, reliability: RELIABILITY, signal: SIGNAL_QUALITY,
	stop: STOP_KINDS, carFree: CAR_FREE, transport: TRANSPORT_MODES, direction: DIRECTIONS,
	parkingSize: PARKING_SIZES, parkingFills: PARKING_FILLS, lift: LIFT_KINDS,
	liftDirection: LIFT_DIRECTIONS, pricePer: PRICE_PER, rule: RULE_KINDS, kids: KIDS, dogs: DOGS,
	bike: BIKE, winter: WINTER, experienced: EXPERIENCED, weather: WEATHER, visibility: VISIBILITY,
	traction: TRACTION, trail: TRAIL_STATES, crowding: CROWDING, deviation: DEVIATION_KINDS,
	gearNeed: GEAR_NEED, gear: GEAR_KINDS, source: SOURCE_KINDS
} as const;
export type EnumGroup = keyof typeof ENUMS;

type Of<T extends readonly string[]> = T[number];

/** Free text, normalized: a plain string in YAML becomes `{ en }`. */
export interface Text { en: string; de?: string }

/** The text in `lang`, falling back to English. */
export function textIn(text: Text | null | undefined, lang: Lang): string {
	if (!text) return '';
	return (lang !== 'en' && text[lang]) || text.en;
}

/** A place, resolved against the hike's nodes and projected onto the route. */
export interface Place {
	/** What to call it: the node's name, or the authored name or string. */
	name: Text;
	/** OSM node id when it's one of the hike's nodes. */
	node?: number;
	lat?: number;
	lon?: number;
	/** Distance along the route, km on the chart's scale; absent when off the route or unresolved. */
	km?: number;
	/** Elevation, m: the node's `ele`, else the track's. */
	ele?: number;
	/**
	 * The 3D map's terrain height there (m): the node's, or the place's own
	 * (scripts/backfill_terrain.py fills sidecar places). Without it the place
	 * stays off the 3D map, like a photo without one.
	 */
	demEle?: number;
	/** False when the authored place matched nothing (a build warning). */
	resolved: boolean;
}

export interface Span { from?: Place; to?: Place }

export interface Price {
	amount: number;
	currency?: string;
	per?: Of<typeof PRICE_PER>;
	note?: Text;
	checked?: string;
}

export interface Window { from: string; to: string }
export interface Link { url: string; label?: Text }

export interface FerrataGrade { grade: string; scale?: Of<typeof FERRATA_SCALES> }
export interface ClimbGrade { grade: string; scale?: Of<typeof CLIMB_SCALES> }

export interface Difficulty {
	sac?: string;
	/** Present whenever `sac` is: written by hand, or the hardest section/leg grade. */
	sacSource?: 'manual' | 'computed';
	note?: Text;
	sections?: Array<Span & { sac?: string; viaFerrata?: FerrataGrade; climbing?: ClimbGrade; note?: Text }>;
	viaFerrata?: Array<FerrataGrade & Span & { name?: Text; length?: number; gain?: number; time?: number; note?: Text }>;
	climbing?: ClimbGrade & { note?: Text };
	exposure?: { level: Of<typeof LEVEL4>; note?: Text };
	fitness?: number;
	winter?: {
		snowshoe?: Of<typeof SNOWSHOE_GRADES>;
		skiTour?: string;
		avalanche?: number;
		note?: Text;
	};
}

export interface Season { best?: number[]; possible?: number[]; window?: Window; note?: Text }

export interface RouteInfo {
	start?: Place;
	end?: Place;
	type?: Of<typeof ROUTE_TYPES>;
	official?: Text;
	optional?: Array<Span & { name?: Text; note?: Text }>;
	terrain?: Array<Of<typeof TERRAINS>>;
	shade?: Of<typeof LEVEL4>;
	trails?: string[];
	peaks?: Place[];
}

export interface Navigation {
	marking?: Of<typeof MARKINGS>;
	spans?: Array<Span & { marking: Of<typeof MARKINGS>; note?: Text }>;
	note?: Text;
	offline?: boolean;
}

export interface Hazard extends Span {
	kind: Of<typeof HAZARD_KINDS> | string;
	label?: Text;
	at?: Place;
	severity?: Of<typeof SEVERITIES>;
	season?: number[];
	note?: Text;
}

/** A bailout's route planned in a routing tool, from its GPX file. */
export interface BailoutRoute {
	/** Served path of the GPX file, for the download link. */
	url: string;
	/** `[lat, lon]` along the route. */
	coords: [number, number][];
	/** m */
	distance: number;
	ascent?: number;
	descent?: number;
	/** min, DAV walking time without breaks; only with elevations in the GPX. */
	duration?: number;
}

export interface Bailout {
	at: Place;
	route?: BailoutRoute;
	to?: Text;
	via?: Of<typeof BAILOUT_VIA>;
	time?: number;
	note?: Text;
	last?: boolean;
}

export interface WaterSource {
	at: Place;
	kind?: Of<typeof WATER_KINDS>;
	reliable?: Of<typeof RELIABILITY>;
	treat?: boolean;
	note?: Text;
}

export interface SignalSpan extends Span {
	quality: Of<typeof SIGNAL_QUALITY>;
	network?: string;
	note?: Text;
}

export interface Stop {
	at: Place;
	kind?: Of<typeof STOP_KINDS>;
	open?: Window | 'all-year' | 'closed';
	days?: Text;
	overnight?: boolean;
	booking?: Link;
	phone?: string;
	water?: boolean;
	food?: boolean;
	cash?: boolean;
	price?: Price[];
	note?: Text;
	checked?: string;
}

export interface Transport {
	mode: Of<typeof TRANSPORT_MODES>;
	from: Text;
	to: Place;
	direction?: Of<typeof DIRECTIONS>;
	duration?: number;
	changes?: number;
	line?: string;
	operator?: string;
	first?: string;
	last?: string;
	frequency?: Text;
	price?: Price[];
	ticket?: Text;
	url?: Link;
	note?: Text;
	checked?: string;
}

export interface Parking {
	at?: Place;
	name?: Text;
	price?: Price[];
	size?: Of<typeof PARKING_SIZES>;
	fills?: Of<typeof PARKING_FILLS>;
	freeWith?: Text;
	url?: Link;
	note?: Text;
	checked?: string;
}

export interface Lift extends Span {
	name: Text;
	kind?: Of<typeof LIFT_KINDS>;
	direction?: Of<typeof LIFT_DIRECTIONS>;
	open?: Window;
	first?: string;
	last?: string;
	price?: Price[];
	url?: Link;
	note?: Text;
	checked?: string;
}

export interface Ticket {
	name: Text;
	includes?: Text[];
	price?: Price[];
	validity?: Text;
	url?: Link;
	note?: Text;
	checked?: string;
}

export interface Border { at: Place; from: string; to: string; note?: Text }

export interface Access {
	carFree?: Of<typeof CAR_FREE>;
	transport?: Transport[];
	parking?: Parking[];
	lifts?: Lift[];
	tickets?: Ticket[];
	borders?: Border[];
	note?: Text;
	checked?: string;
}

export interface Permit {
	name: Text;
	required?: boolean;
	where?: Text;
	price?: Price[];
	url?: Link;
	note?: Text;
	checked?: string;
}

export interface Rule extends Span {
	kind: Of<typeof RULE_KINDS> | string;
	label?: Text;
	season?: number[];
	note?: Text;
}

export interface Suitability {
	kids?: Of<typeof KIDS>;
	dogs?: Of<typeof DOGS>;
	stroller?: boolean;
	bike?: Of<typeof BIKE>;
	winter?: Of<typeof WINTER>;
	night?: Of<typeof EXPERIENCED>;
	solo?: Of<typeof EXPERIENCED>;
	note?: Text;
}

export interface Leg {
	to: Place;
	terrain?: Array<Of<typeof TERRAINS>>;
	sac?: string;
	viaFerrata?: FerrataGrade;
	marking?: Of<typeof MARKINGS>;
	optional?: boolean;
	note?: Text;
}

export interface Conditions {
	weather?: Array<Of<typeof WEATHER>>;
	temp?: { min?: number; max?: number };
	visibility?: Of<typeof VISIBILITY>;
	snowLine?: number;
	traction?: Of<typeof TRACTION>;
	trail?: Array<Of<typeof TRAIL_STATES>>;
	crowding?: Of<typeof CROWDING>;
	start?: string;
	why?: Text;
	note?: Text;
}

export interface Deviation { kind?: Of<typeof DEVIATION_KINDS>; at?: Place; note: Text }

export interface GearItem {
	item: Of<typeof GEAR_KINDS> | string;
	label?: Text;
	need?: Of<typeof GEAR_NEED>;
	when?: Text;
	amount?: Text;
}

export interface Variant {
	name: Text;
	summary?: Text;
	distance?: number;
	ascent?: number;
	descent?: number;
	duration?: number;
	sac?: string;
	viaFerrata?: FerrataGrade;
	link?: string;
	recommended?: boolean;
	note?: Text;
}

export interface Plan {
	gear?: GearItem[];
	for?: Text[];
	notFor?: Text[];
	variants?: Variant[];
	timing?: { start?: string; turnaround?: string; sunrise?: { start: string; note?: Text }; note?: Text };
	alternatives?: { easier?: string[]; harder?: string[]; similar?: string[] };
	note?: Text;
}

export interface Source {
	title: Text;
	url: string;
	kind?: Of<typeof SOURCE_KINDS>;
	lang?: string;
	note?: Text;
}

export interface HikeAuthoredFacts {
	checked?: string;
	summary?: Text;
	difficulty?: Difficulty;
	season?: Season;
	route?: RouteInfo;
	navigation?: Navigation;
	hazards?: Hazard[];
	bailouts?: Bailout[];
	water?: WaterSource[];
	signal?: SignalSpan[];
	stops?: Stop[];
	access?: Access;
	permits?: Permit[];
	/** Where drones are forbidden and why, in the author's words. */
	drones?: Text;
	/** Nature reserves and similar protected zones (Naturschutzgebiet, …) on the way, in the author's words. */
	protectedAreas?: Text;
	rules?: Rule[];
	suitability?: Suitability;
	legs?: Leg[];
	conditions?: Conditions;
	deviations?: Deviation[];
	plan?: Plan;
	sources?: Source[];
}

const SAC_RE = /^T([1-6])([+-]?)$/;
/** A single grade, or a range for a stretch of mixed difficulty: `T1-T2` or `T1–T2`. */
const SAC_RANGE_RE = /^(T[1-6][+-]?)[-–](T[1-6][+-]?)$/;

function sacSingleRank(grade: string): number {
	const m = SAC_RE.exec(grade);
	if (!m) return -1;
	return Number(m[1]) * 3 + (m[2] === '+' ? 1 : m[2] === '-' ? -1 : 0);
}

/** Whether `grade` is an SAC hiking grade, `T1`–`T6` with an optional `+`/`-`, or an easier–harder range of two. */
export function isSacGrade(grade: string): boolean {
	if (SAC_RE.test(grade)) return true;
	const m = SAC_RANGE_RE.exec(grade);
	return !!m && sacSingleRank(m[1]) < sacSingleRank(m[2]);
}

/** The hardest grade in `grade`: the grade itself, or a range's upper end. */
export function sacTop(grade: string): string {
	return SAC_RANGE_RE.exec(grade)?.[2] ?? grade;
}

/** Orders SAC grades: T3- < T3 < T3+ < T4- …; a range ranks as its upper end; -1 for anything else. */
export function sacRank(grade: string): number {
	return sacSingleRank(sacTop(grade));
}

/** Writes a range with an en dash, `T1–T2`; single grades are unchanged. */
export function normaliseSac(grade: string): string {
	const m = SAC_RANGE_RE.exec(grade);
	return m ? `${m[1]}–${m[2]}` : grade;
}
