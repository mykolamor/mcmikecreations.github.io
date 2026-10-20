<script lang="ts">
	import AppMeta from '$lib/components/AppMeta.svelte';
	import AppBreadcrumbs from '$lib/components/AppBreadcrumbs.svelte';
	import AppJsonLd from '$lib/components/AppJsonLd.svelte';
	import ResumeHeader from './ResumeHeader.svelte';
	import ResumeExperience from './ResumeExperience.svelte';
	import ResumePublications from './ResumePublications.svelte';
	import ResumeAwards from './ResumeAwards.svelte';
	import { PrinterSolid, ProfileCardSolid } from 'flowbite-svelte-icons';
	import { Button } from 'flowbite-svelte';
	import resume from '$lib/data/resume.json';

	let { data } = $props();

	// Search snippets cut off around 160 characters, so the terms that matter go first.
	const title = `${resume.basics.name} – Résumé, PhD Researcher at TUM`;
	const description = `${resume.basics.name}: PhD researcher in database systems at TUM, ex Senior Software Engineer at Group107. Databases, GPU, geospatial computing, computer graphics.`;
</script>

<AppMeta {title} hasBaseTitle={false} {description} type="website" />
<AppBreadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Résumé', href: '/resume/' }]} />
<AppJsonLd variant="profile" {description} dateModified={data.dateModified} />

<section class="container mx-auto md:px-24">
	<ResumeHeader />
	<ResumeExperience />
	<ResumePublications />
	<ResumeAwards />
</section>

<Button href="/contact.vcf" pill={true} color="alternative" class="fixed bottom-6 right-24 px-5 py-2.5 text-sm p-3!">
	<ProfileCardSolid class="size-8" />
</Button>
<Button href="/cv.pdf" pill={true} class="fixed bottom-6 right-6 px-5 py-2.5 text-sm p-3!">
	<PrinterSolid class="size-8" />
</Button>
