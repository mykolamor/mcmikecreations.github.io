---
name: writing-presentations
description: Use when creating, extending or fixing a slide deck / presentation embedded in a blog post (a `![…](…/presentation/index.js "presentation")` embed), turning slide notes like gpu-paper-slides.md into slides, or when slides animate wrongly, lag on rapid arrow keys, replay on theme/language switch, or break in the overview grid.
---

# Writing presentations

## Overview

A presentation is a folder of plain browser ES modules under `static/images/blog/<post-slug>/presentation/`.
The site's frame (`src/lib/presentation/`) owns the toolbar, keys, swipe, grid, fullscreen, deep links,
theme and language. A slide only answers lifecycle hooks: **build once, snap to any state instantly,
animate one step, restyle in place.**

The full contract is in `src/lib/presentation/types.ts`. Hook semantics are in [reference.md](reference.md).
The worked example, with one technique per slide, is
`static/images/blog/markdown-test/presentation/` (`slides/text.js`: HTML + anime.js;
`diagram.js`: fetched SVG + anime.js timeline with `reverse()`; `bars.js`: d3 with an entrance, which that demo asked for;
`scene.js`: three.js + `claimInput` + image thumbnails). **Read the example closest to your slide before writing it.**

## Recipe

1. **Folder:**
   ```
   static/images/blog/<post-slug>/presentation/
     index.js            # export default { name: '<deck-name>', slides: [a, b, c] }
     slides/<name>.js    # export default { name, label, states, mount, snap, step, … }
     lib.js              # export * from '../../_kit/index.js' (+ this post's palette exports)
     figs/<name>.js      # figures (diagrams, plots) drawn with the kit; embeddable in the post too
     data.js|*.json      # data extracted from the source, not typed in by hand
     <asset>.svg|json    # fetched by slides; served no-cache
   ```
   **Build slides on the shared figure kit** (`static/images/blog/_kit/`, re-exported by the deck's `lib.js`, imported
   relatively): `slide({ name, label, title, states, build(b, root, ctx) })` gives you `mount`/`snap`/`step`/`update` for free;
   `b.text`/`b.svgText`/`b.attr` register `{ en, de, uk }` text, `b.part(el, (s) => props)`/`b.show(el, from, until)` register
   what changes per state. Helpers: `bullets`, `table`, `barChart`, `canvas`, `arrow`, `svg`, `h`, `num`/`fmt`/`times`/`same`,
   `tint`/`stripes`, and `figure(b, new URL('../figures/x.svg', import.meta.url), css, alt)` for converted images.
   Figures in `figs/` take `(b, root, …)` and draw into `root`, so `embedFigure` (see `writing-blog-script-embeds`) can show
   them in the post as well. Hand-written hook objects (the `markdown-test` demo) still work for one-off slides.
2. **Embed** it in the post on its own line. The alt text is the caption, and the title must contain `presentation`:
   ```markdown
   ![Talk slides](/images/blog/<post-slug>/presentation/index.js "presentation")
   ```
   **Always set `name`** in `index.js`. Otherwise the deck is called `presentation`, and deep links
   (`[see](#<deck-name>/<slide>/<state>)`) and `[data-presentation="…"]` lookups clash between decks.
3. **One slide per file.** Give it a `name` (kebab-case; it's used in the URL), a `label` (shown in the grid and
   read by screen readers), and `states` as named objects: `[{ name: 'empty' }, { name: 'one' }, …]`.
   The `states` count is the number of arrow presses on the slide plus one.
4. **Write each slide to this skeleton:**
   ```js
   /** @typedef {import('../../../../../../src/lib/presentation/types').SlideContext} SlideContext */
   /** @type {WeakMap<SlideContext, Mount>} */
   const mounts = new WeakMap();                       // per mount: the same def is mounted many times

   export default {
     name: 'contribs', label: { en: 'Contributions', de: 'Beiträge', uk: 'Внески' },
     states: [                                         // label = the grid caption + screen-reader text per state
       { name: 'empty', label: { en: 'Contributions', de: 'Beiträge', uk: 'Внески' } },
       { name: 'a', label: { en: 'Fused kernels', de: 'Fusionierte Kernel', uk: 'Злиті ядра' } },
       { name: 'b', label: { en: 'Portability', de: 'Portabilität', uk: 'Переносність' } },
     ],
     mount(ctx)            { /* build ALL elements once into ctx.root; mounts.set(ctx, m); paint(ctx, m) */ },
     snap(ctx, state)      { /* cancel running anim; set EVERY element to `state` instantly; m.state = state */ },
     step(ctx, from, to)   { /* cancel previous anim; m.state = to; animate; return { finish, finished, reverse? } */ },
     finish(ctx)           { /* complete the anim → end state (only called for promise-returning steps) */ },
     update(ctx)           { /* re-run paint: texts via ctx.t, colours; NO animation */ },
     unmount(ctx)          { /* cancel anims, dispose; mounts.delete(ctx) */ },
   };
   ```
