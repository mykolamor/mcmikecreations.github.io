// Names of OSM refs written in the facts, from the local store (`/api/osm/entry`, never OSM), read once per page and
// reactive: a label asks while it draws and redraws when the name arrives. A ref the store lacks or refuses (4xx) is
// kept as nameless; a failed request isn't kept, so it is asked again.
import { SvelteMap } from 'svelte/reactivity';
import { ApiClientError, api } from '../api';

type Entry = { tags?: Record<string, string>; local?: Record<string, string | null> };

/** null: no name, the store lacking the element or its name. */
const names = new SvelteMap<string, string | null>();
const asking = new Set<string>();

/** The store's name for `ref` (its local name over OSM's); undefined until known or when it has none. */
export function storeName(ref: string): string | undefined {
	const known = names.get(ref);
	if (known !== undefined) return known ?? undefined;
	if (!asking.has(ref)) {
		asking.add(ref);
		api<{ entry: Entry }>('GET', `/api/osm/entry?${new URLSearchParams({ ref })}`)
			.then(({ entry }) => names.set(ref, entry.local?.name !== undefined ? entry.local.name : (entry.tags?.name ?? null)))
			.catch((e) => {
				if (e instanceof ApiClientError && e.status >= 400 && e.status < 500) names.set(ref, null);
			})
			.finally(() => asking.delete(ref));
	}
	return undefined;
}

/** A name already known (an element just picked). */
export function rememberName(ref: string, name: string | null): void {
	names.set(ref, name);
}
