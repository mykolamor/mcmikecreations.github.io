<script lang="ts">
	import { onMount } from 'svelte';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import '@xterm/xterm/css/xterm.css';
	import type { ClientMsg, ServerMsg } from '../../server/claude-terminal';

	// Claude Code in the repo root, run by the CRM server (vite.config.ts, server/claude-terminal.ts). One session for
	// the whole CRM: leaving this tab, opening another hike or reloading reattaches to it, with the screen as it is.
	// The command is `claudeCommand` in settings.json or CRM_CLAUDE_COMMAND (default `claude`).

	let el: HTMLDivElement;
	let phase = $state<'connecting' | 'running' | 'exited' | 'disconnected'>('connecting');
	let exitCode = $state<number | null>(null);
	let error = $state<string | null>(null);
	let ws: WebSocket | null = null;
	let term: Terminal;
	let fit: FitAddon;

	const send = (m: ClientMsg) => {
		if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
	};

	async function connect() {
		phase = 'connecting';
		error = null;
		let token: string;
		try {
			const r = await fetch('/crm-claude/token');
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			token = (await r.json()).token;
		} catch (e) {
			error = `No connection to the CRM server (${e instanceof Error ? e.message : String(e)})`;
			phase = 'disconnected';
			return;
		}
		fit.fit();
		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		const sock = new WebSocket(`${proto}://${location.host}/crm-claude/socket?token=${encodeURIComponent(token)}&cols=${term.cols}&rows=${term.rows}`);
		ws = sock;
		sock.onmessage = (ev) => {
			const m: ServerMsg = JSON.parse(String(ev.data));
			if (m.type === 'snapshot') {
				term.reset();
				term.write(m.data);
				phase = m.running ? 'running' : 'exited';
				exitCode = m.exitCode;
				if (m.running) term.focus();
			} else if (m.type === 'output') term.write(m.data);
			else {
				phase = 'exited';
				exitCode = m.exitCode;
			}
		};
		sock.onclose = () => {
			if (ws !== sock) return;
			ws = null;
			phase = 'disconnected';
		};
	}

	function startAgain() {
		if (ws?.readyState === WebSocket.OPEN) send({ type: 'start' });
		else connect();
	}

	onMount(() => {
		term = new Terminal({
			fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace',
			fontSize: 13,
			cursorBlink: true,
			scrollback: 5000
		});
		fit = new FitAddon();
		term.loadAddon(fit);
		term.open(el);
		term.onData((data) => send({ type: 'input', data }));
		term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
		const ro = new ResizeObserver(() => {
			if (el.clientWidth && el.clientHeight) fit.fit();
		});
		ro.observe(el);
		connect();
		return () => {
			ro.disconnect();
			const s = ws;
			ws = null;
			s?.close();
			term.dispose();
		};
	});
</script>

<section class="claude">
	{#if phase !== 'running'}
		<div class="bar" role="status">
			{#if phase === 'connecting'}
				Connecting…
			{:else if phase === 'exited'}
				Claude exited{exitCode ? ` (code ${exitCode})` : ''}.
				<button type="button" onclick={startAgain}>Start again</button>
			{:else}
				{error ?? 'Disconnected from the CRM server.'}
				<button type="button" onclick={connect}>Reconnect</button>
			{/if}
		</div>
	{/if}
	<div class="term" bind:this={el}></div>
</section>

<style>
	.claude {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		/* The viewport below the sticky header, less main's padding. */
		height: calc(100dvh - var(--header-height, 0px) - 2rem);
		min-height: 16rem;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.9rem;
	}
	.term {
		flex: 1;
		min-height: 0;
		padding: 0.25rem;
		background: #000;
		border-radius: 4px;
	}
	@media (max-width: 719px) {
		.claude {
			/* main's phone padding, its bottom room for the tab bar included */
			height: calc(100dvh - var(--header-height, 0px) - 5.75rem);
		}
	}
</style>
