"""Backfill `taken`, when a photo was taken, into post front matter, and
place photos without usable GPS onto the recorded track by that time.

`taken` is the local wall-clock time with its UTC offset, e.g.
`2026-09-27T11:18:16+02:00`, from Immich's `local_date_time` and
`file_created_at` in each post's match report. It is only written when it is
believable:

- Its UTC offset matches the one most of the post's photos have. Re-exported
  copies with a broken timestamp come out at `+00:00` (or an hour off).
- Recorded hike: its local date is one the track spans. Not just the post
  date, since overnight and multi-day hikes cross midnight.
- Planned hike: its local date is the post's date.
- Recorded hike, photo with GPS: the track's position at that time is within
  250 m of the photo. Before the recording starts or after it ends, that is
  the track's first or last point; inside a recording gap, anywhere on the
  line between the gap's ends. A photo taken during a long break still
  passes, since the track stays where the photo is.

A photo with a believable `taken` but no `lat`/`lon` on a recorded hike gets
the track's position at that time (within 15 minutes of the recording, and
not inside a gap where it moved), its `demEle`, and `located: track`, so the
maps can pin it too. Photos without a believable `taken` lose a stale one, and
track-located photos that can no longer be placed lose that location again.
GPS from the photo itself is never touched.

No Immich access needed. Safe to re-run: unchanged posts aren't rewritten.
Run `scripts/.venv/bin/python scripts/backfill_time.py --help`.
"""

import argparse
import bisect
import math
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config
from .cli import resolve_posts
from .postwriter import merge_image_fields, read_images
from .report import read_report
from .terrain import Terrain
from .track_metrics import MAX_INTERVAL_S, Point, gpx_for_post, read_track

TRACK_SLACK_S = 15 * 60
AGREE_M = 250.0
TRACK_LOCATION_KEYS = ("lat", "lon", "demEle", "located")


@dataclass
class Stamp:
    taken: str        # local wall clock with offset, seconds precision
    utc: float        # unix seconds
    offset_min: int
    local_date: str   # YYYY-MM-DD


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def read_stamp(match: dict | None) -> Stamp | None:
    """The photo's timestamp from a report match, or None without one.

    Immich's `local_date_time` is the wall-clock time labelled as UTC, and
    `file_created_at` the real UTC instant, so their difference is the offset."""
    if not match or not match.get("local_date_time") or not match.get("file_created_at"):
        return None
    try:
        local = _parse(match["local_date_time"])
        utc = _parse(match["file_created_at"])
    except ValueError:
        return None
    offset_min = round((local - utc).total_seconds() / 60 / 15) * 15
    zone = timezone(timedelta(minutes=offset_min))
    wall = local.replace(tzinfo=zone, microsecond=0)
    return Stamp(wall.isoformat(), utc.timestamp(), offset_min, wall.date().isoformat())


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (lat1, lon1, lat2, lon2))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def position_at(track: list[Point], t: float) -> tuple[float, float] | None:
    """Where the recorded track was at unix time `t`, linearly interpolated.

    None outside the track's span, and inside a recording gap unless both
    ends of the gap are at the same place (a break or a night at a hut)."""
    if not track or t < track[0].time or t > track[-1].time:
        return None
    i = bisect.bisect_left([p.time for p in track], t)
    if track[i].time == t:
        return track[i].lat, track[i].lon
    a, b = track[i - 1], track[i]
    if b.time - a.time > MAX_INTERVAL_S and _distance_m(a.lat, a.lon, b.lat, b.lon) > AGREE_M:
        return None
    f = (t - a.time) / (b.time - a.time) if b.time > a.time else 0.0
    return a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f


def _segment_distance_m(lat: float, lon: float, a: Point, b: Point) -> float:
    """Distance from (lat, lon) to the straight segment a-b, on a local flat projection."""
    k = math.cos(math.radians(lat))
    ax, ay = (a.lon - lon) * k, a.lat - lat
    bx, by = (b.lon - lon) * k, b.lat - lat
    dx, dy = bx - ax, by - ay
    f = 0.0 if dx == dy == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
    return _distance_m(lat, lon, a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f)


def track_distance_m(track: list[Point], t: float, lat: float, lon: float) -> float:
    """How far (lat, lon) is from where the recorded track was at time `t`.

    Before the start or after the end, the track is where it started or
    ended (waiting at the trailhead, a hut at the top). Inside a recording
    gap it is anywhere on the straight line between the gap's two ends."""
    if t <= track[0].time:
        return _distance_m(lat, lon, track[0].lat, track[0].lon)
    if t >= track[-1].time:
        return _distance_m(lat, lon, track[-1].lat, track[-1].lon)
    pos = position_at(track, t)
    if pos:
        return _distance_m(lat, lon, *pos)
    i = bisect.bisect_left([p.time for p in track], t)
    return _segment_distance_m(lat, lon, track[i - 1], track[i])


