import { ApiError } from './errors';
import { FrontmatterError } from '../lib/frontmatter';
import { YAMLParseError } from 'yaml';
import { clientDoc, loadDoc, saveOps } from './doc';
import { withDocLock } from './doc-lock';
import { linksKey, lockKey, refFromQuery, type EnglishRef, type SourceRef } from './doc-ref';
import { createPlace, loadPlace, placeClientDoc, savePlaceOps } from './place-doc';
import { createTranslation, loadTranslation, saveTranslationOps, translationClientDoc, type TranslationRef } from './translation-doc';
import type { FieldOp } from '../shared/ops';
import { OTHER_LANGS, type Lang } from '$lib/i18n/languages';
import { listHikes, suggestions, type SuggestKind } from './hikes-index';
import { problemsForRef } from './problems';
import { docGaps } from './translation-gaps';
import { createHike, createPost } from './create';
import { depsVersion, filesState, rebuildThumb, addBailout, replaceBailout, routeLine, writeCover, writeGeojson, writeGpx, type CoverScope } from './files';
import { assertSafeDate } from './paths';
import { downloadTiles, tileStatus, type SpawnFn } from './tiles';
import { currentMetrics, recomputeMetrics, computedMetrics } from './metrics';
import { createOsmClient, createStubClient, type OsmClient } from './osm-client';
import { StaleStoreError, addToStore, osmAround, osmSearch, refreshElement, setLocal, storeEntry, storeInBox, storeVersion } from './osm-service';
import { loadSettings, type Settings } from './settings';
import { mapPayload } from './map-data';
import { createMapyTiles, type MapyTiles } from './mapy-tiles';
import { candidates } from './photo-sources';
import { createImmich, createStubImmich, type Immich } from './immich-client';
import { StaleDocError, addFromImmich, addFromLibrary, addUpload, pinState, postPhotos, removePhoto, setAlt, setCaption, setLocation, setPins, setTime } from './photo-ops';
import { postCaptionPlaces } from './caption-places';
import { docHasPins, photoBadges } from './photo-badges';
import { listLibrary } from './photo-library';
import { findInImmich, hasPhotoKey } from './image-match';
import { readLinks, setLink } from './immich-links';
import { VIDEO_MAX_BYTES, addYoutube, uploadVideo } from './write-ops';
import { previewHtml, renderInputs } from './preview';
import { readDocFacts } from './facts-read';
import { StaleLibraryError, libraryState, putLibraryRecord } from './facts-library-api';
import { StaleStringsError, readStrings, writeStrings } from './strings-file';
import { keepApart, mergeNearDuplicates, nearDuplicateGroups, type MergeRequest } from '../lib/facts-near-duplicates';
import { createTerrain, type Terrain } from './terrain';
import { DeeplError, NO_KEY, deeplLangs, deeplStub, deeplTarget, translateBatch, type DeeplText } from './deepl';
import type { VideoFetcher } from './video-meta';
import path from 'node:path';
import { repoPaths } from './paths';
import type { PlaceDocRef } from '../../../src/lib/hikes/place-docs';
import type { PlaceNode } from '../../../src/lib/hikes/place-links';

export { ApiError };

export type ApiRequest = {
	method: string;
	path: string;
	query: URLSearchParams;
	json?: unknown;
	body?: Buffer;
	/** The raw request body of a route in STREAMED_ROUTES (not buffered; `body` and `json` stay unset). */
	stream?: AsyncIterable<Uint8Array>;
	headers: Record<string, string>;
	/** Values of the `:name` segments of the matched route, in order. */
	params?: string[];
};

/** `stream` yields ready-made SSE lines (including the trailing blank line). */
export type ApiResponse = { status: number; json?: unknown; stream?: AsyncIterable<string>; binary?: { contentType: string; body: Buffer } };

export type Handler = (req: ApiRequest, root: string) => ApiResponse | Promise<ApiResponse>;

/** Routes that get the request body as `stream` instead of a buffered `body`. */
export const STREAMED_ROUTES = new Set(['PUT /api/write/video']);

/** A post (`?slug&date`) or hike (`?slug`) doc; place docs (`?place=`) and translations (`&lang=`) are refused here. */
function docKey(req: ApiRequest): { slug: string; date: string | null } {
	const ref = refFromQuery(req.query);
	if (ref.kind === 'place') throw new ApiError(400, 'Not available for a place doc');
	if (ref.kind === 'translation') throw new ApiError(400, 'Not available for a translation');
	return { slug: ref.slug, date: ref.kind === 'post' ? ref.date : null };
}

/** A doc whose photos a route edits: a post (`?slug&date`) or a place doc (`?place=`); a hike alone has none, nor a translation. */
function photoRef(req: ApiRequest): SourceRef {
	const ref = refFromQuery(req.query);
	if (ref.kind === 'hike' || ref.kind === 'translation') throw new ApiError(400, 'a dated visit or a place doc is required');
	return ref;
}

