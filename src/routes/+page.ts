import type { PageLoad } from './$types';

export const load: PageLoad = ({ data }) => {
	return {
		// Server load provides the latest blog posts (parsed from markdown).
		...data,
		// The page renders its own navbar, which slides in once the hero (whose labels link everywhere) is scrolled past.
		header: { showNavbar: false },
		footer: {
			pinBottom: false,
			showSocials: false,
		},
	};
};
