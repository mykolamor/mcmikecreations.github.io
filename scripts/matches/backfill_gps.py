"""One-time backfill: copy matched photos' GPS into post front matter.

Posts optimized before the 2D map started showing photos have `images`
entries without `lat`/`lon`. The coordinates are already in each post's
match report (Immich's EXIF location for the matched asset), so this reads
them from there - no Immich access needed - and adds them to the existing
front-matter entries. Safe to re-run: unchanged posts aren't rewritten.

Run `scripts/.venv/bin/python scripts/backfill_gps.py --help` for options.
"""

import argparse

from . import cliutil
from .cliutil import resolve_posts
from .optimize import gps_meta
from .postwriter import merge_image_fields
from .report import matched_by_filename, read_report


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="backfill_gps.py",
        description="Add `lat`/`lon` from match reports to hike post front-matter `images` entries.",
    )
    cliutil.add_posts(p)
    cliutil.add_posts_dir(p)
    cliutil.add_out_dir(p)
    cliutil.add_dry_run(p)
    return p


def gps_updates(report: dict) -> dict[str, dict]:
    """filename -> {lat, lon} for every matched report entry with coordinates."""
    return matched_by_filename(report, gps_meta)


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    settings = cliutil.settings_from_dirs(args)

    total = 0
    posts = resolve_posts(args, settings)
    for path in posts:
        try:
            report = read_report(settings.out_dir, path.name)
        except FileNotFoundError:
            continue
        updated = merge_image_fields(path, gps_updates(report), dry_run=args.dry_run)
        if updated:
            total += updated
            print(f"{path.name}: added GPS to {updated} image(s)")

    cliutil.print_summary("\ntotal", f"{total} image(s) updated", len(posts), "post(s)", args.dry_run)
    return 0
