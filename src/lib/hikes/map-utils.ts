const peakColor = (visited: string | undefined) => {
    switch (visited) {
        case 'yes': return '#16a34a'; // I'm 95% sure I haven't visited it, but Komoot counted it
        case 'no': return '#6b7280'; // I probably haven't visited it
        case 'missing': return '#7dd3fc'; // I definitely visited it, but Komoot doesn't have this peak
        default: return '#dc2626'; // Present for me and Komoot
    }
};

export const getNodeIconDetails = (tags: any) => {
    if (tags.natural === 'peak') return { emoji: '⛰️', color: peakColor(tags.visited) };
    if (tags.natural === 'saddle') return { emoji: '〰️', color: '#16a34a' };
    if (tags.tourism === 'alpine_hut' || tags.tourism === 'wilderness_hut' || tags.building === 'hut') return { emoji: '🛖', color: '#b45309' };
    if (tags.tourism === 'hotel' || tags.tourism === 'guest_house') return { emoji: '🏨', color: '#b45309' };
    if (tags.amenity === 'restaurant' || tags.amenity === 'cafe' || tags.amenity === 'fast_food' || tags.amenity === 'pub') return { emoji: '🍽️', color: '#ea580c' };
    if (tags.shop === 'convenience') return { emoji: '🛒', color: '#16a34a' };
    if (tags.tourism === 'viewpoint') return { emoji: '🔭', color: '#0284c7' };
    if (tags.waterway === 'waterfall') return { emoji: '🌊', color: '#0ea5e9' };
    if (tags.natural === 'water' || tags.natural === 'spring') return { emoji: '💧', color: '#38bdf8' };
    if (tags.natural === 'cave_entrance') return { emoji: '🕳️', color: '#57534e' };
    if (tags.historic === 'ruins' || tags.historic === 'castle') return { emoji: '🏰', color: '#525252' };
    if (tags.historic === 'memorial') return { emoji: '🪦', color: '#78716c' };
    if (tags.amenity === 'place_of_worship') {
        if (tags.religion === 'muslim') return { emoji: '🕌', color: '#9333ea' };
        if (tags.religion === 'jewish') return { emoji: '🕍', color: '#9333ea' };
        if (tags.religion === 'hindu' || tags.religion === 'buddhist') return { emoji: '🛕', color: '#9333ea' };
        return { emoji: '⛪', color: '#9333ea' };
    }
    if (tags.highway === 'bus_stop') return { emoji: '🚌', color: '#2563eb' };
    if (tags.railway === 'station' || tags.railway === 'halt' || tags.public_transport === 'station') return { emoji: '🚉', color: '#dc2626' };
    if (tags.tourism === 'information') return { emoji: 'ℹ️', color: '#2563eb' };
    if (tags.place === 'village' || tags.place === 'town' || tags.place === 'city') return { emoji: '🏘️', color: '#7c3aed' };
    if (tags.aeroway === 'aerodrome') return { emoji: '✈️', color: '#6294ff' };
    return { emoji: '📍', color: '#3b82f6' };
};

export const formatTags = (tags: any): [string, string][] => {
    const formatted = new Map<string, string>();
    const handledKeys = new Set(['name', 'ele']);

    const addHandled = (keys: string[], label: string, formatter: (v: string) => string) => {
        keys.forEach(k => handledKeys.add(k));
        for (const k of keys) {
            if (tags[k] !== undefined && tags[k] !== null) {
                formatted.set(label, formatter(String(tags[k])));
                return;
            }
        }
    };

    addHandled(['contact:phone', 'phone', 'contact:mobile', 'mobile'], 'Phone', v => 
        v.split(';').map(p => {
            const num = p.trim();
            return `<a href="tel:${num}" style="color: #2563eb; text-decoration: none;">${num}</a>`;
        }).join(', ')
    );
    addHandled(['contact:website', 'website', 'url'], 'Website', v => `<a href="${v.startsWith('http') ? v : 'https://' + v}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">Link</a>`);
    addHandled(['contact:email', 'email'], 'Email', v => `<a href="mailto:${v}" style="color: #2563eb; text-decoration: none;">${v}</a>`);

    handledKeys.add('wikipedia');
    if (tags.wikipedia) {
        const parts = String(tags.wikipedia).split(':');
        const lang = parts.length > 1 ? parts[0] : 'en';
        const title = parts.length > 1 ? parts[1] : parts[0];
        formatted.set('Wikipedia', `<a href="https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">${tags.wikipedia}</a>`);
    }

    handledKeys.add('wikidata');
    if (tags.wikidata) {
        formatted.set('Wikidata', `<a href="https://www.wikidata.org/wiki/${tags.wikidata}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">${tags.wikidata}</a>`);
    }

    for (const [k, v] of Object.entries(tags)) {
        if (!handledKeys.has(k)) {
            const prettyKey = k.replace(/[:_]/g, ' ')
                               .split(' ')
                               .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                               .join(' ');
            formatted.set(prettyKey, String(v));
        }
    }

    return Array.from(formatted.entries());
};



