---
name: localizing-hike-posts
description: Use when asked to proofread a hike post and its sidecar (static/_projects/data-viz/hikes/markdown/<date>-<slug>.md + <slug>.hike.json), move its huts, parking, transport, lifts, tickets or permits into facts-library.json, and/or translate the post, sidecar facts and library records into German and Ukrainian with DeepL.
---

# Proofreading, sharing and localizing a hike post

Four passes, in this order, each finished before the next. The English must be final
before translating: Fill only fills *empty* translations, so a later English fix is
not picked up.

Helper script (reuses the CRM's own reader, writers, Fill gatherers and DeepL client):

```sh
export JITI_ALIAS='{"$lib":"'"$PWD"'/src/lib"}'
H=".claude/skills/localizing-hike-posts/hike-l10n.ts"
node_modules/.bin/jiti $H move  <slug> <kind>:<index>[=<id>] … [--dry-run]
node_modules/.bin/jiti $H fill  <slug> de uk [--dry-run]     # CRM_DEEPL_STUB=1 for an offline try
node_modules/.bin/jiti $H texts <slug> <lang>                # path | en | translation, for proofreading
```

Before starting, copy the post, sidecar and `facts-library.json` to the scratchpad
(backups to restore from). Work uncommitted; never commit.

## 1. English proofread: typos only

**Fix only:** spelling, grammar, tense agreement, articles/prepositions, hyphenation
(`off-road`, `one-way`), capitalisation (`Polish`), number ranges with an en dash
(`3–4 L`), and one name spelled two ways (the `people:` front matter wins).

**Never change on your own**, even when you believe it is wrong: which place a
caption names, peak lists or their order, summaries, notes, enum values (route
type, dogs, …), idioms, word choice, sentence structure. The author was very
clear about this. Collect suspected errors instead and **ask** in one numbered list:

- facts that contradict the post or reality (countries, rules, route type);
- a caption naming a different place than the photo's `pins` (compare refs in
  `osm.json`; look at the photo: `ffmpeg -i <img>-640.avif x.png`, then Read);
- names mixing languages (Slovak vs Polish) between description and post;
- wrong idioms and odd words;
- leftover files from renames (`git status`).

Apply only the items the author approves, exactly as worded.

## 2. Shared library (`facts-library.json`)

Move entries other hikes in the area will reuse: stops (huts, restaurants) with
`at: {ref}`, `access.transport`, `access.parking`, `access.lifts`, `access.tickets`,
`permits` (a national park's entry ticket).
Not bailouts, legs, hazards, water or route-specific notes.

```sh
node_modules/.bin/jiti $H move <slug> stops:0 transport:0=bus-12-zakopane-kuznice \
  parking:0=parking-lot-kuznice lifts:0=kasprowy-wierch-cable-car --dry-run
```

- ids: lowercase words joined by `-`, following the existing ones
  (`bus-<line>-<from>-<to>`, `train-rb-6-…`, `parking-lot-<place>`, `<lift-name>`);
  a stop's id is its OSM ref (no `=id`). Check first that no near-identical record exists already
  (`grep` the library). If one does, point the entry at it with `"use"` by hand.
- The script refuses if any page's resolved facts would change, then writes the
  library with the CRM's byte-stable writer (it may also put an existing record's keys
  back in schema order, which is harmless) and replaces the sidecar entry with
  `{ "at": … }` / `{ "use": "<id>" }`.
- Run `pnpm crm check`: 0 errors expected.

## 3. Translate (DeepL via the CRM's Fill)

Key: `deeplKey` in `scripts/crm/data/settings.json` (or `DEEPL_API_KEY`). Try the
stub first (`CRM_DEEPL_STUB=1 … fill <slug> de uk --dry-run`): it shows the counts
without a request. Then run `fill <slug> de uk` for real. It fills the sidecar's
facts, name and description, every library record the hike uses, and creates/fills
`<date>-<slug>.<lang>.md`. It never overwrites a text that has a translation already.

