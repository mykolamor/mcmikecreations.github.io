<script lang="ts">
	import { monthName } from '$lib/hikes/facts-format';
	import type { Spec } from '$lib/hikes/facts-spec';
	import DateInput from '../components/DateInput.svelte';
	import { localDate } from '../date-utils';
	import FactsField from './FactsField.svelte';
	import PostField from './PostField.svelte';
	import PlaceField from './PlaceField.svelte';
	import SharedRecord from './SharedRecord.svelte';
	import { storeName } from './store-names.svelte';
	import TextField from './TextField.svelte';
	import { REMOVE, type FactsCtx, type Path } from './facts-state';
	import { enumOptions, fieldLabel, hasContent, linkValue, mergeText, textParts, valueText } from './form-model';
	import { byEntry, hideOp, inheritedRows, laid, rowCtx, unhideOp, type Row } from './inherit';
	import { recordCtx, recordIdOf, recordOf } from './shared';

	// One value of the facts form, drawn from its spec; groups and lists draw their members with this same component.
	// `bare`: no label or frame of its own (a section's top value, a list entry under its own header).
	// `inherited`: in "This visit", the hike's value under the post's `value`; under an entry that starts from a shared
	// record (`ctx.inherits`), the record's (with the hike's entry over it, for a hike entry in "This visit").
	let {
		spec,
		path,
		value,
		inherited = undefined,
		ctx,
		bare = false
	}: { spec: Spec; path: Path; value: unknown; inherited?: unknown; ctx: FactsCtx; bare?: boolean } = $props();

	const key = $derived(path[path.length - 1]);
	const name = $derived(typeof key === 'string' ? fieldLabel(key) : `${key + 1}`);
	const str = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? '' : String(v));
	const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
	const set = (v: unknown, debounce: boolean) => ctx.edit(path, v, debounce);
	const typed = (e: Event) => (e.currentTarget as HTMLInputElement).value;

	function setNumber(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		if (el.value === '') set(REMOVE, true);
		// A half-typed number (`-`, `1e`) reads as NaN: nothing is sent until it is one.
		else if (Number.isFinite(el.valueAsNumber)) set(el.valueAsNumber, true);
	}

	function choose(e: Event, options: { value: string | number }[]) {
		const v = typed(e);
		set(v === '' ? REMOVE : (options.find((o) => String(o.value) === v)?.value ?? v), false);
	}

	// A list of months: twelve toggles, the list kept in calendar order.
	const months = $derived(Array.isArray(value) ? (value as number[]) : []);
	function toggleMonth(m: number) {
		const next = months.includes(m) ? months.filter((x) => x !== m) : [...months, m].sort((a, b) => a - b);
		set(next.length ? next : REMOVE, false);
	}

	function setWindow(end: 'from' | 'to', v: string) {
		const w = { from: str(obj(value).from), to: str(obj(value).to), [end]: v };
		set(w.from === '' && w.to === '' ? REMOVE : w, true);
	}
	// `open` set to dates before any is typed: the window inputs show, nothing is written yet.
	let openDates = $state(false);
	const openMode = $derived(typeof value === 'string' ? value : value != null || openDates ? 'dates' : '');
	function chooseOpen(e: Event) {
		const v = typed(e);
		openDates = v === 'dates';
		if (v !== 'dates') set(v === '' ? REMOVE : v, false);
	}

	const link = $derived(typeof value === 'string' ? { url: value, label: undefined } : { url: str(obj(value).url), label: obj(value).label });
	function setLabel(edit: Record<string, string>) {
		const r = mergeText(link.label, edit);
		if ('value' in r) set(linkValue(link.url, r.value) ?? REMOVE, true);
	}

	// A list: one new entry at a time, drawn after the others until its first edit lands in the list.
	const items = $derived(Array.isArray(value) ? value : []);
	let addAt = $state<number | null>(null);
	const rows = $derived(addAt !== null && addAt >= items.length ? [...items, undefined] : items);
	// The new entry landed: it is one of the items now (the same row, so focus stays).
	$effect(() => {
		if (addAt !== null && items.length > addAt) addAt = null;
	});
	// "This visit": a value is the hike's (inherited), the visit's over the hike's (overridden), removed for the visit
	// (`null`), or the visit's own. A group and a list paired by entry show their members' states instead.
	const fromRecord = $derived(ctx.inherits === 'record');
	const visit = $derived(ctx.scope === 'post' || fromRecord);
	const pairs = $derived(visit && spec.t === 'list' && byEntry(spec));
	const fixed = $derived(visit && !!ctx.fixed?.(path));
	const mode = $derived.by(() => {
		if (!visit) return 'own';
		if (value === null) return 'removed';
		if (spec.t === 'obj' || pairs) return 'own';
		if (value === undefined) return hasContent(inherited) ? 'inherited' : 'own';
		return hasContent(inherited) ? 'overridden' : 'own';
	});
	// The visit's value starts equal to the hike's; a text's English only, the other languages still inherited one by one.
	function override() {
		set(spec.t === 'text' ? (textParts(inherited).en ?? structuredClone(inherited)) : structuredClone(inherited), false);
	}

	// A library list (`lib`): each entry may start from a shared record, its `use` or a stop's place.
	const lib = $derived(spec.t === 'list' ? spec.lib : undefined);
	const takes = (e: unknown) => (lib ? recordOf(lib, e, ctx.shared?.state()?.library, ctx.shared?.stops()) : undefined);
	const idOf = (e: unknown) => (lib ? recordIdOf(lib, e, ctx.shared?.stops()) : null);

	// A list paired by entry: the hike's entries with the visit's over them, then the visit's own; `items` is the post's list.
	const visitRows = $derived(
		pairs ? inheritedRows(spec as Extract<Spec, { t: 'list' }>, Array.isArray(inherited) ? inherited : undefined, Array.isArray(value) ? value : undefined, takes) : []
	);
	// The new entry is the last row, where it stays once it lands (the visit's own entries come last), so focus stays.
	const shownRows = $derived<Row[]>(rows.length > items.length ? [...visitRows, { key: '', removed: false, postAt: items.length }] : visitRows);

	// `n`: the entry's number as shown (in "This visit", its row's, not its index in the post).
	function removeRow(i: number, n = i + 1) {
		if (i >= items.length) addAt = null;
		else if (!hasContent(items[i]) || confirm(`Remove entry ${n} of ${name}?`)) {
			// A new entry still blank goes too: the list it was to be added to is changing under it.
			addAt = null;
			ctx.edit([...path, i], REMOVE, false);
		}
	}
