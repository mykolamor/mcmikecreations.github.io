# Hike data reference

Everything you can write about a hike, in one place: which file it goes in, what it
looks like, what wins when two places say different things, which fields are worth
your time, and where to get the data. Step-by-step guides live elsewhere:

- [Adding a hike](adding-a-hike.md): creating the files for a new route.
- [Adding a place doc](adding-a-place.md): reference texts shown under posts.

## Contents

1. [The files](#1-the-files)
2. [What wins: merging and overriding](#2-what-wins-merging-and-overriding)
3. [Sidecar `<slug>.hike.json`](#3-sidecar-slughikejson)
4. [Post front matter `<date>-<slug>.md`](#4-post-front-matter-date-slugmd)
5. [The facts layer (`facts:`)](#5-the-facts-layer-facts)
6. [Place docs](#6-place-docs)
7. [What's worth filling in first](#7-whats-worth-filling-in-first)
8. [Where to get the data](#8-where-to-get-the-data)
9. [Gotchas](#9-gotchas)

---

## 1. The files

One route has one **slug** (`schneefernerkopf`). Every file is named after it.

| File | What it holds | Who writes it |
|---|---|---|
| `static/_projects/data-viz/hikes/markdown/<slug>.hike.json` | **The sidecar.** The route itself: name, map framing, POI nodes, and **route-level facts defaults**. Its existence is what makes the hike exist. | You, plus `backfill_terrain.py` (`demEle`) |
| `static/_projects/data-viz/hikes/markdown/<date>-<slug>.md` | **A post.** One walk on that route: story, photos, the day's numbers, and **post-level facts**. The file name gives the date and the slug. | You, plus the image tools (`images:`, `elapsed`) |
| `static/_projects/data-viz/hikes/geojson/<slug>.json` | The route line, with elevation per point. | openrouteservice export |
| `static/_projects/data-viz/hikes/gpx/<slug>.gpx` | The recorded (or planned) track, offered as a download. | Your watch or app |
| `static/_projects/data-viz/hikes/gpx/bailouts/*.gpx` | Planned bailout routes, referenced from `facts.bailouts[].route`. | A route planner |
| `static/_projects/data-viz/hikes/places/<slug>.md` | **A place doc.** Reference text about a hut or peak, shown under every post that lists it. | You, plus the image tools |
| `src/lib/data/hikes.json` | Only hikes that still have **no post**, and their dates. | You |
| `src/lib/data/contacts.json` | People's avatars and links, matched by `people:` names. | You |

**Rule of thumb:** if something is true of the route on any day, it goes in the
**sidecar**. If it's true of this walk, it goes in the **post**. If it's true of a place
regardless of route, it goes in a **place doc**.

---

## 2. What wins: merging and overriding

Three different mechanisms, which is the confusing part.

### 2a. Hike fields: the post overrides, key by key, with no merging

For the plain hike fields (`name`, `title`, `description`, metrics, `nodes`, `origin`, …):

```
hikes.json (route entry, then the date's entry)  →  sidecar  →  post front matter
                                         lowest priority  ……  highest priority
```

- A value in the post **replaces** the lower one entirely. `nodes` in a post replaces
  the whole node list; it doesn't add to it.
- **Omitted or `null` falls back.** There's no way to clear a value from a post.
- `metaPath` (another sidecar) is applied **first**. Swapping a sidecar replaces all
  its fields at once, `facts` included.
- `description` is the exception: the post's is **prepended** to the sidecar's, not
  swapped for it.

### 2b. Facts: sidecar defaults, deep-merged with the post

`facts:` in the sidecar holds route defaults. `facts:` in the post is merged **into**
them, recursively:

| What | Rule |
|---|---|
| Plain value (string, number, true/false, a choice like `high`) | Post wins. |
| Translated text `{en, de}` | Merged per language. A post can add only `de` to the sidecar's English, or replace only `en`. A plain string counts as `{en}`. |
| Object (`difficulty`, `access`, `plan`, `season`, …) | Merged field by field, all the way down. |
| List of plain values (`season.best`, `route.trails`, `route.terrain`, `plan.for`, `plan.notFor`, `alternatives.*`, `tickets[].includes`, `conditions.weather`, `conditions.trail`) | Post's list **replaces** the sidecar's. `best: [8]` means August, not August plus the sidecar's months. |
| Price lists (`price: [...]`) | Replaced as a whole. |
| List of entries (`hazards`, `bailouts`, `gear`, `stops`, …) | **Matched by an identity key** (table below). A matching post entry is merged into the sidecar's entry. Unmatched post entries are **appended** after the sidecar's. |
| `null` in the post | **Deletes** the sidecar's value for that key. This is the opposite of 2a. |
| `remove: true` on a post entry | Drops the matching sidecar entry. If nothing matches, the build warns. |

Identity keys. Places compare after being resolved, so `Knorrhütte` and
`{node: 476498599}` are the same place.

| List | Matched on |
|---|---|
| `hazards` | `kind` + `at` (or `from` + `to`) |
| `bailouts`, `water`, `stops`, `access.borders` | `at` |
| `signal`, `navigation.spans`, `difficulty.sections` | `from` + `to` |
| `difficulty.viaFerrata`, `route.optional` | `name`, else `from` + `to` |
| `rules` | `kind` + `from` + `to` |
| `legs` | `to` |
| `access.transport` | `mode` + `from` + `to` |
| `access.parking` | `name`, else `at` |
| `access.lifts`, `access.tickets`, `permits`, `plan.variants` | `name` (its English text) |
| `plan.gear` | `item` (+ `label`) |
| `sources` | `url` |

Only a post may set `conditions` and `deviations`, since they describe one day; the
sidecar's copies are ignored with a warning. Only a post may set `facts.hidden`.

**Worked example** (from Schneefernerkopf):

```yaml
# sidecar facts.hazards has: snowfield at Schneefernerscharte, severity medium, note "Hard snow in the morning."
# post:
facts:
  hazards:
    - {kind: snowfield, at: Schneefernerscharte, severity: high, note: {en: "Hard ice at 05:00…", de: "…"}}
    - {kind: crowding, at: Zugspitzplatt, remove: true}
    - {kind: darkness, severity: high}
# result: the snowfield entry becomes high with the post's note; crowding disappears;
#         darkness is added at the end. Every other sidecar hazard is kept as is.
```

### 2c. Computed vs. written

Some values are computed from the track and only take over when you write nothing:

| Value | Computed from | Written override |
|---|---|---|
| Distance, ascent, descent, moving time | GeoJSON, or `scripts/track_metrics.py` for recorded tracks | `distance`, `ascent`, `descent`, `duration` in the post |
| Elapsed time | GPX timestamps (minus gaps over 3 h) | `elapsed: {start, end, source}` in the post |
| Highest/lowest point, typical (DAV) time | The route's own elevations | none |
| Route type | Track shape | `facts.route.type` |
| Overall SAC grade | Hardest of `difficulty.sections[].sac` and non-optional `legs[].sac` | `facts.difficulty.sac`. If yours is easier than the computed one, the build warns. |
| km and altitude of a facts place | Projected onto the route | none |
| Bailout route length, ascent, descent, DAV time | Its GPX file | `bailouts[].time` is your own figure, shown separately |
| `dateModified` | Last git commit that changed the post's text | `updated: YYYY-MM-DD` |

### 2d. Place docs aren't merged at all

A post lists slugs (`places: [knorrhuette]`); each doc is shown as written. Nothing in
a post changes a place doc.

---

## 3. Sidecar `<slug>.hike.json`

```jsonc
{
  "name": "Schneefernerkopf",                       // required: the hike's name
  "description": "Hike from Ehrwald to …",          // required: one sentence; the post's description is prepended
  "image": "/images/projects/data-viz/hikes/schneefernerkopf.jpg",  // required: full-size; thumb/ is derived
  "origin": { "lat": 47.40009, "lon": 10.96796 },   // required: map centre, hand-picked to frame the route
  "height": 512,                                    // required: map size in px (and which tiles get downloaded)
  "checkpoints": [[10.91359, 47.40956], …],         // required: coarse [lon, lat] outline for the Web graph
  "nodes": [                                        // optional: OSM points of interest
    {
      "id": 476498599, "lat": 47.4100105, "lon": 11.012732,
      "demEle": 2047.3,                             // written by backfill_terrain.py; puts the marker on the 3D map
      "tags": { "name": "Knorrhütte", "ele": "2052", "tourism": "alpine_hut",
                "phone": "+4988212905", "website": "http://www.knorrhuette.de/",
                "visited": "no" }                   // your own tag: yes / no / missing (peak marker colour)
    }
  ],
  "facts": { … }                                    // optional: route-level facts defaults, see §5
}
```

What the nodes are for, beyond markers:

- **Place links in the story.** `Knorrhütte (2052 m)` links to the map when the name
  matches a node.
- **Facts places.** `at: Knorrhütte` resolves to the node, with its height, map
  position and `demEle`.
- **Stops** on a node take the node's `phone` and `website` when the facts give none.
- **Search.** Node names are indexed.

So **a good node list makes everything else cheaper.** Prefer adding a node over
writing `{lat, lon}` in facts.

---

## 4. Post front matter `<date>-<slug>.md`

All keys are optional. The date and route come from the file name; there's no `date:`.

### This walk

| Key | Type | Notes |
|---|---|---|
| `title` | text | Falls back to the sidecar's `name`. |
| `description` | text | Prepended to the sidecar's description. |
| `image` | path | Only if this date's header photo differs. |
| `tags` | list | Tag chips and `/hikes/tag/<tag>/` pages. |
| `people` | list | Names, matched against `contacts.json`. |
| `contacts` | list | Per-post people details: `{name, avatar?, links: [{network or label, url}]}`. |
| `author` | text | Defaults to you. |
| `gpx` | path | The track to link; also listed in the Web graph popup. |
| `distance`, `ascent`, `descent` | metres | Override the GeoJSON. Recorded hikes: computed by `track_metrics.py`. |
| `duration` | minutes | **Moving** time. |
| `elapsed` | `{start, end, source}` | Wall-clock start and end (`'2026-07-18T20:30'`), `source: photos` (a lower bound) or `manual`. Wins over GPX timestamps. |
| `updated` | date | Forces `dateModified` (JSON-LD, sitemap). |
| `places` | list of slugs | Place docs shown at the bottom (§6). |
| `facts` | object | The facts layer (§5). `facts: {hidden: true}` switches it off for this post. |
| `images` | map | **Don't write by hand.** Filename → `{w, h, lat?, lon?, demEle?, taken?, located?, blur}`, maintained by the image tools (§8). |
| `filePath`, `metaPath` | path | Another GeoJSON or sidecar for this date (a different route variant). |

### Overriding the hike (rare)

`name`, `height`, `origin`, `checkpoints`, `nodes`. Each replaces the sidecar's value
for **this post's page only**; the Web graph and search keep using the sidecar's. If a
value is wrong for every date, fix the sidecar instead.

`draft` and top-level `hidden` are **inert** here; only `hikes.json` reads them. Don't
confuse that with `facts.hidden`, which works.

---

## 5. The facts layer (`facts:`)

Lives in the sidecar (route defaults) and/or the post (this walk), merged as in §2b.
**Every field is optional**: a post renders exactly as much as it has.

### Shared building blocks

**Text:** `"English"` or `{en: "English", de: "Deutsch"}`. The German is ready for
the planned `/de/` pages; today the page shows English.

**Place**: where something is.

| Form | Example | Use when |
|---|---|---|
| Node name | `Knorrhütte` | **Default.** Matched like story place links. |
| `{node, name?}` | `{node: 12806819227, name: {en: Fore-summit cross}}` | The node has no name, or you want another. |
| `km N` / `{km: N}` | `km 19.0` | A point on the route with no node. |
| `{lat, lon, name?, ele?, demEle?}` | `{lat: 47.4133, lon: 10.9802, name: Sonnalpin}` | Off-route, or nothing else fits. |

- A name that matches no node is a **warning**: it shows as plain text, with no map
  link or km.
- **3D map heights.** A pin stands on the 3D map only with a `demEle`:
  - A node's comes from `backfill_terrain.py`.
  - `{lat, lon}` places **in the sidecar** get one from the same script.
  - Places in a post's YAML and `km` places don't, unless you type `demEle` yourself.

**Span:** `from` and/or `to` (places). An open end runs to the route's start or end.

**Price:** `{amount, currency?: EUR, per?, note?, checked?}`. `amount: 0` shows as free.

**`checked: YYYY-MM-DD`** on anything that goes stale (prices, timetables, opening
dates). `facts.checked` is the default for the whole post; `access.checked` for
`access`.

### Field map

Where each block renders: **T** = title-card tiles, **S** = safety box above the
story, **G** = guide below the story, **C** = elevation charts, **M** = 2D and 3D maps.

| Field | Type / values | Where | Notes |
|---|---|---|---|
| `checked` | date | G | Default "checked …" stamp. |
| `summary` | text | S | 1–2 sentences over the safety box. |
| `difficulty.sac` | `T1`–`T6`, optional `+`/`-` | T G | Hand-written, else computed from sections and legs. |
| `difficulty.note` | text | G | **The justification.** Always write one with a grade. |
| `difficulty.sections[]` | span + `sac`, `viaFerrata`, `climbing`, `note` | G C | Coloured SAC band on the charts. |
| `difficulty.viaFerrata[]` | `grade`, `scale` (schall/huesler/french/italian), span, `name`, `length`, `gain`, `time`, `note` | T G | The tile shows the hardest. |
| `difficulty.climbing` | `grade`, `scale` (uiaa/french/yds), `note` | T G | |
| `difficulty.exposure` | `level`: none/low/moderate/high, `note` | T G | |
| `difficulty.fitness` | 1–5 | T G | |
| `difficulty.winter` | `snowshoe` WT1–6, `skiTour`, `avalanche` 1–5, `note` | G | Only if it's done in winter. |
| `season` | `best`, `possible` (months 1–12), `window {from: "06-20", to: "10-10"}`, `note` | T G | The tile shows `best`. |
| `route.start`, `route.end` | place, or `{name, at?}` | G | A named trailhead needn't be a node. |
| `route.type` | loop/out-and-back/point-to-point/lollipop/traverse | G | Overrides the computed one. |
| `route.official` | text | G | How the usual route differs from yours. |
| `route.optional[]` | span + `name`, `note` | G | Detours. |
| `route.terrain` | list: road, forest-road, path, meadow, scree, ridge, secured, snow, glacier, … | G | |
| `route.shade` | none/low/moderate/high | G | |
| `route.trails` | list | G | Waymarked route numbers ("801"). |
| `route.peaks` | list of places | G, JSON-LD | Become `Mountain` entities for search engines. |
| `navigation` | `marking` good/partial/poor/none, `spans[]`, `note`, `offline` | G | |
| `hazards[]` | `kind`, `label?`, `at` or span, `severity` low/medium/high, `season`, `note` | S C M | ~40 kinds (rockfall, snowfield, cattle, lightning, …). An unknown kind needs a `label`. With a span, the stretch is drawn on the charts and maps. |
| `bailouts[]` | `at`, `to`, `via` trail/lift/road/bus/taxi/hut, `time`, `last`, `route`, `note` | S C M | `route`: a served GPX path, drawn dashed beside the main route. `last: true` marks the point of no return. |
| `water[]` | `at`, `kind` tap/fountain/spring/stream/lake/hut/shop, `reliable`, `treat`, `note` | G C M | |
| `signal[]` | span + `quality` none/patchy/good, `network`, `note` | G | |
| `stops[]` | `at`, `kind`, `open` (window / all-year / closed), `days`, `overnight`, `food`, `water`, `cash`, `price[]`, `booking`, `phone`, `note`, `checked` | G | `phone` and `booking` fall back to the node's OSM tags. |
| `access.carFree` | yes/partial/no | T G | The tile shows only this, linking to "Getting there". |
| `access.transport[]` | `mode`, `from`, `to`, `direction` there/back/both, `duration`, `changes`, `line`, `operator`, `first`, `last`, `frequency`, `price[]`, `ticket`, `url`, `note`, `checked` | G | One entry per leg or alternative. Quote times: `"06:32"`. |
| `access.parking[]` | `name`, `at`, `price[]`, `size`, `fills`, `freeWith`, `url`, `note`, `checked` | G | |
| `access.lifts[]` | `name`, `kind`, span, `direction`, `open`, `first`, `last`, `price[]`, `url`, `note`, `checked` | G | |
| `access.tickets[]` | `name`, `includes[]`, `price[]`, `validity`, `url`, `note`, `checked` | G | |
| `access.borders[]` | `at`, `from`, `to` (country codes), `note` | G | |
| `permits[]` | `name`, `required`, `where`, `price[]`, `url`, `note`, `checked` | G | |
| `protectedAreas` | text | G | Naturschutzgebiet and similar zones, in your words. |
| `drones` | text | G | Where drones are forbidden and why. |
| `rules[]` | `kind` (protected-area, no-camping, no-drones, dogs-on-leash, …), `label?`, span, `season`, `note` | G | Short, place-bound rules. |
| `suitability` | `kids`, `dogs`, `stroller`, `bike`, `winter`, `night`, `solo`, `note` | G | |
| `legs[]` | `to`, `terrain[]`, `sac`, `viaFerrata`, `marking`, `optional`, `note` | G | A leg runs from the previous `to`. Optional legs don't count towards the SAC grade. |
| `conditions` | `weather[]`, `temp {min, max}`, `visibility`, `snowLine`, `traction`, `trail[]`, `crowding`, `start`, `why`, `note` | S | **Post only.** |
| `deviations[]` | `kind` (solo, night, unroped, off-trail, …), `at`, `note` | S | **Post only.** "Don't copy this." |
| `plan.gear[]` | `item` (~55 kinds), `label?`, `need` essential/conditional/optional, `when`, `amount` | G | Checklist with tick boxes. |
| `plan.for`, `plan.notFor` | lists of text | G | |
| `plan.variants[]` | `name`, `summary`, `distance`, `ascent`, `descent`, `duration`, `sac`, `viaFerrata`, `link`, `recommended`, `note` | G | `link`: a post slug or URL. |
| `plan.timing` | `start`, `turnaround`, `sunrise {start, note}`, `note` | G | |
| `plan.alternatives` | `easier`, `harder`, `similar`: lists of post slugs | G | Shown with the posts' titles. |
| `sources[]` | `title`, `url`, `kind`, `lang`, `note` | G | |
| `hidden` | true/false | none | **Post only.** `true` switches the whole layer off, sidecar included, unread. |

The full enum lists (every hazard kind, gear item and so on) are in
`src/lib/hikes/facts-schema.ts`. A value outside them fails the build and lists the
allowed ones.

---

## 6. Place docs

`static/_projects/data-viz/hikes/places/<slug>.md`:

```markdown
---
title: Knorrhütte                                   # required
description: DAV hut at 2052 m on the edge of …     # required; shown while collapsed
tags: [Hut, DAV]                                    # optional
aliases: [Knorr hut]                                # optional; the title always counts
images: {…}                                         # optional; written by the image tools
---
Markdown text, photos like a post's.
```

- **Any other key fails the build.** No facts or metrics here.
- A post shows docs with `places: [knorrhuette]` (an unknown slug fails the build).
  They appear under **Places on this route**, collapsed. Their photos join the post's
  gallery.
- **Links from the story:**
  - The first `Name (1234 m)` reference matching a doc's title or alias gets a small ⓘ
    link; the name keeps its map link.
  - `[the hut](place:knorrhuette)` links any text explicitly.
- **Place doc or facts?** If it's about the place on any visit (history, beds, season,
  how to book), it's a place doc. If it's about this route passing it (water here at
  km 17, bail out here), it's facts.

---

## 7. What's worth filling in first

Ordered by reader value per minute of your time.

**Every post (already the habit):** the filename, `title`, `description`, `tags`, the
sidecar basics, and a good **nodes** list. Nodes pay off everywhere: links, facts
places, 3D pins, search.

**Tier 1: the facts most readers come for.** Do these on the Alpine routes first.

1. `difficulty.sac` **with** `difficulty.note`. A grade without a reason isn't trusted.
2. `hazards`, especially anything high severity, with places.
3. `bailouts`, with `last: true` on the point of no return, and a `route` GPX when the
   way down isn't the way up.
4. `season.best`.
5. `access.carFree` and the main `transport` connection, with `first`/`last` service
   times when a late start matters.
6. `conditions` and `deviations`, **for new posts, while you remember.**

**Tier 2: planning.** `water`, `stops`, `difficulty.exposure` and `fitness`,
`navigation.marking`, `plan.gear`, `plan.for`/`notFor`, `difficulty.sections` or `legs`
(either one also computes the SAC grade).

**Tier 3: nice to have.** Prices, tickets, parking, lifts, permits, rules, `drones`,
`protectedAreas`, `signal`, `suitability`, `variants`, `alternatives`, `sources`,
German translations.

**Put route facts in the sidecar,** so every post on that route inherits them. Use
the post only for what differs on that day.

---

## 8. Where to get the data

### Route, track and photos (mostly scripted)

| Data | Source / tool |
|---|---|
| Route GeoJSON | [openrouteservice](https://maps.openrouteservice.org/) export; see the blog post "How I make the hiking routes". |
| Recorded GPX | Garmin Connect / Strava / Komoot export. |
| `distance`, `ascent`, `descent`, `duration` | `scripts/track_metrics.py` for recorded tracks (`deploy.sh` runs it with `--missing-only`). |
| `elapsed` | GPX timestamps automatically. Without them, hand-pick the first and last photo. |
| `images:` (`w`, `h`, `blur`, AVIF tiers) | `scripts/image_match.py` (or the web UI `image_match_web.py`), then `scripts/image_optimize.py`. |
| `images[].lat/lon` | `backfill_gps.py`, from Immich. |
| `images[].taken`, `located: track` | `backfill_time.py` (`deploy.sh` runs it). |
| `demEle` (photos, nodes, sidecar facts places) | `scripts/backfill_terrain.py`. Run it after adding nodes or `{lat, lon}` facts places to a sidecar. |
| Nodes | [Overpass turbo](https://overpass-turbo.eu/) around the route; keep the OSM shape. Then `node scripts/check-nodes.js`. |
| Node `visited` | Your own comparison with Komoot's peak list. |
| Map tiles | `scripts/map-download.js <slug>`, after setting `origin` and `height`. |

### Facts (by hand; good sources)

| Field | Where to look |
|---|---|
| SAC grade, sections, exposure | [hikr.org](https://www.hikr.org/) reports (graded by many people), [gipfelbuch.ch](https://www.gipfelbuch.ch/), [alpenvereinaktiv.com](https://www.alpenvereinaktiv.com/), Bergfex and Outdooractive route pages. Then your own judgement; write it in `note`. |
| Via ferrata grade | [klettersteig.de](https://www.klettersteig.de/), [bergsteigen.com](https://www.bergsteigen.com/), the topo you used (Schall scale in DE/AT). |
| Hazards, navigation, terrain | Your own experience first, then recent hikr/gipfelbuch reports. |
| Bailout routes (`route` GPX) | Plan them in [openrouteservice](https://maps.openrouteservice.org/) (foot-hiking) and export **"Standard GPX"**, not "ORS GPX" (smaller, plain GPX 1.1). Save under `gpx/bailouts/`. |
| Season, hut opening dates, prices, beds | The hut's own website (also in the node's OSM `website` tag); the DAV/ÖAV hut pages on alpenvereinaktiv.com. |
| Transport | [DB Navigator / bahn.de](https://www.bahn.de/), [ÖBB Scotty](https://fahrplan.oebb.at/), [VVT](https://www.vvt.at/) for Tyrolean buses, [MVV](https://www.mvv-muenchen.de/) around Munich. Note first/last services for late starts. |
| Lifts, tickets, parking | The lift operator's website (prices change yearly; set `checked`). |
| Protected areas (`protectedAreas`, `rules`) | Bavaria: [FIN-Web](https://www.lfu.bayern.de/natur/fis_natur/fin_web/index.htm) (LfU). Tyrol: [tiris](https://www.tirol.gv.at/statistik-budget/tiris/). Germany-wide: [BfN maps](https://geodienste.bfn.de/schutzgebiete). |
| Drones (`drones`) | Germany: [DIPUL map tool](https://maptool-dipul.dfs.de/). Austria: [Dronespace](https://www.dronespace.at/) (Austro Control). |
| Avalanche level (winter) | [lawinenwarndienst-bayern.de](https://www.lawinenwarndienst-bayern.de/), [lawinen.report](https://lawinen.report/) (Tyrol, South Tyrol, Trentino). |
| Conditions on the day | Your photos and memory. For past dates, historical weather from [meteoblue](https://www.meteoblue.com/) or [GeoSphere Austria](https://data.hub.geosphere.at/). |
| Phone signal | Your own phone on the day; operators' coverage maps as a rough guide. |
| Permits (Nepal etc.) | The issuing authority's site (ACAP / TIMS for Annapurna). |

---

## 9. Gotchas

- **Quote times** in YAML: `"20:30"`. Unquoted, YAML reads it as a number, and the
  build tells you to quote it.
- **Quote text containing commas** inside `{…}` one-line maps:
  `{en: "Hard ice, spikes needed"}`. Otherwise YAML splits it into extra keys and the
  build fails with an odd "unknown language".
- **Facts typos fail the build**, naming the file and key path, so a hazard can't
  silently go missing. A **place that matches no node** only warns.
- **`null` means opposite things:** in hike fields it falls back to the lower value
  (§2a), in facts it deletes it (§2b).
- **Two different `hidden`s:** top-level `hidden` in a post does nothing; `facts.hidden`
  switches the facts layer off.
- **Re-running the optimizer** rebuilds a post's `images:` from its match report, so
  hand-fixed photo GPS comes back. Fix it in Immich instead. (See
  `offroute-photos.md` for photos whose GPS is off the route.)
- **Editing a place doc doesn't change the posts' `dateModified`.** Add `updated:` to
  a post if the change matters for it.
- **Most prerender failures don't fail the build**; the page is just missing. Watch the
  build log for warnings.
