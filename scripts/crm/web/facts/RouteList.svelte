<script lang="ts">
	import type { Spec } from '$lib/hikes/facts-spec';
	import FactsField from './FactsField.svelte';
	import { storeName } from './store-names.svelte';
	import { REMOVE, type FactsCtx, type Path } from './facts-state';
	import { fieldLabel, hasContent, valueText } from './form-model';
	import { hideOp, inheritedRows, nest, rowCtx, unhideOp, type Row } from './inherit';
	import { chained, insertOp, mergedBefore, routeRows, selectionAfterInsert, selectionAfterMove, selectionAfterRemove, toggleOps, visitLegs, type Leg } from './route-list';

	type ListSpec = Extract<Spec, { t: 'list' }>;

	// The route list (`legs`): a table of its entries, the selected one's fields in the form below it.
	// `selected`: the selected entry's index in the scope's merged list (the hike's in "Hike defaults"), as `onselect` gives it.
	let {
		spec,
		value,
		inherited = undefined,
		ctx,
		selected,
		onselect
	}: { spec: ListSpec; value: unknown; inherited?: unknown; ctx: FactsCtx; selected: number | null; onselect: (index: number | null) => void } = $props();

	const path: Path = ['legs'];
	const fields = $derived(Object.entries((spec.of as Extract<Spec, { t: 'obj' }>).f).filter(([k]) => k !== 'inTable' && k !== 'onProfile'));
	const COLUMNS = ['sac', 'viaFerrata', 'climbing', 'terrain', 'marking', 'optional', 'note'];
	const obj = (v: unknown): Leg => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Leg) : {});
	const visit = $derived(ctx.scope === 'post');
	const items = $derived(Array.isArray(value) ? value : []);

	// A row as shown: its entry (in "This visit", the hike's with the visit's over it), where its edits go in the scope's
	// list (`at`), its index in the merged list (null when hidden), and whether it is the scope's own (its toggles,
	// order and removal editable; a hike entry in "This visit" has Hide and Reset instead).
	type Shown = { row?: Row; entry: Leg; at: number; merged: number | null; own: boolean };
	const shown = $derived.by<Shown[]>(() => {
		if (!visit) return items.map((e, i) => ({ entry: obj(e), at: i, merged: i, own: true }));
		const rows = inheritedRows(spec, Array.isArray(inherited) ? inherited : undefined, items);
		const legs = visitLegs(spec, rows);
		let k = 0;
		return rows.map((row) =>
			row.removed ? { row, entry: row.hike ?? row.post ?? {}, at: row.postAt, merged: null, own: !row.hike } : { row, entry: legs[k], at: row.postAt, merged: k++, own: !row.hike }
		);
	});
	const merged = $derived(shown.filter((s) => s.merged !== null).map((s) => s.entry));
	const chain = $derived(chained(merged));
	const ends = $derived(routeRows(merged, storeName));
	const movable = $derived(shown.filter((s) => s.own && s.merged !== null));
	const inTable = (leg: Leg) => leg.inTable !== false;

	// A new entry: shown blank at its place until its first edit lands, which inserts it with that value.
	let adding = $state<{ at: number; merged: number; after: number; count: number } | null>(null);
	const landed = $derived(adding !== null && items.length > adding.count);
	$effect(() => {
		if (landed) adding = null;
	});
	function add(after: number, s?: Shown) {
		adding = s ? { at: s.at + 1, merged: s.merged! + 1, after, count: items.length } : { at: items.length, merged: merged.length, after, count: items.length };
		onselect(null);
	}
	function addCtx(a: NonNullable<typeof adding>): FactsCtx {
		return {
			...ctx,
			edit: (p, v, debounce) => {
				// Nothing to remove from an entry not written yet.
				if (v === REMOVE) return;
				const [field, ...rest] = p.slice(path.length + 1);
				ctx.send(insertOp(ctx.scope, items, a.at, { [String(field)]: nest(rest, v) }), debounce);
				onselect(a.merged);
			}
		};
	}

	function select(s: Shown) {
		adding = null;
		onselect(selected === s.merged ? null : s.merged);
	}
	function toggle(s: Shown, flag: 'inTable' | 'onProfile', on: boolean) {
		for (const op of toggleOps(ctx.scope, s.at, flag, on, chain[s.merged!])) ctx.send(op, false);
	}
	// Moves among the scope's own entries; the selection follows its entry (the moved one, or one it passed).
	function move(s: Shown, by: -1 | 1) {
		const other = movable[movable.indexOf(s) + by];
		ctx.move(path, items, s.at, other.at);
		onselect(selectionAfterMove(selected, s.merged!, other.merged!));
	}
	function remove(s: Shown, n: number) {
		if (hasContent(items[s.at]) && !confirm(`Remove entry ${n} of the route list?`)) return;
		adding = null;
		onselect(selectionAfterRemove(selected, s.merged!));
		ctx.edit([...path, s.at], REMOVE, false);
	}
	// Hiding a hike entry takes its row out of the merged list; undoing it puts the row back where it was.
	function hide(s: Shown) {
		onselect(selectionAfterRemove(selected, s.merged!));
		ctx.send(hideOp(spec, path, s.row!), false);
	}
	function unhide(s: Shown) {
		if (s.row!.removed && s.row!.hike) onselect(selectionAfterInsert(selected, mergedBefore(shown, shown.indexOf(s))));
		ctx.send(unhideOp(path, s.row!), false);
	}
	function rowState(s: Shown): string {
		if (!s.row) return '';
		if (s.row.removed) return s.row.hike ? 'hidden for this visit' : 'hides nothing';
		return !s.row.hike ? 'this visit only' : s.row.post ? 'changed for this visit' : 'from the hike';
	}
	const newFrom = $derived(adding ? routeRows([...merged.slice(0, adding.merged), {}], storeName).at(-1)!.from : '');

	// The form below the table: the new entry, or the selected one (a hike entry in "This visit" edits the visit's over it).
	const form = $derived.by(() => {
		if (adding && !landed) return { title: 'New entry', at: adding.at, value: undefined, inherited: undefined, ctx: addCtx(adding), from: newFrom, table: true };
		const s = shown.find((x) => x.merged !== null && x.merged === selected);
		if (!s) return null;
		const end = ends[s.merged!];
		const fieldsCtx = s.row?.hike ? rowCtx(ctx, spec, path, s.row) : ctx;
		return { title: `${end.from} → ${end.to || '?'}`, at: s.at, value: s.row ? s.row.post : s.entry, inherited: s.row?.hike, ctx: fieldsCtx, from: end.from, table: inTable(s.entry) };
	});
