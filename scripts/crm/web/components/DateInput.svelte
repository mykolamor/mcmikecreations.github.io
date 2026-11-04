<script lang="ts">
	import { isValidDate, maskDate, monthGrid, pad, shiftMonth } from '../date-utils';

	let { value = $bindable(''), label = 'Date', disabled = false, onchange }: { value?: string; label?: string; disabled?: boolean; onchange?: (v: string) => void } = $props();

	let open = $state(false);
	let root: HTMLDivElement;
	const today = new Date();
	let view = $state(
		isValidDate(value)
			? { year: +value.slice(0, 4), month: +value.slice(5, 7) }
			: { year: today.getFullYear(), month: today.getMonth() + 1 }
	);
	let touched = $state(false);
	// No error while a date is still being typed: only when complete-but-wrong, or after leaving the field.
	let invalid = $derived(value !== '' && !isValidDate(value) && (value.length >= 10 || touched));
	let weeks = $derived(monthGrid(view.year, view.month));

	function oninput(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		value = maskDate(el.value);
		el.value = value;
		onchange?.(value);
		if (isValidDate(value)) view = { year: +value.slice(0, 4), month: +value.slice(5, 7) };
	}
	function pick(d: string) {
		value = d;
		open = false;
		onchange?.(d);
	}
	// Esc closes the calendar and returns focus to the input; `suppressOpen` stops that refocus reopening it.
	let suppressOpen = false;
	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || !open) return;
		open = false;
		const input = root.querySelector('input');
		if (input && document.activeElement !== input) {
			suppressOpen = true;
			input.focus();
			suppressOpen = false;
		}
	}
	function onwindow(e: Event) {
		if (open && !root.contains(e.target as Node)) open = false;
	}

	// Keeps the open calendar inside the window: shifted left when it would cross the right edge (a narrow side card),
	// opened above the field when there is no room below but there is above. "The window" is the visible part: the
	// visual viewport (shrunk by a phone's on-screen keyboard), less the bars pinned over it — `data-top-overlay`
	// (the sticky header) and `data-bottom-overlay` (the phone tab bar, the Facts preview sheet) while fixed; a top one fixed or sticky.
	const EDGE = 8;
	function visibleBand(): { top: number; bottom: number } {
		const vv = window.visualViewport;
		let top = vv ? vv.offsetTop : 0;
		let bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
		for (const el of document.querySelectorAll<HTMLElement>('[data-top-overlay], [data-bottom-overlay]')) {
			if (el.contains(root)) continue;
			const pos = getComputedStyle(el).position;
			const r = el.getBoundingClientRect();
			if (!r.height) continue;
			if (el.hasAttribute('data-top-overlay')) {
				if (pos === 'fixed' || pos === 'sticky') top = Math.max(top, r.bottom);
			} else if (pos === 'fixed') bottom = Math.min(bottom, r.top); // the desktop Facts preview is sticky in its column: not over anything
		}
		return { top, bottom };
	}
	let cal = $state<HTMLDivElement>();
	let shiftX = $state(0);
	let above = $state(false);
	function place() {
		if (!cal) return;
		const r = root.getBoundingClientRect();
		const vw = document.documentElement.clientWidth;
		const band = visibleBand();
		const w = cal.offsetWidth;
		const h = cal.offsetHeight;
		let x = Math.min(0, vw - EDGE - w - r.left);
		if (r.left + x < EDGE) x = EDGE - r.left;
		shiftX = x;
		above = r.bottom + h > band.bottom - EDGE && r.top - h >= band.top + EDGE;
	}
	$effect(() => {
		if (!open || !cal) return;
		place();
		// The keyboard opening (or closing) resizes only the visual viewport on phones, not the window.
		const vv = window.visualViewport;
		vv?.addEventListener('resize', place);
		return () => vv?.removeEventListener('resize', place);
	});
</script>

<svelte:window onpointerdown={onwindow} onresize={() => open && place()} />

<div class="date" bind:this={root} onkeydown={onkeydown} role="presentation">
	<label>
		<span>{label}</span>
		<input
			type="text"
			inputmode="numeric"
			placeholder="YYYY-MM-DD"
			maxlength="10"
			autocomplete="off"
			{value}
			{disabled}
			{oninput}
			onfocus={() => {
				if (!suppressOpen) open = true;
				touched = false;
			}}
			onclick={() => (open = true)}
			onblur={() => (touched = true)}
			aria-invalid={invalid}
		/>
	</label>
	{#if invalid}<span class="err" role="alert">Use YYYY-MM-DD</span>{/if}
	{#if open}
		<div class="cal" class:above bind:this={cal} style:translate={`${shiftX}px 0`} role="dialog" aria-label="Calendar">
			<div class="nav">
				<button type="button" aria-label="Previous month" onclick={() => (view = shiftMonth(view.year, view.month, -1))}>‹</button>
				<strong>{view.year}-{pad(view.month)}</strong>
				<button type="button" aria-label="Next month" onclick={() => (view = shiftMonth(view.year, view.month, 1))}>›</button>
			</div>
			<div class="grid head">
				{#each ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as w}<span>{w}</span>{/each}
			</div>
			{#each weeks as week}
				<div class="grid">
					{#each week as d}
						{#if d}
							<button type="button" class="day" aria-pressed={d === value} aria-label={d} onclick={() => pick(d)}>{+d.slice(8)}</button>
						{:else}
							<span></span>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.date {
		position: relative;
		display: inline-block;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.85rem;
	}
	input {
		font: inherit;
		min-height: 2.75rem;
		box-sizing: border-box;
		width: 10rem;
		padding: 0 0.5rem;
		border: 1px solid #888;
		border-radius: 4px;
	}
	input[aria-invalid='true'] {
		border: 2px solid #111;
	}
	.err {
		font-size: 0.8rem;
	}
	.cal {
		position: absolute;
		z-index: 10;
		top: 100%;
		left: 0;
		background: #fff;
		border: 1px solid #111;
		border-radius: 4px;
		padding: 0.4rem;
		width: calc(7 * 2.75rem + 0.8rem);
		max-width: calc(100vw - 2rem);
	}
	.cal.above {
		top: auto;
		bottom: 100%;
	}
	.nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		text-align: center;
	}
	.head span {
		font-size: 0.75rem;
		padding: 0.2rem 0;
	}
	.day {
		min-height: 2.75rem;
		min-width: 0;
		padding: 0;
		border-color: transparent;
		background: #fff;
	}
	.day[aria-pressed='true'] {
		border: 2px solid #111;
		font-weight: 700;
		text-decoration: underline;
	}
</style>
