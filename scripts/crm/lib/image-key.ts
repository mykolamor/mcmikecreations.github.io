// No node imports: the Write tab (browser) keys photos with it too.
export const STORIES = '/images/projects/data-viz/hikes/stories/';
export const PLACES = '/images/projects/data-viz/hikes/places/';

/** Folder (with trailing slash) whose images are keyed by bare file name for a post or place doc file name. */
export function ownFolderOf(docFile: string): string {
	const stem = docFile.replace(/\.md$/, '');
	return /^\d{4}-\d{2}-\d{2}-/.test(stem) ? `${STORIES}${stem.replace(/^\d{4}-\d{2}-\d{2}-/, '')}/` : `${PLACES}${stem}/`;
}

/** Bare file name when the image sits directly in `ownFolder`, otherwise the full href. */
export function keyFor(href: string, ownFolder: string): string {
	return href.startsWith(ownFolder) && !href.slice(ownFolder.length).includes('/') ? href.slice(ownFolder.length) : href;
}
