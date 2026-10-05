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
| List of plain values (`season.best`, `route.trails`, `route.terrain`, `route.peaks`, `plan.for`, `plan.notFor`, `alternatives.*`, `tickets[].includes`, `conditions.weather`, `conditions.trail`) | Post's list **replaces** the sidecar's. `best: [8]` means August, not August plus the sidecar's months. |
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
| Overall SAC grade | Hardest of `difficulty.sections[].sac` and non-optional `legs[].sac` (a range counts as its upper end) | `facts.difficulty.sac`. If yours is easier than the computed one, the build warns. |
| km and altitude of a facts place | Projected onto the route | none |
| Bailout route length, ascent, descent, DAV time | Its GPX file | `bailouts[].time` is your own figure, shown separately |
| `dateModified` | Last git commit that changed the post's text | `updated: YYYY-MM-DD` |

### 2d. Place docs aren't merged at all

A sidecar or post lists slugs (`places: [knorrhuette]`); each doc is shown as written.
Nothing in a post changes a place doc. The **list** follows §2a: a post's `places:`
replaces the sidecar's, and an omitted or `null` one falls back to it.

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
  "places": ["knorrhuette"],                       // optional: place docs for every post on the route, see §6
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
| `places` | list of slugs | Place docs shown at the bottom (§6). Replaces the sidecar's list; `[]` shows none. |
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
- **One marker per node.** Hazards, bailouts and water at a node (by name or
  `{node}`) don't get a pin of their own on the 2D and 3D maps. The node's marker
  wears a small badge with their emojis instead, and its popup lists them. Water on
  a node already drawn as water (💧) adds no badge. A `{lat, lon}` or `km` place
  keeps its own pin, however close to a node. The elevation charts still show pins.

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
| `difficulty.sac` | `T1`–`T6`, optional `+`/`-`; or an easier–harder range, `T1-T2` | T G | Hand-written, else computed from sections and legs. Every `sac` field takes a range; it's shown with an en dash (`T1–T2`) and ranks as its upper end. |
| `difficulty.note` | text | G | **The justification.** Always write one with a grade. |
| `difficulty.sections[]` | span + `sac`, `viaFerrata`, `climbing`, `note` | G C | Coloured SAC band on the charts. Give a stretch of mixed difficulty a range (`T1-T2`) instead of splitting it; the band takes the harder grade's colour. |
| `difficulty.viaFerrata[]` | `grade`, `scale` (schall/huesler/french/italian), span, `name`, `length`, `gain`, `time`, `note` | T G | The tile shows the hardest. |
| `difficulty.climbing` | `grade`, `scale` (uiaa/french/yds), `note` | T G | |
| `difficulty.exposure` | `level`: none/low/moderate/high, `note` | T G | |
| `difficulty.fitness` | 1–5 | T G | Stamina the hike takes, the German guides' *Kondition*; shown as "N of 5". Technique goes in `sac`, not here. See [Fitness levels](#fitness-levels). |
| `difficulty.winter` | `snowshoe` WT1–6, `skiTour`, `avalanche` 1–5, `note` | G | Only if it's done in winter. |
| `season` | `best`, `possible` (months 1–12), `window {from: "06-20", to: "10-10"}`, `note` | T G | The tile shows `best`. |
| `route.start`, `route.end` | place, or `{name, at?}` | G | A named trailhead needn't be a node. |
| `route.type` | loop/out-and-back/point-to-point/lollipop/traverse | G | Overrides the computed one. |
| `route.official` | text | G | How the usual route differs from yours. |
| `route.optional[]` | span + `name`, `note` | G | Detours. |
| `route.terrain` | list: road, forest-road, path, meadow, scree, ridge, secured, snow, glacier, … | G | |
| `route.shade` | none/low/moderate/high | G | |
| `route.trails` | list | G | Waymarked route numbers ("801"). |
| `route.peaks` | list of places | G, JSON-LD | Become `Mountain` entities for search engines. See [`route` in detail](#route-in-detail). |
| `navigation` | `marking` good/partial/poor/none, `spans[]`, `note`, `offline` | G | Details in [`navigation` in detail](#navigation-in-detail). |
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
| `suitability` | `kids`, `dogs`, `stroller`, `bike`, `winter`, `night`, `solo`, `note` | G | Fixed values: `kids` yes / older / no; `dogs` yes / leash / no; `stroller` true / false; `bike` yes / partial / no; `winter` yes / with-gear / no; `night` and `solo` yes / experienced ("experienced only") / no. `note` is free text. |
| `legs[]` | `to`, `terrain[]`, `sac`, `viaFerrata`, `marking`, `optional`, `note` | G | A leg runs from the previous `to`. Optional legs don't count towards the SAC grade. |
| `conditions` | `weather[]`, `temp {min, max}`, `visibility`, `snowLine`, `traction`, `trail[]`, `crowding`, `start`, `why`, `note` | S | **Post only.** |
| `deviations[]` | `kind` (solo, night, unroped, off-trail, …), `at`, `note` | S | **Post only.** "Don't copy this." |
| `plan.gear[]` | `item` (~55 kinds), `label?`, `need` essential/conditional/optional, `when`, `amount` | G | Checklist with tick boxes. |
| `plan.for`, `plan.notFor` | lists of text | G | |
| `plan.variants[]` | `name`, `summary`, `distance`, `ascent`, `descent`, `duration`, `sac`, `viaFerrata`, `link`, `recommended`, `note` | G | `link`: a post slug or URL. |
| `plan.timing` | `start`, `turnaround`, `sunrise {start, note}`, `note` | G | Quoted `"HH:MM"` times. `start`: latest sensible start. `turnaround`: the time to give up and head back if you haven't reached the top, wherever you are (shown as "Turn around by" / "Umkehrzeit"). Set it so you're off exposed ground before afternoon storms or dark; say why in `note`. |
| `plan.alternatives` | `easier`, `harder`, `similar`: lists of post slugs | G | Shown with the posts' titles. |
| `sources[]` | `title`, `url`, `kind`, `lang`, `note` | G | |
| `hidden` | true/false | none | **Post only.** `true` switches the whole layer off, sidecar included, unread. |

The full enum lists (every hazard kind, gear item and so on) are in
`src/lib/hikes/facts-schema.ts`. A value outside them fails the build and lists the
allowed ones.

#### Fitness levels

Grade the whole day at a steady hiking pace, breaks not included. Take the **higher**
of the two columns. Then go up one for altitude above ~2500 m, heat, or a heavy pack.
Go down one when a lift takes most of the climb. Say why in `difficulty.note`.

| Level | Typical time | Ascent | Who it suits |
|---|---|---|---|
| 1 | under 2 h | under 300 m | Anyone; a walk. |
| 2 | 2–4 h | 300–700 m | Occasional hikers. |
| 3 | 4–6 h | 700–1100 m | Regular hikers. |
| 4 | 6–8 h | 1100–1500 m | Fit hikers used to long days. |
| 5 | over 8 h | over 1500 m | Very fit; a full mountain day or more. |

### `route` in detail

The route's shape and where it goes: its ends, its type, the usual route compared
with yours, detours, the ground underfoot, and the summits. The type is `RouteInfo` in
`facts-schema.ts`, and the build checks it in `facts.server.ts`.

```jsonc
// <slug>.hike.json (from Schneefernerkopf, shortened)
"route": {
  "start": {
    "name": {"en": "Ehrwald train station", "de": "Bahnhof Ehrwald"},
    "at": {"lat": 47.40956, "lon": 10.913795, "demEle": 977.4}
  },
  "end": {"lat": 47.413305, "lon": 10.980198, "demEle": 2581.3, "name": "Sonnalpin"},
  "type": "point-to-point",
  "official": {"en": "The usual route takes the Ehrwalder Almbahn up and skips Issentalköpfl, …", "de": "…"},
  "optional": [
    {
      "name": {"en": "Issentalköpfl", "de": "Issentalköpfl"},
      "from": "Ehrwalder Almbahn Bergstation",
      "to": "Issentalköpfl",
      "note": {"en": "Overgrown, unmarked detour; only for peak baggers.", "de": "…"}
    }
  ],
  "terrain": ["forest-road", "ski-slope", "meadow", "secured", "path", "scree", "snow", "ridge"],
  "shade": "low",
  "trails": ["801", "813"],
  "peaks": ["Issentalköpfl", "Schneefernerkopf"]
}
```

**Fields.** Every field is optional, and so is every field inside an `optional[]`
entry.

| Field | Type | Meaning |
|---|---|---|
| `start`, `end` | spot (below) | Where the walk starts and ends. Use the trailhead, station or bus stop a reader travels to, not the first node on the track. |
| `type` | `loop` / `out-and-back` / `point-to-point` / `lollipop` / `traverse` | The route's shape. If you leave it out, it's computed from the track (below). |
| `official` | text | How the usual or signposted route differs from yours: a lift you skipped, a peak you added, a different way down. Leave it out if you walked the usual route. |
| `optional[]` | list of `{from?, to?, name?, note?}` | Detours off the main route, such as a side summit or a viewpoint. `from`/`to` is a span (see Shared building blocks). Name it in `name` and say who it's for in `note`. |
| `terrain` | list of `road`, `forest-road`, `path`, `meadow`, `forest`, `ski-slope`, `rocky`, `scree`, `boulders`, `scramble`, `ridge`, `secured`, `snow`, `glacier`, `ice`, `mud`, `overgrown`, `steps`, `beach`, `urban` | The surfaces underfoot, listed in route order. For terrain per stretch, use `legs[].terrain`. See [`terrain`, `shade`, `trails`, `peaks`](#terrain-shade-trails-peaks). |
| `shade` | `none` / `low` / `moderate` / `high` | How much of the route is shaded. It matters on summer days. |
| `trails` | list of strings | Waymarked route numbers or names exactly as signposted (`"801"`, `"E5"`). Shown untranslated. |
| `peaks` | list of places | Summits reached on the main route. They go in the guide and in the JSON-LD (below). |

Any other key fails the build. So does a `type`, `terrain` or `shade` value that isn't
on its list.

**Spots: `start` and `end`.** These two take any place form, plus one more:
`{name, at?}`, for a trailhead or town that isn't a node.

| Form | Example | Result |
|---|---|---|
| Place (node name, `km N`, `{lat, lon, name?}`) | `"Knorrhütte"` | As anywhere else. A node name that matches nothing warns. |
| `{name}` | `{name: {en: "Ehrwald train station"}}` | Shown as plain text, with no map link and no warning. |
| `{name, at}` | `{name: {en: "Ehrwald station"}, at: {lat: …, lon: …}}` | `at` is looked up as a place for the map link and km, but your `name` is what's shown. |

- In the `{name, …}` form, any key other than `name` and `at` fails the build. That
  includes `{node: 123, name: …}`: since it has a `name`, it's read as a spot. Write
  `{name: …, at: {node: 123}}` instead.
- An object with `lat` is always read as a normal place, even if it has a `name`.

**Computed vs. written `type`.** With no `type`, the build classifies the track
(`classifyRoute` in `hike-facts.ts`):
- `out-and-back` if most of the second half retraces the first.
- `loop` if the start and end are close together.
- `point-to-point` otherwise.

It never computes `lollipop` or `traverse`, so write those yourself. Your `type`
replaces the computed one in the guide's **Route type** row and in the JSON-LD. The
**Route type** stat tile in the title card still shows the computed value.

#### `terrain`, `shade`, `trails`, `peaks`

These four describe the whole route in one line each. They have no spans and no km,
and nothing draws them on the charts or maps. `terrain`, `shade` and `trails` appear
only in the guide. `peaks` also goes into the JSON-LD.

```jsonc
// <slug>.hike.json (Wasenkogel, adapted)
"terrain": ["forest-road", "ski-slope", "meadow", "path", "secured", "rocky"],
"shade": "low",
"trails": ["697", "699", "602", "532", "BK", "D7"],
"peaks": ["Wasenkogel", "Nesselscheibe", "Gefällberg", {"node": 1638504578, "name": {"en": "Point 1212"}}]
```

```yaml
# The same in a post's front matter
facts:
  route:
    terrain: [forest-road, meadow, path, secured]
    shade: low
    trails: ["697", "699", BK]
    peaks: [Wasenkogel, Nesselscheibe]
```

**`terrain`: a list of fixed values.**

- Each entry must be one of the 20 values below, spelled exactly as shown (lower case,
  hyphenated). Anything else fails the build:
  `route.terrain[2]: unknown value "Scree" (expected one of: road, forest-road, …)`.
- There's no `label` escape hatch like hazards have. If nothing fits, pick the
  nearest value and explain it in `official` or a leg's `note`.
- Order is kept exactly as written, and duplicates aren't removed. List each surface
  once, in the order a walker first meets it.
- Rendered as one comma-separated row: `forest road, ski slope, meadow, path`.

Only the value names are enforced. The "use for" column is a convention, to keep
posts comparable:

| Value | Shown as (en / de) | Use for |
|---|---|---|
| `road` | road / Straße | Tarmac or paved road, including quiet lanes. |
| `forest-road` | forest road / Forststraße | Wide gravel or dirt track a vehicle can drive. |
| `path` | path / Pfad | An ordinary single-track footpath. The default walking surface. |
| `meadow` | meadow / Wiese | Grass, pasture, alpine meadow, with or without a trodden line. |
| `forest` | forest / Wald | Walking among trees where the woodland itself is the point: roots, needles, shade. A path through forest can be both `path` and `forest`. |
| `ski-slope` | ski slope / Skipiste | A groomed piste in summer: wide, often steep, loose or grassy. |
| `rocky` | rocky / felsig | Path over bedrock or slabs; hands rarely needed. |
| `scree` | scree / Geröll | Small loose stones that slide underfoot. |
| `boulders` | boulders / Blockgelände | Large blocks you step or hop between. |
| `scramble` | scramble / Kraxelei | Hands needed for balance or upward progress, without protection. |
| `ridge` | ridge / Grat | Walking along a crest. Say how exposed it is in `difficulty.exposure`. |
| `secured` | secured / versichert | Cables, chains, ladders or iron rungs. For a graded via ferrata, add `difficulty.viaFerrata` too. |
| `snow` | snow / Schnee | Snowfields you cross on foot, including old summer snow. |
| `glacier` | glacier / Gletscher | Walking on glacier ice or snow over it. Add a `glacier` or `crevasses` hazard. |
| `ice` | ice / Eis | Bare ice or iced-over path. |
| `mud` | mud / Matsch | Sections that are regularly muddy, not after one rainy day (that's `conditions` in a post). |
| `overgrown` | overgrown / zugewachsen | Vegetation covers the path: pushing through dwarf pine, high grass, nettles. |
| `steps` | steps / Stufen | Built stairs: stone steps, timber steps. |
| `beach` | beach / Strand | Sand or shingle shore. |
| `urban` | urban / Ortschaft | Through a town or village: pavements, streets. |

How many to list: what a reader would notice and pack for, not every 50 m of
gravel. Six to eight is plenty for a long day. When the mix differs a lot from
stretch to stretch, write `legs[]` with `terrain` per leg and keep the route-level list
short. Both render, and neither is computed from the other.

**`shade`: one fixed value.** One of `none`, `low`, `moderate`, `high`, the same
four-step scale as `difficulty.exposure`. Rendered as **Shade** ("Schatten"):
none / keine, low / gering, moderate / mittel, high / hoch. Anything else fails the build.
Convention, judged by **walking time**, not distance:

| Value | Use when |
|---|---|
| `none` | Practically no shade: above the treeline, open ridge, desert, beach. |
| `low` | Short shaded stretches, under about a quarter of the day. Typical for an Alpine route that starts in forest and climbs out of it. |
| `moderate` | Roughly half shaded. |
| `high` | Mostly under trees or in a gorge. |

Judge it for a sunny summer day around midday. If shade depends on the time of day
(a north face shaded in the morning), say so in `official` or in a `sun`/`heat`
hazard's `note`, which goes in the safety box.

**`trails`: a list of free strings.**

- Any non-empty string, no fixed list. A bare number is accepted and turned into a
  string (`801` → `"801"`). Write it as a string anyway: in YAML, a number with a
  leading zero or a decimal point (`08`, `1.2`) wouldn't come through as written.
- Write the number or code exactly as it appears on the signposts: `"801"`, `"E5"`,
  `"BK"`, `"Via Alpina"`. Don't add "Trail" or "Nr.". The row is the same in both
  languages and marked `translate="no"`, so browsers won't translate it.
- Order kept as written, duplicates kept. Route order is the most useful.
- Rendered as **Waymarked trails** ("Markierte Wege"), comma-separated, plain text with
  no links.
- How well the route is marked doesn't belong here; that's `navigation`.

**`peaks`: a list of places.** Every entry is a place in any of the forms in Shared
building blocks:

| Form | Example | Result |
|---|---|---|
| Node name | `"Wasenkogel"` | **The usual one.** Matched like story place links. Gets coordinates, `ele` from the node (else the track) and a map link. |
| `{node, name?}` | `{node: 1638504578, name: {en: "Point 1212"}}` | A summit node with no OSM name, or that you want called something else. |
| `{lat, lon, name, ele?}` | `{lat: 47.4212, lon: 10.9863, name: "Zugspitze", ele: 2962}` | A summit that isn't one of the hike's nodes. Give `ele`: a point near the route takes the track's elevation, but one off it gets none. |
| `km N` | `"km 12.4"` | Possible, but it shows as "km 12.4", which is no name for a summit, and the JSON-LD `Mountain` gets that as its name. Avoid. |

- A name that matches no node is a build **warning**, not an error. The summit still
  shows, as plain text with no elevation and no map link, and in the JSON-LD it gets
  no `geo`. Fix the spelling or switch to `{node}` / `{lat, lon}`.
- Rendered as **Summits** ("Gipfel"): `Wasenkogel (1211 m), Nesselscheibe (1258 m)`.
  Each name with coordinates is a link that centres the 2D map on it. No km is shown.
- Order kept as written. List them in the order they're reached.
- List summits **reached on the main route**. Detour summits go in `optional[]`
  instead. Put them in `peaks` as well only if you want them in the guide's Summits row
  and in the JSON-LD.
- `peaks` doesn't feed the "bagged peaks" list on the `/hikes` index. That list comes
  from the hike's nodes tagged `natural=peak` (minus `visited: no` / `missing`), so a
  summit in `peaks` that isn't a node won't appear there.

**JSON-LD.** Each entry in `peaks` becomes a schema.org `Mountain` in the
post's `BlogPosting.about`:

```json
"about": [
  {"@type": "Mountain", "name": "Wasenkogel",
   "geo": {"@type": "GeoCoordinates", "latitude": 47.7288407, "longitude": 11.6905672, "elevation": 1211}}
]
```

- `name` is always the **English** text.
- `geo` appears only when the place has coordinates. `elevation` appears only when it
  has `ele`.
- With no `peaks`, the post has no `about`.

**Merging (sidecar + post).** All four are replaced whole, never merged entry by entry:

- `shade`: the post's value wins; `shade: null` removes it.
- `terrain`, `trails`, `peaks`: the post's list replaces the sidecar's list. To add
  one entry, repeat the whole list. To remove the field, write `null`. An empty list
  `[]` also renders nothing.
- Typical post-level use: a walk that skipped a summit writes its own `peaks`; a
  winter walk writes `terrain` with `snow`.

**How it renders** (guide, Route section):

| Field | Shown as (en / de) |
|---|---|
| `start` / `end` | **Start** / **End** rows ("Start" / "Ziel"). Places link to the map. |
| `type` | **Route type** row ("Routentyp"). |
| `terrain` | **Terrain** row ("Gelände"), comma-separated labels. |
| `shade` | **Shade** row ("Schatten"). |
| `trails` | **Waymarked trails** row, comma-separated. |
| `peaks` | **Summits** row, comma-separated place links. |
| `official` | A paragraph under the rows: "**Standard route:** …" ("Normalweg"). |
| `optional[]` | Its own heading, **Optional detours** ("Optionale Abstecher"). One line per entry: **name** (from – to) — note. |

`peaks` also becomes one schema.org `Mountain` per summit in the post's JSON-LD:
`name` is the English name, plus `geo` with latitude, longitude and elevation when the
place has coordinates. Peaks that are nodes or `{lat, lon}` places get coordinates;
an unmatched name doesn't. Detour summits belong in `optional`, not `peaks`, unless
you want search engines to list them too (Schneefernerkopf does this for
Issentalköpfl).

**Merging (sidecar + post, §2b).**

- `start`, `end`, `type`, `shade`: the post's value wins.
- `official`: merged per language.
- `terrain`, `trails`, `peaks`: the post's list **replaces** the sidecar's. To add one
  summit, repeat the whole list.
- `optional[]`: entries are matched on `name` (its English text), or on `from` + `to`
  when there's no name. A matching post entry merges into the sidecar's; anything else
  is appended. `remove: true` drops a sidecar entry.
- `null` deletes: `type: null` brings back the computed type, and `route: null` drops
  the whole block.

**Related fields: which to use.**

| You want to say | Use |
|---|---|
| Terrain, grade or marking stretch by stretch | `legs[]` |
| How hard a stretch is | `difficulty.sections[]` |
| A different route someone could take instead | `plan.variants[]` (a whole alternative), not `optional` (a detour off this one) |
| How to reach `start` and get home from `end` | `access.transport[]`, `access.parking[]` |
| Waymarking quality | `navigation` |

### `navigation` in detail

How easy the way is to find on the ground. It covers paint, signposts and cairns, not
how hard the walking is (that's `difficulty`) or whether your phone works (that's
`signal`). Type: `Navigation` in `facts-schema.ts`; validated in `facts.server.ts`.

```jsonc
// <slug>.hike.json (from Schneefernerkopf)
"navigation": {
  "marking": "partial",
  "offline": true,
  "note": {
    "en": "Red-white-red to Knorrhütte, sparse paint and cairns after.",
    "de": "Rot-weiß-rot bis zur Knorrhütte, danach spärliche Markierungen und Steinmänner."
  },
  "spans": [
    {
      "from": "Knorrhütte",
      "to": "Zugspitzplatt",
      "marking": "poor",
      "note": {"en": "Faded paint on scree; easy to lose at night.", "de": "…"}
    }
  ]
}
```

**Fields.** All optional except `spans[].marking`. Leave the block out rather than
writing an empty `navigation: {}`.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `marking` | `good` / `partial` / `poor` / `none` | no | Waymarking along the **whole route**, judged by its typical stretch. Put the exceptions in `spans`. |
| `note` | text | no | Your words: what the marks look like (red-white-red, blue-white for alpine routes, cairns, poles), where junctions are signed, where it's easy to go wrong. |
| `offline` | true/false | no | `true` adds "Carry an offline map." Set it when the marks alone won't get you there, or when the signal is gone where you'd need a map. `false` and omitting it look the same. |
| `spans[]` | list of objects | no | Stretches whose marking differs from the overall `marking`. |
| `spans[].from`, `spans[].to` | place | at least one, in practice | The stretch, as a span (see Shared building blocks). An open end runs to the route's start or end. |
| `spans[].marking` | `good` / `partial` / `poor` / `none` | **yes** | Marking on this stretch. Missing it fails the build. |
| `spans[].note` | text | no | Why this stretch differs: faded paint, missing junction sign, marks under snow until July, … |

Any other key, inside `navigation` or a span, fails the build with
`unknown key "…" (expected one of: …)`.

**Choosing a `marking` value.** The values are fixed. The meanings below are the
convention, so grades stay comparable between posts:

| Value | Shown as (en / de) | Use when |
|---|---|---|
| `good` | good / gut | Continuous marks and signed junctions. You could walk it without a map in clear weather. |
| `partial` | partial / lückenhaft | Marked, but with gaps: unsigned junctions, stretches where you look for the next mark, or marks that lapse on open ground. A map helps. |
| `poor` | poor / schlecht | Sparse, faded or ambiguous marks, or only cairns. Route-finding is needed, and in fog or darkness it gets hard. |
| `none` | none / keine | No waymarks. You navigate by map, GPS or terrain. |

**How it renders** (guide, Route section; no tiles, charts or maps):

- `marking`, `note` and `offline` share one row labelled **Waymarking**
  ("Markierung"): `partial — Red-white-red to Knorrhütte, … Carry an offline map.`
  The row appears if any of the three is set; with no `marking` the note starts the
  row.
- Each span is a line under the list:
  `Knorrhütte – Zugspitzplatt: waymarking poor — Faded paint on scree; …`.
  With only `from`, it reads `Knorrhütte →`; with only `to`, `→ Zugspitzplatt`.
  Places link to the map like everywhere else in the facts.
- Spans are **not** drawn on the elevation charts or maps. To get a stretch drawn,
  add a hazard with a span as well (below).

**Merging (sidecar + post, §2b).**

- `marking`, `offline`: the post's value wins. `note`: merged per language.
- `spans` are matched on `from` + `to`, after the places are resolved. A post span
  with the same ends is merged into the sidecar's (e.g. change only `marking`). Any
  other post span is appended.
- `{from: X, to: Y, remove: true}` drops the sidecar's span. `navigation: null` drops
  the sidecar's whole block; `offline: null` drops just that field.
- Typical use: the route is `good` in the sidecar, and a post on a snowy day adds a
  span with `marking: none` and a note that the marks were under snow. Snow is
  temporary, so it belongs in the post, not the sidecar.

**Related fields: which to use.**

| You want to say | Use |
|---|---|
| How well the whole route or a stretch is marked | `navigation` |
| Marking per leg, in the legs table | `legs[].marking` (same four values). Use it if you already write `legs`; don't repeat the same stretch in `navigation.spans`. |
| Getting lost here is a **safety** issue (fog on a plateau, a wrong turn towards a cliff) | Also a hazard `kind: poor-marking` or `kind: navigation` with a span and `severity`. That one goes in the safety box and is drawn on the charts and maps. |
| Readers should carry a map or GPS | `offline: true`, and `plan.gear` items `offline-map`, `gps`, `paper-map`, `compass`, which go on the checklist. |
| Where there's no phone signal | `signal[]` |
| Waymarked route numbers ("801") | `route.trails` |

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
- **Listing them.** Put route places in the sidecar, so every post on the route
  shows them. Use a post's own list only when that day differs:

  ```jsonc
  // <slug>.hike.json
  "places": ["knorrhuette", "sonnalpin"]
  ```

  ```yaml
  # <date>-<slug>.md: omit to use the sidecar's list
  places: [knorrhuette]   # replaces the sidecar's list for this post (repeat any you keep)
  places: []              # shows no place docs on this post
  ```

  An unknown slug fails the build, naming the sidecar or post. The docs appear under
  **Places on this route**, collapsed. Their photos join the post's gallery.
- **Links from the story:**
  - A doc's title or alias in the text is marked whether or not it has an elevation:
    `Knorrhütte (2052 m)` and plain "through Marienstein" look the same. The name
    links to the 2D map when it's one of the hike's nodes. The **first** mention of
    each doc also gets a small ⓘ, which scrolls to the doc and opens it.
  - A plain mention must be spelled as written, case and accents included; spaces
    and hyphens are interchangeable. It links to the map only when it's a node's
    whole name. Headings, links and photo captions aren't marked.
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
| `images[].lat/lon` | `image_optimize.py`, from Immich (`backfill_gps.py` for older posts). |
| `images[].taken`, `located: track` | `backfill_time.py` (`deploy.sh` runs it). |
| `demEle` (photos, nodes, sidecar facts places) | `scripts/backfill_terrain.py`. Run it after adding nodes or `{lat, lon}` facts places to a sidecar. |
| Nodes | [Overpass turbo](https://overpass-turbo.eu/) around the route; keep the OSM shape. Then `node scripts/check-nodes.js`. |
| Node `visited` | Your own comparison with Komoot's peak list. |
| Map tiles | `scripts/map-download.js <slug>`, after setting `origin` and `height`. |

### Scripts to run for each hike

Run these from the repository root, in this order. `POST` arguments are the post's
filename (`2026-07-19-schneefernerkopf.md`; the `.md` is optional). Every Python script
takes `--dry-run` to preview its changes and `--help` for all its options. The image
scripts read `$IMMICH_URL` and `$IMMICH_API_KEY`.

```sh
# 1. Sidecar nodes: check for duplicate ids, names and wikidata across all hikes.
node scripts/check-nodes.js

# 2. Map tiles, once the sidecar has `origin` and `height`. Takes the slug, not the
#    post filename. Mapbox/Nextzen tokens come from the environment
#    (mapboxDEMAccess, mapboxSatelliteAccess, nextzenAccess, ...).
node scripts/map-download.js schneefernerkopf

# 3. Match the post's compressed photos to their Immich originals. Writes
#    scripts/matches/hikes/<post>.json. Album is guessed from the post name;
#    pass --album "Name" if the guess is wrong. --force re-matches an existing report.
#    To review or fix matches in the browser instead: scripts/.venv/bin/python scripts/image_match_web.py
scripts/.venv/bin/python scripts/image_match.py 2026-07-19-schneefernerkopf.md

# 4. Build the AVIF tiers and blur placeholders, and write the post's `images:`
#    (w, h, blur, lat/lon and demEle from Immich). --force rebuilds an existing `images:`
#    (see Gotchas: this resets hand-fixed GPS).
scripts/.venv/bin/python scripts/image_optimize.py 2026-07-19-schneefernerkopf.md

# 5. Photo timestamps (`taken`), and placing photos without GPS on the recorded track
#    (`located: track`). deploy.sh also runs this for every post.
scripts/.venv/bin/python scripts/backfill_time.py 2026-07-19-schneefernerkopf.md

# 6. Distance, ascent, descent and moving time from the recorded GPX. Takes the slug
#    or the post filename. deploy.sh runs it with --missing-only for every post;
#    run it without that flag to overwrite metrics already written.
scripts/.venv/bin/python scripts/track_metrics.py 2026-07-19-schneefernerkopf.md

# 7. demEle for the sidecar's nodes and `{lat, lon}` facts places, and any located
#    photo still missing it. Re-run whenever you add nodes or facts places.
#    Nodes are done for every *.hike.json regardless of the POST argument.
scripts/.venv/bin/python scripts/backfill_terrain.py 2026-07-19-schneefernerkopf.md
```

`backfill_gps.py` (photo `lat`/`lon`) and `backfill_file_size.py` were one-time
backfills for posts made before `image_optimize.py` wrote those fields. A new hike
doesn't need them.

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
