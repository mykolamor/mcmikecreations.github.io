/**
 * Markdown image titles double as a rendering flag list for media embeds:
 *
 *     ![Cows chasing a dog](/clip.mp4 "autoplay")
 *
 * Flags are comma-separated and case-insensitive. `autoplay` starts a video
 * muted; `invert` inverts an image in dark mode (black line art such as
 * diagrams on a transparent background). Anything in the title that
 * isn't a recognized flag stays a real `title` attribute, so a caption-style
 * title keeps working.
 */

const MEDIA_FLAGS = new Set(['autoplay', 'invert']);

export interface MediaFlags {
	/** Recognised flags found in the title, lower-cased. */
	flags: Set<string>;
	/** The title with recognized flags removed; empty when it held only flags. */
	title: string;
}

export function parseMediaFlags(title: unknown): MediaFlags {
	if (typeof title !== 'string' || title.length === 0) {
		return { flags: new Set<string>(), title: '' };
	}

	const flags = new Set<string>();
	const rest: string[] = [];
	for (const part of title.split(',')) {
		const token = part.trim();
		if (MEDIA_FLAGS.has(token.toLowerCase())) {
			flags.add(token.toLowerCase());
		} else if (token.length > 0) {
			rest.push(token);
		}
	}

	// A title carrying no flags is passed through byte-for-byte, so ordinary
	// titles never get reflowed by the split/join above.
	if (flags.size === 0) {
		return { flags, title };
	}
	return { flags, title: rest.join(', ') };
}
