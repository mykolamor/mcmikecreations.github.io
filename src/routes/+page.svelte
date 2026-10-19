<script lang="ts">
	import BlogSection from './home/BlogSection.svelte';
	import ResumeSection from './home/ResumeSection.svelte';
	import AppMeta from '$lib/components/AppMeta.svelte';
	import resume from '$lib/data/resume.json';
	import HeroMapSection from './home/HeroMapSection.svelte';
	import AppNavbar from '$lib/components/AppNavbar.svelte';
	import ContactSection from './home/ContactSection.svelte';
	import ReferenceSection from './home/ReferenceSection.svelte';
	import ProjectsSection from './home/ProjectsSection.svelte';
	import AppBreadcrumbs from '$lib/components/AppBreadcrumbs.svelte';
	import AppJsonLd from '$lib/components/AppJsonLd.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let pastHero = $state(false);
</script>

<AppMeta title="Home" description={resume.basics.summary} type="website" />
<AppBreadcrumbs items={[{ name: 'Home', href: '/' }]} />
<AppJsonLd variant="website" />

<HeroMapSection bind:pastHero />
<!-- Hidden while the hero's own labels are on screen; slides in once it's scrolled past. -->
<div
	class="fixed inset-x-0 top-0 z-50 transition-transform duration-300 motion-reduce:transition-none {pastHero ? 'translate-y-0' : '-translate-y-full'}"
	inert={!pastHero}
>
	<AppNavbar shouldFixNavbar="false" />
</div>

<main class="container mx-auto md:px-24">
	<ProjectsSection />
	<ResumeSection />
	<ReferenceSection />
	<BlogSection posts={data.blogPosts} />
	<ContactSection />
</main>

<div class="mt-8"></div>
