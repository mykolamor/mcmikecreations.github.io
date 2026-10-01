"""Distance, ascent, descent and moving time from a recorded GPX track,
written into a hike post's front matter as `distance` (m), `ascent` (m),
`descent` (m) and `duration` (minutes).

Garmin, Strava and Komoot each compute these their own way, and the exported
GPX doesn't reproduce any of them exactly, so every post uses the same rules:

- Distance: 3D length of the track (horizontal distance plus the elevation
  change of each step).
- Ascent / descent: elevation changes counted once they reach 2 m from the
  last counted point, which filters out GPS/barometer noise. Within a few
  percent of Garmin's figures.
- Moving time: a sample interval counts as moving when the straight-line
  displacement over the minute centred on it amounts to at least 0.5 km/h.
  Displacement rather than path length, because GPS jitter while standing
  still adds up to more than that as path length but cancels out as
  displacement; 0.5 km/h is low enough to keep slow via ferrata climbing.
  Intervals longer than 10 minutes are recording gaps (auto-pause, a night at
  a hut) and never count.

Planned tracks (no `<time>` on the trackpoints) are skipped: their only
metrics are the route planner's.

`--missing-only` fills in just the fields a post doesn't have yet, which is
what the deploy script runs, so a new post never ships without them.
"""

from __future__ import annotations

import argparse
import math
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

WINDOW_S = 60
MIN_SPEED_KMH = 0.5
MAX_INTERVAL_S = 600
CLIMB_THRESHOLD_M = 2.0

KEYS = ("distance", "ascent", "descent", "duration")

REPO = Path(__file__).resolve().parents[2]
MARKDOWN = REPO / "static/_projects/data-viz/hikes/markdown"

COMMENT = "# Computed from the recorded GPX by scripts/track_metrics.py.\n"
_OLD_COMMENTS = re.compile(r'^# (Computed from the recorded GPX|Moving time from the GPX):.*\n|'
                           r'^# Computed from the recorded GPX by .*\n', re.M)

_TRKPT = re.compile(r'<trkpt\s+([^>]*)>(.*?)</trkpt>', re.S)
_FRONT = re.compile(r'\A---[ \t]*\n(.*?\n)---[ \t]*\n', re.S)


@dataclass
class Point:
    lat: float
    lon: float
    ele: float | None
    time: float  # unix seconds


def _haversine_m(a: Point, b: Point) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a.lat, a.lon, b.lat, b.lon))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def read_track(gpx: str) -> list[Point]:
    """Every trackpoint that has a time; an untimed (planned) track gives []."""
    points = []
    for m in _TRKPT.finditer(gpx):
        lat = re.search(r'lat="([^"]+)"', m.group(1))
        lon = re.search(r'lon="([^"]+)"', m.group(1))
        time = re.search(r'<time>([^<]+)</time>', m.group(2))
        ele = re.search(r'<ele>([^<]+)</ele>', m.group(2))
        if lat and lon and time:
            t = datetime.fromisoformat(time.group(1).strip().replace("Z", "+00:00")).timestamp()
            points.append(Point(float(lat.group(1)), float(lon.group(1)),
                                float(ele.group(1)) if ele else None, t))
    return points


def moving_minutes(points: list[Point]) -> float | None:
    if len(points) < 2:
        return None
    moving = 0.0
    lo = hi = 0
    n = len(points)
    for i in range(n - 1):
        dt = points[i + 1].time - points[i].time
        if dt <= 0 or dt > MAX_INTERVAL_S:
            continue
        t = points[i].time
        while points[lo].time < t - WINDOW_S / 2:
            lo += 1
        while hi < n - 1 and points[hi].time < t + WINDOW_S / 2:
            hi += 1
        span = points[hi].time - points[lo].time
        if span > 0 and _haversine_m(points[lo], points[hi]) / span * 3.6 >= MIN_SPEED_KMH:
            moving += dt
    return moving / 60


