// One-off: move each OSM store entry's top-level `visited` into `local.visited`.
// Idempotent. Run with: node_modules/.bin/jiti scripts/crm/oneoff/osm-visited-to-local.ts
//
// Edits the file's text rather than re-serialising it: JSON.stringify would
// print `1577.0` as `1577`, and osmstore.py would then churn those lines on
// its next save. `visited` already sits where `local` belongs in the entry
// order (after `demEle`, before `tags`), so the layout stays that of
// `save_store`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STORE = fileURLToPath(new URL('../../../static/_projects/data-viz/hikes/osm.json', import.meta.url));

const before = readFileSync(STORE, 'utf-8');
// Entry-level keys are indented 4 spaces; tags are one level deeper.
let moved = 0;
const after = before.replace(/^    "visited": ("[^"\n]*"),\n/gm, (_, value: string) => {
	moved++;
	return `    "local": {\n      "visited": ${value}\n    },\n`;
});

// Same parse either way, and no entry keeps a top-level `visited`.
const store: Record<string, Record<string, unknown>> = JSON.parse(after);
if (Object.values(store).some((e) => 'visited' in e)) throw new Error('a top-level visited is left');

writeFileSync(STORE, after, 'utf-8');
console.log(`moved ${moved} visited marks into local`);
