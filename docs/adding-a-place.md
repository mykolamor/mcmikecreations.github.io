# Adding a place doc

A **place doc** is reference text for one hut, peak, lake, pass or town, written once
and shown at the bottom of every hike post that lists it. Use it for what stays true
between hikes (opening season, beds, water, how to get down), so the story itself can
stay a story.

## The file

`static/_projects/data-viz/hikes/places/<slug>.md`, next to the posts' `markdown/`
folder. The slug is lowercase letters and digits joined by `-` or `_`
(`knorrhuette`, `zugspitz_platt`), and it is how posts refer to the doc.

```markdown
---
title: Knorrhütte
description: DAV hut at 2052 m on the edge of the Zugspitzplatt.
tags: [Hut, DAV]          # optional
aliases: [Knorr hut]      # optional: more names it goes by in posts
images: {...}             # optional; written by the image tools, as for posts
---
Markdown text, with images like a post's:

![The terrace in the morning](/images/projects/data-viz/hikes/places/knorrhuette/2026-07-19-00.jpg)
```

- **`title`** and **`description`** are required. The description is shown under the
  title while the doc is collapsed, so make it one useful sentence.
- **`aliases`**: the title always counts as one of the doc's names; aliases add more.
- No other keys. Anything else (a `date`, `facts`, metrics) fails the build, naming the
  file, so a typo can't hide.
- Images live in `static/images/projects/data-viz/hikes/places/<slug>/`, named and
  optimised like a post's story images (`<capture-date>-<NN>`, AVIF tiers, blur).

## Translating it

A translation is a second file beside the doc, `<slug>.<lang>.md` (`knorrhuette.de.md`),
with `<lang>` any language in `LANGS` (`src/lib/i18n/translation-name.js`) but `en`.
Its front matter takes only `title`, `description` and `aliases`, all optional, and its
body is the whole translated text:

```markdown
---
title: Knorrhütte
description: DAV-Hütte unter dem Zugspitzplatt.
aliases: [Knorr-Hütte]
---
Der übersetzte Text, mit denselben Fotos.
```

The English file must exist, an unknown language or any other key fails the build, and
a translation is never listed as a place doc of its own. Photos it uses count as used.
Details: [hike-data-reference.md](hike-data-reference.md#6b-localization).

## Showing it in posts

List the slug in the route's sidecar, `<slug>.hike.json`, so every post on that route
shows it:

```json
"places": ["knorrhuette"]
```

A post can set its own list in its front matter, which **replaces** the sidecar's for
that post (`places: []` shows none):

```yaml
places: [knorrhuette]
```

An unknown slug fails the build, naming the sidecar or post. Each listed doc becomes a collapsed
section under **Places on this route**, after the facts and before the participants.
Its photos join the post's gallery, after the post's own.

The story links to it in two ways:

- **Automatically:** the first `Name (1234 m)` reference whose name is one of the doc's
  names gets a small ⓘ link after it. The name keeps its own link to the 2D map. Not in
  headings, links or photo captions.
- **Explicitly:** `[the hut](place:knorrhuette)` links any text to the doc. A slug the
  post doesn't list renders as plain text.

Either link opens the doc. A URL ending in `#place-<slug>` opens it on arrival too.

## Images: the CRM

The hike CRM (`pnpm crm`, see `scripts/crm/README.md`) treats place docs like posts:

- **`pnpm crm images`** and **`pnpm crm terrain`** cover place docs as well as posts
  (AVIF tiers, `w`/`h`/`blur`, and `demEle` on located photos). **`pnpm crm photo-times`**
  skips place docs: they have no date or track.
- **The UI** lists place docs on the Open screen:
  - **+ New place doc** creates a doc (slug, then its front matter in **Details**).
  - **Details** edits the front matter, **Write** the text. `images` is left alone.
  - **Photos** works as for posts and writes into the doc's image folder. A place doc
    has no date to search around, so its source bar searches Immich by text (smart
    search, prefilled with the doc's title), optionally narrowed by a date range.
  - In **Write**, **Photo** inserts one of the doc's photos into the text.
- Immich links are kept under `places/<slug>.md` in `scripts/crm/data/immich-links.json`,
  beside the posts'. A post's name always starts with its date and a place doc's never
  does, so they can't collide.
