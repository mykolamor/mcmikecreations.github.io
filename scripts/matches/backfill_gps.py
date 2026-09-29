"""One-time backfill: copy matched photos' GPS into post front matter.

Posts optimized before the 2D map started showing photos have `images`
entries without `lat`/`lon`. The coordinates are already in each post's
match report (Immich's EXIF location for the matched asset), so this reads
them from there - no Immich access needed - and adds them to the existing
front-matter entries. Safe to re-run: unchanged posts aren't rewritten.

Run `scripts/.venv/bin/python scripts/backfill_gps.py --help` for options.
"""

import argparse
from pathlib import Path

from . import config
from .cli import resolve_posts
from .optimize import gps_meta
from .postwriter import merge_image_fields
from .report import read_report


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="backfill_gps.py",
        description="Add `lat`/`lon` from match reports to hike post front-matter `images` entries.",
    )
    p.add_argument("posts", nargs="*", metavar="POST", default=[],
                   help="Post filenames without a path, e.g. 2024-08-31-aiplspitz.md "
                        "(the .md is optional). Omit to process every post.")
    p.add_argument("--posts-dir", default=None, help="Directory holding the hike markdown posts.")
    p.add_argument("--out-dir", default=None, help="Directory holding the per-post JSON reports.")
    p.add_argument("--dry-run", action="store_true",
                   help="Report what would change without writing any file.")
    return p


def gps_updates(report: dict) -> dict[str, dict]:
    """filename -> {lat, lon} for every matched report entry with coordinates."""
    updates: dict[str, dict] = {}
    for entry in report.get("entries", []):
        if entry.get("status") != "matched":
            continue
        gps = gps_meta(entry.get("match"))
        if gps:
            updates[entry["web_path"].rsplit("/", 1)[-1]] = gps
    return updates


def backfill_post(post_path: Path, updates: dict[str, dict], dry_run: bool = False) -> int:
    """Apply `updates` to the post's existing `images` entries; return how many changed."""
    return merge_image_fields(post_path, updates, dry_run=dry_run)


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    kwargs = {}
    if args.posts_dir:
        kwargs["posts_dir"] = Path(args.posts_dir)
    if args.out_dir:
        kwargs["out_dir"] = Path(args.out_dir)
    settings = config.Settings(**kwargs)

    total = 0
    posts = resolve_posts(args, settings)
    for path in posts:
        try:
            report = read_report(settings.out_dir, path.name)
        except FileNotFoundError:
            continue
        updated = backfill_post(path, gps_updates(report), dry_run=args.dry_run)
        if updated:
            total += updated
            print(f"{path.name}: added GPS to {updated} image(s)")

    print(f"\ntotal: {total} image(s) updated across {len(posts)} post(s)"
          + (" (dry run, nothing written)" if args.dry_run else ""))
    return 0
