/**
 * Browser-safe hike post helpers: the shape a listing renders, and the markdown
 * renderer the post page re-runs on client-side navigation.
 *
 * Enumerating posts needs the markdown glob, so `getAllPosts` / `getPosts` live
 * in the server-only `hikes-info.server`.
 */

import { stripFrontmatter, extractFrontMatterBlock, isPlainObject } from '$lib/hikes/frontmatter';
import { parseMediaFlags } from '$lib/renderers/media-flags';
import type { GalleryItem } from '$lib/renderers/gallery-item';
import { photoStopText, type PhotoStop } from '$lib/hikes/photo-stops';
import { buildPlaceIndex, type PlaceIndex, type PlaceMatch, type PlaceNode } from '$lib/hikes/place-links';
import { imageMetaFor } from '$lib/renderers/image-meta';
import { avifTiers, buildAvifSrcset, avifVariantHref, videoPosterHref, type HikeImageMeta, type HikeVideoMeta } from '$lib/renderers/responsive-image';
import { buildPlaceDocIndex, placeDocAnchor, placeDocMarkerHtml, type PlaceDocIndex, type PlaceDocRef } from '$lib/hikes/place-docs';
import type { PinNode } from '$lib/hikes/photo-pins';
import { photoPinsCss, photoPinsHtml } from '$lib/hikes/photo-pins-view';
import { tHtml } from '$lib/i18n/strings';
import type { Lang } from '$lib/i18n/languages';

export interface ProcessedPost {
    year: number;
    month: number;
    day: number;
    date: Date;
    url: string;
    title: string;
    image?: string;
    description: string;
    tags: string[];
    people: string[] | null;
    anchor: string;
}

export interface ParsedPost {
    /** Rendered post body, including the appended <style> block. */
    html: string;
    /** Gallery entries in document order; the index matches `data-media-index`. */
    media: GalleryItem[];
    /**
     * The distinct nodes the place links point to, in first-link order. A
     * re-parse given just these (and the same `origin`) links the same places,
     * so the browser never needs the whole OSM store.
     */
    placeNodes: PlaceNode[];
}

// Must stay in lockstep with map-elevation.ts's SVG viewBox (VW/VH) — this
// placeholder's aspect-ratio reserves exactly the box that SVG will fill.
const ELEVATION_CHART_ASPECT_RATIO = '600 / 190';

/**
 * Insert empty, correctly-sized placeholder markup for the 3D map, 2D map,
 * and both elevation charts at the same positions +page.svelte used to build
 * them client-side-only: after the 1st and 2nd paragraph (one later for a
 * Climb-tagged post). Reserving the boxes here, in the HTML `parseMarkdown`
 * itself returns, means they're part of the SSR'd response and of every
 * client-side re-parse alike — `afterNavigate` then only has to find and
 * populate these mount points, never insert or resize them after the article
 * has already painted, which is what used to cause a large layout shift a
 * few seconds into every page load.
 */
function insertHikeWidgetPlaceholders(html: string, tags: string[]): string {
    const paragraphEnds: number[] = [];
    const paragraphRe = /<p>[\s\S]*?<\/p>/g;
    let match: RegExpExecArray | null;
    while ((match = paragraphRe.exec(html))) {
        paragraphEnds.push(match.index + match[0].length);
    }

    const map3dBlock =
        '<div class="w-full mx-auto not-prose my-4" translate="no" data-hike-widget="map3d-wrapper">' +
        '<div style="position: relative; width: 100%; aspect-ratio: 1 / 1; overflow: hidden;">' +
        '<div style="position: absolute; inset: 0;" data-hike-widget="map3d-mount"></div>' +
        '</div></div>';
    const elev3dBlock =
        `<div class="w-full mx-auto not-prose" translate="no" style="aspect-ratio: ${ELEVATION_CHART_ASPECT_RATIO};" data-hike-widget="elev3d-mount"></div>`;
    const map2dBlock =
        '<div id="hike-map" class="w-full mx-auto not-prose my-4" translate="no" data-hike-widget="map2d-wrapper">' +
        '<div style="position: relative; isolation: isolate; width: 100%; aspect-ratio: 1 / 1; overflow: hidden;">' +
        '<div style="position: absolute; inset: 0;" data-hike-widget="map2d-mount"></div>' +
        '</div></div>';
    const elev2dBlock =
        `<div class="w-full mx-auto not-prose" translate="no" style="aspect-ratio: ${ELEVATION_CHART_ASPECT_RATIO};" data-hike-widget="elev2d-mount"></div>`;

    if (paragraphEnds.length === 0) {
        // No paragraph to anchor to (e.g. an all-figure post) — append at the end.
        return html + map3dBlock + elev3dBlock + map2dBlock + elev2dBlock;
    }

    const offset = tags.includes('Climb') ? 1 : 0;
    const pos1 = paragraphEnds[Math.min(offset, paragraphEnds.length - 1)];
    const pos2 = paragraphEnds[Math.min(offset + 1, paragraphEnds.length - 1)];

    if (pos1 === pos2) {
        return html.slice(0, pos1) + map3dBlock + elev3dBlock + map2dBlock + elev2dBlock + html.slice(pos1);
    }
    return (
        html.slice(0, pos1) + map3dBlock + elev3dBlock +
        html.slice(pos1, pos2) + map2dBlock + elev2dBlock +
        html.slice(pos2)
    );
}