5. **Write the deck in a 1600×900 px coordinate space.** `ctx.root` is an absolutely positioned 1600×900 box scaled to fit,
   with a default font size of 32px. Titles are around 56–64px and body text around 36–44px.
   Lay elements out with absolute positions or flex inside it.

## Rules

| Rule | Why |
|---|---|
| Keep per-mount state in a `WeakMap` keyed by `ctx`. Nothing mutable at module level. | The stage, its neighbours, live grid thumbnails and offscreen thumbnail captures all mount the **same** slide object at once. |
| `snap(ctx, s)` fully determines what's visible for **any** `s`. It's idempotent and instant, and cancels running animations first. | The grid, deep links and goTo jump to arbitrary states. Neighbours get re-snapped. `snap` runs right after `mount`. |
| `step` covers only adjacent states (`to = from ± 1`) on the same slide. It sets `m.state = to` **before** it animates and returns a handle whose `finish()` synchronously lands on `to`. | Input is never queued. A key press during an animation calls `finish()` and then starts the next step at once, so animations must be interruptible. |
| Give `step` a `reverse()` when the animation can play backwards in place (an anime.js timeline, see `diagram.js`). | Pressing ← mid-step reverses the step instead of snapping. |
| By default a slide has **no entrance animation**: entering it just shows the snapped state. Add one only for a slide whose notes, or the user, ask for it, and then in that slide's own `enter(ctx, state, direction, animate)`, behind `animate` (see `bars.js`). Shared helpers never add an `enter` animation to every slide. Render loops still start in `enter` and stop in `leave`. | The frame animates `enter` only on a forward → into a new slide; backward moves, jumps and in-slide steps never get it. A blanket entrance therefore makes one kind of transition look different from all others. `enter` runs after the slide is already snapped. |
| Colours: use `var(--fig-fg / bg / muted / accent / accent2 / dim)` in styles and SVG `style="fill:…"` (the kit's slide root maps them to the frame's `--pres-*`, so figures look the same in posts; hand-written hook slides may use `--pres-*` directly). Use `ctx.color(name)` only when JS needs the value (d3 interpolation, canvas, three.js). Pass it through the canvas `rgb()` helper from `bars.js`, because values can be `oklch()`. The demo slides read `ctx.color()` in `paint` even for DOM text; that works too, it's just more code. | CSS variables follow theme switches for free. Values read in JS must be re-read in `update`. |
| More than two series: derive them from the palette, e.g. `color-mix(in oklab, var(--fig-accent) 55%, var(--fig-fg))`; post-specific series colours go in `static/images/blog/<slug>/palette.js`, or use stripes or opacity. Light/dark values: fg gray-900/gray-100, bg white/gray-900, muted gray-500/400, accent teal (primary-600/400), accent2 amber-500/400, dim gray-300/700. | Only six variables exist (defined in `Presentation.svelte`). |
| Text: every visible string (titles, labels, ticks, captions, slide/state `label`s, SVG text via a `data-i18n` hook) is `{ en, de, uk }`, all three filled, passed through `ctx.t()` in `paint` and again in `update`. Translation rules below. | The site renders English today, but every language must already be there when de/uk go live. Language/theme switches call `update` and must never replay animations. |
| Libraries: bare `'animejs'` (v4: `animate`, `createTimeline`, `utils`, `stagger`), `'d3'`, `'three'`, `'three/addons/…'`. Load assets through `new URL('../x.svg', import.meta.url)` with `fetch(…, { signal: ctx.signal })`. | Only the import map resolves these (`src/lib/presentation/vendor-manifest.js`). Anything else must be vendored first. |
| Interactive content (orbit, drag, sliders) calls `ctx.claimInput(el, ['drag', 'keys'])`. | Otherwise the frame steals arrows and swipes. |
| Heavy slides (WebGL, big simulations) set `thumbnail: 'image'` with a `thumbnails(ctx, state)` function, or `'label'`. | The grid mounts `'live'` thumbnails for every state. |
| Figures that exist only as PDF: redraw them from source. Plots go in d3 from the data files behind them; diagrams become hand-written SVG following their TikZ/drawio source. If the source data can't be found, say so in the report and ask; only then, as a stopgap, convert it with `pdftocairo -svg`, show it on a white card (it has fixed colours), translate its alt text, and list it in your report as "text inside stays English". Keep each asset small (SVG under ~300 KB) and report the deck's total size. | Images can't follow the theme or the language. |
| SVG ids (`<marker>`, `<pattern>`, `<clipPath>`, gradients) get a per-mount suffix, e.g. a counter in `mount`. | The same slide is mounted several times at once, and duplicate ids resolve to whichever comes first in the document. |
| CSS transforms on SVG parts (a `scaleY` bar grow) need `transform-box: fill-box; transform-origin: bottom` (or similar). | Otherwise they scale around the SVG's origin. |
| Plain JS + JSDoc. No TypeScript, no `$lib` imports, nothing compiled. | It's served as is from `static/`. |

