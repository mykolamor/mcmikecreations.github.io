<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../api';
	import type { createDocSession } from '../doc-session';
	import { hikeGroups, mergeId, type NearDoc, type NearDuplicateGroup } from './near-duplicates';
	import type { SharedCtx } from './shared';

	// Entries of this hike that another hike (or visit) holds with the same key but other content: merge them into a
	// shared record (the entry to keep, an id), or keep them apart. Read when the tab opens and after each action.
	// `pending`: edits not saved yet, which a merged file's new version would refuse; the merge waits for them.
	let { session, shared, pending }: { session: ReturnType<typeof createDocSession>; shared: SharedCtx; pending: boolean } = $props();

	let groups = $state.raw<NearDuplicateGroup[] | null>(null);
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let busy = $state(false);
	// The open merge: its group, the entry kept as the record and the id.
	let merging = $state.raw<{ group: NearDuplicateGroup; chosen: number; id: string } | null>(null);
	// A group is known by its id (its exact key): two may share a label.
	const open = (g: NearDuplicateGroup) => merging?.group.id === g.id;
	// The id a merge proposes comes from the shared records: none is opened before they are loaded.
	const recordsLoaded = $derived(shared.state() != null);

	const slug = () => session.doc?.slug ?? '';
	async function load() {
		try {
			groups = hikeGroups(await api<NearDuplicateGroup[]>('GET', '/api/facts/near-duplicates'), slug());
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
	onMount(() => void load());

	function openMerge(group: NearDuplicateGroup) {
		[error, notice] = [null, null];
		if (open(group)) return void (merging = null);
		const state = shared.state();
		const doc = session.doc as unknown as NearDoc | null;
		merging = { group, chosen: 0, id: state && doc ? mergeId(group, doc, state) : group.kind === 'stops' ? group.key : '' };
	}

	// `wrote`: the action rewrote files, this doc maybe: read again quietly when no edit is unsaved (the change is the
	// tab's own, not one made elsewhere); with edits unsaved, the freshness check decides.
	async function run(what: () => Promise<unknown>, wrote = false) {
		busy = true;
		[error, notice] = [null, null];
		try {
			await what();
			merging = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			// Written or not, the files may have changed: the doc, the records and the groups are read again (a failed
			// re-read leaves what is shown; the session says so on its next check).
			const quiet = wrote && session.queue.status === 'saved' && !session.queue.pending().length && !session.queue.inFlight().length;
			await Promise.allSettled([quiet ? session.load() : session.checkFresh(), shared.reload(), load()]);
			busy = false;
		}
	}

	function merge() {
		if (!merging) return;
		const { group, chosen, id } = merging;
		const entry = group.entries[chosen];
		void run(async () => {
			const r = await api<{ kept: { file: string; reason: string }[] }>('POST', '/api/facts/near-duplicates/merge', { group: group.id, chosen: { file: entry.file, path: entry.path }, id });
			if (r.kept.length) notice = `Merged; left as they are: ${r.kept.map((k) => `${k.file} (${k.reason})`).join(', ')}`;
		}, true);
	}

	const keep = (group: NearDuplicateGroup) => void run(() => api('POST', '/api/facts/near-duplicates/keep', { kind: group.kind, key: group.key, group: group.id }));
</script>

<section class="near" aria-label="Near-duplicates">
	<h3>Near-duplicates</h3>
	{#if groups === null && !error}
		<p class="note">Reading…</p>
	{:else if groups && !groups.length}
		<p class="note">None for this hike.</p>
	{/if}
	{#each groups ?? [] as group (group.id)}
		<div class="group">
			<p class="what"><b>{group.kind}</b> {group.key}</p>
			<ul>
				{#each group.entries as e, i (`${e.file} ${e.path}`)}
					<li>
						{#if merging && open(group)}
							<label class="pick">
								<input type="radio" name="keep-{group.id}" checked={merging.chosen === i} onchange={() => merging && (merging = { ...merging, chosen: i })} />
								<span><code>{e.file}</code> {e.path}</span>
							</label>
						{:else}
							<span><code>{e.file}</code> {e.path}</span>
						{/if}
						<ul class="diff">
							{#each e.diff as line (line)}<li>{line}</li>{/each}
						</ul>
					</li>
				{/each}
			</ul>
			{#if merging && open(group)}
				<div class="panel">
					<p class="note">The chosen entry becomes the record; every entry takes it and keeps only where it differs.</p>
					<label class="field">
						<span>Record id</span>
						<input value={merging.id} oninput={(e) => merging && (merging = { ...merging, id: e.currentTarget.value })} readonly={group.kind === 'stops'} autocapitalize="none" spellcheck="false" />
					</label>
					<div class="actions">
						<button type="button" disabled={busy || !merging.id || pending || !recordsLoaded} onclick={merge}>Merge</button>
						<button type="button" onclick={() => (merging = null)}>Cancel</button>
					</div>
				</div>
			{/if}
			<div class="actions">
				<button type="button" aria-expanded={open(group)} disabled={busy || !recordsLoaded} onclick={() => openMerge(group)}>Merge into a shared record</button>
				<button type="button" disabled={busy} onclick={() => keep(group)}>Keep apart</button>
			</div>
		</div>
	{/each}
	{#if notice}<p class="note">{notice}</p>{/if}
	{#if error}<p class="refused" role="alert">{error}</p>{/if}
</section>

<style>
	.near {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		padding: 0 0.75rem 0.75rem;
		font-size: 0.85rem;
	}
	h3 {
		margin: 0;
		display: flex;
		align-items: center;
		min-height: 2.75rem;
		font-size: 1rem;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		border-top: 1px solid #eee;
		padding-top: 0.5rem;
	}
	.what {
		margin: 0;
		overflow-wrap: anywhere;
	}
	ul {
		margin: 0;
		padding-left: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		overflow-wrap: anywhere;
	}
	.diff {
		color: #555;
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.75rem;
	}
	.pick input {
		width: 1.25rem;
		height: 1.25rem;
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		border: 1px dashed #999;
		border-radius: 4px;
		padding: 0.5rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.field input {
		font: inherit;
		font-size: 0.95rem;
		box-sizing: border-box;
		min-height: 2.75rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
		min-width: 0;
		background: #fff;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	button {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 0.6rem;
	}
	.note {
		margin: 0;
		color: #555;
	}
	.refused {
		margin: 0;
		color: #b71c1c;
	}
</style>