def _track_dates(track: list[Point], offset_min: int) -> set[str]:
    """Local dates the recorded track spans."""
    zone = timezone(timedelta(minutes=offset_min))
    first = datetime.fromtimestamp(track[0].time, zone).date()
    last = datetime.fromtimestamp(track[-1].time, zone).date()
    return {(first + timedelta(days=d)).isoformat() for d in range((last - first).days + 1)}


def _believable(stamp: Stamp, usual_offset: int, post_date: str, track: list[Point]) -> bool:
    if stamp.offset_min != usual_offset:
        return False
    if track:
        return stamp.local_date in _track_dates(track, usual_offset)
    return stamp.local_date == post_date


def time_updates(post_date: str, images: dict[str, dict], report: dict,
                 track: list[Point], terrain) -> dict[str, dict]:
    """filename -> fields to set (None removes a field) for one post."""
    stamps: dict[str, Stamp] = {}
    for entry in report.get("entries", []):
        if entry.get("status") != "matched":
            continue
        stamp = read_stamp(entry.get("match"))
        if stamp:
            stamps[entry["web_path"].rsplit("/", 1)[-1]] = stamp
    offsets = Counter(s.offset_min for s in stamps.values())
    usual_offset = offsets.most_common(1)[0][0] if offsets else None

    updates: dict[str, dict] = {}
    for filename, meta in images.items():
        from_track = meta.get("located") == "track"
        has_gps = "lat" in meta and "lon" in meta and not from_track
        stamp = stamps.get(filename)
        wanted: dict = {}

        if stamp and _believable(stamp, usual_offset, post_date, track):
            if not track:
                wanted["taken"] = stamp.taken
            elif has_gps:
                if track_distance_m(track, stamp.utc, meta["lat"], meta["lon"]) <= AGREE_M:
                    wanted["taken"] = stamp.taken
            else:
                wanted["taken"] = stamp.taken
                start, end = track[0].time - TRACK_SLACK_S, track[-1].time + TRACK_SLACK_S
                pos = position_at(track, min(max(stamp.utc, track[0].time), track[-1].time)) \
                    if start <= stamp.utc <= end else None
                # Off the recording or inside a gap: the time stands, the place is unknown.
                if pos:
                    lat, lon = round(pos[0], 6), round(pos[1], 6)
                    wanted.update({"lat": lat, "lon": lon, **terrain.meta(lat, lon), "located": "track"})

        fields = {k: v for k, v in wanted.items() if meta.get(k) != v}
        stale = ["taken"] + (list(TRACK_LOCATION_KEYS) if from_track else [])
        fields.update({k: None for k in stale if k in meta and k not in wanted})
        if fields:
            updates[filename] = fields
    return updates


def backfill_post(post_path: Path, updates: dict[str, dict], dry_run: bool = False) -> int:
    """Apply `updates` to the post's existing `images` entries; return how many changed."""
    return merge_image_fields(post_path, updates, dry_run=dry_run)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="backfill_time.py",
        description="Add `taken` from match reports to hike post images, and place "
                    "photos without GPS on the recorded track by that time.",
    )
    p.add_argument("posts", nargs="*", metavar="POST", default=[],
                   help="Post filenames without a path, e.g. 2024-08-31-aiplspitz.md "
                        "(the .md is optional). Omit to process every post.")
    p.add_argument("--posts-dir", default=None, help="Directory holding the hike markdown posts.")
    p.add_argument("--out-dir", default=None, help="Directory holding the per-post JSON reports.")
    p.add_argument("--dry-run", action="store_true",
                   help="Report what would change without writing any file.")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    kwargs = {}
    if args.posts_dir:
        kwargs["posts_dir"] = Path(args.posts_dir)
    if args.out_dir:
        kwargs["out_dir"] = Path(args.out_dir)
    settings = config.Settings(**kwargs)
    terrain = Terrain.for_settings(settings)

    total = 0
    posts = resolve_posts(args, settings)
    for path in posts:
        try:
            report = read_report(settings.out_dir, path.name)
        except FileNotFoundError:
            report = {"entries": []}
        markdown = path.read_text(encoding="utf-8")
        gpx = gpx_for_post(markdown, path.stem)
        track = read_track(gpx.read_text(encoding="utf-8")) if gpx.exists() else []
        updates = time_updates(path.stem[:10], read_images(path), report, track, terrain)
        updated = backfill_post(path, updates, dry_run=args.dry_run)
        if updated:
            total += updated
            placed = sum(1 for f in updates.values() if f.get("located") == "track")
            dropped = sum(1 for f in updates.values() if "taken" in f and f["taken"] is None)
            print(f"{path.name}: updated {updated} image(s)"
                  + (f", placed {placed} on the track" if placed else "")
                  + (f", dropped {dropped} timestamp(s)" if dropped else ""))

    print(f"\ntotal: {total} image(s) updated across {len(posts)} post(s)"
          + (" (dry run, nothing written)" if args.dry_run else ""))
    return 0
