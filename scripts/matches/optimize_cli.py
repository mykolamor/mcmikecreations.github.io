"""Command-line interface for generating AVIF/LQIP from Immich matches."""

import argparse
import sys

from . import cliutil, config
from .cliutil import resolve_posts
from .immich import ImmichClient
from .optimize import optimize_post
from .backfill_time import refresh_post
from .postwriter import merge_images_front_matter


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="image_optimize.py",
        description=(
            "Generate responsive AVIF + LQIP blur placeholders for hike post "
            "images with a confirmed Immich match, and record width/height "
            "for every other inline story image, into each post's front matter."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    cliutil.add_posts(
        p, help="Post filenames without a path, e.g. 2024-08-31-aiplspitz.md "
                "(the .md is optional). Omit to process every post that has a match report.",
    )

    src = p.add_argument_group("sources")
    src.add_argument("--immich-url", default=None,
                     help=f"Base URL of the Immich instance. Defaults to ${config.IMMICH_URL_ENV}.")
    src.add_argument("--api-key", default=None,
                     help=f"Immich API key. Defaults to ${config.API_KEY_ENV}.")
    cliutil.add_posts_dir(src)
    src.add_argument("--places-dir", default=None,
                     help="Directory holding the place docs. Defaults to `places` next to --posts-dir.")
    src.add_argument("--static-root", default=None, help="Directory that /images/... paths resolve against.")
    cliutil.add_out_dir(src, help="Directory holding image_match.py's per-post JSON reports.")
    src.add_argument("--cache-dir", default=None, help="Download cache. Defaults to a dot-directory inside --out-dir.")
    src.add_argument("--no-cache", action="store_true", help="Re-download originals instead of reusing the cache.")

    tune = p.add_argument_group("generation")
    tune.add_argument("--avif-quality", type=int, default=config.DEFAULT_AVIF_QUALITY,
                      help="AVIF encode quality (0-100) for all three tiers.")
    tune.add_argument("--lqip-quality", type=int, default=config.DEFAULT_LQIP_QUALITY,
                      help="WebP encode quality (0-100) for the blur placeholder.")
    tune.add_argument("--lqip-long-edge", type=int, default=config.DEFAULT_LQIP_LONG_EDGE,
                      help="Long-edge pixel size of the blur placeholder.")

    run = p.add_argument_group("execution")
    run.add_argument("--force", action="store_true",
                     help="Re-process a post even if its front matter already has an images map.")
    cliutil.add_dry_run(run, help="Report what would be generated without writing any file.")
    run.add_argument("--workers", type=int, default=config.DEFAULT_WORKERS, help="Concurrent downloads.")
    run.add_argument("--timeout", type=int, default=config.DEFAULT_TIMEOUT, help="HTTP timeout in seconds.")
    run.add_argument("-v", "--verbose", action="store_true", help="Print a line per image instead of a line per post.")
    return p


def settings_from_args(args) -> config.Settings:
    kwargs = dict(
        use_cache=not args.no_cache,
        avif_quality=args.avif_quality,
        lqip_quality=args.lqip_quality,
        lqip_long_edge=args.lqip_long_edge,
        workers=args.workers,
        timeout=args.timeout,
        force=args.force,
        verbose=args.verbose,
    )
    return cliutil.settings_from_dirs(args, **kwargs, **cliutil.immich_credentials(args))


def _already_processed(post_path) -> bool:
    text = post_path.read_text(encoding="utf-8")
    end = text.find("\n---", 3)
    return end != -1 and "\nimages:" in text[:end]


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    settings = settings_from_args(args)

    try:
        client = ImmichClient(settings)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    posts = resolve_posts(args, settings)
    for path in posts:
        if _already_processed(path) and not args.force and not args.dry_run:
            print(f"{path.name}: already has an images map, skipping (use --force to redo)")
            continue
        try:
            images = optimize_post(path, client, settings, dry_run=args.dry_run)
        except FileNotFoundError as exc:
            print(f"{path.name}: {exc}", file=sys.stderr)
            continue

        matched = sum(1 for meta in images.values() if "blur" in meta)
        dims_only = len(images) - matched
        print(f"{path.name}: {matched} converted to AVIF, {dims_only} dims-only")
        if args.verbose:
            for filename, meta in images.items():
                kind = "avif+blur" if "blur" in meta else "dims-only"
                print(f"    {filename}: {kind} {meta['w']}x{meta['h']}")

        if not args.dry_run:
            merge_images_front_matter(path, images)
            # The map above is rebuilt from scratch: restore `taken` and track locations.
            refresh_post(path, settings)

    return 0
