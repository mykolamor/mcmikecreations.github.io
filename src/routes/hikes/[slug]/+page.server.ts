import { error, isHttpError } from '@sveltejs/kit';
import { existsSync, readFileSync } from 'node:fs';
import { hikes } from '$lib/hikes/hikes.server';
import { readingTime } from 'reading-time-estimator';
import resume from '$lib/data/resume.json';
import { parseMarkdown } from '$lib/hikes/hikes-info';
import { defaultPageSize, getAllPosts } from '$lib/hikes/hikes-info.server';
import type { EntryGenerator, PageServerLoad } from './$types';
import type { Map, MapDate, MapProperties } from '$lib/data/map-info';
import { mergeMetrics } from '$lib/hikes/hike-metrics';
import { applyPostOverrides, readHikeFrontmatter, readMetaPathOverride } from '$lib/hikes/frontmatter.server';
import { defaultGpxPath, defaultMetaPath, getHikeMeta } from '$lib/data/hikes-db';
import { readHikeFacts } from '$lib/hikes/facts.server';
import { placeDocsForPost } from '$lib/hikes/places.server';
import type { PlaceDocRef, RenderedPlaceDoc } from '$lib/hikes/place-docs';
import { readHikeContacts } from '$lib/hikes/frontmatter';
import { buildHikeContacts } from '$lib/hikes/contacts';
import contactsBook from '$lib/data/contacts.json';
import { postDateModified } from '$lib/hikes/date-modified.server';
import { computeHikeFacts } from '$lib/hikes/hike-facts';
import { readHikeElapsed, readTimedTrack } from '$lib/hikes/hike-facts.server';
import { computePhotoStops } from '$lib/hikes/photo-stops';
import { computeMetricScales } from '$lib/hikes/hike-metrics';

export const entries: EntryGenerator = () => {
	return getAllPosts().map((p) => ({ slug: p.anchor }));
};

