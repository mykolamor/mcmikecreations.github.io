---
title: Jekyll to Flowbite Svelte
date: '2024-02-26'
image: /images/blog/migration.jpg
description: 'How I migrated from Ruby and Jekyll to Vite, Svelte, SvelteKit and Flowbite.'
path: 2024-02-26-migration.md
author: Mykola Morozov
tags:
  - Frontend
images:
  /images/blog/migration.jpg: {w: 585, h: 439, blur: 'data:image/webp;base64,UklGRkgBAABXRUJQVlA4IDwBAABwBwCdASoYABIAPtFaqU2oJSQiKAqpABoJbACdMoR11vK8BtgOeA/wGoAbzojQNn2O6lMv3ov9NN/r5e+h3UvqulCoWAD4Oj8GzcRCwYs/4WgMtGWS6Of90+Y/mCwxVZGrhCKodrMIRLgaFuJg4J3NmH7PPFYkKbv9JYYDZENsL7qdlYCKK1+1Dm/3kAX70b2OqrkFJnfujx9aZSmGTdWAU8m4AZhhHZvSgkRYEoV8iyCwN7ewwgULYqfm9afbgEoMHbzNr1XcN/1zhXf7cz51cTPGlzqUYiYvnQpi+lp5G6Mf4TNIRek5VM+/bjW6mMVz1/eIuVb+wvNT2bu/LKnmVaDy1RmiSPZXuh/c/mAJEE57vjiLGErCSn0wgbiR0wLZvK99ZRTx00ue/LUvX4tWHzr+huTLy/objIAA'}
  /images/blog/migration/old-resume.png: {w: 1895, h: 1421, blur: 'data:image/webp;base64,UklGRooAAABXRUJQVlA4IH4AAACQBACdASoYABIAPtFeqE+oJKOiKAgBABoJaQAALjA37cpI3Lgq5Lk2LLjl1AAA/u6xadwMHHxq5PLgC0dgF01DWxbxcavMJrRsteYx8qTeRjhih5oSNsdVrvx/Z1C57RJr5EYHtVU1yMR7G5At6M7HUu35IgVcz6ED4sAAAAA=', alt: 'Dark résumé page with my name and job title, a row of social media icons, an About Me section with a portrait and a Projects list'}
---
# Jekyll to Flowbite Svelte

## Old website

I started my journey of creating an online résumé website in March 2023, when I
got tired by updating my profiles on LinkedIn, Orcid, my CVs in tabular and
freeflow form. I thought: "Wouldn't it be nice to have a single source of
ground truth for my career?" A personal site seemed like a logical solution at
the time. I was naïve at the time, and the website became just another place I
needed to update.

Regardless, I decided to push forward and create a website from scratch, so
that I didn't have to rely on an external service generating and processing my
data. I was new to front-end development and web hosting, so I was looking for
the simplest possible solution.

