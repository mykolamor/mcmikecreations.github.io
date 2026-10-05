"""Flags, settings and post selection shared by the package's command-line tools."""

import argparse
import os
from pathlib import Path

from . import config

POSTS_HELP = ("Post filenames without a path, e.g. 2024-08-31-aiplspitz.md "
              "(the .md is optional). Omit to process every post.")
DRY_RUN_HELP = "Report what would change without writing any file."
DRY_RUN_NOTE = " (dry run, nothing written)"
# Settings fields a command may expose as a `--<name>` directory flag.
DIR_FIELDS = ("posts_dir", "places_dir", "static_root", "out_dir", "cache_dir")


def add_posts(p, help: str = POSTS_HELP) -> None:
    p.add_argument("posts", nargs="*", metavar="POST", default=[], help=help)


def add_posts_dir(p, help: str = "Directory holding the hike markdown posts.") -> None:
    p.add_argument("--posts-dir", default=None, help=help)


def add_out_dir(p, help: str = "Directory holding the per-post JSON reports.") -> None:
    p.add_argument("--out-dir", default=None, help=help)


def add_dry_run(p, help: str = DRY_RUN_HELP) -> None:
    p.add_argument("--dry-run", action="store_true", help=help)


def settings_from_dirs(args: argparse.Namespace, **kwargs) -> config.Settings:
    """Settings from `kwargs`, plus whichever DIR_FIELDS flags the command
    defines and was given; the rest keep their defaults."""
    for name in DIR_FIELDS:
        value = getattr(args, name, None)
        if value:
            kwargs[name] = Path(value)
    return config.Settings(**kwargs)


def immich_credentials(args: argparse.Namespace, saved: dict | None = None) -> dict:
    """`immich_url` and `api_key`: the flag, else the environment, else
    `saved` (the review GUI's remembered credentials, when given)."""
    saved = saved or {}
    return {
        "immich_url": (args.immich_url or os.environ.get(config.IMMICH_URL_ENV)
                       or saved.get("immich_url") or ""),
        "api_key": (args.api_key or os.environ.get(config.API_KEY_ENV)
                    or saved.get("api_key") or ""),
    }


def print_summary(label: str, done: str, count: int, unit: str, dry_run: bool) -> None:
    """`<label>: <done> across <count> <unit>`, noting a dry run."""
    print(f"{label}: {done} across {count} {unit}" + (DRY_RUN_NOTE if dry_run else ""))


def all_posts(settings: config.Settings) -> list[Path]:
    """Every post, then every place doc."""
    places_dir = settings.places_root
    places = sorted(places_dir.glob("*.md")) if places_dir and places_dir.is_dir() else []
    return sorted(settings.posts_dir.glob("*.md")) + places


def resolve_posts(args, settings: config.Settings) -> list[Path]:
    """Post and place-doc paths to process. Empty selection means every post,
    then every place doc. A name is looked up among the posts first, then
    among the place docs (a post's name always starts with its date, a place
    doc's never does, so the two can't collide)."""
    if not args.posts:
        return all_posts(settings)
    places_dir = settings.places_root
    chosen: list[Path] = []
    for name in args.posts:
        if "/" in name or "\\" in name:
            raise SystemExit(f"Post names must not contain a path: {name!r}")
        stem = name[:-3] if name.endswith(".md") else name
        path = settings.posts_dir / f"{stem}.md"
        if not path.is_file() and places_dir is not None and (places_dir / f"{stem}.md").is_file():
            path = places_dir / f"{stem}.md"
        if not path.is_file():
            raise SystemExit(f"No such post or place doc: {path}")
        chosen.append(path)
    return chosen
