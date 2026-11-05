---
title: How I make the hiking routes for the website
date: '2025-03-28'
image: /images/projects/data-viz/hikes/thumb/riedenburg_kelheim.jpg
imageFull: /images/projects/data-viz/hikes/riedenburg_kelheim.jpg
description: My hike mapping journey at a glance.
path: 2025-03-28-hiking-routes.md
author: Mykola Morozov
tags:
  - Data-Viz
  - Hiking
images:
  /images/projects/data-viz/hikes/thumb/riedenburg_kelheim.jpg: {w: 400, h: 299, blur: 'data:image/webp;base64,UklGRtwAAABXRUJQVlA4INAAAAAQBQCdASoYABIAPtFcpE6oJSMiKAqpABoJYwCsM0xBCmSs6eXomc0V+QoEPWXYdr+AAMsIDePJ91FKLlNBbG1qoejCmKNl1vYDRF88um8wUsu8e5fUUsTRykgH5Xcv+MF1flpWH7HxjqZ1nBchnj4AVJY7pjSlw+S6kVS06T2GB/H1f0SB3nkeE0fialttL6A6bXUZXOgbGfgInEadFn/N1qjyyxMkyl48vQyY1Xp2Yg6JNpRyd2TsI217GLVDUX5673likbcZczlZ9dOaCwAA'}
  /images/projects/data-viz/hikes/riedenburg_kelheim.jpg: {w: 4640, h: 3472, blur: 'data:image/webp;base64,UklGRtoAAABXRUJQVlA4IM4AAADwBACdASoYABIAPtFcpE6oJSMiKAqpABoJYwCw7Aq/B2zIl7mm5xFoqom1StzK2JgAyvGDJb+72DzLG3V5vHmj+/4ZN/s5j2ZVdPPOL9An+PcKxYQNyO3ihziV8Thk9Ft7n9byrtPwc6pfNJVIjKglkW3wJsnluVnzF+x+z5OmaTewh2G7YfVdtm8RA64frOQx7CUGeq7mxSWcoD0jL9qvWdj42S2s1/klDJVGOuBrs3NEM/nEQmDDuP1HlXP88608dulIhACVIULReqOMAA=='}
---
# How I make the hiking routes for the website

Since the hiking routes are an important part of my data-viz journey, I wanted
to briefly describe how I prepare the routes I take for the website. The process
is divided into a few separate steps:
1. Finding an interesting hiking route and doing it.
2. Recording my trip in some way.
3. Gathering the recorded data and building a route for the hike online.
4. Exporting all the data and putting it on my website.

There are numerous ways to achieve what I'm doing, but here are the steps I
usually take.

## Finding a hike