## Translations

Write German and Ukrainian alongside English, not later:
- German: informal (`du`/`ihr`), never `Sie`.
- Ukrainian: the author is male (masculine first-person past tense).
- Proper names stay as they are: system names (LingoDB, CUDA, TPC-H…), paper titles, citations like `[47]`. Only common technical terms get translated, and established English terms ("kernel", "warp") are kept where German/Ukrainian practitioners use them.
- Covers everything visible: slide and state `label`s (grid, screen reader), chart titles, axis labels and legends, and text inside fetched SVGs (mark it `data-i18n="key"` and fill it in `paint`).
- Numbers keep their values but are formatted per language: `new Intl.NumberFormat(ctx.lang, …).format(x)` for ticks, labels and values in text (de/uk use a decimal comma). `ctx.t` only takes `Localized`, so format numbers in the same `paint` that runs on `update`. Never format them once in `mount`.
- German runs about 30% longer, so titles overflow first. Size titles per language or let them shrink. Check by switching the deck to `de` and `uk` and finding visible elements whose `scrollWidth > clientWidth` or whose box leaves the 1600×900 root. SVG `<text>` has no `scrollWidth`, so compare `getBoundingClientRect()` boxes of visible text elements pairwise for overlaps, then confirm with screenshots.

## From slide notes to slides

When the input is a notes file (e.g. `gpu-paper-slides.md`):
- Each `## N.` heading is a slide. Every "then…", "appears", "on click" or bullet revealed one at a time is a state.
  Name states after what they show.
- Take numbers and labels from the source (paper, notes). Don't invent data. Plots get their values from the paper's tables
  or figures, written inline as a `const` or kept in a `.json` file next to the slides.
- "Speaker notes" and "backup" sections are not visible text. Put backup slides last.

## Verifying

1. `find static/images/blog/<slug>/presentation -name '*.js' -exec node --check {} \;`
2. `pnpm dev` (it vendors the libraries on start). Draft posts render in dev. Open the post and check the console for
   `Presentation slide <name> <hook> failed` and `malformed` errors. If the chrome-devtools MCP has no display
   ("Missing X server"), drive headless `google-chrome --remote-debugging-port` over CDP instead. Don't edit deck files
   during a test run, because Vite reloads the page. Stop the dev server by its PID; a `pkill -f` pattern can match your own shell.
   The external API (`document.querySelector('[data-presentation="<name>"]').presentation`) makes scripted runs easy:
   `next()`, `prev()`, `goTo()`, `setLanguage()`, `position`.
3. Per slide: hammer → and ← (no lag, ends in the right state); press → then ← quickly; open the grid (`g`) and click
   a far state; toggle dark mode and change the language (no replay, colours right); use fullscreen (`f`); check the deep link.
4. Visual polish is the user's call in their live preview. Report what you checked and what you didn't.

## Common mistakes

- **Module-level `let svg`.** Grid thumbnails overwrite the stage's elements. Use the `WeakMap`.
- **`snap` only handles the last state.** Jumping from the grid shows leftovers. Set every element every time.
- **`step` waits for the animation before updating `m.state`.** A fast ←→ ends in the wrong state.
- **A blanket entrance in a shared `slide()` helper.** Every forward slide change blinks and slides its content in, while every other transition doesn't. Leave `enter` out unless that slide asks for it.
- **Entrance animation in `mount` or `snap`.** It plays in thumbnails and on every re-snap. Put it in `enter` behind `animate`.
- **`update` calls `snap` with transitions, or re-runs the entrance.** That's a replay on theme switch. Restyle only.
- **Hex colours.** They're invisible in one of the two themes.
- **Numbers formatted with `toFixed`.** German and Ukrainian readers see `9.4` instead of `9,4`.
- **For a single self-running demo** with no steps, use the `writing-blog-script-embeds` skill instead.
