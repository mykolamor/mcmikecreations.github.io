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
import { buildPlaceIndex, type PlaceIndex, type PlaceNode } from '$lib/hikes/place-links';
import { avifTiers, buildAvifSrcset, avifVariantHref, type HikeImageMeta } from '$lib/renderers/responsive-image';

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
const TOPONYM = /(?<![\p{L}\p{N}])((?:\p{Lu}[\p{L}.'’-]*\s){0,3}\p{Lu}[\p{L}.'’-]*\s\(\d{2,4}\s?m\))/gu;

// Capitalised English words that start a sentence ("The Nebelhorn (2224 m)",
// "After Reintalangerhütte (1366 m)") and so get caught by TOPONYM, but are not
// part of the name and should still be translated.
const LEADING_ENGLISH = new Set([
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
 */
function markToponyms(html: string, places: PlaceIndex | null): string {
    return html.replace(TOPONYM, (match: string) => {
        // Words and the whitespace between them alternate: even indices are words.
        // The elevation's own space is non-breaking, so a line never splits `(2024 m)`.
        const words = match.replace(/\((\d{2,4})\s(m\))$/, '($1&nbsp;$2').split(/(\s)/);
        // Always keep at least one name word before the `(1234 m)` part.
        const elevationAt = words.findIndex((w) => w.startsWith('('));
        let start = 0;
        while (start + 2 < elevationAt && LEADING_ENGLISH.has(words[start])) start += 2;
        const lead = words.slice(0, start).join('');

        const nameWords = words.slice(start, elevationAt).filter((_, i) => i % 2 === 0).map(unescapeHtml);
        const ele = Number(/\d+/.exec(words[elevationAt])?.[0]);
        const place = places?.match(nameWords, ele);
        if (!place) return lead + `<span translate="no">${words.slice(start).join('')}</span>`;

        // The node's name says exactly where the place name starts, so words
        // before it ("Approaching") stay translatable.
        const linkAt = start + place.start * 2;
        const { lat, lon } = place.node;
        return words.slice(0, linkAt).join('') + '<span translate="no">' +
            `<a class="mk-place" href="#hike-map" data-place-lat="${lat}" data-place-lon="${lon}" title="Show on the map">` +
            `${words.slice(linkAt).join('')}</a></span>`;
    });
}

/**
 * The `km 13.4 · 2052 m · 11:18` line under a photo's caption. A button when
 * the photo is on the maps, so clicking it can center them on the photo.
 */
function photoStopHtml(stop: PhotoStop | undefined, mediaIndex: number): string {
    const text = stop ? photoStopText(stop) : '';
    if (!text) return '';
    const title = stop!.timeSource === 'track'
        ? ' title="Time from my recorded track, where it passed this spot"'
        : stop!.timeSource === 'photo' ? ' title="Time the photo was taken"' : '';
    if (stop!.lat != null && stop!.lon != null) {
        return `<button type="button" class="mk-photo-stop mk-photo-stop-link" translate="no" data-photo-stop="${mediaIndex}"${title} aria-label="${text}, show on the map">${text}</button>`;
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
    /** The hike's POI nodes; place references naming one link to it on the map. */
    nodes?: PlaceNode[] | null;
}

export async function parseMarkdown(
    postRaw: string,
    tags: string[] = [],
    { stops, nodes }: ParseMarkdownOptions = {}
): Promise<ParsedPost> {
    // Drop any leading YAML front matter before rendering. Uses the
    // dependency-free stripper so this stays safe in the client bundle, which
    // re-renders the body on navigation. Files without front matter are unchanged.
    const post = stripFrontmatter(postRaw);
    const { Marked, Renderer } = await import('marked');
    const places = buildPlaceIndex(nodes);
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
    const frontMatterBlock = extractFrontMatterBlock(postRaw);
    if (frontMatterBlock) {
        try {
            const { load } = await import('js-yaml');
            const parsed = load(frontMatterBlock);
            if (isPlainObject(parsed) && isPlainObject(parsed.images)) {
                images = parsed.images as Record<string, HikeImageMeta>;
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
                if (!isPlaceholderHref(token.href)) {
                    return withoutPlaceLinks(() => Renderer.prototype.link.call(this as any, token));
                }
                return `<span>${(this as any).parser.parseInline(token.tokens)}</span>`;
            },
            text(token: any) {
                if (token.tokens) return false;
                const html = token.escaped ? token.text : escapeHtml(token.text);
                return markToponyms(html, placeLinksOff === 0 ? places : null);
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
                    const mediaIndex = media.length;
                    media.push({
                        kind: 'youtube',
                        videoId,
                        href: href.trim(),
                        alt: text,
                        title: title || undefined,
                        captionHtml: renderedText
                    });
                    return `
<figure class="mk-figure">
    <a class="mk-video-link" href="${safeHref}" target="_blank" rel="noopener noreferrer" data-media-index="${mediaIndex}">
        <img src="https://img.youtube.com/vi/${videoId}/0.jpg" ${safeTitle ? `title="${safeTitle}"` : ''} alt="${safeText}" class="mk-img-no-pointer" />
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
                    const mediaIndex = media.length;
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
                    const mediaIndex = media.length;
                    const meta = images[href.trim().split('/').pop() ?? ''];

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
                                alt: text,
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
            <img src="${safeFallbackSrc}" ${safeTitle ? `title="${safeTitle}"` : ''} alt="${safeText}" width="${largest.width}" height="${largest.height}" loading="lazy" decoding="async" class="mk-img-pointer marked-image mk-fade-in" data-media-index="${mediaIndex}" onload="this.classList.add('mk-loaded')" />
        </picture>
    </span>
    <figcaption class="mk-figcaption">${renderedText}${photoStopHtml(stops?.get(mediaIndex), mediaIndex)}</figcaption>
</figure>`;
                        }
                    }

                    media.push({
                        kind: 'image',
                        src: href.trim(),
                        taken: meta ? readTaken(meta) : undefined,
                        alt: text,
                        title: title || undefined,
                        captionHtml: renderedText
                    });
                    const dims = meta ? ` width="${meta.w}" height="${meta.h}"` : '';
                    return `
<figure class="mk-figure">
    <img src="${safeHref}" ${safeTitle ? `title="${safeTitle}"` : ''} alt="${safeText}"${dims} loading="lazy" decoding="async" class="mk-img-pointer marked-image" data-media-index="${mediaIndex}" />
    <figcaption class="mk-figcaption">${renderedText}${photoStopHtml(stops?.get(mediaIndex), mediaIndex)}</figcaption>
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
.mk-blur-placeholder { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(12px); transform: scale(1.05); margin: 0 !important; }
.mk-fade-in { position: relative; display: block; width: 100%; height: auto; opacity: 0; transition: opacity 400ms ease; margin: 0 !important; }
.mk-fade-in.mk-loaded { opacity: 1; }
.mk-video-link { position: relative; display: flex; justify-content: center; }
.mk-play-badge { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; width: 4rem; height: 4rem; border-radius: 9999px; background-color: rgb(17 24 39 / 0.5); color: rgb(255 255 255 / 0.85); pointer-events: none; transition: background-color 150ms ease, transform 150ms ease; }
.mk-play-badge svg { width: 1.75rem; height: 1.75rem; }
.mk-video-link:hover .mk-play-badge, .mk-video-link:focus-visible .mk-play-badge { background-color: rgb(17 24 39 / 0.75); transform: translate(-50%, -50%) scale(1.08); }
</style>`;
    const withoutEmptyParagraphs = result.replace(/<p>\s*<\/p>/g, '');
    const withWidgets = insertHikeWidgetPlaceholders(withoutEmptyParagraphs, tags);
    return { html: withWidgets + styles, media };
}
