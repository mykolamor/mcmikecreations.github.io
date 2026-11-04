<script lang="ts">
	import { api } from '../api';
	import { refParams } from '../doc-session';
	import type { Problem } from '../../server/problems';
	import type { DocRef } from '../../server/doc-ref';

	/** A hike's or post's problems by `slug`/`date`, or any doc's (a translation's) by `ref`. */
	let { slug = '', date = null, ref = null, refreshKey }: { slug?: string; date?: string | null; ref?: DocRef | null; refreshKey: unknown } = $props();

	let problems = $state<Problem[]>([]);
	let failed = $state<string | null>(null);

	$effect(() => {
		void refreshKey;
		const q = new URLSearchParams(ref ? refParams(ref) : date ? { slug, date } : { slug });
		let stale = false;
		api<{ problems: Problem[] }>('GET', `/api/problems?${q}`)
			.then((r) => {
				if (stale) return;
				problems = r.problems;
				failed = null;
			})
			.catch((e) => !stale && (failed = String(e.message ?? e)));
		return () => (stale = true);
	});
	let what = $derived(ref?.kind === 'translation' ? 'translation' : 'hike');
	let own = $derived(problems.filter((p) => p.level !== 'site'));
	let site = $derived(problems.filter((p) => p.level === 'site'));
</script>

<details class="problems" open={own.length > 0}>
	<summary>Problems <span class="badge" aria-label={`${own.length} problems`}>{own.length}</span></summary>
	{#if failed}
		<p>Could not check: {failed}</p>
	{:else}
		{#if own.length === 0}
			<p>No problems with this {what}.</p>
		{:else}
			<ul>
				{#each own as p}
					<li><strong>{p.level === 'error' ? 'Error' : 'Warning'}:</strong> {p.message}</li>
				{/each}
			</ul>
		{/if}
		{#if site.length}
			<h3>Site-wide (not this {what})</h3>
			<ul>
				{#each site as p}
					<li>{p.message}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</details>

<style>
	.problems {
		border: 1px solid #888;
		border-radius: 4px;
		padding: 0 0.75rem;
	}
	summary {
		min-height: 2.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-weight: 600;
	}
	.badge {
		border: 1px solid #111;
		border-radius: 1rem;
		padding: 0 0.5rem;
		font-size: 0.85rem;
	}
	ul {
		margin: 0 0 0.75rem;
		padding-left: 1.2rem;
	}
	h3 {
		margin: 0.5rem 0 0.25rem;
		font-size: 0.9rem;
	}
	p {
		margin: 0 0 0.75rem;
	}
</style>
