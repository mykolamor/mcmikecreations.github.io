export const BLOG_TITLE = 'Programming Blog | Frontend, Backend & Gamedev';
export const BLOG_DESCRIPTION = 'Personal programming blog of Mykola Morozov';

export const blogListTitle = (page: number) =>
	`Programming Blog - Page ${page} | Mykola Morozov`;

export const blogListDescription = (page: number) =>
	`Browse programming blog posts - Page ${page}`;

export const blogTagTitle = (tag: string, page: number) => {
	const suffix = page > 1 ? ` - Page ${page}` : '';
	return `Posts tagged "${tag}"${suffix} | Programming Blog`;
};

export const blogTagDescription = (tag: string, page: number) => {
	const suffix = page > 1 ? ` - Page ${page}` : '';
	return `Browse programming blog posts tagged with ${tag}${suffix}`;
};

export const blogYearTitle = (year: number, page: number) => {
	const suffix = page > 1 ? ` - Page ${page}` : '';
	return `Blog posts from ${year}${suffix} | Programming Blog`;
};

export const blogYearDescription = (year: number, page: number) => {
	const suffix = page > 1 ? ` - Page ${page}` : '';
	return `Browse programming blog posts from ${year}${suffix}`;
};

/** The one `@id` of the `Blog` node, shared by the listing pages and every post's `isPartOf`. */
export const blogId = (origin: string) => `${origin}/blog/#blog`;

/**
 * A post's `YYYY-MM-DD` date as the ISO 8601 date-time used for
 * `datePublished` / `dateModified` and the `article:*_time` meta tags.
 */
export const blogDateTime = (isoDate: string) => `${isoDate}T16:00:00+00:00`;

/** Reading time in minutes as an ISO 8601 duration for `timeRequired`. */
export const blogTimeRequired = (minutes: number) => `PT${Math.max(1, Math.round(minutes))}M`;

/** Google's limit is loose; ten images say enough (the hike JSON-LD uses the same cap). */
export const BLOG_MAX_IMAGES = 10;
