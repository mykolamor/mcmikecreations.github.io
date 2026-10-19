"""Heightmaps for the home page's hero map (src/lib/hero-map/).

Each hike sidecar with enough `natural=peak` nodes gets one small Terrain-RGB
heightmap of the square its post's 3D map shows - centred on the sidecar's
`origin`, `height` world pixels wide (256 px tiles at zoom 13, as map-3d.ts
projects) - resampled from the local zoom-13 DEM tiles. 256x256 plus the same
1 px border the DEM tiles carry, so src/lib/hikes/meshline/dem-height.ts
samples it unchanged. Beside it, `<stem>.json` holds the square's bounds and
height range.

Incremental: a hike whose outputs are newer than its sidecar and every DEM
tile it reads is skipped. Hikes with a missing tile are skipped with a note.
Run `scripts/.venv/bin/python scripts/hero_heightmaps.py --help`.
"""

import argparse
import json
import math
from pathlib import Path
from typing import Callable

from PIL import Image

from . import config
from .terrain import Terrain, tile_position

HERO_SUBDIR = "_projects/data-viz/hikes/hero"  # under STATIC_SUBDIR
SIDECAR_SUBDIR = "_projects/data-viz/hikes/markdown"  # under STATIC_SUBDIR
SIDECAR_SUFFIX = ".hike.json"
INNER = 256
SIZE = INNER + 2 * config.DEM_BUFFER_PX
TILE_PX = 256  # map-3d.ts projection: 2^21 px around the globe at zoom 13
WORLD_PX = TILE_PX * 2 ** config.TERRAIN_ZOOM

Area = tuple[float, float, float]  # (x0, y0, size) in world pixels, y down


def encode_height(h: float) -> tuple[int, int, int]:
    """Metres -> Mapbox Terrain-RGB pixel (inverse of terrain.decode_height)."""
    enc = min(max(round((h + 10000.0) / 0.1), 0), 0xFFFFFF)
    return (enc >> 16) & 0xFF, (enc >> 8) & 0xFF, enc & 0xFF


def world_px(lat: float, lon: float) -> tuple[float, float]:
    x, y = tile_position(lat, lon)
    return x * TILE_PX, y * TILE_PX


def lonlat(x: float, y: float) -> tuple[float, float]:
    lon = x / WORLD_PX * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / WORLD_PX))))
    return lon, lat


def hike_area(origin: dict, height: float) -> Area:
    cx, cy = world_px(origin["lat"], origin["lon"])
    return cx - height / 2, cy - height / 2, float(height)


def area_bounds(area: Area) -> dict:
    x0, y0, size = area
    west, north = lonlat(x0, y0)
    east, south = lonlat(x0 + size, y0 + size)
    return {"west": west, "south": south, "east": east, "north": north}


def _sample_coords(area: Area) -> tuple[list[float], list[float]]:
    """World x per column and y per row, border included: pixel centres."""
    x0, y0, size = area
    step = size / INNER
    offsets = [(i - config.DEM_BUFFER_PX + 0.5) * step for i in range(SIZE)]
    return [x0 + o for o in offsets], [y0 + o for o in offsets]


def area_tiles(area: Area) -> set[tuple[int, int]]:
    xs, ys = _sample_coords(area)
    return {(tx, ty)
            for tx in range(math.floor(xs[0] / TILE_PX), math.floor(xs[-1] / TILE_PX) + 1)
            for ty in range(math.floor(ys[0] / TILE_PX), math.floor(ys[-1] / TILE_PX) + 1)}


def peak_count(meta: dict) -> int:
    return sum(1 for n in meta.get("nodes") or [] if (n.get("tags") or {}).get("natural") == "peak")


def build_heightmap(area: Area, sample: Callable[[float, float], float | None]):
    """(image, min, max), or None if any sample is missing. `sample` takes
    fractional tile coordinates at TERRAIN_ZOOM."""
    xs, ys = _sample_coords(area)
    img = Image.new("RGB", (SIZE, SIZE))
    px = img.load()
    lo, hi = math.inf, -math.inf
    for row, wy in enumerate(ys):
        for col, wx in enumerate(xs):
            h = sample(wx / TILE_PX, wy / TILE_PX)
            if h is None:
                return None
            px[col, row] = encode_height(h)
            lo, hi = min(lo, h), max(hi, h)
    return img, lo, hi


def process(sidecar: Path, out_dir: Path, terrain: Terrain, min_peaks: int, force: bool, dry_run: bool) -> str:
    meta = json.loads(sidecar.read_text(encoding="utf-8"))
    peaks = peak_count(meta)
    if peaks < min_peaks:
        return f"skipped ({peaks} peaks)"
    area = hike_area(meta["origin"], meta["height"])
    stem = sidecar.name[: -len(SIDECAR_SUFFIX)]
    webp, info = out_dir / f"{stem}.webp", out_dir / f"{stem}.json"
    tiles = [terrain.dem_dir / f"{terrain.zoom}_{tx}_{ty}.png" for tx, ty in area_tiles(area)]
    if not all(t.exists() for t in tiles):
        return "missing DEM tiles"
    if not force and webp.exists() and info.exists():
        newest_input = max(p.stat().st_mtime_ns for p in [sidecar, *tiles])
        if min(webp.stat().st_mtime_ns, info.stat().st_mtime_ns) >= newest_input:
            return "up to date"
    built = build_heightmap(area, terrain.sample)
    if built is None:
        return "missing DEM tiles"
    if dry_run:
        return "would write"
    img, lo, hi = built
    out_dir.mkdir(parents=True, exist_ok=True)
    img.save(webp, format="WEBP", lossless=True, quality=100, method=6, exact=True)
    bounds = {k: round(v, 7) for k, v in area_bounds(area).items()}
    info.write_text(json.dumps({**bounds, "minEle": round(lo, 1), "maxEle": round(hi, 1)}) + "\n", encoding="utf-8")
    return "written"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="hero_heightmaps.py",
                                description="Build the home page hero map's per-hike heightmaps.")
    p.add_argument("--static-root", type=Path, default=config.repo_root() / config.STATIC_SUBDIR,
                   help="The site's static/ directory.")
    p.add_argument("--min-peaks", type=int, default=5, help="Fewest natural=peak nodes a hike needs.")
    p.add_argument("--force", action="store_true", help="Rebuild even when the outputs are up to date.")
    p.add_argument("--dry-run", action="store_true", help="Report what would change without writing any file.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    static = Path(args.static_root)
    terrain = Terrain(static / config.DEM_SUBDIR)
    out_dir = static / HERO_SUBDIR
    counts: dict[str, int] = {}
    for sidecar in sorted((static / SIDECAR_SUBDIR).glob(f"*{SIDECAR_SUFFIX}")):
        status = process(sidecar, out_dir, terrain, args.min_peaks, args.force, args.dry_run)
        if not status.startswith("skipped"):
            print(f"{sidecar.name}: {status}")
        key = "skipped" if status.startswith("skipped") else status
        counts[key] = counts.get(key, 0) + 1
    print("hero heightmaps: " + ", ".join(f"{n} {k}" for k, n in sorted(counts.items())))
    return 0
