// The Preview tab's frame document. Kept out of the .svelte file: a style tag in its script would be taken for the
// component's own stylesheet.

/**
 * Small and light: roughly what the site's Tailwind typography gives. Images start hidden on the site (a script fades
 * them in) and the map widgets stay empty without scripts, so both get a stand-in here.
 */
const BASE = `
body { margin: 0; padding: 1rem; background: #fff; color: #222; font: 17px/1.65 system-ui, sans-serif; }
article { max-width: 46rem; margin: 0 auto; overflow-wrap: break-word; }
pre, table { display: block; max-width: 100%; overflow-x: auto; }
h2 { font-size: 1.4rem; line-height: 1.3; margin: 2rem 0 0.75rem; }
a { color: #0f766e; }
img, video, iframe { max-width: 100%; height: auto; }
figure { margin: 1.5rem auto; }
figcaption { font-size: 0.9rem; color: #555; margin-top: 0.4rem; }
blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid #ccc; color: #444; }
.mk-fade-in { opacity: 1 !important; }
[data-hike-widget$="-wrapper"], [data-hike-widget="elev2d-mount"], [data-hike-widget="elev3d-mount"] { margin: 1rem 0; background: #f1f1f1; border: 1px dashed #bbb; }
[data-place-docs] { margin-top: 2rem; }
details.place { margin: 0.75rem 0; padding: 0.5rem 1rem; border: 1px solid #ddd; border-radius: 8px; }
details.place summary { display: flex; flex-direction: column; cursor: pointer; list-style: none; }
.place-title { font-weight: 600; }
.place-description { color: #555; }
.place-tags { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
.place-tags span { font-size: 0.85rem; background: #f1f1f1; padding: 0.1rem 0.6rem; border-radius: 4px; }
`;

/**
 * Links that leave the page open a new tab; in-page `#…` links (place markers, place doc links) stay in the frame.
 * Those point at `about:srcdoc#…`, the frame's own document: a bare `#…` would resolve against the base below and load
 * the CRM in the frame.
 */
function frameLinks(html: string): string {
	return html.replace(/<a\b([^>]*)>/g, (tag, attrs: string) => {
		const href = /\shref="([^"]*)"/.exec(attrs)?.[1];
		if (href === undefined) return tag;
		const rest = attrs.replace(/\starget="[^"]*"/, '');
		if (href.startsWith('#')) return `<a${rest.replace(/\shref="#/, ' href="about:srcdoc#')}>`;
		return `<a${rest} target="_blank">`;
	});
}

/** The rendered HTML as a whole page. `/images/…` resolve against the CRM (`origin`), which serves the repo's static/. */
export function previewDocument(html: string, origin: string): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="${origin}/"><style>${BASE}</style></head><body><article>${frameLinks(html)}</article></body></html>`;
}