/** An English doc (a post, a hike, a place doc); a translation (`&lang=`) is refused. */
function englishRef(req: ApiRequest): EnglishRef {
	const ref = refFromQuery(req.query);
	if (ref.kind === 'translation') throw new ApiError(400, 'Not available for a translation');
	return ref;
}

/** The translation a route acts on: a post's or place doc's ref with `&lang=`. */
function translationRef(req: ApiRequest): TranslationRef {
	const ref = refFromQuery(req.query);
	if (ref.kind !== 'translation') throw new ApiError(400, 'lang (the translation\'s language) is required');
	return ref;
}

/** The lock shared by a hike's sidecar and its posts. */
const postLock = (slug: string): string => lockKey({ kind: 'hike', slug });

function validOp(op: unknown): boolean {
	if (!op || typeof op !== 'object') return false;
	const o = op as Record<string, unknown>;
	if (o.kind === 'body') return typeof o.text === 'string';
	if (o.kind === 'mirrors')
		return (
			Array.isArray(o.rows) &&
			o.rows.every(
				(r) => !!r && typeof r === 'object' && typeof r.title === 'string' && typeof r.url === 'string' && (r.key === undefined || Number.isInteger(r.key))
			)
		);
	if (o.kind === 'facts')
		return (
			(o.scope === 'hike' || o.scope === 'post') &&
			Array.isArray(o.path) &&
			o.path.every((s) => (typeof s === 'string' && s !== '') || (Number.isInteger(s) && s >= 0)) &&
			(o.remove === true ? !('value' in o) : 'value' in o)
		);
	if (o.lang !== undefined && !(typeof o.lang === 'string' && (OTHER_LANGS as readonly string[]).includes(o.lang))) return false;
	return typeof o.field === 'string';
}

