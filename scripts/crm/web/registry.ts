import type { Component } from 'svelte';

export type Tab = {
	id: string;
	label: string;
	order: number;
	component: Component<any>;
	/** Item kinds (see registerItemKind) this tab applies to. */
	kinds: string[];
	/** Optional props passed to the component. */
	props?: Record<string, unknown>;
};
export type ItemKind = { id: string; label: string };

const tabs: Tab[] = [];
const kinds: ItemKind[] = [];

/** Replaces the tab of the same id for `tab.kinds` only: a kind can have its own component under one id (Details of a hike vs a place doc). */
export function registerTab(tab: Tab): void {
	for (let i = tabs.length - 1; i >= 0; i--) {
		if (tabs[i].id !== tab.id) continue;
		const rest = tabs[i].kinds.filter((k) => !tab.kinds.includes(k));
		if (rest.length) tabs[i] = { ...tabs[i], kinds: rest };
		else tabs.splice(i, 1);
	}
	tabs.push(tab);
}
export function registerItemKind(kind: ItemKind): void {
	const i = kinds.findIndex((k) => k.id === kind.id);
	if (i >= 0) kinds[i] = kind;
	else kinds.push(kind);
}
export const getTabs = (kind?: string): Tab[] =>
	tabs.filter((t) => !kind || t.kinds.includes(kind)).sort((a, b) => a.order - b.order);
export const getItemKinds = (): ItemKind[] => [...kinds];

/**
 * What leaving the shown tab would lose, as a question for the author (Write: a running video upload is cancelled when
 * the tab goes); null: nothing. The tab bar asks it before a switch, and leaving the page warns. One tab is shown at a
 * time, so the last one set wins; the returned function unsets it (only if it is still the one set).
 */
let leaveCheck: (() => string | null) | null = null;
export function setLeaveQuestion(fn: () => string | null): () => void {
	leaveCheck = fn;
	return () => {
		if (leaveCheck === fn) leaveCheck = null;
	};
}
export const leaveQuestion = (): string | null => leaveCheck?.() ?? null;