</script>

{#snippet windowInputs(w: Record<string, unknown>)}
	<div class="pair">
		<label><span>From</span><input inputmode="numeric" placeholder="MM-DD" maxlength="5" value={str(w.from)} oninput={(e) => setWindow('from', typed(e))} /></label>
		<label><span>To</span><input inputmode="numeric" placeholder="MM-DD" maxlength="5" value={str(w.to)} oninput={(e) => setWindow('to', typed(e))} /></label>
	</div>
{/snippet}

{#snippet editor()}
	{#if spec.t === 'obj'}
		{#if bare}
			<div class="members">
				{#each Object.entries(spec.f) as [k, sub] (k)}
					<FactsField spec={sub} path={[...path, k]} value={obj(value)[k]} inherited={obj(inherited)[k]} {ctx} />
				{/each}
			</div>
		{:else}
			<fieldset class="group">
				<legend>{name}</legend>
				<div class="members">
					{#each Object.entries(spec.f) as [k, sub] (k)}
						<FactsField spec={sub} path={[...path, k]} value={obj(value)[k]} inherited={obj(inherited)[k]} {ctx} />
					{/each}
				</div>
			</fieldset>
		{/if}
	{:else if spec.t === 'list' && spec.of.t === 'month'}
		<div class="field">
			<span class="name">{name}</span>
			<div class="chips">
				{#each Array.from({ length: 12 }, (_, i) => i + 1) as m (m)}
					<button type="button" class="chip" aria-pressed={months.includes(m)} onclick={() => toggleMonth(m)}>{monthName('en', m)}</button>
				{/each}
			</div>
		</div>
	{:else if spec.t === 'list' && pairs}
		<fieldset class="group list">
			{#if !bare}<legend>{name}</legend>{/if}
			{#each shownRows as row, i}
				<div class="entry" class:gone={row.removed} class:new={!row.hike && !row.post}>
					<div class="entry-head">
						<span>{i + 1}<small>{row.removed && !row.hike ? 'hides nothing' : row.removed ? 'hidden for this visit' : !row.hike ? 'this visit only' : row.post ? 'changed for this visit' : 'from the hike'}</small></span>
						{#if row.removed}
							<button type="button" onclick={() => ctx.send(unhideOp(path, row), false)}>Undo</button>
						{:else if row.hike}
							{#if row.post}<button type="button" onclick={() => ctx.send(unhideOp(path, row), false)}>Reset to hike</button>{/if}
							<button type="button" onclick={() => ctx.send(hideOp(spec as Extract<Spec, { t: 'list' }>, path, row), false)}>Hide for this visit</button>
						{:else}
							<button type="button" aria-label="Remove entry {i + 1}" onclick={() => removeRow(row.postAt, i + 1)}>✕</button>
						{/if}
					</div>
					{#if row.removed && !row.hike}
						<!-- As the site warns: the visit hides an entry the hike doesn't have. -->
						<p class="was">`remove` matched no sidecar entry: {valueText(spec.of, row.post, ctx.lang, storeName)}</p>
					{:else if row.removed}
						<s class="was">{valueText(spec.of, row.hike, ctx.lang, storeName)}</s>
					{:else}
						{@const at = [...path, row.postAt]}
						{@const listSpec = spec as Extract<Spec, { t: 'list' }>}
						{#if lib && ctx.shared}
							<SharedRecord kind={lib} entry={row.post} entryPath={at} record={row.record} id={idOf({ ...row.hike, ...row.post })} own={!row.hike} {ctx} />
						{/if}
						<FactsField
							spec={spec.of}
							path={at}
							value={row.post}
							inherited={row.hike ? (row.record ? laid(listSpec, row.record, row.hike) : row.hike) : row.record}
							ctx={row.hike ? rowCtx(ctx, listSpec, path, row) : row.record ? recordCtx(ctx, at, row.post) : ctx}
							bare
						/>
					{/if}
				</div>
			{/each}
			<button type="button" class="add" disabled={rows.length > items.length} onclick={() => (addAt = items.length)}>Add</button>
		</fieldset>
	{:else if spec.t === 'list'}
		<fieldset class="group list">
			{#if !bare}<legend>{name}</legend>{/if}
			{#each rows as item, i}
				{@const record = takes(item)}
				<div class="entry" class:new={i >= items.length}>
					<div class="entry-head">
						<span>{i + 1}</span>
						<button type="button" aria-label="Move up" disabled={i === 0 || i >= items.length} onclick={() => ctx.move(path, items, i, i - 1)}>↑</button>
						<button type="button" aria-label="Move down" disabled={i >= items.length - 1} onclick={() => ctx.move(path, items, i, i + 1)}>↓</button>
						<button type="button" aria-label="Remove entry {i + 1}" onclick={() => removeRow(i)}>✕</button>
					</div>
					{#if lib && ctx.shared}
						<SharedRecord kind={lib} entry={item as Record<string, unknown> | undefined} entryPath={[...path, i]} {record} id={idOf(item)} own {ctx} />
					{/if}
					<FactsField spec={spec.of} path={[...path, i]} value={item} inherited={record} ctx={record ? recordCtx(ctx, [...path, i], item as Record<string, unknown> | undefined) : ctx} bare />
				</div>
			{/each}
			<button type="button" class="add" disabled={rows.length > items.length} onclick={() => (addAt = items.length)}>Add</button>
		</fieldset>
	{:else if spec.t === 'text'}
		<TextField label={bare ? '' : name} {value} inherited={visit ? inherited : undefined} stated={() => ctx.stated(path)} lang={ctx.lang} onedit={(edit, debounce) => set(edit, debounce)} draft={ctx.draft?.has(path) ?? false} ontouch={() => ctx.draft?.clear(path)} />
	{:else if spec.t === 'date'}
		<div class="stamp">
			<DateInput label={bare ? '' : name} value={str(value)} onchange={(v) => set(v === '' ? REMOVE : v, true)} />
			<button type="button" onclick={() => set(localDate(), false)}>Today</button>
		</div>
	{:else if spec.t === 'bool'}
		<label class="field">
			<span class="name">{bare ? '' : name}</span>
			<select value={value === true ? 'yes' : value === false ? 'no' : ''} onchange={(e) => set(typed(e) === '' ? REMOVE : typed(e) === 'yes', false)}>
				<option value="">—</option>
				<option value="yes">Yes</option>
				<option value="no">No</option>
			</select>
		</label>
	{:else if spec.t === 'enum' || spec.t === 'sac'}
		{@const options = enumOptions(spec)}
		<label class="field">
			<span class="name">{bare ? '' : name}</span>
			<select value={str(value)} onchange={(e) => choose(e, options)}>
				<option value="">—</option>
				{#each options as o (o.value)}
					<option value={String(o.value)}>{o.label === String(o.value) ? o.label : `${o.label} (${o.value})`}</option>
				{/each}
				<!-- A value the list lacks (an SAC range, a labelled enum's own word, a typo) still shows. -->
				{#if value != null && !options.some((o) => String(o.value) === str(value))}
					<option value={str(value)}>{str(value)}</option>
				{/if}
			</select>
		</label>
	{:else if spec.t === 'month'}
		<label class="field">
			<span class="name">{bare ? '' : name}</span>
			<select value={str(value)} onchange={(e) => set(typed(e) === '' ? REMOVE : Number(typed(e)), false)}>
				<option value="">—</option>
				{#each Array.from({ length: 12 }, (_, i) => i + 1) as m (m)}
					<option value={String(m)}>{monthName('en', m)}</option>
				{/each}
			</select>
		</label>
	{:else if spec.t === 'num'}
		<label class="field">
			<span class="name">{bare ? '' : name}</span>
			<input type="number" inputmode="decimal" min={spec.min} max={spec.max} step={spec.int ? 1 : 'any'} value={str(value)} oninput={setNumber} />
		</label>
	{:else if spec.t === 'country'}
		<label class="field">
			<span class="name">{bare ? '' : name}</span>
			<input class="short" maxlength="2" autocapitalize="characters" placeholder="DE" value={str(value)} oninput={(e) => set(typed(e) === '' ? REMOVE : typed(e).toUpperCase(), true)} />
		</label>
	{:else if spec.t === 'time'}
		<label class="field">
			<span class="name">{bare ? '' : name}</span>
			<input class="short" inputmode="numeric" maxlength="5" placeholder="HH:MM" value={str(value)} oninput={(e) => set(typed(e) === '' ? REMOVE : typed(e), true)} />
		</label>
	{:else if spec.t === 'window'}
		<div class="field">
			<span class="name">{bare ? '' : name}</span>
			{@render windowInputs(obj(value))}
		</div>
	{:else if spec.t === 'open'}
		<div class="field">
			<label class="field">
				<span class="name">{bare ? '' : name}</span>
				<select value={openMode} onchange={chooseOpen}>
					<option value="">—</option>
					<option value="all-year">All year</option>
					<option value="closed">Closed</option>
					<option value="dates">From … to …</option>
				</select>
			</label>
			{#if openMode === 'dates'}{@render windowInputs(obj(value))}{/if}
		</div>
	{:else if spec.t === 'link'}
		<div class="field">
			<label class="field">
				<span class="name">{bare ? '' : name}</span>
				<input type="url" inputmode="url" placeholder="https://" value={link.url} oninput={(e) => set(linkValue(typed(e), link.label) ?? REMOVE, true)} />
			</label>
			<TextField label="Link text" value={link.label} lang={ctx.lang} onedit={setLabel} draft={ctx.draft?.has([...path, 'label']) ?? false} ontouch={() => ctx.draft?.clear([...path, 'label'])} />
		</div>
	{:else if spec.t === 'place' || spec.t === 'spot' || spec.t === 'gpx'}
		<PlaceField {spec} {path} label={bare ? '' : name} {value} {ctx} onset={set} />
	{:else if spec.t === 'str' && spec.ref === 'post'}
		<PostField label={bare ? '' : name} {value} onset={set} />
	{:else}
		<label class="field">
			<span class="name">{bare ? '' : name}</span>
			<input value={str(value)} oninput={(e) => set(typed(e) === '' ? REMOVE : typed(e), true)} />
		</label>
	{/if}
{/snippet}

{#if fixed && spec.t !== 'obj'}
	<div class="field">
		<span class="name">{bare ? '' : name}</span>
		<div class="current from-hike"><span>{valueText(spec, value ?? inherited, ctx.lang, storeName) || '—'}</span></div>
	</div>
{:else if mode === 'removed'}
	<div class="field">
		<span class="name">{bare ? '' : name}</span>
		<div class="current from-hike">
			<s>{valueText(spec, inherited, ctx.lang, storeName) || '—'}</s>
			<button type="button" onclick={() => set(REMOVE, false)}>Undo</button>
		</div>
	</div>
{:else if mode === 'inherited'}
	<div class="field">
		<span class="name">{bare ? '' : name}</span>
		<div class="current from-hike">
			<span>{valueText(spec, inherited, ctx.lang, storeName)}</span>
			<button type="button" onclick={override}>{spec.t === 'list' && !fromRecord ? 'Own list for this visit' : 'Override'}</button>
			{#if ctx.scope === 'post'}<button type="button" onclick={() => set(null, false)}>Remove for this visit</button>{/if}
		</div>
	</div>
{:else if mode === 'overridden'}
	<div class="overridden">
		{@render editor()}
		<button type="button" onclick={() => set(REMOVE, false)}>{fromRecord ? 'Reset to record' : spec.t === 'list' ? "Use the hike's list" : 'Reset to hike'}</button>
	</div>
{:else}
	{@render editor()}
{/if}

<style>
	.members {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		border: 1px solid #bbb;
		border-radius: 4px;
		margin: 0;
		padding: 0.5rem 0.6rem 0.6rem;
		min-width: 0;
	}
	legend {
		font-size: 0.85rem;
		font-weight: 600;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.85rem;
		min-width: 0;
	}
	.name:empty {
		display: none;
	}
	input,
	select {
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
	.short {
		max-width: 8rem;
	}
	button {
		font: inherit;
		min-height: 2.75rem;
		min-width: 2.75rem;
		padding: 0 0.6rem;
	}
	.pair {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 0.4rem;
	}
	.pair label {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.pair span {
		color: #555;
		font-size: 0.75rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.chip {
		border: 1px solid #888;
		border-radius: 999px;
		background: #fff;
		min-width: 3.5rem;
	}
	.chip[aria-pressed='true'] {
		background: #1b5e20;
		border-color: #1b5e20;
		color: #fff;
	}
	.stamp {
		display: flex;
		align-items: flex-end;
		gap: 0.4rem;
	}
	.stamp > :global(:first-child) {
		flex: 1;
		min-width: 0;
	}
	.entry {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border-top: 1px solid #ddd;
		padding-top: 0.5rem;
	}
	.entry.new {
		border-top-style: dashed;
	}
	.entry-head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.entry-head span {
		flex: 1;
		font-weight: 600;
		font-size: 0.85rem;
	}
	.add {
		align-self: flex-start;
	}
	.current {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.current span,
	.current s {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.from-hike {
		flex-wrap: wrap;
		color: #777;
	}
	.overridden {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
	}
	.overridden > :global(:first-child) {
		align-self: stretch;
	}
	.entry-head small {
		margin-left: 0.5rem;
		font-weight: normal;
		color: #777;
	}
	.entry.gone .was {
		margin: 0;
		color: #777;
		overflow-wrap: anywhere;
	}
</style>
