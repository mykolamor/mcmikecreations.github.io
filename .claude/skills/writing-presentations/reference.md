# Presentation API reference

Source of truth: `src/lib/presentation/types.ts`, `controller.ts`, `slide-host.ts`. If this file disagrees with them, they win.

## PresentationDef / SlideDef

```ts
PresentationDef { name?: string; slides: SlideDef[] }          // name = deep-link prefix + data-presentation
SlideDef {
  name?: string                       // unique; used in deep links (#deck/slide/state) and goTo
  label?: string | Localized          // grid caption, live-region announcement
  states?: number | StateDef[]        // default 1; StateDef { name?: string (unique per slide); label?: string | Localized }
  thumbnail?: 'live' | 'image' | 'label'   // default 'live'
  thumbnails?: string[] | ((ctx, state) => string | Promise<string>)   // image URLs per state for 'image'
  html?: string                       // set as ctx.root.innerHTML before mount
  mount? snap? step? enter? leave? finish? update? unmount?
}
Localized = { en: string; de?: string; uk?: string }
```

`normalize()` throws on: no slides, duplicate slide names, duplicate state names in one slide, or 0 states.
The embed then logs `Presentation … is malformed` and shows only the placeholder.

## SlideContext (`ctx`)

| Member | Meaning |
|---|---|
| `root` | The 1600×900 slide box. Your DOM goes here. |
| `isThumbnail` | True for grid and offscreen thumbnail mounts. Skip controls, hints and render loops there. |
| `signal` | An AbortSignal that aborts on unmount. Pass it to `fetch` and `addEventListener`. |
| `lang`, `theme`, `reducedMotion` | Live getters. |
| `t(v)` | Picks `v[lang] ?? v.en`. Plain strings pass through. |
| `color(n)` | The computed `--pres-<n>` for `fg bg muted accent accent2 dim`. It may be `oklch()`. |
| `claimInput(el, ['keys'\|'drag'])` | The frame stops using arrows (while `el` is focused, until Esc) or swipes on `el`. No-op in thumbnails. |

## Lifecycle, as the host calls it

- **Mount:** `root.innerHTML = html` → `mount(ctx)` (an optional returned function runs as cleanup) → `snap(ctx, initialState)`.
- **Stage window:** the current slide **and its neighbours** stay mounted. Neighbours are snapped to `0` (the next slide) or their
  last state (the previous slide), and hidden with `visibility:hidden` + `inert`, so they're still laid out.
  Moving away re-snaps a kept slide. Slides outside the window are unmounted.
- **Arrow within a slide:** `step(ctx, from, to)`. With reduced motion it's `snap(ctx, to)` instead.
  The position changes immediately and the returned handle is tracked.
- **Arrow across slides:** `leave(old)` → `show(new)` (mount/snap) → `enter(ctx, state, 'forward'|'backward', animate)`.
  `animate` is false under reduced motion.
- **Jump** (grid, deep link, goTo, Home/End): the running handle gets `finish()`. On the same slide that's `snap`. Across slides
  it's leave → show → `enter(…, animate=false)`.
- **Next input while a handle runs:**
  - If the input goes in the opposite direction, the handle came from `step` and it has `reverse()`, the host calls
    `reverse()`, which must return a new handle.
  - Otherwise the host calls `handle.finish()` (synchronously → end state) and then handles the input.
  - Nothing is queued.
- **Language/theme change:** finishes the running handle, then calls `update(ctx, env)` on **every** mount, thumbnails included.
- **Unmount:** `unmount(ctx)` → cleanup → `signal` aborts → root removed (thumbnails: emptied).

## Step results

| `step`/`enter` returns | Host behaviour |
|---|---|
| `{ finish(), finished: Promise, reverse?() }` | Used as is. `finish()` must jump to the end state synchronously. |
| a `Promise` | Wrapped: `finished` = the promise, `finish()` calls your `finish(ctx)` hook. |
| nothing | Treated as instant. |

anime.js v4: `const a = animate(targets, {...})` → `{ finish: () => a.complete(), finished: a.then() }`; `a.cancel()` to drop.
For a timeline, `reverse()` is `tl.reversed ? tl.play() : tl.reverse()` (see `diagram.js` `handleFor`).
After a reverse, the controller's position is back at the step's origin, so the new handle's `finish()` must land on the **origin**
state, and its own `reverse()` heads to the original target again. Update `m.state` to match on each flip.
d3: `finished: Promise.all(ts.map(t => t.end())).catch(() => {})`, and `finish` re-renders the end state (see `bars.js`).

## Thumbnails

- `'live'`: the slide is mounted per grid cell, scaled down, and snapped to each state. Make sure `mount` is cheap.
- `'image'`: `thumbnails` is either an array of URLs (one per state) or a function. The function is run on an offscreen
  mount, one state at a time after `snap`, and its result is cached per language and theme. WebGL needs `preserveDrawingBuffer: true`.
- `'label'`: a text card from the labels.

## External API and links

- `document.querySelector('[data-presentation="<name>"]').presentation`: `next() prev() first() last()
  goTo({ slide, state }, { animate? }) setLanguage(l) setTheme(t) on('change'|'enter'|'leave', fn) toggleGrid()
  toggleFullscreen() position`. Slide and state may be names or 0-based indices.
- Deep link in markdown: `[text](#<deck>/<slide>/<state>)`. Segments are names, or 1-based numbers.

## Keys (frame)

← / PageUp / Shift+Space go back; → / PageDown / Space go forward; Home / End; `g` opens the grid; `f` toggles fullscreen; Esc releases claimed keys or
exits. Swipe: horizontal ≥ 50px within 800ms.
