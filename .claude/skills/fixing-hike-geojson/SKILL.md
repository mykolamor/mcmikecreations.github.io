---
name: fixing-hike-geojson
description: Use when a hike's route GeoJSON (static/_projects/data-viz/hikes/geojson/<slug>.json) deviates from its recorded GPX between two points, or the planned openrouteservice route doesn't match the path actually walked and a section must be redrawn from the recording.
---

# Fixing a hike GeoJSON section from the GPX

## Overview

The route GeoJSON is an openrouteservice export: a LineString with DEM elevations, `way_points`, `segments[].steps` (directions) and `extras` (waytype/surface/steepness), all indexed into the coordinate array. When the planned route went a different way from the walk, splice the recorded GPX into that section, keeping the file's point density, its elevation baseline, and every index consistent. Only the coordinates render on the site, but indices must stay valid.

## Usage

The user gives two `(lat, lon)` points that bound the bad section (order doesn't matter):

```bash
python3 .claude/skills/fixing-hike-geojson/splice_gpx.py <slug> <lat1>,<lon1> <lat2>,<lon2> --dry-run
python3 .claude/skills/fixing-hike-geojson/splice_gpx.py <slug> <lat1>,<lon1> <lat2>,<lon2>
```

Back up first: `cp geojson/<slug>.json <scratchpad>/<slug>.orig.json`. Pass `--root DIR` to run on a copy.

What the script does:

| Concern | Handling |
|---|---|
| Section ends | Snaps each point to the GeoJSON and GPX. The original end vertices are kept, so the joins don't move. |
| Granularity | 3D Douglas-Peucker on the GPX, with tolerance auto-picked so mean spacing matches the rest of the file (`--eps M` to force). |
| Elevation | GPX barometric heights are offset from the DEM. The offset at each join is removed, blended linearly along the section, so both joins meet the DEM values and the recorded profile shape survives. |
| Directions | Steps inside the section collapse to one step per segment with `instruction: ''`, `type: 6`. Steps straddling an end are clipped. |
| Via points | A `way_points` entry inside the section moves to the nearest new vertex. |
| Totals | Segment and summary distance/duration are updated, duration scaled at the old pace. Ascent/descent are adjusted by the change. |
| `extras` | The section becomes `0` (unknown) for waytype/surface. Steepness is recomputed from the new elevations. Later ranges are shifted. |

## Read the output

- **Snap > ~10 m**: the points are probably not on the track; recheck with the user.
- **`WARNING: ... passes a bounding point more than once`**: out-and-back or loop. The script uses the shortest span, which may be the wrong leg. Check the printed candidate indices and re-run with `--geojson-range i:j` / `--gpx-range i:j`.
- **Length old → new**: a big jump is expected when the route really differed. Report it.
- **Elevation offset** of tens of metres is normal (barometer vs DEM).

## Verify

- Index chains are contiguous: each segment's steps run from `way_points[i]` to `way_points[i+1]` without gaps; every `extras` list ends at `len(coords) - 1`.
- The max deviation of new vertices from the GPX is a few metres.
- There's no elevation jump at either join (print 3 points each side).

## Report to the user

State the replaced index ranges and point counts, the spacing match, the elevation offsets that were removed, the dropped instructions, and the old → new distance, ascent and descent. Note that the post's `distance`/`ascent`/`descent` front matter (from `scripts/track_metrics.py`) may override the GeoJSON totals.

## Common mistakes

- Taking the GPX elevations raw: this leaves 10–30 m steps at the joins.
- Thinning in 2D only, which flattens the summits out of the profile.
- Keeping the old turn instructions: they describe the wrong path.
- Forgetting the `extras` and step indices after the section, which shifts every later direction onto the wrong vertices.
