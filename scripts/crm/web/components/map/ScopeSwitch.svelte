<script lang="ts">
	import { currentValue, scopeOf, setField, type EditSession } from '../../map/tools/scope';
	import { confirmOverrideOff, overrideOps } from '../../map/view-ops';

	let { session, field, rev, label = 'This post only', onnote }: { session: EditSession & { date: string | null }; field: string; rev: number; label?: string; onnote?: (text: string) => void } = $props();

	const on = $derived.by(() => {
		void rev;
		return scopeOf(session, field) === 'post';
	});
	// A hike without a post has nothing to override.
	const available = $derived(session.date !== null);

	const docOf = () => ({ fields: { [field]: { hike: currentValue(session, field, 'hike'), post: currentValue(session, field, 'post') } } });

	function toggle(e: Event) {
		const box = e.currentTarget as HTMLInputElement;
		if (!box.checked) {
			if (confirmOverrideOff(field, docOf()) && !confirm('This post has its own value that differs from the hike. Discard it and use the hike value?')) {
				box.checked = true;
				return;
			}
			setField(session, field, null, 'post');
			return;
		}
		const op = overrideOps(field, docOf(), true);
		if (!op) {
			box.checked = false;
			onnote?.('Set the hike value first, then override it for this post.');
			return;
		}
		setField(session, field, op.value, 'post');
	}
</script>

{#if available}
	<label class="switch">
		<input type="checkbox" checked={on} onchange={toggle} />
		<span>{label}</span>
	</label>
{/if}

<style>
	.switch {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.75rem;
		font-size: 0.9rem;
		color: #444;
	}
	input {
		width: 1.25rem;
		height: 1.25rem;
	}
</style>
