"""Backfill `demEle`, the 3D map's rendered terrain height, onto located
photos and POI nodes so both can be pinned onto a post's 3D map.

Photos: every front-matter `images` entry that already carries `lat`/`lon`
(see backfill_gps) gets a `demEle` beside them. Nodes: every node in every
`*.hike.json` gets a top-level `demEle` beside its `lat`/`lon`. A node's OSM
`tags.ele` is left alone - it stays what the popup shows, while `demEle`
is only for placement, as it's what the terrain under the marker is drawn at.

No Immich access needed. Safe to re-run: unchanged files aren't rewritten,
and re-running after the terrain maths or DEM tiles change updates every
value. Run `scripts/.venv/bin/python scripts/backfill_terrain.py --help`.
"""

import argparse
import json
from decimal import Decimal
from pathlib import Path

from . import config
from .cli import resolve_posts
from .postwriter import merge_image_fields, read_images
from .terrain import Terrain

HIKE_JSON_GLOB = "*.hike.json"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="backfill_terrain.py",
        description="Add `demEle` (3D map terrain height) to located post images and hike nodes.",
    )
    p.add_argument("posts", nargs="*", metavar="POST", default=[],
                   help="Post filenames without a path, e.g. 2024-08-31-aiplspitz.md "
                        "(the .md is optional). Omit to process every post.")
    p.add_argument("--posts-dir", default=None,
                   help="Directory holding the hike markdown posts and their .hike.json files.")
    p.add_argument("--no-nodes", action="store_true", help="Skip the *.hike.json nodes.")
    p.add_argument("--no-photos", action="store_true", help="Skip the posts' front-matter images.")
    p.add_argument("--dry-run", action="store_true",
                   help="Report what would change without writing any file.")
    return p


def photo_updates(images: dict[str, dict], terrain: Terrain) -> dict[str, dict]:
    """filename -> {demEle} for every image entry with coordinates on a DEM tile."""
    updates: dict[str, dict] = {}
    for filename, meta in images.items():
        dem = terrain.meta(meta.get("lat"), meta.get("lon"))
        if dem:
            updates[filename] = dem
    return updates


def dump_hike_json(value, indent: int = 0) -> str:
    """Serialise like the hand-maintained .hike.json files: two-space
    indent, arrays of scalars on one line (checkpoints), and numbers parsed
    as Decimal written back verbatim so `28.6056550` keeps its trailing zero."""
    pad = "  " * indent
    if isinstance(value, dict):
        if not value:
            return "{}"
        items = (f"{pad}  {json.dumps(k, ensure_ascii=False)}: {dump_hike_json(v, indent + 1)}"
                 for k, v in value.items())
        return "{\n" + ",\n".join(items) + f"\n{pad}}}"
    if isinstance(value, list):
        if not value:
            return "[]"
        if all(not isinstance(v, (dict, list)) for v in value):
            return "[" + ", ".join(dump_hike_json(v) for v in value) + "]"
        return "[\n" + ",\n".join(f"{pad}  {dump_hike_json(v, indent + 1)}" for v in value) + f"\n{pad}]"
    if isinstance(value, Decimal):
        return str(value)
    return json.dumps(value, ensure_ascii=False)


def _with_dem_ele(node: dict, dem_ele: float) -> dict:
    """`node` with `demEle` set, placed right after `lon` for new keys."""
    value = Decimal(str(dem_ele))
    if "demEle" in node:
        return {**node, "demEle": value}
    out: dict = {}
    for key, v in node.items():
        out[key] = v
        if key == "lon":
            out["demEle"] = value
    if "demEle" not in out:
        out["demEle"] = value
    return out


def backfill_hike_json(path: Path, terrain: Terrain, dry_run: bool = False) -> int:
    """Set `demEle` on every node of one .hike.json; return how many changed."""
    text = path.read_text(encoding="utf-8")
    data = json.loads(text, parse_float=Decimal)
    nodes = data.get("nodes") if isinstance(data, dict) else None
    if not nodes:
        return 0
    changed = 0
    for i, node in enumerate(nodes):
        h = terrain.height(float(node["lat"]), float(node["lon"]))
        if h is None or node.get("demEle") == Decimal(str(h)):
            continue
        nodes[i] = _with_dem_ele(node, h)
        changed += 1
    if changed and not dry_run:
        trailing = "\n" if text.endswith("\n") else ""
        path.write_text(dump_hike_json(data) + trailing, encoding="utf-8")
    return changed


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    kwargs = {"posts_dir": Path(args.posts_dir)} if args.posts_dir else {}
    settings = config.Settings(**kwargs)
    terrain = Terrain.for_settings(settings)
    suffix = " (dry run, nothing written)" if args.dry_run else ""

    if not args.no_photos:
        total = 0
        posts = resolve_posts(args, settings)
        for path in posts:
            updated = merge_image_fields(path, photo_updates(read_images(path), terrain),
                                         dry_run=args.dry_run)
            if updated:
                total += updated
                print(f"{path.name}: set demEle on {updated} image(s)")
        print(f"photos: {total} image(s) updated across {len(posts)} post(s){suffix}")

    if not args.no_nodes:
        total = 0
        files = sorted(settings.posts_dir.glob(HIKE_JSON_GLOB))
        for path in files:
            updated = backfill_hike_json(path, terrain, dry_run=args.dry_run)
            if updated:
                total += updated
                print(f"{path.name}: set demEle on {updated} node(s)")
        print(f"nodes: {total} node(s) updated across {len(files)} file(s){suffix}")
    return 0