export const load: PageServerLoad = async ({ fetch, params, locals }) => {
	try {
		const slug = params.slug.endsWith('.html')
			? params.slug.substring(0, params.slug.length - '.hmtl'.length)
			: params.slug;
		const regex = /^(\d{4}-\d{2}-\d{2})-(.+)$/gm;
		const m = regex.exec(slug);
		if (!m) {
			error(404, { message: `Failed to match slug "${slug}"` });
		}
		const dateStr = m[1];
		const routeStr = m[2];
		const hike =
			hikes.find(h => h.route.split('/').pop() === routeStr);
		if (!hike) {
			error(404, { message: `Failed to find route "${routeStr}"` });
		}
		const date = hike.properties.dates.find(d => d.date === dateStr) as MapDate;
		if (!date || !date.path) {
			error(404, { message: `Failed to find post "${dateStr}"` });
		}
		
		const res = await fetch(date.path);
		if (!res.ok) {
			console.log(`Failed to fetch ${date.path} with return code ${res.status}.`);
			error(404, { message: `Failed to fetch "${slug}"` });
		}
		
		const postRaw = await res.text();

		// `content` is the body with the fence removed so the
		// header outline and reading time ignore the metadata block.
		const { data: frontmatter, content: postBody } = readHikeFrontmatter(postRaw);

		const {
			hike: mergedHike,
			date: mergedDate,
			properties: mergedProperties
		} = applyPostOverrides(hike as unknown as Map, date, frontmatter);
		const fmContacts = readHikeContacts(frontmatter);
		const contacts = buildHikeContacts(mergedDate.people, contactsBook, fmContacts);

		const headerRegex = /#{2} (.*)\r?\n/g;
		const headers = Array.from(postBody.matchAll(headerRegex), x => x[1]);
		const stats = readingTime(postBody);
		const allPosts = getAllPosts();
		const postIndex = allPosts.findIndex(p => p.anchor === slug);
		const page = postIndex !== -1 ? Math.floor(postIndex / defaultPageSize) + 1 : 1;

		const nodes = mergedProperties.nodes;
		const metaPath = readMetaPathOverride(frontmatter, date) ?? mergedProperties.metaPath ?? defaultMetaPath(routeStr);
		const sidecar = getHikeMeta(metaPath);
		// The post's place docs (`places:`, else the sidecar's): linked from the prose, shown at the bottom.
		const placeDocs = placeDocsForPost(frontmatter, date.path, { places: sidecar?.places, source: metaPath });
		const placeRefs: PlaceDocRef[] = placeDocs.map(({ slug, title, names }) => ({ slug, title, names }));
		const parsed = await parseMarkdown(postRaw, mergedDate.tags, { nodes, placeDocs: placeRefs });
		const media = parsed.media;
		let postHtml = parsed.html;

		let showStatistics = false;
		let showFilePrimary: string | null = null;
		let showFileGpx: string | null = null;

		const gpxUrl = mergedDate.gpx ?? defaultGpxPath(mergedProperties.filePath);
		const [gpx, geojsonRes] = await Promise.all([
			fetch(gpxUrl, { method: 'OPTIONS' }),
			fetch(mergedProperties.filePath),
		]);
		showFileGpx = gpx.ok ? gpxUrl : null;

		let mapProperties = mergedProperties;
		let coordinates: number[][] | null = null;
		if (geojsonRes.ok) {
			const geojson = await geojsonRes.json();
			const fp = geojson?.features?.[0]?.properties;
			if (fp) {
				showFilePrimary = mergedProperties.filePath;
				mapProperties = <MapProperties>{
					...mergedProperties,
					...mergeMetrics(mergedProperties, fp),
				};
				coordinates = geojson.features[0].geometry?.coordinates ?? null;
			}
		}

		const facts = computeHikeFacts(coordinates, mapProperties);
		const gpxFile = showFileGpx ? `static${showFileGpx}` : null;

		// Where along the route each photo was taken, for the line under its
		// caption. The stops are keyed by media index, which only the first
		// parse knows, so the body is rendered again with them.
		const photoStops = computePhotoStops(
			coordinates,
			coordinates ? computeMetricScales(coordinates, mapProperties).distanceFactor : 1,
			media.flatMap((item, mediaIndex) =>
				item.kind === 'image' ? [{ mediaIndex, ...item.location, taken: item.taken }] : []
			),
			readTimedTrack(gpxFile)
		);
		if (photoStops.size > 0) {
			postHtml = (await parseMarkdown(postRaw, mergedDate.tags, { stops: photoStops, nodes, placeDocs: placeRefs })).html;
		}
		locals.postContent = postHtml;

		// Each doc rendered like a post body, without the map boxes; its media
		// indices continue after the post's, so all photos share one gallery.
		// Sent as HTML (unlike the post's body, which the browser re-parses):
		// docs are short, and this keeps the browser free of their front matter.
		const places: RenderedPlaceDoc[] = [];
		let mediaOffset = media.length;
		for (const doc of placeDocs) {
			const rendered = await parseMarkdown(doc.raw, [], { nodes, mediaOffset, widgets: false, styles: false });
			places.push({ slug: doc.slug, title: doc.title, description: doc.description, tags: doc.tags, ...rendered });
			mediaOffset += rendered.media.length;
		}

		// The hand-written facts layer: the sidecar's route defaults with the
		// post's own facts merged on top, places resolved on the route.
		const { facts: authored, warnings: factWarnings } = readHikeFacts({
			post: frontmatter.facts,
			sidecar: sidecar?.facts,
			postSource: date.path,
			sidecarSource: metaPath,
			nodes,
			coords: coordinates,
			distanceFactor: coordinates ? computeMetricScales(coordinates, mapProperties).distanceFactor : 1,
			// Bailout routes are served files under static/, like the hike's own GPX.
			readGpx: (servedPath) => (existsSync(`static${servedPath}`) ? readFileSync(`static${servedPath}`, 'utf-8') : null)
		});
		for (const warning of factWarnings) console.warn(warning);
		// Titles for the posts the facts link to (alternatives, variants).
		const linkedSlugs = new Set([
			...(authored?.plan?.alternatives?.easier ?? []),
			...(authored?.plan?.alternatives?.harder ?? []),
			...(authored?.plan?.alternatives?.similar ?? []),
			...(authored?.plan?.variants ?? []).flatMap((v) => (v.link ? [v.link] : []))
		]);
		const linkedPosts = Object.fromEntries(
			allPosts.filter((p) => linkedSlugs.has(p.anchor)).map((p) => [p.anchor, p.title])
		);
		facts.elapsed = readHikeElapsed(frontmatter.elapsed, gpxFile);
		// Front-matter durations are mine: computed from a recorded GPX by
		// scripts/moving_time.py, or entered by hand. Without one, the duration
		// is the route planner's estimate from the GeoJSON summary.
		const durationSource: 'gpx' | 'manual' | 'planner' =
			frontmatter.duration == null ? 'planner' : readHikeElapsed(null, gpxFile) ? 'gpx' : 'manual';

		return {
			post: {
				title: mergedDate.title ?? mergedHike.name,
				description: (mergedDate.description ? (mergedDate.description + ' ') : '') + mergedHike.description,
				image: mergedDate.image?.replace('/hikes/', '/hikes/thumb/') ?? mergedHike.image?.replace('/hikes/', '/hikes/thumb/'),
				imageFull: mergedDate.image ?? mergedHike.image,
				headers: headers,
				time: stats.text,
				date: dateStr,
				dateModified: postDateModified(`static${date.path}`, dateStr, frontmatter.updated),
				tags: mergedDate.tags,
				author: mergedDate.author ?? resume.basics.name,
				anchor: slug ?? '',
				page,
				media,
				photoStops: Object.fromEntries(photoStops),
			},
			map: { ...mergedHike, properties: mapProperties },
			facts,
			authoredFacts: authored,
			linkedPosts,
			places,
			placeRefs,
			durationSource,
			contacts,
			display: {
				statistics: showStatistics,
				filePrimary: showFilePrimary,
				fileGpx: showFileGpx,
			},
		};
	} catch (ex) {
		if (isHttpError(ex)) {
			throw ex;
		}
		console.log(ex);
		error(500, { message: `An error happened processing "${params.slug}"` });
	}
};
