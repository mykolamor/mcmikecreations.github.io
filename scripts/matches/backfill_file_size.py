"""One-time backfill: fill in `file_size` on existing report matches.

Report JSON files written before the review GUI started showing file sizes
have no `file_size` on their Immich matches. This walks every report in
--out-dir and, for each match missing one, looks the asset up in Immich and
writes the size back into the JSON. Safe to re-run - already-filled entries
are left alone.

Run `scripts/.venv/bin/python scripts/backfill_file_size.py --help` for options.
"""

import argparse
import json
import sys

from . import cliutil, config
from .immich import ImmichClient
from .report import dump_report
from .web.state import load_saved


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="backfill_file_size.py",
        description="Fill in `file_size` for existing Immich matches in report JSON files.",
    )
    p.add_argument("--immich-url", default=None,
                   help=f"Base URL of the Immich instance. Defaults to ${config.IMMICH_URL_ENV}, "
                        f"then to whatever the review GUI has remembered.")
    p.add_argument("--api-key", default=None,
                   help=f"Immich API key. Defaults to ${config.API_KEY_ENV}, "
                        f"then to whatever the review GUI has remembered.")
    cliutil.add_out_dir(p)
    cliutil.add_dry_run(p)
    return p


def settings_from_args(args) -> config.Settings:
    return cliutil.settings_from_dirs(args, **cliutil.immich_credentials(args, load_saved()))


def backfill_report(report: dict, client, cache: dict[str, int]) -> int:
    """Fill in missing match file sizes in place; return how many were updated."""
    updated = 0
    for entry in report.get("entries", []):
        match = entry.get("match")
        if not match or match.get("file_size"):
            continue
        asset_id = match.get("asset_id")
        if not asset_id:
            continue
        if asset_id not in cache:
            try:
                cache[asset_id] = client.get_asset(asset_id).file_size
            except Exception as exc:
                print(f"    warning: could not fetch {asset_id}: {exc}", file=sys.stderr)
                continue
        size = cache[asset_id]
        if size:
            match["file_size"] = size
            updated += 1
    return updated


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    settings = settings_from_args(args)
    try:
        client = ImmichClient(settings)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    reports = sorted(settings.out_dir.glob("*.json"))
    if not reports:
        print(f"No report JSON files found in {settings.out_dir}")
        return 0

    cache: dict[str, int] = {}
    total_updated = 0
    for path in reports:
        report = json.loads(path.read_text(encoding="utf-8"))
        updated = backfill_report(report, client, cache)
        if updated:
            total_updated += updated
            print(f"{path.name}: filled in {updated} file size(s)")
            if not args.dry_run:
                dump_report(report, path)

    cliutil.print_summary("\ntotal", f"{total_updated} file size(s) filled in", len(reports),
                          "report(s)", args.dry_run)
    return 0
