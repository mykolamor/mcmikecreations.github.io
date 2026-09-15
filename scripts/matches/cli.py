"""Command-line interface for Immich image matching."""

import argparse
import os
import sys
from pathlib import Path

from . import config
from .immich import ImmichClient
from .matcher import match_post
from .report import build_report, report_path, write_report


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="image_match.py",
        description=(
            "Map compressed images in hike posts to their Immich originals. "
            "Writes one JSON file per post."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument(
        "posts", nargs="*", metavar="POST", default=[],
        help="Post filenames without a path, e.g. 2024-08-31-aiplspitz.md "
             "(the .md is optional). Omit to process every post.",
    )
    p.add_argument(
        "--album", action="append", default=[], metavar="NAME",
        help="Restrict the search to this Immich album. Repeatable. "
             "Omit to guess the album from the post name, falling back to the date window.",
    )

    src = p.add_argument_group("sources")
    src.add_argument("--immich-url", default=None,
                     help=f"Base URL of the Immich instance. "
                          f"Defaults to ${config.IMMICH_URL_ENV}.")
    src.add_argument("--api-key", default=None,
                     help=f"Immich API key. Defaults to ${config.API_KEY_ENV}.")
    src.add_argument("--site-url", default=config.DEFAULT_SITE_URL,
                     help="Base URL of the deployed site, used for 'Open on site' links.")
    src.add_argument("--posts-dir", default=None,
                     help="Directory holding the hike markdown posts.")
    src.add_argument("--static-root", default=None,
                     help="Directory that /images/... paths resolve against.")

    out = p.add_argument_group("output")
    out.add_argument("--out-dir", default=None,
                     help="Where per-post JSON mappings are written.")
    out.add_argument("--cache-dir", default=None,
                     help="Thumbnail and preview cache. Defaults to a dot-directory inside --out-dir.")
    out.add_argument("--no-cache", action="store_true",
                     help="Re-download images instead of reusing the cache.")
    out.add_argument("--force", action="store_true",
                     help="Re-match posts that already have an output file.")
    out.add_argument("--dry-run", action="store_true",
                     help="Report what would be matched without writing any file.")

    tune = p.add_argument_group("matching thresholds")
    tune.add_argument("--date-window-days", type=int, default=config.DEFAULT_DATE_WINDOW_DAYS,
                      help="Days added either side of the post's image dates when searching Immich.")
    tune.add_argument("--ar-tolerance", type=float, default=config.DEFAULT_AR_TOLERANCE,
                      help="Relative aspect-ratio difference tolerated between query and candidate.")
    tune.add_argument("--phash-top-k", type=int, default=config.DEFAULT_PHASH_TOP_K,
                      help="Candidates kept after perceptual-hash ranking.")
    tune.add_argument("--bm-accept", type=float, default=config.DEFAULT_BM_ACCEPT,
                      help="Block-mean distance below which a match is accepted outright.")
    tune.add_argument("--bm-margin", type=float, default=config.DEFAULT_BM_MARGIN,
                      help="Required ratio of runner-up to best block-mean distance.")
    tune.add_argument("--residual-top-k", type=int, default=config.DEFAULT_RESIDUAL_TOP_K,
                      help="Candidates promoted to the expensive residual stage.")
    tune.add_argument("--mae-accept", type=float, default=config.DEFAULT_MAE_ACCEPT,
                      help="Aligned-residual error below which a match is accepted.")
    tune.add_argument("--mae-margin", type=float, default=config.DEFAULT_MAE_MARGIN,
                      help="Required ratio of runner-up to best residual error.")
    tune.add_argument("--sift-max-edge", type=int, default=config.DEFAULT_SIFT_MAX_EDGE,
                      help="Long edge images are scaled to before SIFT detection.")
    tune.add_argument("--residual-blur", type=float, default=config.DEFAULT_RESIDUAL_BLUR,
                      help="Gaussian sigma applied before measuring the residual, so "
                           "a soft web copy is not penalised against a crisp original. "
                           "0 compares at full detail.")
    tune.add_argument("--no-trust-album", action="store_true",
                      help="Also apply the date window when an album is known. Off by "
                           "default because wrong timestamps then hide real matches.")
    tune.add_argument("--album-coverage-min", type=float, default=config.DEFAULT_ALBUM_COVERAGE_MIN,
                      help="Minimum share of post-name words an album must contain to be guessed.")
    tune.add_argument("--original-area-factor", type=float, default=config.DEFAULT_ORIGINAL_AREA_FACTOR,
                      help="Pixel-area ratio at which a larger shortlisted candidate is treated "
                           "as a possible full-resolution original and preferred over a closer-"
                           "scoring but smaller duplicate.")

    run = p.add_argument_group("execution")
    run.add_argument("--workers", type=int, default=config.DEFAULT_WORKERS,
                     help="Concurrent image downloads.")
    run.add_argument("--timeout", type=int, default=config.DEFAULT_TIMEOUT,
                     help="HTTP timeout in seconds.")
    run.add_argument("-v", "--verbose", action="store_true",
                     help="Print a line per image instead of a line per post.")
    return p


def settings_from_args(args) -> config.Settings:
    kwargs = dict(
        site_url=args.site_url,
        use_cache=not args.no_cache,
        date_window_days=args.date_window_days,
        ar_tolerance=args.ar_tolerance,
        phash_top_k=args.phash_top_k,
        bm_accept=args.bm_accept,
        bm_margin=args.bm_margin,
        residual_top_k=args.residual_top_k,
        mae_accept=args.mae_accept,
        mae_margin=args.mae_margin,
        sift_max_edge=args.sift_max_edge,
        residual_blur=args.residual_blur,
        album_coverage_min=args.album_coverage_min,
        original_area_factor=args.original_area_factor,
        trust_album=not args.no_trust_album,
        workers=args.workers,
        timeout=args.timeout,
        force=args.force,
        verbose=args.verbose,
    )
    kwargs["immich_url"] = args.immich_url or os.environ.get(
        config.IMMICH_URL_ENV, "")
    kwargs["api_key"] = args.api_key or os.environ.get(config.API_KEY_ENV, "")
    for name in ("posts_dir", "static_root", "out_dir", "cache_dir"):
        value = getattr(args, name, None)
        if value:
            kwargs[name] = Path(value)
    return config.Settings(**kwargs)


def resolve_posts(args, settings: config.Settings) -> list[Path]:
    """Post paths to process. Empty selection means every post."""
    if not args.posts:
        return sorted(settings.posts_dir.glob("*.md"))
    chosen: list[Path] = []
    for name in args.posts:
        if "/" in name or "\\" in name:
            raise SystemExit(f"Post names must not contain a path: {name!r}")
        stem = name[:-3] if name.endswith(".md") else name
        path = settings.posts_dir / f"{stem}.md"
        if not path.is_file():
            raise SystemExit(f"No such post: {path}")
        chosen.append(path)
    return chosen


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    settings = settings_from_args(args)

    try:
        client = ImmichClient(settings)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    posts = resolve_posts(args, settings)
    albums = client.list_albums()
    totals = {"matched": 0, "ambiguous": 0, "unmatched": 0,
              "skipped_video": 0, "skipped_youtube": 0, "missing_local": 0}

    for path in posts:
        out = report_path(settings.out_dir, path.name)
        if out.exists() and not settings.force and not args.dry_run:
            print(f"{path.name}: already matched, skipping (use --force to redo)")
            continue

        result = match_post(path, client, settings, albums, args.album or None)
        report = build_report(result, settings.immich_url)
        stats = report["stats"]
        for key in totals:
            totals[key] += stats.get(key, 0)

        album_name = report["album"]["name"] or "(date window only)"
        print(
            f"{path.name}: {stats['matched']}/{stats['total']} matched, "
            f"{stats['ambiguous']} ambiguous, {stats['unmatched']} unmatched "
            f"[{album_name}, {result.candidate_count} candidates]"
        )
        if settings.verbose:
            for entry in report["entries"]:
                name = entry["match"]["original_file_name"] if entry["match"] else "-"
                print(f"    [{entry['index']:3d}] {entry['status']:13} {name}")

        if not args.dry_run:
            write_report(report, settings.out_dir, path.name)

    print(
        f"\ntotal: {totals['matched']} matched, {totals['ambiguous']} ambiguous, "
        f"{totals['unmatched']} unmatched, {totals['skipped_video']} videos skipped, "
        f"{totals['skipped_youtube']} youtube skipped, "
        f"{totals['missing_local']} missing locally"
    )
    return 0
