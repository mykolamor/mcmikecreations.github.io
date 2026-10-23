"""Region outlines for the hike hubs and the Web map: one GeoJSON file per
`REGIONS` slug (src/lib/hikes/facts-schema.ts), under REGIONS_SUBDIR, plus an
`index.json` listing them.

Each region is built from OpenStreetMap objects fetched from Nominatim
(polygons for relations and ways, no Overpass needed), as SOURCES says:

- `osm`: the union of these objects' polygons (a mountain area relation, or
  the municipalities a town or valley region covers);
- `buffer`: a line or lake grown by `metres`, for a valley or a lake's shore;
- `split`: the part of another region on one side of a river, minus other
  regions. OSM has no outline for the Mangfall and Walchensee Mountains, so
  they are the Bavarian Prealps east and west of the Isar, the west part
  without the Ester Mountains.

Only missing files are built unless `--force` (or slugs) are given; regions
change rarely and deploy.sh runs this every time. Network failures warn.

Run `scripts/.venv/bin/python scripts/region_shapes.py --help` for options.
"""

import argparse
import json
import math
import re
import sys
import time
from pathlib import Path

import shapely
from shapely import make_valid
from shapely.geometry import LineString, MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

from . import config

REGIONS_SUBDIR = "_projects/data-viz/hikes/regions"
FACTS_SCHEMA = "src/lib/hikes/facts-schema.ts"
LOOKUP_URL = "https://nominatim.openstreetmap.org/lookup"
# Nominatim's usage policy: an identifying agent and at most one request a second.
HEADERS = {"User-Agent": "mykolamor.com region outlines (scripts/region_shapes.py)"}
REQUEST_GAP = 1.1
TIMEOUT = 60
# Simplification, in degrees (~20 m), and coordinate precision (~1 m).
SIMPLIFY = 0.0002
PRECISION = 5
ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
# Split pieces smaller than this share of the region are slivers where the river meanders.
MIN_PIECE = 0.005

# kind: `range` (a mountain range) or `area` (the town, lake or valley a hike is known by).
SOURCES: dict[str, dict] = {
    "ammergau-alps": {"kind": "range", "osm": ["R2121864"]},
    "bavarian-prealps": {"kind": "range", "osm": ["R2116473"]},
    "ester-mountains": {"kind": "range", "osm": ["R2131430"]},
    "karwendel": {"kind": "range", "osm": ["R2114147"]},
    "wetterstein": {"kind": "range", "osm": ["R2131103"]},
    "mangfall-mountains": {"kind": "range", "split": {
        "of": "bavarian-prealps", "river": "R273028", "side": "east"}},
    "walchensee-mountains": {"kind": "range", "split": {
        "of": "bavarian-prealps", "river": "R273028", "side": "west", "minus": ["ester-mountains"]}},
    "ehrwald": {"kind": "area", "osm": ["R37838"]},
    "schwangau": {"kind": "area", "osm": ["R448297"]},
    # The municipality holds both lakes and Neuhaus.
    "schliersee": {"kind": "area", "osm": ["R935959"]},
    # The Tegernseer Tal: Gmund, Tegernsee, Bad Wiessee, Rottach-Egern, Kreuth.
    "tegernsee": {"kind": "area", "osm": ["R935953", "R935954", "R935946", "R935950", "R935952"]},
    # The lake and its shore paths.
    "walchensee": {"kind": "area", "buffer": {"osm": "R168897", "metres": 1000}},
    # OSM maps the valley as a line along its floor.
    "risstal": {"kind": "area", "buffer": {"osm": "W660104910", "metres": 1500}},
}


def region_slugs(repo_root: Path) -> list[str]:
    """The `REGIONS` slugs, read from the TypeScript schema they're defined in."""
    text = (Path(repo_root) / FACTS_SCHEMA).read_text(encoding="utf-8")
    m = re.search(r"export const REGIONS = \[(.*?)\] as const", text, re.S)
    if not m:
        raise ValueError(f"no REGIONS list in {FACTS_SCHEMA}")
    return re.findall(r"'([a-z0-9-]+)'", m.group(1))


class Nominatim:
    """OSM object geometries by id (`R123`, `W456`), polite and cached."""

    def __init__(self):
        import requests
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self.cache: dict[str, object] = {}
        self.last = 0.0

    def geometry(self, osm_id: str):
        if osm_id not in self.cache:
            time.sleep(max(0.0, self.last + REQUEST_GAP - time.monotonic()))
            r = self.session.get(LOOKUP_URL, params={"osm_ids": osm_id, "format": "json", "polygon_geojson": 1},
                                 timeout=TIMEOUT)
            self.last = time.monotonic()
            r.raise_for_status()
            found = r.json()
            if not found or "geojson" not in found[0]:
                raise ValueError(f"Nominatim has no geometry for {osm_id}")
            self.cache[osm_id] = shape(found[0]["geojson"])
        return self.cache[osm_id]


def _local_metres(geom):
    """Project around the geometry's centre so a buffer in metres is round."""
    lat0 = (geom.bounds[1] + geom.bounds[3]) / 2
    scale = [111_320 * math.cos(math.radians(lat0)), 110_540]
    return (lambda xy: xy * scale), (lambda xy: xy / scale)


def buffer_metres(geom, metres: float):
    to_m, from_m = _local_metres(geom)
    return shapely.transform(shapely.transform(geom, to_m).buffer(metres), from_m)


def _river_x_at(river, y: float) -> float | None:
    """The river's longitude where it crosses latitude `y` (its westmost crossing)."""
    xmin, _, xmax, _ = river.bounds
    hits = river.intersection(LineString([(xmin - 1, y), (xmax + 1, y)]))
    xs = [p.x for p in getattr(hits, "geoms", [hits]) if p.geom_type == "Point"]
    return min(xs) if xs else None


