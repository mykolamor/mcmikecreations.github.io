/**
 * Media chips: a small widget at the start of every media line of the Write
 * editor (photo thumbnail, film icon and file name, YouTube poster, "missing"),
 * computed from `mediaLines`. The line's text stays as it is and editable; a
 * photo chip opens the pin editor for its key. Also the editor's drop target
 * for photos dragged from the Insert photo panel.
 */
import { StateField, type ChangeDesc, type EditorState, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { mediaLines, type MediaLine } from '../../shared/md-lines';
import { keyFor, ownFolderOf } from '../../lib/image-key';
import { avifVariantHref } from '$lib/renderers/responsive-image';
import type { DocRef } from '../../server/doc-ref';
import type { PostPhoto } from '../photos/types';

export interface Chip {
	/** Where the media starts (its `!`). */
	at: number;
	kind: MediaLine['kind'];
	href: string;
	/** A photo's key for the pin editor. */
	key?: string;
	/** A video's file name. */
	label?: string;
	/** A YouTube link's video id. */
	youtube?: string;
}

/** The drag data type of a photo from the Insert photo panel (its href). */
export const PHOTO_DRAG_TYPE = 'application/x-crm-photo';

const POSTERS = '/images/projects/data-viz/hikes/videos/';

/**
 * The folder whose images the doc keys by file name (as the server's `ownFolder`); a translation's is its source's. Null for
 * a hike, which has no text.
 */
export function ownFolderFor(ref: DocRef): string | null {
	if (ref.kind === 'translation') return ownFolderFor(ref.source);
	if (ref.kind === 'place') return ownFolderOf(`${ref.slug}.md`);
	if (ref.kind === 'post') return ownFolderOf(`${ref.date}-${ref.slug}.md`);
	return null;
}

/** The video id of a YouTube link, or null. */
export function youtubeIdOf(href: string): string | null {
	let u: URL;
	try {
		u = new URL(href);
	} catch {
		return null;
	}
	const host = u.hostname.toLowerCase();
	const id = host.endsWith('youtu.be') ? u.pathname.split('/')[1] : host.endsWith('youtube.com') ? u.searchParams.get('v') : null;
	return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** A chip for each media line of `body`. */
export function mediaChips(body: string, ownFolder: string): Chip[] {
	return mediaLines(body).map((m): Chip => {
		const href = m.href.trim();
		const chip: Chip = { at: m.from, kind: m.kind, href };
		if (m.kind === 'photo') chip.key = keyFor(href, ownFolder);
		else if (m.kind === 'video') chip.label = href.slice(href.lastIndexOf('/') + 1);
		else if (m.kind === 'youtube') chip.youtube = youtubeIdOf(href) ?? undefined;
		return chip;
	});
}

/** The post's photos for the pin editor's `[`/`]`: those in the text in text order (each once), then the rest. */
export function photoOrder(body: string, photos: PostPhoto[], ownFolder: string): PostPhoto[] {
	const byKey = new Map(photos.map((p) => [p.key, p]));
	const out = new Set<PostPhoto>();
	for (const c of mediaChips(body, ownFolder)) {
		const p = c.key === undefined ? undefined : byKey.get(c.key);
		if (p) out.add(p);
	}
	for (const p of photos) out.add(p);
	return [...out];
}

/** A title as a caption: `\\`, `[` and `]` escaped, so a bracket in it can't end the caption early. */
export const captionText = (s: string) => s.replace(/[\\[\]]/g, (c) => `\\${c}`);

/**
 * A position kept through the edits made while a server write runs (the author typing on during an upload), so the
 * media goes where it was asked for. Text typed right at the position stays before it.
 */
export function posTracker(pos: number) {
	return {
		map: (changes: ChangeDesc) => void (pos = changes.mapPos(pos, 1)),
		get: () => pos
	};
}

/** Where a photo dropped at `pos` goes: the end of that line (mediaInsert then puts it after the line). */
export const dropPos = (doc: Text, pos: number) => doc.lineAt(pos).to;

/** An image that falls back from its 640 tier to `fallback` (the original, or the poster JPEG). */
function thumb(src: string, fallback: string): HTMLImageElement {
	const img = document.createElement('img');
	img.src = src;
	img.alt = '';
	img.loading = 'lazy';
	img.onerror = () => {
		img.onerror = null;
		img.src = fallback;
	};
	return img;
}

class ChipWidget extends WidgetType {
	constructor(
		readonly chip: Chip,
		readonly onPhoto: (key: string) => void
	) {
		super();
	}
	eq(other: ChipWidget) {
		return other.chip.kind === this.chip.kind && other.chip.href === this.chip.href && other.chip.key === this.chip.key;
	}
	toDOM() {
		const { kind, href, key, label, youtube } = this.chip;
		const el = document.createElement('span');
		el.className = `cm-media-chip cm-media-chip-${kind}`;
		el.contentEditable = 'false';
		if (kind === 'photo') {
			el.append(thumb(avifVariantHref(href, 640), href));
			el.setAttribute('role', 'button');
			el.tabIndex = -1;
			el.title = 'Pins and caption';
			el.setAttribute('aria-label', `Pins and caption of ${key}`);
			// mousedown is cancelled so the tap doesn't move the cursor or open the keyboard first
			el.onmousedown = (e) => e.preventDefault();
			el.onclick = () => this.onPhoto(key!);
		} else if (kind === 'video') {
			el.textContent = `🎞 ${label}`;
			el.title = href;
		} else if (kind === 'youtube') {
			if (youtube) el.append(thumb(`${POSTERS}${youtube}-640.avif`, `${POSTERS}${youtube}.jpg`));
			el.append('▶ YouTube');
			el.title = href;
		} else {
			el.textContent = 'missing';
			el.title = 'Media not there yet (/404/)';
		}
		return el;
	}
	// The chip handles its own taps; the editor ignores them.
	ignoreEvent() {
		return true;
	}
}

/** The chips of `body` as decorations, side -1 so the cursor at the line start sits after the chip. */
function decorations(body: string, opts: ChipOptions): DecorationSet {
	return Decoration.set(mediaChips(body, opts.ownFolder).map((c) => Decoration.widget({ widget: new ChipWidget(c, opts.onPhoto), side: -1 }).range(c.at)));
}

type ChipOptions = { ownFolder: string; onPhoto: (key: string) => void };

/** The chips, recomputed from the text on every change (bodies are a few kB). */
export function mediaChipsField(opts: ChipOptions) {
	return StateField.define<DecorationSet>({
		create: (state) => decorations(state.doc.toString(), opts),
		update: (deco, tr) => (tr.docChanged ? decorations(tr.state.doc.toString(), opts) : deco),
		provide: (f) => EditorView.decorations.from(f)
	});
}

/** Where `field`'s chips are in `state` (for tests). */
export function chipsAt(state: EditorState, field: StateField<DecorationSet>): number[] {
	const out: number[] = [];
	state.field(field).between(0, state.doc.length, (from) => {
		out.push(from);
	});
	return out;
}

/**
 * The chips, plus the drop target for photos dragged from the Insert photo panel: `onDrop` gets the photo's href and
 * the end of the line it was dropped on (the media then goes after that line).
 */
export function mediaChipsExtension(opts: ChipOptions & { onDrop: (href: string, pos: number) => void }): Extension {
	const ours = (e: DragEvent) => !!e.dataTransfer?.types.includes(PHOTO_DRAG_TYPE);
	return [
		mediaChipsField(opts),
		EditorView.domEventHandlers({
			dragover(e) {
				if (!ours(e)) return false;
				e.preventDefault();
				e.dataTransfer!.dropEffect = 'copy';
				return true;
			},
			drop(e, view) {
				if (!ours(e)) return false;
				e.preventDefault();
				const href = e.dataTransfer!.getData(PHOTO_DRAG_TYPE);
				const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
				if (href) opts.onDrop(href, dropPos(view.state.doc, pos));
				return true;
			}
		})
	];
}