DeepL **refuses** some blocks ("added markup", "broke a link"); they are listed
and left **missing** from the translation. Translate them by hand in pass 4, in
the position the English has them (count `![` lines: must equal the English).

## 4. Proofread the translations

Read the whole `.de.md` and `.uk.md`, then `texts <slug> de` / `uk`. Translate
faithfully. A translation must not "fix" the English. Apply
[the translation conventions](#conventions) and check for these recurring DeepL faults:

| Fault | Fix |
|---|---|
| German `Sie`/`Ihr`/`Folgen Sie` | `du`/`ihr`: `Folgt dem Grat…`, `Informiert euch…` |
| Ukrainian mentions `(1987 m)` | `(1987 м)` everywhere (`re.sub(r'\((\d{3,4}) m\)', r'(\1 м)', s)`) |
| Peaks/huts/lifts/saddles/lakes/streams translated or transliterated (`Каспровий Верх`, `Суха-Копа`, `«…»`) | keep the original name: `Kasprowy Wierch`, `Suchá kopa`. Only the sidecar's top-level `name` is localized |
| Towns/villages/valleys spelled inconsistently (`Кужниці`/`Кузниці`) | one transliteration everywhere (`Кузьниці`, `Закопане`) |
| A place name split or quoted (`„Przełęcz między“ Kopami`) | restore the full name before `(1499 m)` |
| Link text lost its mention (`[Sonnenberg (1622 m) Tour]`) | keep `Name (h m)` intact inside: `[Tour auf den Sonnenberg (1622 m)]` |
| Gear mistranslated | translate the author's word literally: shoe spikes / spikes = `Grödel` / `шипи`; crampons = `Steigeisen` / `кішки` ("shoe spikes" may mean either, so don't guess) |
| A sentence left in English (`Meet Morskie Oko …`) | translate it (`Darf ich vorstellen: …`, `Знайомтеся: …`) |
| Thousands separator inside a mention (`Kępa (1.683 m)`) | `(1683 m)`: the place link needs the plain number |
| A name's Polish/Slovak preposition translated (`Schronisko PTTK in Dolinie …`) or the name quoted (`„Wyżni Wodogrzmot“`, `«Морське Око»`) | restore the exact OSM name: `Schronisko PTTK w Dolinie Pięciu Stawów Polskich` |
| Nonsense from a short note (`In-person` → `Особисте навчання`) | rewrite (`На місці — …`) |
| Conditional read as causal ("given the trail is clear") | `sofern … wäre` / `за умови, що …` |
| German genitive -s before an elevation | rephrase (`am Fischberg`); articles for Polish names: `die Kopa`, `der Kasprowy Wierch` |
| Ukrainian feminine first person (also mid-story: `сама віднесла`, `я підійшла`) | masculine: `я пообіцяв`, `сам відніс`, `я підійшов`; check with `grep -P "[Яя] (\S+ )?\S+ла\b"` |
| Broken run-on sentences, repeated verbs, nonsense ("Beliebte Zielgruppe…") | rewrite the sentence |
| Ridge words | `Grat` (not `Bergrücken`) consistently |

Edit with exact string replacements (Python `assert s.count(a)==1`), not by
re-running DeepL. Finish with `pnpm crm check` (0 errors) and a photo-line count.

## Conventions

From the author's memory notes: German `du`/`ihr`, never `Sie`; the author is male (Ukrainian
masculine past tense); David Bilan = `Давід Білан`; `віа ферата`, `трос`;
peaks, huts, alms, saddles, castles, chapels, lifts, trails, streams, pure lakes and
ranges keep the original name in every language; towns/villages/valleys/stations are
transliterated in Ukrainian; settled spellings: Шлірзе, Тегернзе, Шпіцінгзе,
Фішхаузен-Нойхаус, Хаусхам, Гмунд, `Головний вокзал Мюнхена`, Кузьниці, Закопане.

## Report back

What changed per file, the open questions from pass 1, the refused DeepL blocks you
translated by hand, and any library record you reused or created. Leave everything
uncommitted.