def split_by_river(region, river, side: str):
    """The pieces of `region` east or west of `river`, which must cross it."""
    pieces = region.difference(river.buffer(1e-6))
    keep = []
    for piece in getattr(pieces, "geoms", [pieces]):
        p = piece.representative_point()
        x = _river_x_at(river, p.y)
        if x is not None and (p.x > x) == (side == "east") and piece.area >= MIN_PIECE * region.area:
            keep.append(piece)
    return unary_union(keep)


def as_multipolygon(geom) -> MultiPolygon:
    geom = make_valid(geom)
    polys = [g for g in getattr(geom, "geoms", [geom]) if isinstance(g, Polygon)]
    if geom.geom_type == "Polygon":
        polys = [geom]
    return MultiPolygon([p for p in polys if not p.is_empty])


def build(slug: str, sources: dict, nominatim, built: dict) -> MultiPolygon:
    """`slug`'s outline; `built` holds regions already made, for `split`."""
    spec = sources[slug]
    if "osm" in spec:
        geom = unary_union([nominatim.geometry(i) for i in spec["osm"]])
    elif "buffer" in spec:
        geom = buffer_metres(nominatim.geometry(spec["buffer"]["osm"]), spec["buffer"]["metres"])
    elif "split" in spec:
        s = spec["split"]
        for dep in [s["of"], *s.get("minus", [])]:
            if dep not in built:
                built[dep] = build(dep, sources, nominatim, built)
        geom = split_by_river(built[s["of"]], nominatim.geometry(s["river"]), s["side"])
        for dep in s.get("minus", []):
            geom = geom.difference(built[dep])
    else:
        raise ValueError(f"{slug}: no osm, buffer or split source")
    return as_multipolygon(geom)


def _round(coords):
    if isinstance(coords[0], (int, float)):
        return [round(c, PRECISION) for c in coords]
    return [_round(c) for c in coords]


def feature(slug: str, spec: dict, geom: MultiPolygon) -> dict:
    simple = as_multipolygon(geom.simplify(SIMPLIFY, preserve_topology=True))
    g = mapping(simple)
    osm = spec.get("osm") or ([spec["buffer"]["osm"]] if "buffer" in spec else None)
    return {
        "type": "Feature",
        "properties": {
            "slug": slug,
            "kind": spec["kind"],
            "source": "split" if "split" in spec else "buffer" if "buffer" in spec else "osm",
            **({"osm": osm} if osm else {}),
            "attribution": ATTRIBUTION,
        },
        "bbox": [round(b, PRECISION) for b in simple.bounds],
        "geometry": {"type": g["type"], "coordinates": _round(g["coordinates"])},
    }


def write_index(out_dir: Path) -> list[dict]:
    """`index.json`: every region file's slug, kind and bbox, for drawing without fetching all."""
    entries = []
    for path in sorted(out_dir.glob("*.json")):
        if path.name == "index.json":
            continue
        f = json.loads(path.read_text(encoding="utf-8"))
        entries.append({"slug": f["properties"]["slug"], "kind": f["properties"]["kind"], "bbox": f["bbox"]})
    (out_dir / "index.json").write_text(json.dumps(entries, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8")
    return entries


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="region_shapes.py",
                                description="Build the region outlines (GeoJSON) the hub pages and the Web map draw.")
    p.add_argument("slugs", nargs="*", help="Regions to (re)build. Omit for every region missing its file.")
    p.add_argument("--force", action="store_true", help="Rebuild every region.")
    p.add_argument("--static-root", default=None, help="The site's static folder.")
    p.add_argument("--dry-run", action="store_true", help="Build, but write nothing.")
    return p


def main(argv=None, nominatim=None, repo_root: Path | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo_root = repo_root or config.repo_root()
    static_root = Path(args.static_root) if args.static_root else repo_root / config.STATIC_SUBDIR
    out_dir = static_root / REGIONS_SUBDIR

    slugs = region_slugs(repo_root)
    missing = [s for s in slugs if s not in SOURCES]
    if missing:
        print(f"error: no source for region(s) {', '.join(missing)}; add them to SOURCES in "
              f"scripts/matches/regions.py", file=sys.stderr)
        return 1
    unknown = [s for s in args.slugs if s not in slugs]
    if unknown:
        print(f"error: unknown region(s) {', '.join(unknown)}", file=sys.stderr)
        return 2
    todo = args.slugs or [s for s in slugs if args.force or not (out_dir / f"{s}.json").is_file()]
    if not todo:
        print("regions: all outlines present")
        return 0

    try:
        nominatim = nominatim or Nominatim()
    except ImportError as exc:
        print(f"    warning: {exc}; skipping region outlines", file=sys.stderr)
        return 0
    built: dict = {}
    written = 0
    for slug in todo:
        try:
            geom = built[slug] = built.get(slug) or build(slug, SOURCES, nominatim, built)
        except Exception as exc:  # network trouble must not stop a deploy
            print(f"    warning: {slug}: {exc}", file=sys.stderr)
            continue
        f = feature(slug, SOURCES[slug], geom)
        size = len(json.dumps(f))
        print(f"{slug}: {len(geom.geoms)} polygon(s), {size // 1024} KB")
        if not args.dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{slug}.json").write_text(json.dumps(f, ensure_ascii=False) + "\n", encoding="utf-8")
            written += 1
    if written:
        write_index(out_dir)
    print(f"\nregions: {written} outline(s) written" + (" (dry run, nothing written)" if args.dry_run else ""))
    return 0