</script>

{#snippet toggles(s: Shown)}
	{@const on = { inTable: inTable(s.entry), onProfile: s.entry.onProfile === true || !inTable(s.entry) }}
	<td class="flag">
		<!-- Back into the table needs a `to`; in "This visit" a hike entry's toggles are its identity. -->
		<button type="button" class="toggle" aria-pressed={on.inTable} disabled={!s.own || (!on.inTable && s.entry.to == null)} onclick={() => toggle(s, 'inTable', !on.inTable)}>
			In table
		</button>
	</td>
	<td class="flag">
		<!-- An entry off the table is on the profile, or it shows nowhere. -->
		<button type="button" class="toggle" aria-pressed={on.onProfile} disabled={!s.own || !on.inTable} onclick={() => toggle(s, 'onProfile', !on.onProfile)}>On profile</button>
	</td>
{/snippet}

{#snippet newRow()}
	<tr class="new">
		<td colspan="12">New entry: its first value in the form below adds it</td>
	</tr>
{/snippet}

<div class="route-list">
	{#if visit && value === null}
		<div class="current from-hike">
			<s>{valueText(spec, inherited, ctx.lang, storeName) || '—'}</s>
			<button type="button" onclick={() => ctx.edit(path, REMOVE, false)}>Undo</button>
		</div>
	{:else}
		{#if shown.length || adding}
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th>#</th>
							<th>From → to</th>
							{#each COLUMNS as c (c)}<th>{fieldLabel(c)}</th>{/each}
							<th>In table</th>
							<th>On profile</th>
							<th><span class="sr">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#if adding?.after === -1}{@render newRow()}{/if}
						{#each shown as s, i}
							<tr class:gone={s.merged === null} class:selected={s.merged !== null && s.merged === selected}>
								<td class="n">{i + 1}</td>
								<td class="span">
									{#if s.merged === null}
										<s>{valueText(spec.of, s.entry, ctx.lang, storeName)}</s>
									{:else}
										<button type="button" class="pick" aria-pressed={s.merged === selected} onclick={() => select(s)}>
											{ends[s.merged].from} → {ends[s.merged].to || '?'}
										</button>
									{/if}
									{#if rowState(s)}<small>{rowState(s)}</small>{/if}
								</td>
								{#each COLUMNS as c (c)}
									<td data-label={fieldLabel(c)}>{s.merged === null ? '' : valueText(spec.of.t === 'obj' ? spec.of.f[c] : undefined, s.entry[c], ctx.lang, storeName)}</td>
								{/each}
								{#if s.merged === null}
									<td></td>
									<td></td>
								{:else}
									{@render toggles(s)}
								{/if}
								<td class="actions">
									{#if s.row?.removed}
										<button type="button" onclick={() => unhide(s)}>Undo</button>
									{:else if s.row?.hike}
										{#if s.row.post}<button type="button" onclick={() => ctx.send(unhideOp(path, s.row!), false)}>Reset to hike</button>{/if}
										<button type="button" onclick={() => hide(s)}>Hide for this visit</button>
									{:else}
										<button type="button" aria-label="Move up" disabled={movable.indexOf(s) <= 0} onclick={() => move(s, -1)}>↑</button>
										<button type="button" aria-label="Move down" disabled={movable.indexOf(s) >= movable.length - 1} onclick={() => move(s, 1)}>↓</button>
										<button type="button" aria-label="Add after entry {i + 1}" disabled={adding !== null} onclick={() => add(i, s)}>+</button>
										<button type="button" aria-label="Remove entry {i + 1}" onclick={() => remove(s, i + 1)}>✕</button>
									{/if}
								</td>
							</tr>
							{#if adding?.after === i}{@render newRow()}{/if}
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="note">No entries yet.</p>
		{/if}
		<button type="button" class="add" disabled={adding !== null} onclick={() => add(shown.length - 1)}>Add</button>

		{#if form}
			<fieldset class="entry">
				<legend>{form.title}</legend>
				{#each fields as [k, sub] (k)}
					{#if k === 'from' && form.table}
						<!-- A table entry starts where the previous one ended. -->
						<div class="field">
							<span class="name">From</span>
							<div class="current from-hike"><span>{form.from} (where the previous table entry ends)</span></div>
						</div>
					{:else}
						<FactsField spec={sub} path={[...path, form.at, k]} value={obj(form.value)[k]} inherited={obj(form.inherited)[k]} ctx={form.ctx} />
					{/if}
				{/each}
			</fieldset>
		{/if}
	{/if}
</div>

<style>
	.route-list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		font-size: 0.85rem;
		width: 100%;
	}
	th,
	td {
		border-bottom: 1px solid #ddd;
		padding: 0.25rem 0.35rem;
		text-align: left;
		vertical-align: middle;
	}
	th {
		font-weight: 600;
		white-space: nowrap;
	}
	tr.selected {
		background: #e8f5e9;
	}
	tr.gone td {
		color: #777;
	}
	tr.new td {
		border-bottom-style: dashed;
	}
	.span small {
		display: block;
		color: #777;
	}
	button {
		font: inherit;
		min-height: 2.75rem;
		min-width: 2.75rem;
		padding: 0 0.6rem;
	}
	.pick {
		text-align: left;
		background: none;
		border: 1px solid transparent;
		border-radius: 4px;
	}
	.pick[aria-pressed='true'] {
		border-color: #1b5e20;
	}
	.toggle {
		white-space: nowrap;
		border: 1px solid #888;
		border-radius: 999px;
		background: #fff;
	}
	.toggle[aria-pressed='true'] {
		background: #1b5e20;
		border-color: #1b5e20;
		color: #fff;
	}
	.toggle:disabled {
		opacity: 0.6;
	}
	.actions {
		white-space: nowrap;
	}
	.add {
		align-self: flex-start;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.entry {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
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
	.note {
		margin: 0;
		color: #555;
		font-size: 0.9rem;
	}
	/* On a phone each row is a card: its cells stacked, each with its column's name. */
	@media (max-width: 40rem) {
		table,
		tbody,
		tr,
		td {
			display: block;
		}
		thead {
			display: none;
		}
		tr {
			border: 1px solid #ccc;
			border-radius: 4px;
			padding: 0.3rem 0.5rem;
			margin-bottom: 0.5rem;
		}
		td {
			border: none;
			padding: 0.15rem 0;
		}
		td[data-label] {
			display: flex;
			align-items: center;
			gap: 0.5rem;
		}
		td[data-label]::before {
			content: attr(data-label);
			flex: 0 0 6.5rem;
			color: #555;
		}
		td[data-label]:empty {
			display: none;
		}
		td.n {
			font-weight: 600;
		}
		td.flag {
			display: inline-block;
			margin-right: 0.3rem;
		}
		.actions {
			display: flex;
			flex-wrap: wrap;
			gap: 0.3rem;
		}
	}
</style>
