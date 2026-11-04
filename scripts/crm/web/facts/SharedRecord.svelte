<script lang="ts">
	import { RECORDS, type LibraryKind } from '$lib/hikes/facts-spec';
	import FactsField from './FactsField.svelte';
	import { storeName } from './store-names.svelte';
	import type { FactsCtx, Path } from './facts-state';
	import { hasContent, normaliseTexts } from './form-model';
	import { changesText, filterRecords, idProblem, newRecordId, newRecordOps, recordEdit, recordLabel, recordSession, recordUsers, refreshSession, type RecordSession } from './shared';
	import { at } from '../../shared/tree';
	import FillButton from '../fill/FillButton.svelte';
	import { drafts } from '../fill/drafts.svelte';
	import { gatherRecord, type FillResult } from '../fill/fill';

	type Entry = Record<string, unknown>;

	// The shared record of one entry of a library list: which it starts from and how many hikes use it, with "Edit shared
	// record"; on an entry of the scope's own (`own`), also "Use a shared record" and "New shared record". The record's
	// values show under the entry as inherited (FactsField, recordCtx).
	let {
		kind,
		entry,
		entryPath,
		record,
		id,
		own,
		ctx
	}: { kind: LibraryKind; entry: Entry | undefined; entryPath: Path; record: Entry | undefined; id: string | null; own: boolean; ctx: FactsCtx } = $props();

	const shared = $derived(ctx.shared!);
	const lib = $derived(shared.state());
	const users = (rid: string) => recordUsers(lib?.usage ?? {}, kind, rid);
	const usedBy = (rid: string) => {
		const n = users(rid).hikes;
		return `used by ${n} hike${n === 1 ? '' : 's'}`;
	};

	let error = $state<string | null>(null);
	let busy = $state(false);
	let panel = $state<'pick' | 'new' | 'edit' | null>(null);
	function toggle(p: 'pick' | 'new' | 'edit') {
		error = null;
		panel = panel === p ? null : p;
		if (panel === 'new' && lib) newId = newRecordId(kind, entry ?? {}, lib, shared.stops());
		// The usage as it is now: another doc may have taken the record since the tab loaded it.
		if (panel === 'new') void shared.reload();
		if (panel === 'edit' && lib && id) {
			const rid = id;
			const opened = (edit = recordSession(lib, kind, rid));
			// The open's reload: an untouched draft takes the record and version as they are now.
			void shared.reload().then((fresh) => {
				if (fresh && edit === opened) edit = refreshSession(opened, fresh, kind, rid);
			});
		}
	}

	// Use a shared record: a stop takes the record of its place, so it is given that place.
	let query = $state('');
	const choices = $derived(lib && panel === 'pick' ? filterRecords(kind, lib.library, query, storeName) : []);
	function pick(rid: string) {
		ctx.edit([...entryPath, kind === 'stops' ? 'at' : 'use'], kind === 'stops' ? { ref: rid } : rid, false);
		panel = null;
	}

	async function put(rid: string, value: Entry | null): Promise<boolean> {
		busy = true;
		error = await shared.put(kind, rid, value);
		busy = false;
		return error === null;
	}

	// New shared record: the entry's fields move into it, the entry keeps `use` (a stop, its place).
	let newId = $state('');
	const newProblem = $derived(lib ? idProblem(kind, newId, lib) : 'The shared records are not loaded');
	// A record no doc uses (left by an earlier try whose entry wasn't saved) is replaced.
	const replaces = $derived(!newProblem && !!lib && Object.hasOwn(lib.library[kind], newId));
	async function create() {
		if (newProblem || !entry) return;
		const { record: made, ops } = newRecordOps(kind, newId, entryPath, entry, ctx.scope);
		if (!(await put(newId, made))) return;
		for (const op of ops) ctx.send(op, false);
		panel = null;
	}

	// Edit shared record: the record in the same form, saved whole; one that more hikes use asks first.
	// The draft and the library version it was copied from, which its save is made on (a change elsewhere since: 409).
	let edit = $state.raw<RecordSession | null>(null);
	const draft = $derived(edit?.draft ?? {});
	const draftCtx: FactsCtx = $derived({
		lang: ctx.lang,
		scope: 'hike',
		edit: (p, v) => {
			const r = recordEdit(kind, draft, p, v);
			if ('error' in r) error = r.error;
			else if (edit) [edit, error] = [{ ...edit, draft: r.record, touched: true }, null];
		},
		send: () => {},
		move: (p, list, from, to) => {
			const next = [...list];
			next.splice(to, 0, ...next.splice(from, 1));
			const r = recordEdit(kind, draft, p, next);
			if ('record' in r && edit) edit = { ...edit, draft: r.record, touched: true };
		},
		stated: (p) => [at(record, p), at(draft, p)].filter((v) => v != null),
		doc: ctx.doc,
		draft: {
			has: (p) => drafts.has(draftScope, JSON.stringify(p)),
			clear: (p) => drafts.clear(draftScope, JSON.stringify(p))
		}
	});

	// "Fill empty from English" changes the draft, which the author then saves as usual; its texts are DeepL drafts until edited.
	const draftScope = $derived(`record:${kind}/${id}`);
	function commitFill(r: FillResult<unknown>) {
		if (!edit || !r.applied.length) return;
		edit = { ...edit, draft: r.state as Entry, touched: true };
		drafts.add(draftScope, r.applied);
	}
	async function save() {
		if (!id || !edit) return;
		const { base, draft: saved } = edit;
		// The usage as it is now, for the question only: the save stays on the draft's own version.
		busy = true;
		const fresh = await shared.reload();
		busy = false;
		if (!fresh) return void (error = 'The shared records could not be read again; nothing was saved');
		const question = changesText(recordUsers(fresh.usage, kind, id));
		if (question && !confirm(`${question}. Save?`)) return;
		busy = true;
		error = await shared.put(kind, id, normaliseTexts(RECORDS[kind], saved) as Entry, base);
		busy = false;
		// Refused (changed elsewhere): the draft stays open, with the message.
		if (error === null) [panel, edit] = [null, null];
	}
