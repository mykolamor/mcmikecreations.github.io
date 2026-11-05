<script>
	export let text;
	export let raw;
</script>

<code translate="no">{(text ?? raw)?.replace(/`/g, '')}</code>
