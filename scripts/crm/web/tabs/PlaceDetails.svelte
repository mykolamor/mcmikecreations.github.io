<script lang="ts">
	import type { createDocSession } from '../doc-session';
	import FieldForm from '../components/FieldForm.svelte';
	import type { Translations } from '../write/translation-session';

	// A place doc's front matter (title, description, tags, aliases); it has no sidecar, files or map.
	let {
		session,
		translations = null,
		openTab
	}: { session: ReturnType<typeof createDocSession>; translations?: Translations | null; openTab?: (id: string, hint?: string | null) => void } = $props();
</script>

<section class="details" aria-label="Details">
	<FieldForm {session} {translations} {openTab} />
</section>

<style>
	.details {
		max-width: 40rem;
	}
</style>
