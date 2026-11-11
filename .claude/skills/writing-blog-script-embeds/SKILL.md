---
name: writing-blog-script-embeds
description: Use when adding an interactive JS demo, simulation, widget, animation or live chart inside a blog post (static/_blog/*.md), or when a blog script embed like /images/blog/ecs/pong-sim.js breaks, duplicates, or keeps running after client-side navigation. Not for slide decks (see writing-presentations).
---

# Writing blog script embeds

## Overview

A script embed is a plain browser ES module that a post references like an image.
`ScriptEmbed.svelte` imports it in the browser and calls its default export with a
container. The module is **not** processed by Vite. It is served as is from `static/`.
SvelteKit navigates client-side and prefetches, so the module is imported **once per page load**.
`mount` then runs on **every visit** to the post.
Reference implementation: `static/images/blog/ecs/pong-sim.js`.

## Recipe

1. **File:** `static/images/blog/<post-slug>/<name>.js`, served at `/images/blog/<post-slug>/<name>.js`.
2. **Markdown** goes right after the paragraph that introduces the demo, on its own line with blank lines around it. The alt text is the caption:
   ```markdown
   ![Implemented simulation](/images/blog/ecs/pong-sim.js)
   ```
   Localized copies (`<slug>.de.md`, `<slug>.uk.md`), when they exist, reference the **same** file with a translated caption.
   Never inline `<script>` or raw HTML for a demo.
3. **Module shape.** `mount(container, { caption })`: `container` is an empty `<div class="w-full">` inside a centred `<figure>` (¾ width on xl screens) that also renders the caption as `<figcaption>`; `caption` is the alt text. The return value is optional.
   ```js
   // One line on what it shows. Embedded in <post> as `![caption](/images/blog/<slug>/<name>.js)`;
   // see src/lib/renderers/ScriptEmbed.svelte for the mount contract.
   export default function mount(container, { caption } = {}) {
     const abort = new AbortController();           // one switch for every listener
     const svg = /* build DOM */;
     svg.setAttribute('aria-label', caption || 'Fallback description of the demo');
     container.append(svg);

     let raf = requestAnimationFrame(function tick(t) { /* update */ raf = requestAnimationFrame(tick); });
     window.addEventListener('resize', onResize, { signal: abort.signal });

     return () => { cancelAnimationFrame(raf); abort.abort(); };   // ScriptEmbed empties the container itself
   }
   ```

## Rules

| Rule | Why |
|---|---|
| All mutable state lives **inside `mount`**. Module top level holds only constants and pure helpers. | The module is cached, so top-level state survives navigation and leaks into the next visit. |
| Return a cleanup that stops **every** timer, `requestAnimationFrame`, observer and listener on `window`/`document`. | Otherwise the demo keeps running after you leave the post, and you get two loops when you come back. |
| Query through `container` and the elements you created. Never use `document.getElementById` or global ids. | Two embeds, or a stale one, would collide. |
| Colours: SVG/HTML use `currentColor` or `color: inherit` and follow dark mode with no JS. Canvas/WebGL can't: read `getComputedStyle(container).color` when drawing, and re-read it when `<html>`'s `class` changes (`MutationObserver`, disconnected in cleanup). | The site toggles `.dark` on `<html>`; `ctx.fillStyle = 'currentColor'` doesn't follow it. |
| Language: every visible string is `{ en, de, uk }` with all three filled, picked via `document.documentElement.lang` (fall back to `en`) in `mount`. German is informal (`du`/`ihr`, never `Sie`). The caption is translated in each post file instead. | The site renders English today, but translations must be ready when de/uk go live. One file serves all localized copies of the post. |
| Libraries: only bare `import … from 'd3' / 'animejs' / 'three' / 'three/addons/…'`. Relative imports and assets go through `new URL('./x.svg', import.meta.url)`. | The page's import map (`static/vendor/importmap.json`, from `src/lib/presentation/vendor-manifest.js`) resolves only these. Any other package means adding it to the manifest first. |
| Plain JS with JSDoc. No TypeScript, JSX or `$lib` imports. | Nothing compiles `static/`. |
| Controls (sliders, buttons, labels): plain elements with inline `style`, `font: inherit; color: inherit`; listeners with `{ signal }`. Tailwind classes only if the site already uses them (e.g. `w-full`) — nothing compiles new ones. | Same reason as above; see `static/images/blog/markdown-test/presentation/lang-buttons.js` for a button group. |
| Size the demo to the container width (`viewBox` + `width:100%`). Never use fixed pixel widths. | Posts are read on phones. |

## Verifying

- `node --check static/images/blog/<slug>/<name>.js` catches syntax errors.
- Draft posts (`draft: true`) render under `pnpm dev` only.
- Open the post, navigate away through a site link, come back, and toggle dark mode.
  You should see exactly one demo, no console errors, and nothing ticking after you leave.
- Leave visual polish to the user's live preview.

## Common mistakes

- **`let state = …` at module top level.** The second visit starts from the old state. Move it into `mount`.
- **Cleanup only removes DOM.** The rAF loop keeps running offscreen. Cancel it.
- **Hard-coded `#000` strokes.** They're invisible in dark mode. Use `currentColor`.
- **A deck with steps, a toolbar or fullscreen.** That's a presentation, not a script embed.
  **REQUIRED:** use the `writing-presentations` skill.