</script>

<div class="shared">
	<div class="line">
		<span class="what">
			{#if record && id}
				Shared record <b>{recordLabel(kind, id, record, storeName)}</b>, {usedBy(id)}
			{:else if id && kind !== 'stops'}
				No shared record "{id}"
			{:else}
				No shared record
			{/if}
		</span>
		{#if record && id}
			<button type="button" aria-expanded={panel === 'edit'} onclick={() => toggle('edit')}>Edit shared record</button>
		{/if}
		{#if own}
			<button type="button" aria-expanded={panel === 'pick'} disabled={!lib} onclick={() => toggle('pick')}>Use a shared record</button>
			{#if !record && hasContent(entry)}
				<button type="button" aria-expanded={panel === 'new'} disabled={!lib} onclick={() => toggle('new')}>New shared record</button>
			{/if}
		{/if}
	</div>

	{#if panel === 'pick'}
		<div class="panel">
			<input type="search" placeholder="Filter records" aria-label="Filter records" bind:value={query} />
			{#if !choices.length}<p class="note">No {kind} record{query ? ' matches' : ' yet'}.</p>{/if}
			<ul>
				{#each choices as c (c.id)}
					<li>
						<button type="button" class="choice" onclick={() => pick(c.id)}>
							<span>{c.label}</span>
							<small>{usedBy(c.id)}</small>
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{:else if panel === 'new'}
		<div class="panel">
			<label class="field">
				<span>Record id</span>
				<input bind:value={newId} readonly={kind === 'stops'} autocapitalize="none" spellcheck="false" />
			</label>
			{#if newProblem}<p class="note">{newProblem}</p>{:else if replaces}<p class="note">Replaces the record "{newId}", which no hike uses.</p>{/if}
			<p class="note">The entry's fields move into the record; the entry keeps {kind === 'stops' ? 'its place' : `"use: ${newId}"`}.</p>
			<div class="actions">
				<button type="button" disabled={!!newProblem || busy} onclick={create}>Create</button>
				<button type="button" onclick={() => (panel = null)}>Cancel</button>
			</div>
		</div>
	{:else if panel === 'edit' && id}
		<div class="panel record">
			<p class="note">Shared record "{id}", {usedBy(id)}{users(id).docs.length ? `: ${users(id).docs.join(', ')}` : ''}</p>
			<FillButton
				doc={draftScope}
				surface="record"
				lang={ctx.lang === 'en' ? null : ctx.lang}
				gather={() => (ctx.lang === 'en' ? [] : gatherRecord(draft, ctx.lang, kind))}
				current={() => draft}
				commit={commitFill}
				blocked={() => (edit ? null : 'The shared record’s form was closed meanwhile')} />
			<FactsField spec={RECORDS[kind]} path={[]} value={draft} ctx={draftCtx} bare />
			<div class="actions">
				<button type="button" disabled={busy} onclick={save}>Save shared record</button>
				<button type="button" onclick={() => (panel = null)}>Cancel</button>
			</div>
		</div>
	{/if}
	{#if error}<p class="refused" role="alert">{error}</p>{/if}
</div>

<style>
	.shared {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-size: 0.85rem;
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.what {
		flex: 1 1 12rem;
		min-width: 0;
		color: #555;
		overflow-wrap: anywhere;
	}
	button {
		font: inherit;
		min-height: 2.75rem;
		min-width: 2.75rem;
		padding: 0 0.6rem;
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		border: 1px dashed #999;
		border-radius: 4px;
		padding: 0.5rem;
	}
	.panel.record {
		border-style: solid;
		border-color: #1b5e20;
	}
	input {
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
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 16rem;
		overflow-y: auto;
	}
	.choice {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		text-align: left;
	}
	.choice small {
		color: #555;
		white-space: nowrap;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
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
