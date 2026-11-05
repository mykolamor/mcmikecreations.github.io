<script lang="ts">
	import { page } from '$app/state';
	import type { ProcessedBlogPost } from '$lib/blog/blog-info';
	import resume from '$lib/data/resume.json';
	import {
		BLOG_TITLE,
		BLOG_DESCRIPTION,
		blogListTitle,
		blogListDescription,
		blogTagTitle,
		blogTagDescription,
		blogYearTitle,
		blogYearDescription,
		blogId as blogIdFor,
	} from '$lib/blog/blog-meta';

	type BlogProps = {
		variant: 'blog';
		posts: ProcessedBlogPost[];
		currentPage: number;
		totalPages: number;
	};

	type ListProps = {
		variant: 'list';
		posts: ProcessedBlogPost[];
		currentPage: number;
	};

	type TagProps = {
		variant: 'tag';
		tag: string;
		posts: ProcessedBlogPost[];
		currentPage: number;
		totalPages: number;
	};

	type YearProps = {
		variant: 'year';
		year: number;
		posts: ProcessedBlogPost[];
		currentPage: number;
		totalPages: number;
	};

	type Props = BlogProps | ListProps | TagProps | YearProps;

	let props: Props = $props();

	function absUrl(path: string): string {
		return path.startsWith('http') ? path : page.url.origin + path;
	}

	function postSchema(post: ProcessedBlogPost) {
		return {
			'@type': 'BlogPosting',
			headline: post.title,
			url: absUrl(post.url),
			datePublished: post.date.toISOString(),
			...(post.image ? { image: absUrl(post.image) } : {}),
		};
	}

	const schema = $derived.by(() => {
		const origin = page.url.origin;
		const blogId = blogIdFor(origin);
		const blogRef = { '@type': 'Blog', '@id': blogId };
		const authorRef = { '@type': 'Person', name: resume.basics.name, url: origin + '/' };

		const blogNode = {
			'@type': 'Blog',
			'@id': blogId,
			inLanguage: 'en',
			name: BLOG_TITLE,
			description: BLOG_DESCRIPTION,
			url: origin + '/blog/',
			author: authorRef,
			publisher: authorRef,
			isPartOf: { '@type': 'WebSite', '@id': origin + '/#website' },
		};

		function graph(...nodes: object[]) {
			return { '@context': 'https://schema.org', '@graph': nodes };
		}

		if (props.variant === 'blog') {
			const pageRefs =
				props.totalPages > 1
					? Array.from({ length: props.totalPages - 1 }, (_, i) => i + 2).map(n => ({
							'@type': 'ItemList',
							url: origin + `/blog/page/${n}/`,
							name: blogListTitle(n),
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
						urlTemplate: origin + '/blog/search/?q={search_term_string}',
					},
					'query-input': 'required name=search_term_string',
				},
			};
			return graph(
				{
					...blogNode,
					blogPost: props.posts.map(postSchema),
					...(pageRefs.length > 0 ? { hasPart: pageRefs } : {}),
				},
				websiteNode,
			);
		}

		if (props.variant === 'list') {
			return graph(blogNode, {
				'@type': 'ItemList',
				inLanguage: 'en',
				name: blogListTitle(props.currentPage),
				description: blogListDescription(props.currentPage),
				url: origin + `/blog/page/${props.currentPage}/`,
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
						...(post.image ? { image: absUrl(post.image) } : {}),
					},
				})),
			});
		}

		if (props.variant === 'tag') {
			const tagBase = `/blog/tag/${encodeURIComponent(props.tag)}`;
			const otherTagPages = Array.from({ length: props.totalPages }, (_, i) => i + 1)
				.filter(n => n !== props.currentPage)
				.map(n => ({
					'@type': 'CollectionPage',
					url: n === 1 ? origin + `${tagBase}/` : origin + `${tagBase}/page/${n}/`,
					name: blogTagTitle(props.tag, n),
				}));
			return graph(blogNode, {
				'@type': 'CollectionPage',
				inLanguage: 'en',
				name: blogTagTitle(props.tag, props.currentPage),
				description: blogTagDescription(props.tag, props.currentPage),
				url:
					props.currentPage > 1
						? origin + `${tagBase}/page/${props.currentPage}/`
						: origin + `${tagBase}/`,
				isPartOf: blogRef,
				hasPart: [...props.posts.map(postSchema), ...otherTagPages],
			});
		}

		// variant === 'year'
		const yearBase = `/blog/year/${props.year}`;
		const otherYearPages = Array.from({ length: props.totalPages }, (_, i) => i + 1)
			.filter(n => n !== props.currentPage)
			.map(n => ({
				'@type': 'CollectionPage',
				url: n === 1 ? origin + `${yearBase}/` : origin + `${yearBase}/page/${n}/`,
				name: blogYearTitle(props.year, n),
			}));
		return graph(blogNode, {
			'@type': 'CollectionPage',
			inLanguage: 'en',
			name: blogYearTitle(props.year, props.currentPage),
			description: blogYearDescription(props.year, props.currentPage),
			url:
				props.currentPage > 1
					? origin + `${yearBase}/page/${props.currentPage}/`
					: origin + `${yearBase}/`,
			isPartOf: blogRef,
			hasPart: [...props.posts.map(postSchema), ...otherYearPages],
		});
	});
</script>

<svelte:head>
	{@html `<script type="application/ld+json">${JSON.stringify(schema)}</script>`}
</svelte:head>