def distance_m(points: list[Point]) -> float:
    total = 0.0
    for a, b in zip(points, points[1:]):
        flat = _haversine_m(a, b)
        dz = (b.ele - a.ele) if a.ele is not None and b.ele is not None else 0.0
        total += math.hypot(flat, dz)
    return total


def climb_m(points: list[Point]) -> tuple[float, float] | None:
    """(ascent, descent), ignoring changes under CLIMB_THRESHOLD_M from the last counted point."""
    elevations = [p.ele for p in points if p.ele is not None]
    if len(elevations) < 2:
        return None
    up = down = 0.0
    ref = elevations[0]
    for z in elevations[1:]:
        if z - ref >= CLIMB_THRESHOLD_M:
            up += z - ref
            ref = z
        elif ref - z >= CLIMB_THRESHOLD_M:
            down += ref - z
            ref = z
    return up, down


def track_metrics(points: list[Point]) -> dict[str, int] | None:
    """The four front-matter metrics, or None for an untimed (planned) track."""
    minutes = moving_minutes(points)
    if minutes is None:
        return None
    metrics = {"distance": round(distance_m(points)), "duration": round(minutes)}
    climb = climb_m(points)
    if climb:
        metrics["ascent"], metrics["descent"] = round(climb[0]), round(climb[1])
    return metrics


def read_metrics(markdown: str) -> dict[str, int]:
    m = _FRONT.match(markdown)
    front = m.group(1) if m else ""
    found = {}
    for key in KEYS:
        v = re.search(rf'^{key}:\s*(\d+(?:\.\d+)?)\s*$', front, re.M)
        if v:
            found[key] = round(float(v.group(1)))
    return found


def set_metrics(markdown: str, metrics: dict[str, int]) -> str:
    """Write `metrics` as one commented block, replacing any of the four keys already there."""
    m = _FRONT.match(markdown)
    if not m:
        raise ValueError("no front matter")
    front = _OLD_COMMENTS.sub("", m.group(1))
    keep = {k: v for k, v in read_metrics(markdown).items() if k not in metrics}
    for key in KEYS:
        front = re.sub(rf'^{key}:.*\n', '', front, flags=re.M)
    merged = {**keep, **metrics}
    block = COMMENT + "".join(f"{k}: {merged[k]}\n" for k in KEYS if k in merged)
    anchor = re.search(r'^(elapsed|images):', front, re.M)
    pos = anchor.start() if anchor else len(front)
    front = front[:pos] + block + front[pos:]
    return f"---\n{front}---\n" + markdown[m.end():]


def gpx_for_post(markdown: str, slug: str) -> Path:
    m = re.search(r'^gpx:\s*(\S+)', markdown, re.M)
    if m:
        return REPO / "static" / m.group(1).lstrip("/")
    return REPO / "static/_projects/data-viz/hikes/gpx" / f"{slug[11:]}.gpx"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("posts", nargs="*", help="post slugs or .md paths (default: every post)")
    parser.add_argument("--missing-only", action="store_true",
                        help="only fill in metrics a post doesn't have yet")
    parser.add_argument("--dry-run", action="store_true", help="print, don't write")
    args = parser.parse_args(argv)

    paths = [Path(p) if p.endswith(".md") else MARKDOWN / f"{p}.md" for p in args.posts] \
        or sorted(MARKDOWN.glob("[0-9]*.md"))
    for path in paths:
        markdown = path.read_text(encoding="utf-8")
        existing = read_metrics(markdown)
        if args.missing_only and all(k in existing for k in KEYS):
            continue
        gpx = gpx_for_post(markdown, path.stem)
        computed = track_metrics(read_track(gpx.read_text(encoding="utf-8"))) if gpx.exists() else None
        if computed is None:
            continue
        if args.missing_only:
            computed = {k: v for k, v in computed.items() if k not in existing}
        changes = {k: v for k, v in computed.items() if existing.get(k) != v}
        if not changes:
            continue
        print(f"{path.stem:45s} " + "  ".join(f"{k} {existing.get(k, '-')}->{v}" for k, v in changes.items()))
        if not args.dry_run:
            path.write_text(set_metrics(markdown, computed), encoding="utf-8")
    return 0