While the selection of hikes, especially in Germany and Austria, may seem
daunting at first, the search space quickly narrows down as you go. For a
more automated approach, it's possible to search for mountain peaks with
an Alpine hut nearby using the [Overpass API](https://overpass-turbo.eu/).
Suggestions from friends are also taken into account. At the extreme end,
standing on the top of one mountain it's possible to judge the difficulty
and excitement of surrounding peaks at a glance, which can guide future
decisions.

The hike steepness, distance, and duration also play a vital role.
If I know I've missed a train and a hike is not possible, I might consider
a quicker hike in the area of the original one.

## Recording the hike

Here I use a couple of methods to make further steps easier. First, if I
know I'll take a lot of random turns along the way, like in my
[Herrsching - Tutzing hike](/projects/data-viz/hikes/herrsching_tutzing/), I
sometimes activate the GPS feature of my fitness bracelet to track the route
for me. This works well on most routes, but the battery drains very fast and
the GPS signal is very inaccurate near steep cliffs or mountain sides.

Another trick I use is glancing at Google Maps and waiting for my phone GPS
to update. This avoids having GPS on all the time, but provides snippets to
the Google Maps Timeline feature, giving me a chance to review them later.
Unfortunately, the accuracy of this method varies quite a lot, as Google
randomly records one point and drops another.

Lastly, I try to take photos with GPS metadata on. This way I can check the
exact location where I took the photo later. Since I take a billion photos as
I hike up and down the mountains, this helps me in situations where I don't
remember, which trail I took.

## Building the route

I try to build the route using
[OpenRouteService](https://maps.openrouteservice.org/)
as the ground truth, since it allows me to export really detailed routes in
multiple formats completely for free and with reasonable limits. On my phone
I often use [Mapy.cz](https://mapy.com/en/) and [OsmAnd](https://osmand.net/)
for their offline capabilities, so whenever possible I take them as the main
reference. They even allow building the routes offline, making them perfect
for on-the-spot decisions! Still, often that is not enough, so I reference
the bracelet and photos as needed.

Building the route itself involves placing a bunch of markers along the way
and instructing the routing algorithm to follow them as close as possible,
so there is no difficulty there. Sometimes it is hard to force the algorithm
to follow specific roads, so I have to use a lot of markers, like in my
[Frau Hitt hike](/projects/data-viz/hikes/frau_hitt/).

### Going off the trail

Sometimes it is necessary to go off the trail, or go through a closed-off
Naturschutzgebiet path.

If I go off the path, I resort to
[OpenStreetMap](https://www.openstreetmap.org/) to get the rough coordinates
of my path and [Mapbox](https://www.mapbox.com/) for the elevation at these
coordinates. Then, I collect the terrain condition data for these points
and store them in a notepad for export.

If I go on a closed-off path that is nonetheless present on the map, I use
the [Overpass API](https://overpass-turbo.eu/) to extract the "way" data,
get the height of each path endpoint using [Mapy.cz](https://mapy.com/en/)
and the terrain data using [OpenStreetMap](https://www.openstreetmap.org/).
I then put everything together into a notepad. This is a very tedious process,
but at the end I get a map of my exact hike down to a few meters of accuracy.
For example, I spent around 6 hours fixing the
[Riedenburg - Kelheim hike](/projects/data-viz/hikes/riedenburg_kelheim/),
where we took a few turns onto closed-off trails.

## Exporting the data

The export process itself is very simple. In most cases it involves pressing
the export button on [OpenRouteService](https://maps.openrouteservice.org/)
to get GeoJSON and GPX versions of the route. I chose GeoJSON as my primary
format, as it is very easy to work with programmatically, specifically using
JavaScript. I parse the file to get the hike properties like distance,
duration, elevation difference, etc. In cases where I go off the allowed path,
I take the data I stashed away in my notepad and manually put it into the
exported file. This take a while, but it's not that hard and I can immediately
see my changes reflected on the respective website page. Since most apps are
compatible with GPX instead of GeoJSON, I convert one into the other using a
random online service. Usually [OpenRouteService](https://maps.openrouteservice.org/)
does the job, but I have used others.

### Tech stack for the visualization

The process I use is also quite simple. I take the hike from a JSON list of
all the hikes I have and start processing it.

First, I take the "center" of the hike that I manually define and using
[d3-geo](https://d3js.org/d3-geo) I calculate all the map tiles I'd need to
display. Map tiles are small square 256x256 pixel images of different sections
of the map. When you load your favorite maps website, you can see the map
loading bit by bit using these squares. I then download these tiles from
several providers to get all the data I need to display. I use
[Mapbox](https://www.mapbox.com/) for elevation and satellite tiles,
[OpenStreetMap](https://www.openstreetmap.org/) for the 2D view, and
[Mapy.cz](https://mapy.com/en/) for the Interactive view.

Then, I use [Three.js](https://threejs.org/) to build the 3D view of the map.
I parse the GeoJSON file manually and extract all coordinates and height, then
draw the paths on the 2D, 3D, and Interactive maps.

Finally, I write up the story of the hike using [Markdown](https://www.markdownguide.org/)
and put it together using [Marked.js](https://marked.js.org/).

Now, with a bit of styling and magic, I put everything together and a page
for a hike is ready!
