# Adding a hike post on a new route

How to publish a hike you have not walked before. For a *second* post on a route that
already exists, skip to [Another date on an existing route](#another-date-on-an-existing-route).

Everything is keyed off one **slug** - a lowercase, underscore-separated name such as
`drachenkopf` or `fockenstein_geierstein`. Pick it once; every file below is named after
it, and every path is derived from it. The route URL becomes
`/projects/data-viz/hikes/<slug>` and the post URL `/hikes/<date>-<slug>/`.

**Nothing needs to be added to `hikes.json`.** It only holds hikes still waiting on a
post. A new route that ships with its post is discovered from the files themselves.

## The six files

| # | File | Required |
| --- | --- | --- |
| 1 | `static/_projects/data-viz/hikes/geojson/<slug>.json` | yes |
| 2 | `static/_projects/data-viz/hikes/gpx/<slug>.gpx` | optional |
| 3 | `static/images/projects/data-viz/hikes/<slug>.jpg` | yes |
| 4 | `static/images/projects/data-viz/hikes/thumb/<slug>.jpg` | yes |
| 5 | `static/_projects/data-viz/hikes/markdown/<slug>.hike.json` | yes |
| 6 | `static/_projects/data-viz/hikes/markdown/<date>-<slug>.md` | yes |

Plus one command to fetch the map tiles. Details below.

### 1. The route GeoJSON

Export the route from [openrouteservice](https://maps.openrouteservice.org/) - the
process is written up in [How I make the hiking routes](/blog/2025-03-28-hiking-routes/).
Save it as `<slug>.json`. The site reads `features[0]` and expects:

```jsonc
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "properties": {
      "ascent": 1505.5,          // metres
      "descent": 1492,           // metres
      "summary": { "distance": 14.853, "duration": 22117 }   // km, seconds
    },
    "geometry": {
      "type": "LineString",
      "coordinates": [[10.93817, 47.387558, 1104], ...]      // lon, lat, elevation
    }
  }]
}
```

The third coordinate is elevation and drives the elevation chart, so keep it. Distance
and duration stay in the GeoJSON's own units (km and seconds); the site converts them.

### 2. The GPX (optional)

Drop the recorded track at `<slug>.gpx`. If present, the post page shows a GPX download
link automatically.

**If you want the track listed in the Web graph popup, name it in the post's front
matter** (`gpx:` - see below). The popup only lists a GPX a post explicitly declares;
the download link on the post page appears from the file's existence alone.

Historically, not all GPX recordings were real, rather converted from GeoJSON.
Manually specified `gpx:` path points to a real recorded GPX route, while non-specified
files are auto-generated.

### 3-4. The images

A full-size photo at `<slug>.jpg` and a thumbnail at `thumb/<slug>.jpg`. Both are
required: listings and social cards use the thumbnail path, which is derived by
inserting `thumb/`, so a missing thumbnail is a broken image rather than a fallback.

The thumbnails are generated from full-size photos using `gen_thumb.sh`.

### 5. The sidecar - `<slug>.hike.json`

This is what makes the hike *exist*: the site enumerates hikes by scanning for these
files. Fields shared by every date on the route live here.

```json
{
  "name": "Drachenkopf",
  "description": "Hike from Ehrwald to Drachenkopf (2302 m).",
  "image": "/images/projects/data-viz/hikes/drachenkopf.jpg",
  "origin": { "lat": 47.37161708892748, "lon": 10.93568801879883 },
  "height": 512,
  "checkpoints": [
    [10.9385542, 47.3874899],
    [10.9352297, 47.3775867]
  ]
}
```

- **`name`** - the hike's title. A post can override it per date with `title`.
- **`description`** - one sentence. The post page shows the post's own `description`
  followed by this one, so write it to read as a continuation.
- **`image`** - full-size path from #3. Do not point at the thumbnail.
- **`origin`** - the map centre, hand-picked. Not the trailhead; the point that frames
  the whole route. Getting it wrong mis-frames the rendered map, so eyeball the result.
- **`height`** - the rendered map size in pixels. Any number works; existing hikes use
  15 distinct values from 256 to 1536, most often `512`, then `384` and `768`. Bigger
  for longer or more sprawling routes.
- **`checkpoints`** - a *coarse* `[lon, lat]` outline of the route. This is not the
  track; it is the simplified line drawn on the Web graph (`/hikes/tag/Web/`). Take a
  handful of points along the GeoJSON - existing hikes use between 2 and 19, typically
  6. Note the order: longitude first, as in GeoJSON.
- **`nodes`** - optional OSM points of interest (peaks, huts, waterfalls). Omit the key
  entirely if there are none; do not write `[]` unless you mean it. 71 of 127 hikes have
  them. Query them with [Overpass](https://overpass-turbo.eu/) and keep the OSM shape:

  ```json
  { "id": 264056175, "lat": 47.6521541, "lon": 11.6431635,
    "tags": { "name": "Seekarkreuz", "natural": "peak", "ele": "1601" } }
  ```

  They render as labelled markers on the 2D map and feed the search index's
  `nodeNames`, so a hut or summit named here becomes searchable. Run
  `node scripts/check-nodes.js` afterwards to catch duplicate ids, names or wikidata
  entries across hikes.

### 6. The post - `<date>-<slug>.md`

Name it `YYYY-MM-DD-<slug>.md`. **The filename is the source of truth** for the date and
the route - there is no `date:` or `path:` key, and the URL is built from it.

Front matter is flat: one key per field, no nesting.

```markdown
---
title: Drying up on Drachenkopf
description: Scorching summer hike to the peak, paired with a social hike back.
tags:
  - Climb
people:
  - Stanislav Kidalau
gpx: /_projects/data-viz/hikes/gpx/drachenkopf.gpx
distance: 14853
duration: 369
ascent: 1566
descent: 1549
---
The body starts here, no blank line after the fence.
```

Every key is optional. What each does:

| Key | Effect |
| --- | --- |
| `title` | post title; falls back to the sidecar's `name` |
| `description` | prepended to the sidecar's `description` |
| `image` | only if this date's photo differs from the hike's; otherwise omit |
| `tags` | tag chips, and membership of `/hikes/tag/<tag>/` - a new tag creates its page |
| `people` | participant cards, matched by name against `src/lib/data/contacts.json` |
| `author` | defaults to the site owner |
| `gpx` | see #2 |
| `distance`, `duration`, `ascent`, `descent` | **metres and minutes** - override the GeoJSON |

Note the units: the GeoJSON stores km and seconds, but front matter is canonical -
metres and minutes. `duration: 369` is 6h 09m. Omit these entirely to let the GeoJSON
speak; write them only to correct it.

Those are the keys you will actually write. For the rest, see
[Full front matter reference](#full-front-matter-reference) below.

## Full front matter reference

Front matter is **flat**: one key per field, no nested `properties`, `dates` or
`standardFeatures` blocks. Every key is optional, and each is routed to a fixed level -
this post, or the hike as a whole.

```yaml
---
# ---- this post ----
title: Drying up on Drachenkopf
description: Scorching summer hike to the peak.
image: /images/projects/data-viz/hikes/drachenkopf_2026.jpg
tags:
  - Climb
people:
  - Stanislav Kidalau
author: Mykola Morozov
gpx: /_projects/data-viz/hikes/gpx/drachenkopf.gpx
distance: 14853          # metres
duration: 369            # minutes
ascent: 1566             # metres
descent: 1549            # metres
filePath: /_projects/data-viz/hikes/geojson/drachenkopf.json
metaPath: /_projects/data-viz/hikes/markdown/drachenkopf.hike.json

# ---- the hike, overriding its sidecar ----
name: Drachenkopf
height: 512
origin: { lat: 47.37161708892748, lon: 10.93568801879883 }
checkpoints:
  - [10.9385542, 47.3874899]
  - [10.9352297, 47.3775867]
nodes:
  - id: 264056175
    lat: 47.6521541
    lon: 11.6431635
    tags: { name: Drachenkopf, natural: peak, ele: '2302' }
draft: false
hidden: false

# ---- display only ----
contacts:
  - name: Ada Lovelace
    avatar: /images/hikes/people/ada.jpg
    links:
      - { network: Strava, url: 'https://www.strava.com/athletes/1' }
      - { label: Blog, url: 'https://example.com' }
---
```

### Keys that set this post

| Key | Type | Effect |
| --- | --- | --- |
| `title` | string | post title; falls back to the hike's `name` |
| `description` | string | prepended to the hike's `description`, so write it to read as a continuation |
| `image` | string | this post's photo; falls back to the hike's. Write it only when it differs |
| `tags` | string[] | tag chips, and membership of `/hikes/tag/<tag>/` |
| `people` | string[] | participant cards, matched against `src/lib/data/contacts.json` |
| `author` | string | defaults to the site owner |
| `gpx` | string | served path of the track; also what puts a GPX link in the Web graph popup |
| `distance` | number | **metres** |
| `duration` | number | **minutes** |
| `ascent`, `descent` | number | **metres** |
| `filePath` | string | a different route GeoJSON for this date; defaults to `<slug>.json` |
| `metaPath` | string | a different sidecar for this date; defaults to `<slug>.hike.json` |
| `places` | string[] | place docs shown at the bottom, by slug: `[knorrhuette]`. Replaces the sidecar's `places`. See [Adding a place doc](adding-a-place.md) |

### Keys that set the hike

These override the `<slug>.hike.json` sidecar for this post only. You will rarely want
them - if a value is wrong for every date on the route, fix the sidecar instead.

| Key | Type | Effect |
| --- | --- | --- |
| `name` | string | the hike's name |
| `height` | number | rendered map size in pixels |
| `origin` | `{ lat, lon }` | map centre; replaces the sidecar's |
| `checkpoints` | `[[lon, lat], ...]` | the coarse Web-graph outline |
| `nodes` | object[] | OSM points of interest |
| `draft`, `hidden` | boolean | see the caveat below |

### Rules

- **Omitted or `null` falls back.** No key can clear a value back to null, so there is
  no way to say "this post has no description" other than letting the hike's stand.
- **Units are canonical, not the GeoJSON's.** The GeoJSON stores km and seconds; front
  matter is metres and minutes. `duration: 369` is 6h 09m.
- **Paths are served paths** (`/_projects/...`), not filesystem paths.
- **`route`, `date` and `path` have no key.** They are identity: the route comes from
  the slug and the date from the filename, and overriding them would desync the URL from
  the file.
- **Unrecognised keys are ignored**, not merged, so a typo cannot reach the page. That
  includes the old nested `properties:` / `dates:` / `standardFeatures:` blocks, which
  are inert - a file written before the flattening will silently stop applying.
- **A malformed `origin` throws.** It must be `{ lat: <number>, lon: <number> }`. The
  same goes for a `metaPath` naming a sidecar that does not exist. Note what a throw
  costs here: the build still exits 0 and simply omits the page, so watch the log.
- **Precedence**, for the keys that also exist in `hikes.json`: front matter first, then
  the date's entry, then the hike's. `metaPath` is resolved *before* the merge, so a
  post that swaps in a sidecar and also sets one of that sidecar's own fields by hand
  keeps its own value.

### What reaches where

Post-level keys are folded into the model when the site is built, so they reach
everything: the post page, listings, feeds, the search index and the Web graph.

Hike-level keys are resolved per post and reach less far:

- `name` shows on the post page, listings and feeds, but **not** the search index, which
  reads the sidecar's name.
- `height`, `origin`, `checkpoints` and `nodes` affect only the post page's own map.
  They are not in `/hikes/index.json`, so the Web graph and the search index still use
  the sidecar's.
- `draft` and `hidden` are **inert in front matter**. Every consumer reads them from
  `hikes.json`, so setting them here will not hide a post. To hide one, remove the post
  or mark its hike in `hikes.json`.

## Fetch the map tiles

The 2D and 3D maps render from tiles committed under
`static/_projects/data-viz/maps/`. Download the ones your new route needs:

```sh
cd scripts
mapboxDEMSKU=... mapboxDEMAccess=... \
mapboxSatelliteSKU=... mapboxSatelliteAccess=... \
nextzenAccess=... \
node map-download.js <slug>
```

It reads the sidecar's `origin` and `height` to work out which tiles are in frame, so
run it *after* step 5, and re-run it if you change either. Existing tiles are skipped,
and it waits a second between downloads to avoid rate limits.

## Participants

A name in `people` is matched against `src/lib/data/contacts.json`:

```json
{ "Stanislav Kidalau": {
    "avatar": "/images/hikes/people/stanislav_kidalau.jpg",
    "links": [{ "network": "Instagram", "url": "https://www.instagram.com/..." }] } }
```

An unlisted name still gets a card, just bare. To give someone details for one post
only, use a `contacts` block in the front matter instead of editing the shared book:

```yaml
contacts:
  - name: Ada Lovelace
    avatar: /images/hikes/people/ada.jpg
    links:
      - { network: Strava, url: 'https://www.strava.com/athletes/1' }
      - { label: Blog, url: 'https://example.com' }
```

A link needs a `url` plus either a known `network` (which picks the icon) or a freeform
`label`.

## Check it

```sh
pnpm build     # prerenders everything; the new pages should appear
pnpm check     # types
```

Then look at:

- `/hikes/<date>-<slug>/` - the post, its map, elevation chart and stats
- `/hikes/` - the card, with the right thumbnail and description
- `/hikes/tag/<tag>/` - if you introduced a tag
- `/hikes/tag/Web/` - the route's outline on the graph, from `checkpoints`

**Watch the build log.** A prerender failure does not fail the build: `svelte.config.js`
sets `prerender.handleHttpError` to `console.warn`, so a broken page is silently dropped
from the output. A clean build prints no warnings from it, so if you see one, a page is
missing. Compare page counts if unsure:

```sh
find build -name '*.html' | wc -l
```

## Another date on an existing route

Add only file #6 - `static/_projects/data-viz/hikes/markdown/<date>-<slug>.md` - using
the existing slug. The sidecar, GeoJSON, images and tiles are already there, and the
date is picked up from the filename.

If that route had the date listed in `hikes.json` as unwritten, delete that entry's date
now; the post supersedes it. If it was the entry's only date, delete the whole entry -
`hikes.json` should only ever describe hikes that are still missing a post.

## A hike with no post yet

To put a route on the map without writing about it, add files #1-#5 and then an entry in
`src/lib/data/hikes.json`, since there is no post to carry the date:

```json
{ "properties": { "dates": [{ "date": "2023-07-16" }] },
  "route": "/projects/data-viz/hikes/herzogstand" }
```

Add `"draft": true` to grey it out on `/projects/data-viz/`, or `"hidden": true` to keep
it off the site entirely. Metric overrides for that date go in the same `properties`
block. When you eventually write the post, move those values into its front matter and
remove the entry.
