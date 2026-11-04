---
name: writing-place-docs
description: Use when asked to write or add a hikes place doc (static/_projects/data-viz/hikes/places/<slug>.md) for a hut, alm, castle, village, chapel or other named place, given its name and an OSM element id like node/123 or way/456.
---

# Writing a place doc

## Overview

A place doc is a short, factual entry the site shows under "Places on this
route". **Every fact in it comes from a page fetched in this session.** Nothing
from memory, nothing inferred from the name. A fact without a source is cut,
not softened.

## Inputs

- Name, e.g. `Kühzagl-Alm`, and OSM id, e.g. `way/60318909`.
- Look the id up in `static/_projects/data-viz/hikes/osm.json` (`lat`, `lon`,
  `demEle`, `tags`). Don't query Overpass/OSM yourself; if the id is missing,
  ask the user to add it (the CRM pin picker does that).
- OSM tags are leads, not facts: `website`, `wikipedia`, `wikidata`,
  `operator`, `ele` tell you where to look and what to confirm.

## Research, in this order

1. **Official**: the place's own website (OSM `website`/`contact:website`),
   operator (DAV section, municipality, Bayerische Schlösserverwaltung,
   Staatsforsten), Wikipedia/Wikidata from the tags, municipal chronicles.
2. **Tourist**: regional tourism boards (e.g. tegernsee.com, schliersee.de),
   alpenvereinaktiv, outdooractive, bergfex, hut portals.
3. **Folklore**: forums, hiking blogs, reviews. Use only for colour or when
   nothing better exists, and only if two independent pages agree.

Search in German as well as English; local places are documented in German.
Fetch pages (WebFetch), don't trust search snippets alone. Keep a running list
`fact → URL`. When sources conflict, prefer the higher tier and hedge in the
text ("usually given as 1852"). Opening hours, prices and phone numbers come
only from the official site, and go stale: say "check the website" rather than
guess a season.

## The file

`places/<slug>.md`, slug lowercase ASCII with `_` between words
(`ü`→`ue`, `ß`→`ss`): `obere_firstalm`, `knorrhuette`. Front matter keys are
only `title`, `description`, `tags`, `aliases` (`images` is written by the CRM).

```markdown
---
title: <official name>
description: <What it is> at <ele> m <where>, <one distinctive fact>.
tags: [<Type>, <Second tag>]
aliases: [<other spellings/names used in posts>]
---
<Paragraph 1: what and where — owner/type, elevation, setting relative to
nearby peaks with their heights in brackets, e.g. "below the Bodenschneid
(1668 m)". History and significance with years: founding, owners, rebuilds.>

<Paragraph 2 (and an optional 3rd): how to get there and what's around —
access routes with times, onward peaks, a notable feature.>

- **Open:** ...
- **Food:** / **Beds:** / **Access:** / **Rules:** ... (only what sources give)
- **Website:** [domain.de](https://domain.de/)
```

Style, matching the existing docs:

- Hard-wrap at ~78 columns. Plain, dry sentences; no "stunning", "nestled",
  "hidden gem", no exclamation marks, no second person except in tips.
- Elevations as `1365 m`; times as `9:00 to 22:00`; ranges `1.5 to 2 hours`.
- 2–3 paragraphs, 3–5 bullets. Short beats padded: if sources are thin,
  write one paragraph.
- Tags: title case, reuse existing ones (`Hut`, `Alm`, `DAV`, `Village`,
  `Castle`, `UNESCO`, `Royal history`, `Mining history`) before inventing.
- Elevation: prefer the official/OSM `ele` over `demEle`; if they differ a lot
  say which you used.

Read two or three existing files in `places/` before writing, to match tone.

## Finish

1. Re-read the draft sentence by sentence; each claim must map to a URL in
   your list. Delete any that doesn't.
2. Tell the user the file path and give the source list (`claim → URL`),
   noting anything hedged, conflicting or left out for lack of a source.

## Common mistakes

| Mistake | Fix |
|---|---|
| Filling gaps from general knowledge ("typical Bavarian alm with cows") | Cut it; if a source doesn't say it, it isn't in the doc |
| Quoting opening hours from a blog | Official site only, else "check the website" |
| Using search-result snippets as sources | Fetch the page and read the context |
| Mixing up a same-named place (many "Kühalm"s exist) | Match coordinates/municipality from `osm.json` against the source |
| Prose that reads like a brochure | State facts with numbers and names |
