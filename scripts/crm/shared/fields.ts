export type FieldDecl = {
	id: string;
	label: string;
	file: 'sidecar' | 'post' | 'place' | 'translation';
	path: string[];
	kind: 'text' | 'textarea' | 'date' | 'chips' | 'origin' | 'number' | 'points' | 'refs';
	suggest?: 'tags' | 'people' | 'places';
	/** Sidecar field a post's front matter may override (same path); the client doc gives it as `{ hike, post }`. */
	postOverride?: boolean;
	required?: boolean;
	/** A text the file may translate (`{ en, de }`): the field shows and edits the English, keeping the rest. */
	translated?: boolean;
};

export const FIELDS: FieldDecl[] = [
	{ id: 'sidecar.name', label: 'Name', file: 'sidecar', path: ['name'], kind: 'text', required: true, translated: true },
	{ id: 'sidecar.description', label: 'Description', file: 'sidecar', path: ['description'], kind: 'textarea', required: true, translated: true },
	{ id: 'post.title', label: 'Title', file: 'post', path: ['title'], kind: 'text' },
	{ id: 'post.description', label: 'Post description', file: 'post', path: ['description'], kind: 'textarea' },
	{ id: 'post.updated', label: 'Updated', file: 'post', path: ['updated'], kind: 'date' },
	{ id: 'post.people', label: 'People', file: 'post', path: ['people'], kind: 'chips', suggest: 'people' },
	{ id: 'post.tags', label: 'Tags', file: 'post', path: ['tags'], kind: 'chips', suggest: 'tags' },
	{ id: 'post.places', label: 'Places', file: 'post', path: ['places'], kind: 'chips', suggest: 'places' },
	{ id: 'map.origin', label: 'Map centre', file: 'sidecar', path: ['origin'], kind: 'origin', postOverride: true },
	{ id: 'map.height', label: 'Map size (px)', file: 'sidecar', path: ['height'], kind: 'number', postOverride: true },
	{ id: 'map.checkpoints', label: 'Checkpoints', file: 'sidecar', path: ['checkpoints'], kind: 'points', postOverride: true },
	/** Hike-wide only: the site ignores a post `nodes` key. */
	{ id: 'map.nodes', label: 'OSM objects', file: 'sidecar', path: ['nodes'], kind: 'refs' }
];

/** Place doc front matter (`places/<slug>.md`); keys from `placeDoc.knownKeys` in `src/lib/hikes/schema-keys.json`. */
export const PLACE_FIELDS: FieldDecl[] = [
	{ id: 'place.title', label: 'Title', file: 'place', path: ['title'], kind: 'text', required: true },
	{ id: 'place.description', label: 'Description', file: 'place', path: ['description'], kind: 'textarea', required: true },
	{ id: 'place.tags', label: 'Tags', file: 'place', path: ['tags'], kind: 'chips' },
	{ id: 'place.aliases', label: 'Aliases', file: 'place', path: ['aliases'], kind: 'chips' }
];

/**
 * A translation's front matter (`<source>.<lang>.md`); keys from `ALLOWED_KEYS` in `src/lib/hikes/translations.server.ts`.
 * Aliases for a place doc's translation only. Each is optional: a cleared one removes its key.
 */
export const TRANSLATION_FIELDS: FieldDecl[] = [
	{ id: 'tr.title', label: 'Title', file: 'translation', path: ['title'], kind: 'text' },
	{ id: 'tr.description', label: 'Description', file: 'translation', path: ['description'], kind: 'textarea' },
	{ id: 'tr.aliases', label: 'Aliases', file: 'translation', path: ['aliases'], kind: 'chips' }
];

/** The translation fields of a post's (no aliases) or a place doc's translation. */
export const translationFields = (source: 'post' | 'place'): FieldDecl[] => TRANSLATION_FIELDS.filter((f) => source === 'place' || f.id !== 'tr.aliases');

/** Map fields: the client doc gives them as `{ hike, post? }` (`post` only for postOverride ones). */
export const isMapField = (d: FieldDecl): boolean => d.kind === 'origin' || d.kind === 'number' || d.kind === 'points' || d.kind === 'refs';

/** What the Details tab renders: plain text/date/chip fields only; map fields have their own tab. */
export const detailsFields = (): FieldDecl[] => FIELDS.filter((f) => ['text', 'textarea', 'date', 'chips'].includes(f.kind) && !isMapField(f));
