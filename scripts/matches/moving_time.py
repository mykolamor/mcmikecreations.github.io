"""Moving time from a recorded GPX track, written into a hike post's front
matter as `duration` (minutes).

Garmin, Strava and Komoot each report their own moving time, and the exported
GPX doesn't reproduce any of them, so every post uses this one rule instead:
a sample interval counts as moving when the straight-line displacement over
the minute centred on it amounts to at least 0.5 km/h. Displacement rather
than path length, because GPS jitter while standing still adds up to more
than that as path length but cancels out as displacement; 0.5 km/h is low
enough to keep slow via ferrata climbing. Intervals longer than 10 minutes are
recording gaps (auto-pause, a night at a hut) and never count.

Planned tracks (no `<time>` on the trackpoints) are skipped: their only
duration is the route planner's estimate.
"""

from __future__ import annotations

import argparse
import math
import re
from datetime import datetime
from pathlib import Path

WINDOW_S = 60
MIN_SPEED_KMH = 0.5
MAX_INTERVAL_S = 600

REPO = Path(__file__).resolve().parents[2]
MARKDOWN = REPO / "static/_projects/data-viz/hikes/markdown"

COMMENT = (f"# Moving time from the GPX: {WINDOW_S} s displacement >= {MIN_SPEED_KMH} km/h "
           f"(scripts/moving_time.py).\n")

_TRKPT = re.compile(r'<trkpt\s+([^>]*)>(.*?)</trkpt>', re.S)
_FRONT = re.compile(r'\A---[ \t]*\n(.*?\n)---[ \t]*\n', re.S)


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def read_track(gpx: str) -> list[tuple[float, float, float]]:
    """(lat, lon, unix seconds) for every trackpoint that has a time."""
    points = []
    for m in _TRKPT.finditer(gpx):
        lat = re.search(r'lat="([^"]+)"', m.group(1))
        lon = re.search(r'lon="([^"]+)"', m.group(1))
        time = re.search(r'<time>([^<]+)</time>', m.group(2))
        if lat and lon and time:
            t = datetime.fromisoformat(time.group(1).strip().replace("Z", "+00:00")).timestamp()
            points.append((float(lat.group(1)), float(lon.group(1)), t))
    return points


def moving_minutes(points: list[tuple[float, float, float]]) -> float | None:
    """Moving time in minutes, or None for a track without timestamps."""
    if len(points) < 2:
        return None
    moving = 0.0
    lo = hi = 0
    n = len(points)
    for i in range(n - 1):
        dt = points[i + 1][2] - points[i][2]
        if dt <= 0 or dt > MAX_INTERVAL_S:
            continue
        t = points[i][2]
        while points[lo][2] < t - WINDOW_S / 2:
            lo += 1
        while hi < n - 1 and points[hi][2] < t + WINDOW_S / 2:
            hi += 1
        span = points[hi][2] - points[lo][2]
        if span > 0 and _haversine_m(points[lo][:2], points[hi][:2]) / span * 3.6 >= MIN_SPEED_KMH:
            moving += dt
    return moving / 60


def set_duration(markdown: str, minutes: int) -> str:
    """Replace (or add) the front-matter `duration`, with the comment saying where it came from."""
    m = _FRONT.match(markdown)
    if not m:
        raise ValueError("no front matter")
    front = m.group(1)
    front = re.sub(r'^# Moving time from the GPX:.*\n', '', front, flags=re.M)
    line = f"duration: {minutes}\n"
    if re.search(r'^duration:', front, re.M):
        front = re.sub(r'^duration:.*\n', COMMENT + line, front, count=1, flags=re.M)
    else:
        anchor = re.search(r'^(elapsed|images):', front, re.M)
        pos = anchor.start() if anchor else len(front)
        front = front[:pos] + COMMENT + line + front[pos:]
    return f"---\n{front}---\n" + markdown[m.end():]


def gpx_for_post(markdown: str, slug: str) -> Path:
    m = re.search(r'^gpx:\s*(\S+)', markdown, re.M)
    if m:
        return REPO / "static" / m.group(1).lstrip("/")
    return REPO / "static/_projects/data-viz/hikes/gpx" / f"{slug[11:]}.gpx"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("posts", nargs="*", help="post slugs or .md paths (default: every post)")
    parser.add_argument("--dry-run", action="store_true", help="print, don't write")
    args = parser.parse_args(argv)

    paths = [Path(p) if p.endswith(".md") else MARKDOWN / f"{p}.md" for p in args.posts] \
        or sorted(MARKDOWN.glob("[0-9]*.md"))
    for path in paths:
        markdown = path.read_text(encoding="utf-8")
        gpx = gpx_for_post(markdown, path.stem)
        minutes = moving_minutes(read_track(gpx.read_text(encoding="utf-8"))) if gpx.exists() else None
        if minutes is None:
            continue
        old = re.search(r'^duration:\s*(\d+)', markdown, re.M)
        print(f"{path.stem:45s} {old.group(1) if old else '-':>6s} -> {round(minutes)}")
        if not args.dry_run:
            path.write_text(set_duration(markdown, round(minutes)), encoding="utf-8")
    return 0
