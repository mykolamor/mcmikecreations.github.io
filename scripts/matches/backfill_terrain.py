"""Backfill `demEle`, the 3D map's rendered terrain height, onto located
photos and POI nodes so both can be pinned onto a post's 3D map.

Photos: every front-matter `images` entry that already carries `lat`/`lon`
(see backfill_gps) gets a `demEle` beside them. Nodes: every node in every
`*.hike.json` gets a top-level `demEle` beside its `lat`/`lon`. Facts places:
every `{lat, lon}` place in a `*.hike.json`'s `facts` (route defaults for the
post's facts layer, see src/lib/hikes/facts.server.ts) gets one too, so its
pin can stand on the 3D map like a node; places in a post's front matter
aren't touched (that YAML is hand-formatted and commented). A node's OSM
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

from . import cliutil, config
from .cliutil import resolve_posts
from .postwriter import merge_image_fields, read_images
from .terrain import Terrain

HIKE_JSON_GLOB = "*.hike.json"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="backfill_terrain.py",
        description="Add `demEle` (3D map terrain height) to located post images and hike nodes.",
    )
    cliutil.add_posts(p)
    cliutil.add_posts_dir(p, help="Directory holding the hike markdown posts and their .hike.json files.")
    p.add_argument("--no-nodes", action="store_true", help="Skip the *.hike.json nodes.")
    p.add_argument("--no-photos", action="store_true", help="Skip the posts' front-matter images.")
    cliutil.add_dry_run(p)
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


# Keys a `{lat, lon}` facts place may have (facts.server.ts `readRawPlace`).
FACTS_PLACE_KEYS = frozenset(config.schema_keys()["factsPlaceKeys"])


def _is_facts_place(value) -> bool:
    return (isinstance(value, dict) and "lat" in value and "lon" in value
            and set(value) <= FACTS_PLACE_KEYS
            and all(isinstance(value[k], (int, float, Decimal)) for k in ("lat", "lon")))


def _set_dem_ele(place: dict, terrain: Terrain) -> tuple[dict, int]:
    """`place` (a node or a facts place) with `demEle` set to the terrain
    height under it, and 1 if that changed it, else 0. Off the DEM tiles it
    is left as it is."""
    h = terrain.height(float(place["lat"]), float(place["lon"]))
    if h is None or place.get("demEle") == Decimal(str(h)):
        return place, 0
    return _with_dem_ele(place, h), 1


def _backfill_facts_places(value, terrain: Terrain) -> tuple[object, int]:
    """`value` (any part of a sidecar's `facts`) with `demEle` set on every
    `{lat, lon}` place in it, and how many changed."""
    if _is_facts_place(value):
        return _set_dem_ele(value, terrain)
    if not isinstance(value, (dict, list)):
        return value, 0
    out = dict(value) if isinstance(value, dict) else list(value)
    changed = 0
    for k, v in (value.items() if isinstance(value, dict) else enumerate(value)):
        out[k], n = _backfill_facts_places(v, terrain)
        changed += n
    return out, changed


def backfill_hike_json(path: Path, terrain: Terrain, dry_run: bool = False) -> int:
    """Set `demEle` on every node and every `{lat, lon}` facts place of one
    .hike.json; return how many changed."""
    text = path.read_text(encoding="utf-8")
    data = json.loads(text, parse_float=Decimal)
    if not isinstance(data, dict):
        return 0
    changed = 0
    nodes = data.get("nodes") or []
    for i, node in enumerate(nodes):
        nodes[i], n = _set_dem_ele(node, terrain)
        changed += n
    if "facts" in data:
        data["facts"], n = _backfill_facts_places(data["facts"], terrain)
        changed += n
    if changed and not dry_run:
        trailing = "\n" if text.endswith("\n") else ""
        path.write_text(dump_hike_json(data) + trailing, encoding="utf-8")
    return changed


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    settings = cliutil.settings_from_dirs(args)
    terrain = Terrain.for_settings(settings)

    if not args.no_photos:
        total = 0
        posts = resolve_posts(args, settings)
        for path in posts:
            updated = merge_image_fields(path, photo_updates(read_images(path), terrain),
                                         dry_run=args.dry_run)
            if updated:
                total += updated
                print(f"{path.name}: set demEle on {updated} image(s)")
        cliutil.print_summary("photos", f"{total} image(s) updated", len(posts), "post(s)", args.dry_run)

    if not args.no_nodes:
        total = 0
        files = sorted(settings.posts_dir.glob(HIKE_JSON_GLOB))
        for path in files:
            updated = backfill_hike_json(path, terrain, dry_run=args.dry_run)
            if updated:
                total += updated
                print(f"{path.name}: set demEle on {updated} node(s) and facts place(s)")
        cliutil.print_summary("nodes", f"{total} node(s) and facts place(s) updated", len(files),
                              "file(s)", args.dry_run)
    return 0
