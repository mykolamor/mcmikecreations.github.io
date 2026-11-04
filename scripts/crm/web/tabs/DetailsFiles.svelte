<script lang="ts">
	import type { createDocSession } from '../doc-session';
	import FieldForm from '../components/FieldForm.svelte';
	import type { Translations } from '../write/translation-session';
	import FilesCards from '../components/FilesCards.svelte';
	import GeneratedCard from '../components/GeneratedCard.svelte';
	import ProblemsPanel from '../components/ProblemsPanel.svelte';

	let {
		session,
		translations = null,
		openTab
	}: { session: ReturnType<typeof createDocSession>; translations?: Translations | null; openTab?: (id: string, hint?: string | null) => void } = $props();

	// Problems are re-checked whenever the doc version changes (saves, uploads, reloads).
	let savedAt = $state<string | null>(null);
	$effect(() => {
		savedAt = session.doc?.version ?? null;
		return session.subscribe(() => (savedAt = session.doc?.version ?? null));
	});
</script>

<div class="details">
	<section class="form-col" aria-label="Details">
		<FieldForm {session} {translations} {openTab} />
		<ProblemsPanel slug={session.slug} date={session.date} refreshKey={savedAt} />
	</section>
	<section class="files-col" data-slot="files-cards" aria-label="Files">
		<FilesCards {session} />
		<GeneratedCard {session} />
	</section>
</div>

<style>
	.details {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;
		align-items: start;
	}
	.form-col {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
	}
	.files-col {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	@media (min-width: 720px) {
		.details {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
</style>
