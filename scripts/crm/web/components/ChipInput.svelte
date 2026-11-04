<script lang="ts">
	let {
		label,
		values,
		suggestions = [],
		disabled = false,
		onchange
	}: {
		label: string;
		values: string[];
		suggestions?: string[];
		disabled?: boolean;
		onchange: (next: string[]) => void;
	} = $props();

	let text = $state('');
	let focused = $state(false);
	let active = $state(-1);
	const listId = `chips-${Math.random().toString(36).slice(2, 8)}`;

	let matches = $derived.by(() => {
		const q = text.trim().toLowerCase();
		const have = new Set(values.map((v) => v.toLowerCase()));
		return suggestions.filter((s) => !have.has(s.toLowerCase()) && (!q || s.toLowerCase().includes(q))).slice(0, 8);
	});
	let open = $derived(focused && matches.length > 0);

	function add(v: string) {
		const s = v.trim();
		text = '';
		active = -1;
		if (!s || values.some((x) => x.toLowerCase() === s.toLowerCase())) return;
		onchange([...values, s]);
	}
	function remove(i: number) {
		onchange(values.filter((_, j) => j !== i));
	}
	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' && matches.length) {
			e.preventDefault();
			active = (active + 1) % matches.length;
		} else if (e.key === 'ArrowUp' && matches.length) {
			e.preventDefault();
			active = (active - 1 + matches.length) % matches.length;
		} else if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			if (open && active >= 0) add(matches[active]);
			else add(text);
		} else if (e.key === 'Escape') {
			active = -1;
			focused = false;
		} else if (e.key === 'Backspace' && !text && values.length) {
			remove(values.length - 1);
		}
	}
</script>

<div class="chips">
	<span class="label" id={`${listId}-l`}>{label}</span>
	<div class="box">
		<ul class="list" aria-labelledby={`${listId}-l`}>
			{#each values as v, i (v)}
				<li>
					<span class="chip">{v}</span><button type="button" class="x" aria-label={`Remove ${v}`} {disabled} onclick={() => remove(i)}>×</button>
				</li>
			{/each}
		</ul>
		<div class="entry">
			<input
				type="text"
				autocomplete="off"
				aria-label={`Add ${label.toLowerCase()}`}
				aria-controls={listId}
				aria-expanded={open}
				aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
				role="combobox"
				{disabled}
				bind:value={text}
				oninput={() => (active = -1)}
				onfocus={() => (focused = true)}
				onblur={() => setTimeout(() => (focused = false), 150)}
				{onkeydown}
			/>
			{#if text.trim()}
				<button type="button" class="addbtn" {disabled} onclick={() => add(text)}>Add</button>
			{/if}
		</div>
		{#if open}
			<ul class="menu" id={listId} role="listbox">
				{#each matches as m, i (m)}
					<li role="option" id={`${listId}-${i}`} aria-selected={i === active}>
						<button type="button" tabindex="-1" onpointerdown={(e) => e.preventDefault()} onclick={() => add(m)}>{m}</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.chips {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.85rem;
	}
	.box {
		position: relative;
		border: 1px solid #888;
		border-radius: 4px;
		padding: 0.25rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.list li {
		display: flex;
		align-items: center;
		border: 1px solid #555;
		border-radius: 1.4rem;
		background: #f4f4f4;
	}
	.chip {
		padding: 0 0.3rem 0 0.75rem;
		font-size: 1rem;
	}
	.x {
		min-width: 2.75rem;
		min-height: 2.75rem;
		border: none;
		border-radius: 0 1.4rem 1.4rem 0;
		background: transparent;
		font-size: 1.3rem;
		padding: 0;
	}
	.entry {
		display: flex;
		gap: 0.25rem;
		margin-top: 0.25rem;
	}
	input {
		flex: 1;
		min-width: 0;
		min-height: 2.75rem;
		box-sizing: border-box;
		font: inherit;
		padding: 0 0.5rem;
		border: 1px solid #bbb;
		border-radius: 4px;
	}
	.menu {
		position: absolute;
		z-index: 10;
		left: 0;
		right: 0;
		top: 100%;
		background: #fff;
		border: 1px solid #111;
		border-radius: 4px;
		max-height: 16rem;
		overflow: auto;
	}
	.menu button {
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		border-radius: 0;
	}
	.menu li[aria-selected='true'] button {
		background: #111;
		color: #fff;
	}
</style>
