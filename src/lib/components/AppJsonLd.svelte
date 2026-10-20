<script lang="ts">
	import { page } from '$app/state';
	import resume from '$lib/data/resume.json';

	type WebsiteProps = { variant: 'website' };
	type ProfileProps = { variant: 'profile', description?: string | null, dateModified?: string | null };

	type BlogListPost = { title: string; url: string; date: Date; image?: string | null };
	type BlogListProps = { variant: 'blog'; posts?: BlogListPost[] };

	type BlogPostProps = {
		variant: 'blog-post';
		title: string;
		description?: string | null;
		image?: string | null;
		isoDate: string;
		author?: string | null;
		tags?: string[];
		anchor: string;
	};

	type CollectionItem = { name: string; url: string; image?: string | null };
	type CollectionProps = {
		variant: 'collection';
		name: string;
		description?: string;
		url: string;
		items?: CollectionItem[];
	};

	type SoftwareProps = {
		variant: 'software';
		name: string;
		description?: string;
		image?: string;
		url?: string;
		route: string;
	};

	type CreativeWorkProps = {
		variant: 'creative-work';
		name: string;
		description?: string;
		image?: string | null;
		url: string;
	};

	type Props = WebsiteProps | ProfileProps | BlogListProps | BlogPostProps
		| CollectionProps | SoftwareProps | CreativeWorkProps;

	let props: Props = $props();

	function absUrl(path: string): string {
		return path.startsWith('http') ? path : page.url.origin + path;
	}

	const schema = $derived.by(() => {
		const origin = page.url.origin;

		function graph(...nodes: object[]) {
			return { '@context': 'https://schema.org', '@graph': nodes };
		}

		const websiteRef = { '@type': 'WebSite', '@id': origin + '/#website' };

		const sameAs = resume.basics.profiles
			.map(p => p.url)
			.filter(u => u.startsWith('http'));

		// The open-ended work entry is the current job; the résumé label is a
		// headline, not a title.
		const currentJob = resume.work.find(w => !w.endDate);

		// One entry per institution, in résumé order.
		const alumniOf = [...new Map(resume.education.map(e => [e.institution, {
			'@type': 'EducationalOrganization',
			name: e.institution,
			url: e.url
		}])).values()];

		const personNode = {
			'@type': 'Person',
			'@id': resume.basics.url + '#person',
			name: resume.basics.name,
			alternateName: 'Микола Морозов',
			url: resume.basics.url,
			image: absUrl(resume.basics.image),
			jobTitle: currentJob?.position ?? resume.basics.label,
			...(currentJob ? { worksFor: { '@type': 'Organization', name: currentJob.name, url: currentJob.url } } : {}),
			alumniOf,
			knowsAbout: ['Databases', 'GPU Computing', 'Computer Graphics', 'Geospatial Computing', 'Software Architecture'],
			email: resume.basics.email,
			sameAs
		};

		if (props.variant === 'website') {
			return graph(
				{
					'@type': 'WebSite',
					'@id': origin + '/#website',
					name: resume.basics.name,
					url: origin + '/',
					description: resume.basics.summary,
					inLanguage: 'en',
					author: { '@type': 'Person', '@id': personNode['@id'] }
				},
				personNode
			);
		}

		if (props.variant === 'profile') {
			return graph(
				{
					'@type': 'ProfilePage',
					'@id': absUrl(page.url.pathname) + '#profilepage',
					url: absUrl(page.url.pathname),
					...(props.description ? { description: props.description } : {}),
					...(props.dateModified ? { dateModified: props.dateModified + 'T16:00:00+00:00' } : {}),
					inLanguage: 'en',
					mainEntity: { '@type': 'Person', '@id': personNode['@id'] }
				},
				personNode
			);
		}

		if (props.variant === 'blog') {
			const blogUrl = origin + '/blog/';
			const blogNode: Record<string, unknown> = {
				'@type': 'Blog',
				'@id': blogUrl + '#blog',
				name: 'Blog',
				url: blogUrl,
				inLanguage: 'en',
				author: { '@type': 'Person', '@id': personNode['@id'] },
				publisher: { '@type': 'Person', '@id': personNode['@id'] },
				isPartOf: websiteRef
			};
			if (props.posts && props.posts.length > 0) {
				blogNode.blogPost = props.posts.map(post => ({
					'@type': 'BlogPosting',
					headline: post.title,
					url: absUrl(post.url),
					datePublished: post.date.toISOString(),
					...(post.image ? { image: absUrl(post.image) } : {})
				}));
			}
			return blogNode;
		}

		if (props.variant === 'blog-post') {
			const postUrl = absUrl(`/blog/${props.anchor}/`);
			const blogRef = { '@type': 'Blog', '@id': origin + '/blog/#blog' };
			return graph(
				{
					'@type': 'BlogPosting',
					'@id': postUrl + '#blogposting',
					headline: props.title,
					url: postUrl,
					inLanguage: 'en',
					datePublished: props.isoDate + 'T16:00:00+00:00',
					...(props.description ? { description: props.description } : {}),
					...(props.image ? { image: absUrl(props.image) } : {}),
					...(props.author ? { author: { '@type': 'Person', name: props.author } } : {}),
					...(props.tags?.length ? { keywords: props.tags.join(', ') } : {}),
					mainEntityOfPage: { '@type': 'WebPage', '@id': postUrl },
					isPartOf: blogRef
				}
			);
		}

		if (props.variant === 'collection') {
			const collectionUrl = absUrl(props.url);
			const node: Record<string, unknown> = {
				'@type': 'CollectionPage',
				'@id': collectionUrl + '#collectionpage',
				name: props.name,
				url: collectionUrl,
				inLanguage: 'en',
				isPartOf: websiteRef,
				...(props.description ? { description: props.description } : {})
			};
			if (props.items && props.items.length > 0) {
				node.hasPart = props.items.map(item => ({
					'@type': 'WebPage',
					name: item.name,
					url: absUrl(item.url),
					...(item.image ? { image: absUrl(item.image) } : {})
				}));
			}
			return node;
		}

		if (props.variant === 'software') {
			const routeUrl = absUrl(props.route);
			return {
				'@context': 'https://schema.org',
				'@type': 'SoftwareApplication',
				'@id': routeUrl + '#software',
				name: props.name,
				url: routeUrl,
				inLanguage: 'en',
				...(props.description ? { description: props.description } : {}),
				...(props.image ? { image: absUrl(props.image) } : {}),
				...(props.url ? { sameAs: props.url } : {}),
				author: { '@type': 'Person', '@id': personNode['@id'] },
				isPartOf: websiteRef
			};
		}

		// variant === 'creative-work'
		const workUrl = absUrl(props.url);
		return {
			'@context': 'https://schema.org',
			'@type': 'CreativeWork',
			'@id': workUrl + '#creativework',
			name: props.name,
			url: workUrl,
			inLanguage: 'en',
			...(props.description ? { description: props.description } : {}),
			...(props.image ? { image: absUrl(props.image) } : {}),
			author: { '@type': 'Person', '@id': personNode['@id'] },
			isPartOf: websiteRef
		};
	});
</script>

<svelte:head>
	{@html `<script type="application/ld+json">${JSON.stringify(schema)}</script>`}
</svelte:head>