/** A located post photo pinned on the maps, drawn from its blur placeholder. */
export interface MapPhoto {
    lat: number;
    lon: number;
    /** Rendered 3D terrain height under the photo (m); without it the photo stays off the 3D map. */
    demEle?: number;
    /** Tiny data-URI image (the post's LQIP) used as the marker face. */
    blur: string;
    alt: string;
    /** Index into the post's `media` list, i.e. the image's `data-media-index`. */
    mediaIndex: number;
}

export const PHOTO_MARKER_SIZE = 30;
export const NODE_MARKER_SIZE = 24;

/**
 * Keep the items whose projected point doesn't sit within `minPixelDistance`
 * of an earlier kept one - earlier items win, so callers control priority by
 * order. `project` maps an item to screen pixels, or null to drop it.
 */
export function declutterBy<T>(items: T[], project: (item: T) => { x: number; y: number } | null, minPixelDistance: number): T[] {
    const kept: { item: T; x: number; y: number }[] = [];
    const min2 = minPixelDistance * minPixelDistance;
    for (const item of items) {
        const p = project(item);
        if (!p) continue;
        if (!kept.some((k) => (p.x - k.x) ** 2 + (p.y - k.y) ** 2 < min2)) kept.push({ item, x: p.x, y: p.y });
    }
    return kept.map((k) => k.item);
}

/** The blurred photo thumbnail a photo marker shows. */
export function photoIconHtml(photo: MapPhoto): string {
    return `<div style="box-sizing:border-box;width:100%;height:100%;border:2px solid white;border-radius:6px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,.4);cursor:pointer;"><img src="${photo.blur.replace(/"/g, '&quot;')}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;margin:0;" /></div>`;
}

/** The coloured emoji disc a POI node marker shows. */
export function nodeIconHtml(tags: any): string {
    const { emoji, color } = getNodeIconDetails(tags ?? {});
    return `<div style="background-color:${color};width:${NODE_MARKER_SIZE}px;height:${NODE_MARKER_SIZE}px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,.3);font-size:13px;line-height:1;">${emoji}</div>`;
}

/** Default `elevateNode` filter for the 3D map: peaks and saddles stand out on a stem. */
export function isPeakOrSaddle(node: { tags?: Record<string, unknown> | null }): boolean {
    const natural = node.tags?.natural;
    return natural === 'peak' || natural === 'saddle';
}

/** Node name for its popup heading and accessible label. */
export function nodeTitle(tags: any): string {
    return tags?.name || tags?.natural || 'POI';
}

/** A POI node's popup body: name, OSM elevation, and its formatted tags. */
export function nodePopupHtml(tags: any): string {
    const ele = tags?.ele ? ` (${tags.ele}m)` : '';
    const tagsList = formatTags(tags ?? {})
        .map(([k, v]: [string, string]) => `<tr><td style="padding-right:8px;font-weight:600;font-size:11px;color:#6b7280;vertical-align:top;white-space:nowrap;">${k}</td><td style="font-size:11px;word-break:break-word;">${v}</td></tr>`)
        .join('');
    return `<div style="margin-bottom:8px;"><b>${nodeTitle(tags)}</b>${ele}</div>`
        + (tagsList ? `<div style="max-height:150px;overflow-y:auto;"><table style="min-width:100%;border-spacing:0;">${tagsList}</table></div>` : '');
}

// --- "Photos" layer preference ---------------------------------------------
// One setting for both maps, remembered across hikes like the `color-theme`
// choice. On by default; storage may be unavailable (private mode, blocked
// site data), in which case it lasts for the page's lifetime only.
const PHOTOS_PREF_KEY = 'map-photos';
const PHOTOS_PREF_EVENT = 'map-photos-change';
let photosPrefFallback = true;

/** Whether map photo markers are shown. */
export function getMapPhotosPref(): boolean {
    try {
        const stored = localStorage.getItem(PHOTOS_PREF_KEY);
        if (stored !== null) return stored !== 'off';
    } catch { /* storage unavailable */ }
    return photosPrefFallback;
}

/** Remember the choice and tell every map on the page. */
export function setMapPhotosPref(on: boolean) {
    if (getMapPhotosPref() === on) return;
    photosPrefFallback = on;
    try { localStorage.setItem(PHOTOS_PREF_KEY, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
    window.dispatchEvent(new CustomEvent<boolean>(PHOTOS_PREF_EVENT, { detail: on }));
}

/** Call `listener` whenever the preference changes; returns the unsubscribe. */
export function onMapPhotosPref(listener: (on: boolean) => void): () => void {
    const handler = (e: Event) => listener((e as CustomEvent<boolean>).detail);
    window.addEventListener(PHOTOS_PREF_EVENT, handler);
    return () => window.removeEventListener(PHOTOS_PREF_EVENT, handler);
}