I've seen many documentation websites using `*.github.io` domains, which lead me
to the discovery of [GitHub Pages](https://pages.github.com/) that operated on [Ruby](https://www.ruby-lang.org/en/) and [Jekyll](https://jekyllrb.com/) to serve
static html websites. I looked through existing Jekyll templates and [found one](https://github.com/sproogen/modern-resume-theme)
that had an OK style. The biggest advantage for the template was having the
content written in a structured `.yml` file. This meant easy processing in the
future, if I ever needed any. The website offered a nice digital résumé and
contact section for anyone who was interested in contacting me, which worked
fine, but didn't let me add other pages easily.

![Old website built using Jekyll](/images/blog/migration/old-resume.png)

## Transition motivation

I wanted to expand the website with support for detailed project descriptions
and a blog section, which Jekyll supported, but required a complete UI rewrite.
Without easy access to component-based development and JavaScript  package
management it would have been a tedious process. I also wanted to learn a
proper front-end technology with [Node.js](https://nodejs.org/) integration and
Static Site Generation (SSG) capabilities to host it on GitHub Pages.
My front-end colleagues have used:

- [Angular](https://angular.io/guide/prerendering),
- [Remix](https://remix.run/docs/en/main/guides/disabling-javascript),
- [Astro](https://docs.astro.build/en/basics/rendering-modes/#pre-rendered),
- [Gatsby](https://www.gatsbyjs.com/docs/reference/rendering-options/deferred-static-generation/),
- [Next.js](https://nextjs.org/docs/pages/building-your-application/deploying/static-exports).

I was looking for an SSG solution that would have the smallest framework study
overhead for me. Since I was looking around so much, Google News served me some
articles on [Svelte](https://svelte.dev/) and [SvelteKit](https://kit.svelte.dev/),
and they looked really promising for the task. I experimented with them a bit
using [Bootstrap](https://getbootstrap.com/) and had some quite nice results. What I really wanted was a
proper component library that would save me from spending weeks writing custom
components myself.

> TL;DR: I ended up writing/overriding most components myself anyway.

I leaned into component library research and came up with a shortlist of
promising packages I could use. The list was:

1. [Flowbite](https://flowbite-svelte.com/),
2. [Skeleton](https://www.skeleton.dev/),
3. [AgnosticUI](https://www.agnosticui.com/),
4. [Attractions](https://illright.github.io/attractions/),
5. [SvelteStrap](https://sveltestrap.js.org/),
6. [SvelteUI](https://svelteui.dev/).

After my experience with [Flutter](https://flutter.dev/), where I spent countless hours
customizing default component styles, I tried staying away from [Material UI](https://m3.material.io/).
It looks nice and has many useful accessibility features. In my opinion,
however, it is meant for apps (web apps/PWAs too) and not for plain static
websites, especially portfolios. Just in terms of features Flowbite and
Skeleton were ahead, and Svelte was easier to work with after some trial and
error. The biggest win, though, was the usage of [Tailwind](https://tailwindcss.com/).
It allowed creating the UI much faster than writing custom per-element styles.
And since I was already familiar with Bootstrap, it was a no-brainer.

## Design requirements

Just out-of-the-gate I decided to set a few strict and optional design
requirements for the project. It helped limit the scope and focus on important
features first. The list was:

- Instead of having the résumé as a single page, I wanted to split different
sections into multiple pages.
- The home/index page should be a personal landing overview with relevant
snippets from other pages.
- The website should be easily indexable by search engines.
- The website should be accessible via relevant [ARIA Attributes](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes).
- The website should include a dark and a light variant.
- The website should include detailed project descriptions and a blog.
- The résumé should have two versions - a short simple page for printing and
a detailed styled page for online viewing.
- The blog should support tag and year filtering, similar to [Blogspot/Blogger](https://www.blogger.com/).

## Implementation 

After looking for inspiration on other CV websites, e.g. [Colorlib](https://colorlib.com/), I realized
they all had a very similar structure. A hero section with a picture, an
informal description, job and study excerpts, projects or a portfolio section,
and contact details. Some had a blog too somewhere. Most of the websites were
a single long page with no further info apart from portfolio and contact
details, which I wasn't a fan of. Most of all I was annoyed by a mail form
in the contact section, which typically required either a back-end or
an external service to operate. My goal was the least complexity for the least
price, so I set on to replace the form with a list of emails and networks I
could be contacted through.

### Accessibility

Accessibility was one of the key points I wanted to address. I recommend the
[WebAIM](https://webaim.org/resources/evalquickref/) website for those, who
are interested in learning more about making the website work for impaired
individuals, screen readers, and more. [Windows Narrator](https://en.wikipedia.org/wiki/Narrator_(Windows)) was a useful
tool to check if the website was looking correctly for readers used by visually
impaired people. I went through all the elements and made sure they could be
read properly, including buttons, links, and images.

### Dark and light variants

Dark/light theme switching was also something I was interested in tackling.
While the process went mostly smoothly thanks to Tailwind, I got stuck trying
to make different variants of code highlighting and images for both themes.

For block code segments, which I highlighted through [highlight.js](https://highlightjs.org/),
I wrote an observer which subscribed to `body` attribute changes and looked for
the dark theme class. Then, the observer swapped a style include to a different
path. The code can found on [GitHub](https://github.com/mykolamor/mcmikecreations.github.io/blob/a0e59cbf3ffa5ef7db229e896d98fbcba1b011b1/src/lib/renderers/DarkModeLinker.svelte).

For images, on the other hand, the process wasn't as intuitive. I didn't want
to have more observers and was looking for a css-only solution. Because
Tailwind already supported dark variants, I tried implementing the feature
through `background-image`. I substituted the image URL for the image I was
interested in, e.g. `class="bg-[url('{lightUrl}')] dark:bg-[url('{darkUrl}')]"`.
Unfortunately, this didn't work. Tailwind pre-compiles the classes before they
get substituted at build time, so no background image was showing. After a lot
of digging, I eventually stumbled upon [this](https://stackoverflow.com/a/70810692/2832341) React answer on StackOverflow.
All I needed to do was to move the URL into a separate css variable that will
be substituted for the actual URL by the client browser.

### Other points of importance

Another issue I faced was having a different footer for different pages. While
it was easy to move the footer to a separate parameterised component, the issue
was with determining the parameters consistently for each page. For some
unknown to me reason, the state of the footer was sometimes saved and remained
unchanged after a page transition. I settled on `+layout.ts` return values from
`load()` functions.

Lastly, I noticed my back/forward browser navigation sometimes breaking,
because most pages didn't contain a `<title>` tag in the head section. Instead
of fixing it with a `store` variable as in the official examples, I decided
to move it to a separate component and make it more static.

### Framework Components

One of the biggest hurdles I had to overcome was learning the names for all
provided components. While similar, they often differed.


| Flowbite  | Flutter MaterialUI        |
|-----------|---------------------------|
| Accordion | ExpansionPanel            |
| Carousel  | CarouselSlider            |
| SpeedDial | FloatingActionButton      |
| Spinner   | CircularProgressIndicator |
| Tabs      | TabBarView                |

And coming from a back-end position, I kept confusing similar elements. Drawers
are just Sidebars with hidden logic.  AppBars are just NavigationBars with some
styling and preset child element types. A Gallery is just a pre-made grid or
a nested list. A Footer with links is an enhanced bottom Navbar. A BottomNav is
a Navbar with icons. The list goes on and on.

### Blogs

Another issue I had was with the blogs. The `markdown-svelte` package has some
peculiarities. First, custom components need to be defined to render different
markdown elements. The default components are difficult to style (unless
wrapped with `prose` from `tailwind`), especially if compatibility with other
framework components is desired. Second, due to the hydration step of
client-side rendering, routing, and data preloading, inline JavaScript inside
markdown doesn't work as intended. I found a [solution on Reddit](https://www.reddit.com/r/sveltejs/comments/16b1ipm/comment/jzapmyh/?utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button) to perform
full-page navigation instead of preloading.

Regardless, I think the website came together nicely in the end. I
thank you for getting this far in the post and wish you all the best.