/** The image's coordinates if its front matter carries a valid pair, else undefined. */
function readLocation(meta: HikeImageMeta): { lat: number; lon: number; demEle?: number } | undefined {
    const { lat, lon, demEle } = meta;
    if (typeof lat !== 'number' || typeof lon !== 'number') return undefined;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
    return typeof demEle === 'number' && Number.isFinite(demEle) ? { lat, lon, demEle } : { lat, lon };
}

/** The image's `taken` time if its front matter carries one, else undefined. */
function readTaken(meta: HikeImageMeta): string | undefined {
    return typeof meta.taken === 'string' && meta.taken ? meta.taken : undefined;
}

/** Placeholder links to a post that doesn't exist yet: `/404` or `/404/`. */
function isPlaceholderHref(href: string | undefined): boolean {
    return /^\/404\/?$/.test((href ?? '').trim());
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Posts name places as `Wallberg (1722 m)` or `Vordere Kesselschneid (2002 m)`:
// one to four capitalised words followed by an elevation. Browser translation
// turns names like Gatterl or Feldernjöchl into nonsense, so these are marked
// `translate="no"`. Lowercase words end the name, so "View towards Wendelstein
// (1838 m)" only protects "Wendelstein (1838 m)".
export const TOPONYM = /(?<![\p{L}\p{N}])((?:\p{Lu}[\p{L}.'’-]*\s){0,3}\p{Lu}[\p{L}.'’-]*\s\(\d{2,4}(?:[.,]\d+)?\s?m\))/gu;

// Capitalised English words that start a sentence ("The Nebelhorn (2224 m)",
// "After Reintalangerhütte (1366 m)") and so get caught by TOPONYM, but are not
// part of the name and should still be translated.
export const LEADING_ENGLISH = new Set([
    'A', 'An', 'The', 'At', 'After', 'Before', 'Near', 'From', 'To', 'Towards', 'Toward',
    'On', 'In', 'Into', 'Over', 'Under', 'Past', 'Behind', 'Above', 'Below', 'Beyond',
    'Via', 'Of', 'And', 'Then', 'Back', 'Up', 'Down', 'View', 'Views', 'Around', 'Along',
    'Across', 'Through', 'Between', 'Beside', 'Next', 'Finally', 'Also', 'Later',
]);

function unescapeHtml(text: string): string {
    return text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * Wraps `Name (1234 m)` place references in already-escaped HTML text. With
 * `places`, a reference naming one of the hike's nodes also links to the 2D
 * map, where the page's click handler centers it on the node. A link rather
 * than a button: it wraps with the text around it, and without JavaScript it
 * still jumps to the map.
 *
 * With `docMarker`, a reference naming one of the post's place docs is also
 * followed by a small link to that doc's section (see `placeDocMarkerHtml`);
 * `docMarker` decides, so it can link each doc only once. With `docs`, plain
 * mentions of a doc's names in the text between references ("through
 * Marienstein") are marked the same way, just without an elevation.
 *
 * `onLink` hears of each node a link is made to.
 */
function markToponyms(
    html: string,
    places: PlaceIndex | null,
    docMarker?: (nameWords: string[]) => string,
    docs?: PlaceDocIndex | null,
    onLink?: (node: PlaceNode) => void,
    lang: Lang = 'en'
): string {
    if (!docs) return markReferences(html, places, docMarker, onLink, lang);
    let out = '';
    let last = 0;
    for (const m of html.matchAll(TOPONYM)) {
        out += markMentions(html.slice(last, m.index), docs, places, docMarker, onLink, lang) + markReferences(m[0], places, docMarker, onLink, lang);
        last = m.index! + m[0].length;
    }
    return out + markMentions(html.slice(last), docs, places, docMarker, onLink, lang);
}

/** The opening tag of a place's link to the 2D map. */
function placeLinkTag(node: PlaceNode, lang: Lang): string {
    return `<a class="mk-place" href="#hike-map" data-place-lat="${node.lat}" data-place-lon="${node.lon}" title="${tHtml(lang, 'render.showOnMap')}">`;
}

/** A place doc's name without an elevation, marked like a `Name (1234 m)` reference. */
function markMentions(
    html: string,
    docs: PlaceDocIndex,
    places: PlaceIndex | null,
    docMarker?: (nameWords: string[]) => string,
    onLink?: (node: PlaceNode) => void,
    lang: Lang = 'en'
): string {
    return docs.markMentions(html, (text) => {
        const nameWords = unescapeHtml(text.replace(/&nbsp;/g, ' ')).split(/\s+/);
        // No elevation to check a partial name against, so only the whole name counts.
        const place = places?.match(nameWords, NaN);
        const marker = docMarker?.(nameWords) ?? '';
        if (!place || place.start !== 0) return `<span translate="no">${text}</span>` + marker;
        onLink?.(place.node);
        return '<span translate="no">' + placeLinkTag(place.node, lang) + `${text}</a></span>` + marker;
    });
}

/** A `Name (1234 m)` reference as TOPONYM matched it in escaped HTML, and the place it names. */
interface Reference {
    /** The match split into words and the whitespace between them: even indices are words. */
    words: string[];
    /** Index in `words` of the first name word; the ones before it are LEADING_ENGLISH. */
    start: number;
    nameWords: string[];
    place: PlaceMatch | null;
    /** Index in `words` where the link starts, when there is one. */
    linkAt: number;
}

function readReference(match: string, places: PlaceIndex | null): Reference {
    // Words and the whitespace between them alternate: even indices are words.
    // The elevation's own space is non-breaking, so a line never splits `(2024 m)`.
    const words = match.replace(/\((\d{2,4}(?:[.,]\d+)?)\s(m\))$/, '($1&nbsp;$2').split(/(\s)/);
    // Always keep at least one name word before the `(1234 m)` part.
    const elevationAt = words.findIndex((w) => w.startsWith('('));
    let start = 0;
    while (start + 2 < elevationAt && LEADING_ENGLISH.has(words[start])) start += 2;

    const nameWords = words.slice(start, elevationAt).filter((_, i) => i % 2 === 0).map(unescapeHtml);
    // `(1603.3 m)` and `(1603,3 m)` alike.
    const ele = Number(/\d+(?:[.,]\d+)?/.exec(words[elevationAt])?.[0].replace(',', '.'));
    const place = places?.match(nameWords, ele) ?? null;
    // The node's name says exactly where the place name starts, so words
    // before it ("Approaching") stay translatable.
    return { words, start, nameWords, place, linkAt: start + (place?.start ?? 0) * 2 };
}

export interface PlaceMention {
    /** Offsets into the text: the linked part of the reference, `(1234 m)` included. */
    from: number;
    to: number;
    node: PlaceNode;
}

/**
 * The `Name (1234 m)` references in a run of plain text that the renderer
 * links to the map, with the node each one links to. The renderer matches
 * escaped HTML, so the text is escaped the same way and the offsets mapped
 * back. Mentions of a place doc's names without an elevation are not included.
 */
export function findPlaceMentions(text: string, index: PlaceIndex | null): PlaceMention[] {
    if (!index) return [];
    let html = '';
    // Offset in `text` of each char of `html`, and of its end.
    const at: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const escaped = escapeHtml(text[i]);
        html += escaped;
        for (let k = 0; k < escaped.length; k++) at.push(i);
    }
    at.push(text.length);
    const mentions: PlaceMention[] = [];
    for (const m of html.matchAll(TOPONYM)) {
        const { words, place, linkAt } = readReference(m[0], index);
        if (!place) continue;
        const from = m.index! + words.slice(0, linkAt).join('').length;
        mentions.push({ from: at[from], to: at[m.index! + m[0].length], node: place.node });
    }
    return mentions;
}

function markReferences(
    html: string,
    places: PlaceIndex | null,
    docMarker?: (nameWords: string[]) => string,
    onLink?: (node: PlaceNode) => void,
    lang: Lang = 'en'
): string {
    return html.replace(TOPONYM, (match: string) => {
        const { words, start, nameWords, place, linkAt } = readReference(match, places);
        const lead = words.slice(0, start).join('');
        const marker = docMarker?.(nameWords) ?? '';
        if (!place) return lead + `<span translate="no">${words.slice(start).join('')}</span>` + marker;

        onLink?.(place.node);
        return words.slice(0, linkAt).join('') + '<span translate="no">' + placeLinkTag(place.node, lang) +
            `${words.slice(linkAt).join('')}</a></span>` + marker;
    });
}

/**
 * The `km 13.4 · 2052 m · 11:18` line under a photo's caption. A button when
 * the photo is on the maps, so clicking it can center them on the photo.
 */
function photoStopHtml(stop: PhotoStop | undefined, mediaIndex: number, lang: Lang): string {
    const text = stop ? escapeHtml(photoStopText(stop, lang)) : '';
    if (!text) return '';
    const title = stop!.timeSource === 'track'
        ? ` title="${tHtml(lang, 'render.stop.trackTime')}"`
        : stop!.timeSource === 'photo' ? ` title="${tHtml(lang, 'render.stop.photoTime')}"` : '';
    if (stop!.lat != null && stop!.lon != null) {
        return `<button type="button" class="mk-photo-stop mk-photo-stop-link" translate="no" data-photo-stop="${mediaIndex}"${title} aria-label="${tHtml(lang, 'render.stop.showOnMap', { stop: text })}">${text}</button>`;
    }
    return `<span class="mk-photo-stop" translate="no"${title}>${text}</span>`;
}

export interface ParseMarkdownOptions {
    /**
     * Where along the route each photo was taken, by media index (see
     * `computePhotoStops`). Computed server-side; a client-side re-parse passes
     * the copy the server load sent (`photoStopsFromRecord`), or the caption
     * lines are left out.
     */
    stops?: Map<number, PhotoStop>;
    /**
     * The nodes place references may link to on the map: on the server, every
     * element of the OSM store (`storeNodes`); in the browser, the
     * `placeNodes` the server's parse returned.
     */
    nodes?: PlaceNode[] | null;
    /** The hike's map centre: of several nodes with one name, the nearest wins. */
    origin?: { lat: number; lon: number } | null;
    /** The hike's map height in px: with `origin`, only nodes inside the map's tile square can link. */
    height?: number | null;
    /** Refs of the hike's own nodes: they link even outside the tile square. */
    ownRefs?: string[] | null;
    /**
     * The post's place docs (front matter `places:`). The first reference to
     * each in the prose gets a link to its section, plain mentions of its
     * names link there, and `[text](place:<slug>)` links there explicitly.
     * The server load sends the same list to the browser, so a client-side
     * re-parse links exactly the same.
     */
    placeDocs?: PlaceDocRef[] | null;
    /**
     * Where this document's `data-media-index` values start. A place doc
     * rendered under a post continues after the post's own media, so both
     * share one gallery.
     */
    mediaOffset?: number;
    /** Reserve the map and chart boxes (a post's body). Off for a place doc. */
    widgets?: boolean;
    /** Append the renderer's `<style>` block. A place doc's rides on the post's. */
    styles?: boolean;
    /**
     * What the photo pins in `images:` point to, by ref (`photo-pins.server`).
     * The server load sends it to the browser, so a client re-parse draws the same pins.
     */
    pinNodes?: Record<string, PinNode> | null;
    /** The language of the renderer's own text (link titles, the photo line); the post's text is as given. */
    lang?: Lang;
}

export async function parseMarkdown(
    postRaw: string,
    tags: string[] = [],
    { stops, nodes, origin, height, ownRefs, placeDocs, mediaOffset = 0, widgets = true, styles: withStyles = true, pinNodes, lang = 'en' }: ParseMarkdownOptions = {}
): Promise<ParsedPost> {
    // Drop any leading YAML front matter before rendering. Uses the
    // dependency-free stripper so this stays safe in the client bundle, which
    // re-renders the body on navigation. Files without front matter are unchanged.
    const post = stripFrontmatter(postRaw);
    const { Marked, Renderer } = await import('marked');
    const places = buildPlaceIndex(nodes, { origin, height, keepRefs: ownRefs });
    const placeNodes: PlaceNode[] = [];
    const onLink = (node: PlaceNode) => {
        if (!placeNodes.includes(node)) placeNodes.push(node);
    };
    const docs: PlaceDocIndex | null = buildPlaceDocIndex(placeDocs);
    // Each doc's marker goes on its first reference only: one pointer per
    // place, not one per mention. Renderers run in document order, so the
    // server and a client re-parse mark the same reference.
    const markedDocs = new Set<string>();
    const docMarker = (nameWords: string[]): string => {
        const hit = docs?.match(nameWords);
        if (!hit || markedDocs.has(hit.doc.slug)) return '';
        markedDocs.add(hit.doc.slug);
        return placeDocMarkerHtml(hit.doc, lang);
    };
    // Above zero while rendering a heading, a link or a figure caption: no
    // place links there. Links can't nest, and captions are
    // reused in the gallery, where the photo line already links to the map.
    let placeLinksOff = 0;
    const withoutPlaceLinks = <T>(render: () => T): T => {
        placeLinksOff++;
        try {
            return render();
        } finally {
            placeLinksOff--;
        }
    };

    // The post's `images:` front-matter map (filename -> dims/blur), if any.
    // gray-matter can't be used here — its entry point does an unconditional
    // require('fs'), which breaks the browser bundle. js-yaml (the engine
    // underneath it) has no such dependency, so it's loaded directly against
    // just the extracted front-matter text.
    let images: Record<string, HikeImageMeta> = {};
    // `videos:`, by YouTube id (`pnpm crm video-meta`): poster dims/blur and upload date.
    let videos: Record<string, HikeVideoMeta> = {};
    const frontMatterBlock = extractFrontMatterBlock(postRaw);
    if (frontMatterBlock) {
        try {
            const { load } = await import('js-yaml');
            const parsed = load(frontMatterBlock);
            if (isPlainObject(parsed) && isPlainObject(parsed.images)) {
                images = parsed.images as Record<string, HikeImageMeta>;
            }
            if (isPlainObject(parsed) && isPlainObject(parsed.videos)) {
                videos = parsed.videos as Record<string, HikeVideoMeta>;
            }
        } catch (ex) {
            // Malformed front matter shouldn't take down the whole post body -
            // mirrors readHikeFrontmatter's server-side try/catch. For an
            // unconverted post this just means no AVIF/dims; for a post whose
            // originals were already deleted by the optimizer, every inline
            // image falls back to its now-missing .jpg (see design spec's
            // accepted AVIF-only-fallback tradeoff — there is no un-deleted
            // original left to point at).
            console.log('Failed to parse hike front matter:', ex);
        }
    }

    // Filled by the `image` renderer below. Marked invokes renderers in document
    // order, so this ends up in reading order and its indices are the
    // `data-media-index` values stamped into the HTML.
    const media: GalleryItem[] = [];

    const markedInstance = new Marked();
    markedInstance.use({
        renderer: {
            paragraph(token: any) {
                const text = (this as any).parser.parseInline(token.tokens);
                if (/^\s*(<figure[\s\S]*?<\/figure>\s*)+$/.test(text)) {
                    return text + '\n';
                }
                return `<p>${text}</p>\n`;
            },
            link(token: any) {
                // `/404/` marks a place that has no post yet. Linking it would send
                // readers and crawlers to a dead end, so it renders as plain text;
                // the markdown keeps the link, and writing that post later only
                // means changing its URL.
                // `place:<slug>` points at one of the post's place docs, further
                // down the page. A slug the post doesn't list renders as text.
                const placeSlug = /^place:([a-z0-9_-]+)$/.exec((token.href ?? '').trim())?.[1];
                if (placeSlug) {
                    const inner = withoutPlaceLinks(() => (this as any).parser.parseInline(token.tokens));
                    const doc = docs?.get(placeSlug);
                    if (!doc) return `<span>${inner}</span>`;
                    return `<a class="mk-place-doc-link" href="#${placeDocAnchor(doc.slug)}" data-place-doc="${doc.slug}">${inner}</a>`;
                }
                if (!isPlaceholderHref(token.href)) {
                    return withoutPlaceLinks(() => Renderer.prototype.link.call(this as any, token));
                }
                return `<span>${(this as any).parser.parseInline(token.tokens)}</span>`;
            },
            text(token: any) {
                if (token.tokens) return false;
                const html = token.escaped ? token.text : escapeHtml(token.text);
                return placeLinksOff === 0 ? markToponyms(html, places, docMarker, docs, onLink, lang) : markToponyms(html, null);
            },
            heading(token: any) {
                return withoutPlaceLinks(() => Renderer.prototype.heading.call(this as any, token));
            },
            image(token: any) {
                const href = token.href || '';
                const title = token.title || '';
                const text = token.text || '';

                const safeHref = href.replace(/"/g, '&quot;');
                const safeTitle = title.replace(/"/g, '&quot;');
                const safeText = text.replace(/"/g, '&quot;');
                const renderedText = token.tokens?.length
                    ? withoutPlaceLinks(() => (this as any).parser.parseInline(token.tokens))
                    : safeText;

                const isYoutubeLink = href.includes('youtube.com');

                if (isYoutubeLink) {
                    let videoId = '';
                    try {
                        const url = new URL(href);
                        videoId = url.searchParams.get('v') || '';
                    } catch (e) {
                        // ignore invalid url
                    }
                    const mediaIndex = mediaOffset + media.length;
                    const meta = videoId ? videos[videoId] : undefined;
                    // The self-hosted poster when `pnpm crm video-meta` made one, else YouTube's.
                    const tiers = meta?.blur && meta.w && meta.h ? avifTiers(meta.w, meta.h) : [];
                    const posterHref = videoPosterHref(videoId);
                    const poster = tiers.length > 0 ? avifVariantHref(posterHref, tiers[tiers.length - 1].target) : undefined;
                    media.push({
                        kind: 'youtube',
                        videoId,
                        href: href.trim(),
                        alt: text,
                        title: title || undefined,
                        captionHtml: renderedText,
                        ...(poster ? { poster, thumb: avifVariantHref(posterHref, tiers[0].target), placeholder: meta!.blur } : {}),
                        ...(meta?.uploadDate ? { uploadDate: meta.uploadDate } : {}),
                        ...(meta?.duration ? { duration: meta.duration } : {}),
                        ...(meta?.description?.en ? { description: meta.description.en } : {}),
                        ...(meta?.unavailable ? { unavailable: true } : {})
                    });
                    const posterHtml = poster
                        ? `<span class="mk-img-shell" style="aspect-ratio:${meta!.w}/${meta!.h}">
            <img src="${meta!.blur}" alt="" aria-hidden="true" class="mk-blur-placeholder" />
            <picture>
                <source type="image/avif" srcset="${buildAvifSrcset(posterHref, tiers)}" sizes="(min-width: 1280px) 75vw, 100vw" />
                <img src="${poster}" ${safeTitle ? `title="${safeTitle}"` : ''} alt="${safeText}" width="${tiers[tiers.length - 1].width}" height="${tiers[tiers.length - 1].height}" loading="lazy" decoding="async" class="mk-img-no-pointer mk-fade-in" onload="this.classList.add('mk-loaded')" />
            </picture>
        </span>`
                        : `<img src="https://i.ytimg.com/vi/${videoId}/hqdefault.jpg" ${safeTitle ? `title="${safeTitle}"` : ''} alt="${safeText}" width="480" height="360" loading="lazy" decoding="async" class="mk-img-no-pointer" />`;
                    return `
<figure class="mk-figure">
    <a class="mk-video-link" href="${safeHref}" target="_blank" rel="noopener noreferrer" data-media-index="${mediaIndex}">
        ${posterHtml}
        <span class="mk-play-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.5 4.5v15L18.5 12 5.5 4.5Z"/></svg>
        </span>
    </a>
    <figcaption class="mk-figcaption">${renderedText}</figcaption>
</figure>`;
                } else if (href.trimEnd().endsWith('.mp4')) {
                    // The title doubles as a flag list. Only clips flagged `autoplay`
                    // start on their own, and only those are muted, since muting is what
                    // makes browsers allow autoplay at all. An unflagged clip may carry
                    // audio, so it is left for the reader to start.
                    const { flags, title: mediaTitle } = parseMediaFlags(title);
                    const autoplayAttrs = flags.has('autoplay') ? ' autoplay muted' : '';
                    const safeMediaTitle = mediaTitle.replace(/"/g, '&quot;');
                    const mediaIndex = mediaOffset + media.length;
                    media.push({
                        kind: 'video',
                        src: href.trim(),
                        autoplay: flags.has('autoplay'),
                        alt: text,
                        title: mediaTitle || undefined,
                        captionHtml: renderedText
                    });
                    return `
<figure class="mk-figure">
    <video controls${autoplayAttrs} loop playsinline data-media-index="${mediaIndex}" ${safeMediaTitle ? `title="${safeMediaTitle}"` : ''}>
        <source src="${safeHref}" type="video/mp4">
    </video>
    <figcaption class="mk-figcaption">${renderedText}</figcaption>
</figure>`;
                } else {
                    const mediaIndex = mediaOffset + media.length;
                    const meta = imageMetaFor(images, href);
                    // `images.<key>.alt` (set in the CRM) is the alt attribute; the caption stays the figcaption.
                    const altText = typeof meta?.alt === 'string' && meta.alt.trim() ? meta.alt.trim() : text;
                    const safeAlt = altText.replace(/"/g, '&quot;');

                    if (meta?.blur) {
                        const tiers = avifTiers(meta.w, meta.h);
                        if (tiers.length > 0) {
                            const trimmedHref = href.trim();
                            const srcset = buildAvifSrcset(trimmedHref, tiers);
                            const smallest = tiers[0];
                            const largest = tiers[tiers.length - 1];
                            const fallbackSrc = avifVariantHref(trimmedHref, largest.target);
                            const thumbSrc = avifVariantHref(trimmedHref, smallest.target);
                            media.push({
                                kind: 'image',
                                src: fallbackSrc,
                                thumb: thumbSrc,
                                placeholder: meta.blur,
                                location: readLocation(meta),
                                taken: readTaken(meta),
                                ...(meta.pins?.length ? { pins: meta.pins } : {}),
                                alt: altText,
                                title: title || undefined,
                                captionHtml: renderedText
                            });
                            const safeSrcset = srcset.replace(/"/g, '&quot;');
                            const safeFallbackSrc = fallbackSrc.replace(/"/g, '&quot;');
                            return `
<figure class="mk-figure">
    <span class="mk-img-shell" style="aspect-ratio:${meta.w}/${meta.h}">
        <img src="${meta.blur}" alt="" aria-hidden="true" class="mk-blur-placeholder" />
        <picture>
            <source type="image/avif" srcset="${safeSrcset}" sizes="(min-width: 1280px) 75vw, 100vw" />
            <img src="${safeFallbackSrc}" ${safeTitle ? `title="${safeTitle}"` : ''} alt="${safeAlt}" width="${largest.width}" height="${largest.height}" loading="lazy" decoding="async" class="mk-img-pointer marked-image mk-fade-in" data-media-index="${mediaIndex}" onload="this.classList.add('mk-loaded')" />
        </picture>
        ${photoPinsHtml(meta.pins, pinNodes ?? undefined, lang)}
    </span>
    <figcaption class="mk-figcaption">${renderedText}${photoStopHtml(stops?.get(mediaIndex), mediaIndex, lang)}</figcaption>
</figure>`;
                        }
                    }

                    // No AVIF tiers (a topo, a screenshot): the image as it is. Its pins
                    // need a box exactly the image's size to sit in, so only then
                    // does it get a frame; other images render as they always have.
                    const pinsHtml = meta?.w && meta?.h ? photoPinsHtml(meta.pins, pinNodes ?? undefined, lang) : '';
                    media.push({
                        kind: 'image',
                        src: href.trim(),
                        taken: meta ? readTaken(meta) : undefined,
                        ...(pinsHtml ? { pins: meta!.pins } : {}),
                        alt: altText,
                        title: title || undefined,
                        captionHtml: renderedText
                    });
                    const dims = meta ? ` width="${meta.w}" height="${meta.h}"` : '';
                    const imgHtml = `<img src="${safeHref}" ${safeTitle ? `title="${safeTitle}"` : ''} alt="${safeAlt}"${dims} loading="lazy" decoding="async" class="mk-img-pointer marked-image" data-media-index="${mediaIndex}" />`;
                    return `
<figure class="mk-figure">
    ${pinsHtml ? `<span class="mk-img-frame">\n        ${imgHtml}\n        ${pinsHtml}\n    </span>` : imgHtml}
    <figcaption class="mk-figcaption">${renderedText}${photoStopHtml(stops?.get(mediaIndex), mediaIndex, lang)}</figcaption>
</figure>`;
                }
            }
        }
    });

    const result = await markedInstance.parse(post, { async: true });
    const styles = `
<style>
.mk-figure { width: 100%; margin-left: auto; margin-right: auto; display: flex; flex-direction: column; justify-content: center; }
@media (min-width: 1280px) { .mk-figure { width: 75%; } }
.mk-figcaption { text-align: center; }
a.mk-place.mk-place { color: inherit !important; font-weight: inherit !important; text-decoration: underline dotted !important; text-decoration-thickness: 1px !important; text-underline-offset: 3px; }
a.mk-place.mk-place:hover, a.mk-place.mk-place:focus-visible { text-decoration-style: solid !important; }
.mk-photo-stop { display: block; margin: 0.15rem auto 0; padding: 0; border: 0; background: none; font: inherit; font-size: 0.8em; font-style: normal; font-variant-numeric: tabular-nums; color: rgb(107 114 128); }
.mk-photo-stop-link { cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
.mk-photo-stop-link:hover, .mk-photo-stop-link:focus-visible { color: rgb(55 65 81); }
:is(.dark) .mk-photo-stop { color: rgb(156 163 175); }
:is(.dark) .mk-photo-stop-link:hover, :is(.dark) .mk-photo-stop-link:focus-visible { color: rgb(229 231 235); }
.mk-img-no-pointer { pointer-events: none; margin-top: 0 !important; margin-bottom: 0 !important; }
.mk-img-pointer { cursor: pointer; margin-top: 0 !important; margin-bottom: 0 !important; }
.mk-img-shell { position: relative; display: block; width: 100%; overflow: hidden; cursor: pointer; }
.mk-img-shell picture { display: block; margin: 0 !important; }
.mk-img-frame { position: relative; display: block; width: fit-content; max-width: 100%; line-height: 0; }
.mk-img-frame > img { display: block; max-width: 100%; height: auto; margin: 0 !important; }
${photoPinsCss}
.mk-blur-placeholder { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(12px); transform: scale(1.05); margin: 0 !important; }
.mk-fade-in { position: relative; display: block; width: 100%; height: auto; opacity: 0; transition: opacity 400ms ease; margin: 0 !important; }
.mk-fade-in.mk-loaded { opacity: 1; }
.mk-video-link { position: relative; display: flex; justify-content: center; }
.mk-play-badge { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; width: 4rem; height: 4rem; border-radius: 9999px; background-color: rgb(17 24 39 / 0.5); color: rgb(255 255 255 / 0.85); pointer-events: none; transition: background-color 150ms ease, transform 150ms ease; }
.mk-play-badge svg { width: 1.75rem; height: 1.75rem; }
.mk-video-link:hover .mk-play-badge, .mk-video-link:focus-visible .mk-play-badge { background-color: rgb(17 24 39 / 0.75); transform: translate(-50%, -50%) scale(1.08); }
a.mk-place-doc.mk-place-doc { display: inline-block; margin-left: 0.15em; font-size: 0.75em; line-height: 1; vertical-align: super; text-decoration: none !important; font-weight: inherit !important; }
a.mk-place-doc-link.mk-place-doc-link { text-decoration: underline dotted !important; text-underline-offset: 3px; }
</style>`;
    const withoutEmptyParagraphs = result.replace(/<p>\s*<\/p>/g, '');
    const withWidgets = widgets ? insertHikeWidgetPlaceholders(withoutEmptyParagraphs, tags) : withoutEmptyParagraphs;
    return { html: withWidgets + (withStyles ? styles : ''), media, placeNodes };
}