function upload(req: ApiRequest): { file: Buffer; filename: string } {
	if (!req.body || !req.body.length) throw new ApiError(400, 'Empty upload');
	let filename = req.headers['x-filename'] ?? '';
	try {
		filename = decodeURIComponent(filename);
	} catch {
		/* keep the raw header */
	}
	return { file: req.body, filename };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function needDate(req: ApiRequest): string {
	const d = req.query.get('date');
	if (!d) throw new ApiError(400, 'date is required');
	return assertSafeDate(d);
}

/**
 * Runs a file write under the per-slug lock: `base` must be the doc's current version (else 409 and nothing is written);
 * answers with the new FilesState and the new doc version.
 */
function guardedUpload(
	req: ApiRequest,
	root: string,
	write: (slug: string, date: string | null, file: Buffer, filename: string) => Promise<void>
): Promise<ApiResponse> {
	const { slug, date } = docKey(req);
	const base = req.query.get('base');
	if (!base) throw new ApiError(400, 'base (the doc version) is required');
	const { file, filename } = upload(req);
	return withDocLock(postLock(slug), async () => {
		const cur = loadDoc(root, slug, date);
		if (cur.version !== base) {
			const { version, fields, mirrors, body } = clientDoc(cur);
			return { status: 409, json: { error: 'changed on disk', version, fields, mirrors, body } };
		}
		await write(slug, date, file, filename);
		return { status: 200, json: { files: await filesState(root, slug, date), version: loadDoc(root, slug, date).version } };
	});
}

/** Photo writes: a stale `base` answers 409 with the current doc, like the other doc writes. */
async function photoWrite(run: () => Promise<unknown>): Promise<ApiResponse> {
	try {
		return { status: 200, json: await run() };
	} catch (e) {
		if (e instanceof StaleDocError) return { status: 409, json: { error: e.message, version: e.version, fields: e.fields, mirrors: e.mirrors, body: e.body } };
		throw e;
	}
}

export type WritePlaces = { nodes: PlaceNode[]; origin: { lat: number; lon: number } | null; height: number | null; ownRefs: string[]; placeDocs: PlaceDocRef[] };

/**
 * What the Write tab needs to suggest and underline place mentions, built as the post page loader builds it but from
 * the files as they are now (the site's `storeNodes()` keeps the store it loaded first): every element of
 * `osm.json`, the merged origin and height, the hike's own nodes, and the post's place docs (its `places:`, else the
 * sidecar's). A place doc has no origin, height, own nodes or place docs.
 */
function writePlaces(root: string, ref: EnglishRef): WritePlaces {
	const { nodes, origin, height, ownRefs, placeDocs } = renderInputs(root, ref);
	return { nodes, origin, height, ownRefs, placeDocs: placeDocs.map(({ slug, title, names }) => ({ slug, title, names })) };
}

/** Routes are keyed `"METHOD /api/path"`. Later tasks add their routes here. */
export function defaultRoutes(deps: { spawn?: SpawnFn; settings?: (root: string) => Settings; osm?: OsmClient; mapyTiles?: (root: string) => MapyTiles; immich?: (root: string) => Immich; youtube?: VideoFetcher; deeplFetch?: typeof fetch } = {}): Record<string, Handler> {
	const settingsOf = deps.settings ?? ((root: string) => loadSettings(root));
	let osmClient = deps.osm;
	/** One terrain per DEM folder: it keeps the tiles it decoded. */
	const terrains = new Map<string, Terrain>();
	const osm = (): OsmClient => (osmClient ??= process.env.CRM_OSM_STUB === '1' ? createStubClient() : createOsmClient());
	/** Store, library and string-table writes answer 409 { error, version } when `base` is stale. */
	const storeWrite = async (run: () => Promise<unknown>): Promise<ApiResponse> => {
		try {
			return { status: 200, json: await run() };
		} catch (e) {
			if (e instanceof StaleStoreError || e instanceof StaleLibraryError || e instanceof StaleStringsError) return { status: 409, json: { error: e.message, version: e.version } };
			throw e;
		}
	};
	const body = (req: ApiRequest): Record<string, unknown> => {
		if (!req.json || typeof req.json !== 'object') throw new ApiError(400, 'JSON body required');
		return req.json as Record<string, unknown>;
	};
	const coord = (req: ApiRequest, k: string): number => {
		const v = req.query.get(k);
		const n = v === null || v === '' ? NaN : Number(v);
		if (!Number.isFinite(n)) throw new ApiError(400, `${k} is required`);
		return n;
	};
	const mapyCaches = new Map<string, MapyTiles>();
	const mapyTiles = (root: string): MapyTiles => {
		if (deps.mapyTiles) return deps.mapyTiles(root);
		let t = mapyCaches.get(root);
		if (!t) mapyCaches.set(root, (t = createMapyTiles({ dir: path.join(repoPaths(root).crmData, 'tile-cache') })));
		return t;
	};
	const immichClients = new Map<string, { url?: string; key?: string; client: Immich }>();
	const immich = (root: string): Immich => {
		if (deps.immich) return deps.immich(root);
		// Settings are re-read per call: after a "set immichUrl and immichKey" 400 the user edits settings.json and the next call picks it up.
		const s = settingsOf(root);
		let c = immichClients.get(root);
		if (!c || c.url !== s.immichUrl || c.key !== s.immichKey) {
			const cacheDir = path.join(repoPaths(root).crmData, 'immich-cache');
			const client = process.env.CRM_IMMICH_STUB === '1' ? createStubImmich() : createImmich({ url: s.immichUrl, key: s.immichKey, cacheDir });
			immichClients.set(root, (c = { url: s.immichUrl, key: s.immichKey, client }));
		}
		return c.client;
	};
	const stubDeepl = process.env.CRM_DEEPL_STUB === '1';
	const deeplFetch = deps.deeplFetch ?? (stubDeepl ? deeplStub : fetch);
	// Re-read per call, like Immich's, so a key added to settings.json works without a restart. The stub needs none.
	const deeplKey = (root: string): string | undefined => settingsOf(root).deeplKey ?? (stubDeepl ? 'stub' : undefined);
	return {
		'GET /api/deepl/status': (_req, root) => ({ status: 200, json: { configured: !!deeplKey(root), targets: deeplLangs() } }),
		'POST /api/deepl/translate': async (req, root) => {
			const b = body(req);
			const lang = b.lang;
			if (typeof lang !== 'string' || !(OTHER_LANGS as readonly string[]).includes(lang) || !deeplTarget(lang as Lang)) throw new ApiError(400, 'lang must be a language DeepL fills');
			const kinds = ['markdown', 'plain', 'table'];
			if (!Array.isArray(b.texts) || !b.texts.every((t) => !!t && typeof t === 'object' && typeof t.id === 'string' && typeof t.text === 'string' && kinds.includes(t.kind)))
				throw new ApiError(400, 'texts must be [{ id, text, kind: markdown | plain | table }]');
			const key = deeplKey(root);
			if (!key) return { status: 503, json: { error: 'no-key', message: NO_KEY } };
			try {
				return { status: 200, json: await translateBatch(b.texts as DeeplText[], lang as Lang, { key, fetch: deeplFetch }) };
			} catch (e) {
				if (e instanceof DeeplError) return { status: 502, json: { error: e.kind, message: e.message } };
				throw e;
			}
		},
		'GET /api/immich/albums': async (_req, root) => ({ status: 200, json: { albums: await immich(root).albums() } }),
		'GET /api/photos/candidates': async (req, root) => {
			const ref = englishRef(req);
			const params = { ref, album: req.query.get('album') || (ref.kind === 'place' ? 'none' : 'guess'), from: req.query.get('from'), to: req.query.get('to'), query: req.query.get('query') };
			return { status: 200, json: await candidates(root, immich(root), params) };
		},
		'POST /api/photos/add': (req, root) => {
			const ref = photoRef(req);
			const b = body(req);
			if (typeof b.base !== 'string') throw new ApiError(400, 'base (the doc version) is required');
			if (b.source === 'immich') {
				if (typeof b.assetId !== 'string') throw new ApiError(400, 'assetId is required');
				return photoWrite(() => addFromImmich(root, ref, b.assetId as string, b.base as string, { immich: immich(root) }));
			}
			if (b.source === 'library') {
				if (typeof b.href !== 'string') throw new ApiError(400, 'href is required');
				return photoWrite(() => addFromLibrary(root, ref, b.href as string, b.base as string));
			}
			throw new ApiError(400, 'source must be immich or library');
		},
		'PUT /api/photos/upload': (req, root) => {
			const ref = photoRef(req);
			const base = req.query.get('base');
			if (!base) throw new ApiError(400, 'base (the doc version) is required');
			const { file, filename } = upload(req);
			const opts = { target: req.query.get('target') || 'stories', credit: req.query.get('credit') || undefined, sourceUrl: req.query.get('sourceUrl') || undefined };
			return photoWrite(() => addUpload(root, ref, file, filename, opts, base));
		},
		'GET /api/photos/list': (req, root) => {
			return { status: 200, json: { photos: postPhotos(root, photoRef(req)) } };
		},
		'GET /api/photos/library': (req, root) => ({ status: 200, json: listLibrary(root, req.query.get('dir') ?? '') }),
		'GET /api/photos/badges': (req, root) => {
			return { status: 200, json: { badges: photoBadges(root, photoRef(req)) } };
		},
		'POST /api/photos/time': (req, root) => {
			const ref = photoRef(req);
			const b = body(req);
			if (typeof b.base !== 'string') throw new ApiError(400, 'base (the doc version) is required');
			const change = typeof b.taken === 'string' ? { taken: b.taken } : { shiftMinutes: b.shiftMinutes as number };
			return photoWrite(() => setTime(root, ref, b.keys as string[], change, b.base as string, { immich: immich(root) }));
		},
		'POST /api/photos/location': (req, root) => {
			const ref = photoRef(req);
			const b = body(req);
			if (typeof b.base !== 'string') throw new ApiError(400, 'base (the doc version) is required');
			const pos = b.drop === true ? null : b.fromTrack === true ? { fromTrack: true as const } : { lat: b.lat as number, lon: b.lon as number };
			return photoWrite(() => setLocation(root, ref, b.key as string, pos, b.base as string, { immich: immich(root) }));
		},
		'POST /api/photos/alt': (req, root) => {
			const ref = photoRef(req);
			const b = body(req);
			if (typeof b.base !== 'string') throw new ApiError(400, 'base (the doc version) is required');
			return photoWrite(() => setAlt(root, ref, b.key as string, (b.text ?? null) as string | null, b.base as string));
		},
		'GET /api/photos/has-pins': (req, root) => {
			return { status: 200, json: { hasPins: docHasPins(root, englishRef(req)) } };
		},
		'GET /api/photos/pins': (req, root) => {
			return { status: 200, json: pinState(root, photoRef(req), req.query.get('key') ?? '') };
		},
		'POST /api/photos/pins': (req, root) => {
			const ref = photoRef(req);
			const b = body(req);
			if (typeof b.base !== 'string') throw new ApiError(400, 'base (the doc version) is required');
			return photoWrite(() => setPins(root, ref, b.key as string, b.pins, b.base as string));
		},
		'POST /api/photos/caption': (req, root) => {
			const ref = photoRef(req);
			const b = body(req);
			if (typeof b.base !== 'string') throw new ApiError(400, 'base (the doc version) is required');
			return photoWrite(() => setCaption(root, ref, b.key as string, b.text as string, b.base as string));
		},
		'GET /api/photos/caption-places': (req, root) => {
			return { status: 200, json: { places: postCaptionPlaces(root, photoRef(req), req.query.get('text') ?? '') } };
		},
		'DELETE /api/photos/:key': (req, root) => {
			const ref = photoRef(req);
			const base = req.query.get('base');
			if (!base) throw new ApiError(400, 'base (the doc version) is required');
			let key: string;
			try {
				key = decodeURIComponent((req.params ?? [])[0] ?? '');
			} catch {
				throw new ApiError(400, 'Bad key');
			}
			return photoWrite(() => removePhoto(root, ref, key, base));
		},
		'GET /api/photos/find': async (req, root) => {
			const ref = photoRef(req);
			const key = req.query.get('key');
			if (!key) throw new ApiError(400, 'key is required');
			const opts = { immich: immich(root), album: req.query.get('album') || (ref.kind === 'place' ? 'none' : 'guess'), from: req.query.get('from'), to: req.query.get('to'), query: req.query.get('query') };
			return { status: 200, json: await findInImmich(root, ref, key, opts) };
		},
		'POST /api/photos/link': (req, root) => {
			const ref = photoRef(req);
			const b = body(req);
			if (typeof b.key !== 'string' || typeof b.assetId !== 'string') throw new ApiError(400, 'key and assetId are required');
			if (!(UUID.test(b.assetId) || (process.env.CRM_IMMICH_STUB === '1' && /^stub-asset-\d+$/.test(b.assetId)))) throw new ApiError(400, `Bad asset id ${b.assetId}`);
			const { key, assetId } = b as { key: string; assetId: string };
			const docLinks = linksKey(ref);
			return withDocLock(lockKey(ref), async () => {
				if (!hasPhotoKey(root, ref, key)) throw new ApiError(404, `No such photo: ${key}`);
				// One asset, one photo per doc: a second key would make write-backs and "in the post" ambiguous.
				const other = Object.entries(readLinks(root)[docLinks] ?? {}).find(([k, id]) => id === assetId && k !== key)?.[0];
				if (other !== undefined) throw new ApiError(409, `This Immich photo is already linked to ${other}`);
				await setLink(root, docLinks, key, assetId);
				return { status: 200, json: { key, assetId } };
			});
		},
		'GET /api/immich/thumb/:id': async (req, root) => {
			const size = req.query.get('size') ?? 'thumbnail';
			if (size !== 'thumbnail' && size !== 'preview') throw new ApiError(400, 'size must be thumbnail or preview');
			const body = await immich(root).thumb((req.params ?? [])[0] ?? '', size);
			return { status: 200, binary: { contentType: body[0] === 0xff ? 'image/jpeg' : body.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/jpeg', body } };
		},
		'PUT /api/write/video': (req, root) => {
			const ref = photoRef(req);
			const base = req.query.get('base');
			if (!base) throw new ApiError(400, 'base (the doc version) is required');
			if (!req.stream) throw new ApiError(400, 'Empty upload');
			// Refused up front when the browser says the size; uploadVideo counts the bytes anyway.
			if (Number(req.headers['content-length']) > VIDEO_MAX_BYTES) throw new ApiError(413, 'The video is larger than 2048 MB');
			return photoWrite(() => uploadVideo(root, ref, req.stream!, base));
		},
		'POST /api/write/youtube': (req, root) => {
			const ref = photoRef(req);
			const b = body(req);
			if (typeof b.base !== 'string') throw new ApiError(400, 'base (the doc version) is required');
			if (typeof b.url !== 'string') throw new ApiError(400, 'url is required');
			return photoWrite(() => addYoutube(root, ref, b.url as string, b.base as string, { fetcher: deps.youtube }));
		},
		'GET /api/write/places': (req, root) => ({ status: 200, json: writePlaces(root, englishRef(req)) }),
		'GET /api/preview': async (req, root) => ({ status: 200, json: await previewHtml(root, englishRef(req)) }),
		// The facts as the site would read them with an unsaved draft; a malformed draft is the site's error, not a failure.
		'POST /api/facts/preview': (req, root) => {
			const ref = englishRef(req);
			const b = (req.json ?? {}) as { draft?: { hike?: unknown; post?: unknown } };
			if (!b.draft || typeof b.draft !== 'object' || Array.isArray(b.draft)) throw new ApiError(400, 'Body must be { draft: { hike?, post? } }');
			return { status: 200, json: readDocFacts(root, ref, { draft: b.draft }) };
		},
		// The shared records, the library file's version and which docs take each record.
		'GET /api/facts/library': (_req, root) => ({ status: 200, json: libraryState(root) }),
		// One record set (or deleted with `null`) on the library at version `base`.
		'PUT /api/facts/library/record': (req, root) => {
			const b = body(req);
			if (typeof b.kind !== 'string' || typeof b.id !== 'string' || !('record' in b) || typeof b.base !== 'string')
				throw new ApiError(400, 'Body must be { kind, id, record | null, base }');
			return storeWrite(() => putLibraryRecord(root, b.kind as string, b.id as string, b.record, b.base as string));
		},
		// A language's label and tag table beside the English one, by dotted key, with the table file's version.
		'GET /api/strings': (req, root) => ({ status: 200, json: readStrings(root, req.query.get('lang') ?? '') }),
		// Keys set (or removed with `null`) in one language's table at version `base`.
		'PATCH /api/strings': (req, root) => {
			const b = body(req);
			if (typeof b.lang !== 'string' || typeof b.base !== 'string' || !b.set || typeof b.set !== 'object' || Array.isArray(b.set))
				throw new ApiError(400, 'Body must be { lang, base, set: { key: value | null } }');
			return storeWrite(() => writeStrings(root, b.lang as string, b.base as string, b.set as Record<string, string | string[] | null>));
		},
		// Entries in several hikes whose key matches but whose content differs, read fresh; those kept apart left out.
		'GET /api/facts/near-duplicates': (_req, root) => ({ status: 200, json: nearDuplicateGroups(root) }),
		'POST /api/facts/near-duplicates/keep': async (req, root) => {
			const b = body(req);
			if (typeof b.kind !== 'string' || typeof b.key !== 'string' || typeof b.group !== 'string') throw new ApiError(400, 'Body must be { kind, key, group }');
			return { status: 200, json: await keepApart(root, b.kind, b.key, b.group) };
		},
		// The library write first (409 when it is stale, nothing written), then each file; a failure names its file.
		'POST /api/facts/near-duplicates/merge': async (req, root) => {
			const b = body(req);
			const chosen = b.chosen as { file?: unknown; path?: unknown } | undefined;
			if (typeof b.group !== 'string' || typeof b.id !== 'string' || typeof chosen?.file !== 'string' || typeof chosen.path !== 'string')
				throw new ApiError(400, 'Body must be { group, chosen: { file, path }, id }');
			const r = await storeWrite(() => mergeNearDuplicates(root, b as MergeRequest));
			const failed = r.status === 200 && !(r.json as { ok: boolean }).ok;
			return failed ? { status: 500, json: r.json } : r;
		},
		'GET /api/terrain/height': (req, root) => {
			const [lat, lon] = [req.query.get('lat'), req.query.get('lon')].map((v) => (v === null || v.trim() === '' ? NaN : Number(v)));
			if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new ApiError(400, 'lat and lon are required numbers');
			const demDir = repoPaths(root).demDir;
			const terrain = terrains.get(demDir) ?? terrains.set(demDir, createTerrain(demDir)).get(demDir)!;
			return { status: 200, json: { demEle: terrain.height(lat, lon) } };
		},
		'GET /api/map': (req, root) => {
			const { slug, date } = docKey(req);
			return { status: 200, json: mapPayload(root, slug, date) };
		},
		'GET /api/map/config': (_req, root) => ({ status: 200, json: { tracestrackKey: settingsOf(root).tracestrackKey ?? null } }),
		'GET /api/tiles/mapy/:z/:x/:y': async (req, root) => {
			const [z, x, y] = (req.params ?? []).map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
			return { status: 200, binary: { contentType: 'image/png', body: await mapyTiles(root).get(z, x, y) } };
		},
		'GET /api/osm/store/version': (_req, root) => ({ status: 200, json: { version: storeVersion(root) } }),
		'GET /api/osm/entry': (req, root) => ({ status: 200, json: storeEntry(root, req.query.get('ref') ?? '') }),
		'GET /api/osm/store/bbox': (req, root) => {
			const box = { south: coord(req, 'south'), west: coord(req, 'west'), north: coord(req, 'north'), east: coord(req, 'east') };
			return { status: 200, json: { items: storeInBox(root, box) } };
		},
		'GET /api/osm/around': async (req, root) => {
			const r = req.query.get('r');
			if (r !== null && r !== '' && !Number.isFinite(Number(r))) throw new ApiError(400, 'r must be a number');
			const items = await osmAround(root, coord(req, 'lat'), coord(req, 'lon'), r ? Number(r) : 30, osm());
			return { status: 200, json: { items } };
		},
		'GET /api/osm/search': async (req, root) => {
			const lat = req.query.get('lat'), lon = req.query.get('lon');
			const hasPos = !!lat && !!lon && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));
			// `slug` (+ `date`): results sorted by distance from that hike's route, OSM searched around its midpoint.
			const slug = req.query.get('slug');
			const route = slug ? routeLine(root, slug, req.query.get('date') || null) : null;
			// `source`: store (osm.json only, no network) | osm (OpenStreetMap only) | all (default).
			const source = req.query.get('source') || 'all';
			if (source !== 'all' && source !== 'store' && source !== 'osm') throw new ApiError(400, 'source must be all, store or osm');
			return { status: 200, json: await osmSearch(root, req.query.get('q') ?? '', hasPos ? Number(lat) : null, hasPos ? Number(lon) : null, osm(), route, source) };
		},
		'POST /api/osm/add': (req, root) => {
			const b = body(req);
			if (!Array.isArray(b.refs) || typeof b.base !== 'string') throw new ApiError(400, 'Body must be { refs, base }');
			return storeWrite(() => addToStore(root, b.refs as string[], b.base as string, { client: osm() }));
		},
		'POST /api/osm/refresh': (req, root) => {
			const b = body(req);
			if (typeof b.ref !== 'string' || typeof b.base !== 'string') throw new ApiError(400, 'Body must be { ref, base }');
			return storeWrite(() => refreshElement(root, b.ref as string, b.base as string, { client: osm() }));
		},
		'PATCH /api/osm/local': (req, root) => {
			const b = body(req);
			if (typeof b.ref !== 'string' || typeof b.base !== 'string') throw new ApiError(400, 'Body must be { ref, local, base }');
			return storeWrite(() => setLocal(root, b.ref as string, b.local, b.base as string));
		},
		'GET /api/health': () => ({ status: 200, json: { ok: true } }),
		'GET /api/hikes': (_req, root) => ({ status: 200, json: listHikes(root) }),
		'POST /api/hikes': (req, root) => {
			const b = req.json as { slug?: unknown; name?: unknown; date?: unknown } | undefined;
			if (!b || typeof b.slug !== 'string' || typeof b.name !== 'string' || typeof b.date !== 'string')
				throw new ApiError(400, 'Body must be { slug, name, date }');
			return { status: 200, json: createHike(root, { slug: b.slug, name: b.name, date: b.date }) };
		},
		'POST /api/places': (req, root) => {
			const b = req.json as { slug?: unknown; title?: unknown; description?: unknown } | undefined;
			if (!b || typeof b.slug !== 'string' || typeof b.title !== 'string' || typeof b.description !== 'string')
				throw new ApiError(400, 'Body must be { slug, title, description }');
			return { status: 200, json: createPlace(root, b.slug, b.title, b.description) };
		},
		'POST /api/posts': (req, root) => {
			const b = req.json as { slug?: unknown; date?: unknown } | undefined;
			if (!b || typeof b.slug !== 'string' || typeof b.date !== 'string') throw new ApiError(400, 'Body must be { slug, date }');
			return { status: 200, json: createPost(root, { slug: b.slug, date: b.date }) };
		},
		'GET /api/suggest': (req, root) => {
			const kind = req.query.get('kind');
			if (kind !== 'tags' && kind !== 'people' && kind !== 'places') throw new ApiError(400, 'kind must be tags, people or places');
			return { status: 200, json: { items: suggestions(root, kind as SuggestKind) } };
		},
		'GET /api/problems': (req, root) => {
			return { status: 200, json: { problems: problemsForRef(root, refFromQuery(req.query)) } };
		},
		'GET /api/translation-gaps': (req, root) => {
			const ref = refFromQuery(req.query);
			if (ref.kind === 'translation') throw new ApiError(400, 'Gaps are asked of the English doc');
			return { status: 200, json: { gaps: docGaps(root, ref) } };
		},
		'GET /api/doc': async (req, root) => {
			const ref = refFromQuery(req.query);
			if (ref.kind === 'place') return { status: 200, json: { doc: placeClientDoc(loadPlace(root, ref.slug)) } };
			if (ref.kind === 'translation') return { status: 200, json: { doc: translationClientDoc(loadTranslation(root, ref)) } };
			const { slug, date } = docKey(req);
			const doc = clientDoc(loadDoc(root, slug, date));
			return { status: 200, json: { doc: { ...doc, files: await filesState(root, slug, date), deps: depsVersion(root, slug, date) } } };
		},
		// An empty translation (`---\n---\n`) beside its source; 400 without the source, 409 when it exists.
		'POST /api/translation/create': (req, root) => {
			const ref = translationRef(req);
			return withDocLock(lockKey(ref), () => ({ status: 200, json: { doc: createTranslation(root, ref) } }));
		},
		'PUT /api/files/cover': (req, root) =>
			guardedUpload(req, root, async (slug, date, file, filename) => {
				const sc = req.query.get('scope');
				if (sc !== null && sc !== 'hike' && sc !== 'post') throw new ApiError(400, 'scope must be hike or post');
				await writeCover(root, slug, file, filename, sc as CoverScope | null, date);
			}),
		'PUT /api/files/gpx': (req, root) =>
			guardedUpload(req, root, async (slug, date, file) => {
				await writeGpx(root, slug, needDate(req), file);
			}),
		'PUT /api/files/geojson': (req, root) =>
			guardedUpload(req, root, async (slug, date, file) => {
				await writeGeojson(root, slug, file, date);
			}),
		'PUT /api/files/bailout': (req, root) =>
			guardedUpload(req, root, async (_slug, _date, file) => {
				const route = req.query.get('route');
				if (!route) throw new ApiError(400, 'route is required');
				await replaceBailout(root, route, file);
			}),
		// A new bailout GPX, from the facts form: written under a free name (nothing is overwritten); the doc itself is
		// untouched until the form writes the answered `route` into a bailout.
		'PUT /api/files/bailout/new': async (req, root) => {
			const { slug } = docKey(req);
			const { file, filename } = upload(req);
			return { status: 200, json: { route: await addBailout(root, slug, file, filename) } };
		},
		'GET /api/tiles/status': (req, root) => {
			const { slug, date } = docKey(req);
			return { status: 200, json: tileStatus(root, slug, date) };
		},
		'GET /api/metrics': async (req, root) => {
			const { slug } = docKey(req);
			const d = needDate(req);
			return { status: 200, json: { current: currentMetrics(root, slug, d), computed: await computedMetrics(root, slug, d).catch((e) => (e instanceof ApiError && e.status === 404 ? undefined : Promise.reject(e))) } };
		},
		'POST /api/thumbnail/rebuild': (req, root) => {
			const { slug, date } = docKey(req);
			return withDocLock(postLock(slug), async () => {
				await rebuildThumb(root, slug, date);
				return { status: 200, json: { files: await filesState(root, slug, date) } };
			});
		},
		'POST /api/tiles/download': (req, root) => {
			const { slug } = docKey(req);
			return { status: 200, stream: downloadTiles(root, slug, settingsOf(root), deps.spawn) };
		},
		'POST /api/metrics/recompute': (req, root) => {
			const { slug } = docKey(req);
			const date = needDate(req);
			const base = req.query.get('base');
			if (!base) throw new ApiError(400, 'base (the doc version) is required');
			return withDocLock(postLock(slug), async () => {
				const cur = loadDoc(root, slug, date);
				if (cur.version !== base) {
					const { version, fields, mirrors, body } = clientDoc(cur);
					return { status: 409, json: { error: 'changed on disk', version, fields, mirrors, body } };
				}
				const metrics = await recomputeMetrics(root, slug, date);
				const { version, fields } = clientDoc(loadDoc(root, slug, date));
				return { status: 200, json: { version, fields, metrics } };
			});
		},
		'PATCH /api/doc': (req, root) => {
			const ref = refFromQuery(req.query);
			const body = req.json as { base?: unknown; ops?: unknown } | undefined;
			if (!body || typeof body.base !== 'string' || !Array.isArray(body.ops))
				throw new ApiError(400, 'Body must be { base, ops }');
			for (const op of body.ops as unknown[]) if (!validOp(op)) throw new ApiError(400, 'Bad op');
			const [base, ops] = [body.base as string, body.ops as FieldOp[]];
			return withDocLock(lockKey(ref), () => {
				// A place doc and a translation have no mirrors; `body` comes back so a client can tell what was saved (and what is on disk after a 409).
				const r =
					ref.kind === 'place'
						? savePlaceOps(root, ref.slug, base, ops)
						: ref.kind === 'translation'
							? saveTranslationOps(root, ref, base, ops)
							: saveOps(root, ref.slug, ref.kind === 'post' ? ref.date : null, base, ops);
				const { version, fields, body: text } = r.doc;
				const mirrors = r.doc.kind === 'place' || r.doc.kind === 'translation' ? [] : r.doc.mirrors;
				// Nor facts or texts (absent, as their client docs have none).
				const facts = r.doc.kind === 'place' || r.doc.kind === 'translation' ? {} : { facts: r.doc.facts, texts: r.doc.texts };
				if (!r.ok) return { status: 409, json: { error: 'changed on disk', version, fields, mirrors, body: text, ...facts } };
				return { status: 200, json: { version, fields, mirrors, body: text, ...facts } };
			});
		}
	};
}

export function createApi(
	root: string,
	routes: Record<string, Handler> = defaultRoutes()
): (req: ApiRequest) => Promise<ApiResponse> {
	return async (req) => {
		let handler = routes[`${req.method.toUpperCase()} ${req.path}`];
		if (!handler) {
			const parts = req.path.split('/');
			for (const [key, h] of Object.entries(routes)) {
				const [method, pattern] = key.split(' ');
				const pp = pattern.split('/');
				if (method !== req.method.toUpperCase() || !pattern.includes(':') || pp.length !== parts.length) continue;
				if (pp.every((seg, i) => seg.startsWith(':') || seg === parts[i])) {
					handler = h;
					req = { ...req, params: parts.filter((_, i) => pp[i].startsWith(':')) };
					break;
				}
			}
		}
		if (!handler) return { status: 404, json: { error: `No route: ${req.method} ${req.path}` } };
		try {
			return await handler(req, root);
		} catch (e) {
			// The terminal running `pnpm crm` hears of server-side failures too: a line for one reported on purpose (OSM busy),
			// the stack for an unexpected one (a bug). The author's own mistakes (4xx) stay in the UI.
			if (e instanceof ApiError) {
				if (e.status >= 500) console.warn(`[crm] ${req.method} ${req.path} -> ${e.status}: ${e.message}`);
				return { status: e.status, json: { error: e.message } };
			}
			// Front matter that can't be split off, or whose YAML doesn't parse (readFrontmatterDoc throws the parser's error).
			if (e instanceof FrontmatterError || e instanceof YAMLParseError) return { status: 422, json: { error: `front matter not readable: ${e.message}` } };
			console.error(`[crm] ${req.method} ${req.path} failed:`, e instanceof Error ? (e.stack ?? e.message) : e);
			return { status: 500, json: { error: e instanceof Error ? e.message : String(e) } };
		}
	};
}
