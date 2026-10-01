<script lang="ts">
	import { page } from '$app/state';
	import type { ProcessedPost } from '$lib/hikes/hikes-info';
	import resume from '$lib/data/resume.json';
	import {
		HIKES_BLOG_TITLE,
		HIKES_BLOG_DESCRIPTION,
		HIKES_HERO_IMAGE,
		hikesListTitle,
		hikesListDescription,
		hikesTagTitle,
		hikesTagDescription,
		hikesYearTitle,
		hikesYearDescription
	} from '$lib/hikes/hikes-meta';

	type PostProps = {
		variant: 'post';
		title: string;
		description: string;
		image?: string | null;
		date: string;
		dateModified?: string;
		author: string;
		tags: string[];
		anchor: string;
		distance?: number | null;
		ascent?: number | null;
		descent?: number | null;
		duration?: number | null;
	};

	type BlogProps = {
		variant: 'blog';
		posts: ProcessedPost[];
		currentPage: number;
		totalPages: number;
	};

	type ListProps = {
		variant: 'list';
		posts: ProcessedPost[];
		currentPage: number;
	};

	type TagProps = {
		variant: 'tag';
		tag: string;
		posts: ProcessedPost[];
		currentPage: number;
		totalPages: number;
		name?: string;
		description?: string;
	};

	type YearProps = {
		variant: 'year';
		year: number;
		posts: ProcessedPost[];
		currentPage: number;
		totalPages: number;
	};

	type Props = PostProps | BlogProps | ListProps | TagProps | YearProps;

	let props: Props = $props();

	function absUrl(path: string): string {
		return path.startsWith('http') ? path : page.url.origin + path;
	}

	function postSchema(post: ProcessedPost) {
		return {
			'@type': 'BlogPosting',
			headline: post.title,
			url: absUrl(post.url),
			datePublished: post.date.toISOString(),
			...(post.image ? { image: absUrl(post.image) } : {})
		};
	}

	const schema = $derived.by(() => {
		const origin = page.url.origin;
		const blogId = origin + '/hikes/';
		const blogRef = { '@type': 'Blog', '@id': blogId };
		const authorRef = { '@type': 'Person', name: resume.basics.name };

		const blogNode = {
			'@type': 'Blog',
			'@id': blogId,
			inLanguage: 'en',
			name: HIKES_BLOG_TITLE,
			description: HIKES_BLOG_DESCRIPTION,
			url: blogId,
			image: absUrl(HIKES_HERO_IMAGE),
			author: authorRef,
			publisher: authorRef,
			isPartOf: { '@type': 'WebSite', '@id': origin + '/#website' }
		};

		function graph(...nodes: object[]) {
			return { '@context': 'https://schema.org', '@graph': nodes };
		}

		if (props.variant === 'post') {
			const postUrl = absUrl(`/hikes/${props.anchor}/`);
			const additionalProperty = [
				props.distance != null && {
					'@type': 'PropertyValue',
					name: 'Distance',
					value: Math.round((props.distance / 1000) * 10) / 10,
					unitText: 'km',
					unitCode: 'KMT'
				},
				props.ascent != null && {
					'@type': 'PropertyValue',
					name: 'Ascent',
					value: Math.round(props.ascent),
					unitText: 'm',
					unitCode: 'MTR'
				},
				props.descent != null && {
					'@type': 'PropertyValue',
					name: 'Descent',
					value: Math.round(props.descent),
					unitText: 'm',
					unitCode: 'MTR'
				},
				props.duration != null && {
					'@type': 'PropertyValue',
					name: 'Duration',
					value: Math.round(props.duration),
					unitText: 'min',
					unitCode: 'MIN'
				}
			].filter(Boolean);
			return graph(blogNode, {
				'@type': 'BlogPosting',
				inLanguage: 'en',
				headline: props.title,
				description: props.description,
				...(props.image ? { image: absUrl(props.image) } : {}),
				datePublished: props.date + 'T16:00:00+00:00',
				...(props.dateModified ? { dateModified: props.dateModified + 'T16:00:00+00:00' } : {}),
				author: { '@type': 'Person', name: props.author },
				publisher: { '@type': 'Person', name: props.author },
				keywords: props.tags.join(', '),
				url: postUrl,
				mainEntityOfPage: { '@type': 'WebPage', '@id': postUrl },
				isPartOf: blogRef,
				...(additionalProperty.length > 0 ? { additionalProperty } : {})
			});
		}

		if (props.variant === 'blog') {
			const pageRefs = props.totalPages > 1
				? Array.from({ length: props.totalPages - 1 }, (_, i) => i + 2).map(n => ({
					'@type': 'ItemList',
					url: origin + `/hikes/page/${n}/`,
					name: hikesListTitle(n)
				}))
				: [];
			const websiteNode = {
				'@type': 'WebSite',
				'@id': origin + '/#website',
				url: origin + '/',
				potentialAction: {
					'@type': 'SearchAction',
					target: {
						'@type': 'EntryPoint',
						urlTemplate: origin + '/hikes/search/?q={search_term_string}'
					},
					'query-input': 'required name=search_term_string'
				}
			};
			return graph(
				{ ...blogNode, blogPost: props.posts.map(postSchema), ...(pageRefs.length > 0 ? { hasPart: pageRefs } : {}) },
				websiteNode
			);
		}

		if (props.variant === 'list') {
			return graph(blogNode, {
				'@type': 'ItemList',
				inLanguage: 'en',
				name: hikesListTitle(props.currentPage),
				description: hikesListDescription(props.currentPage),
				url: origin + `/hikes/page/${props.currentPage}/`,
				numberOfItems: props.posts.length,
				isPartOf: blogRef,
				itemListElement: props.posts.map((post, i) => ({
					'@type': 'ListItem',
					position: i + 1,
					item: {
						'@type': 'BlogPosting',
						headline: post.title,
						url: absUrl(post.url),
						datePublished: post.date.toISOString(),
						...(post.image ? { image: absUrl(post.image) } : {})
					}
				}))
			});
		}

		if (props.variant === 'tag') {
			const tagBase = `/hikes/tag/${encodeURIComponent(props.tag)}`;
			const otherTagPages = Array.from({ length: props.totalPages }, (_, i) => i + 1)
				.filter(n => n !== props.currentPage)
				.map(n => ({
					'@type': 'CollectionPage',
					url: n === 1 ? origin + `${tagBase}/` : origin + `${tagBase}/page/${n}/`,
					name: props.name && n === 1 ? props.name : hikesTagTitle(props.tag, n)
				}));
			return graph(blogNode, {
				'@type': 'CollectionPage',
				inLanguage: 'en',
				name: props.name ?? hikesTagTitle(props.tag, props.currentPage),
				description: props.description ?? hikesTagDescription(props.tag, props.currentPage),
				url:
					props.currentPage > 1
						? origin + `${tagBase}/page/${props.currentPage}/`
						: origin + `${tagBase}/`,
				isPartOf: blogRef,
				hasPart: [
					...props.posts.map(postSchema),
					...otherTagPages
				]
			});
		}

		// variant === 'year'
		const yearBase = `/hikes/year/${props.year}`;
		const otherYearPages = Array.from({ length: props.totalPages }, (_, i) => i + 1)
			.filter(n => n !== props.currentPage)
			.map(n => ({
				'@type': 'CollectionPage',
				url: n === 1 ? origin + `${yearBase}/` : origin + `${yearBase}/page/${n}/`,
				name: hikesYearTitle(props.year, n)
			}));
		return graph(blogNode, {
			'@type': 'CollectionPage',
			inLanguage: 'en',
			name: hikesYearTitle(props.year, props.currentPage),
			description: hikesYearDescription(props.year, props.currentPage),
			url:
				props.currentPage > 1
					? origin + `${yearBase}/page/${props.currentPage}/`
					: origin + `${yearBase}/`,
			isPartOf: blogRef,
			hasPart: [
				...props.posts.map(postSchema),
				...otherYearPages
			]
		});
	});
</script>

<svelte:head>
	{@html `<script type="application/ld+json">${JSON.stringify(schema)}</script>`}
</svelte:head>
