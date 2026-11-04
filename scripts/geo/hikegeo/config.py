"""Constants and helpers shared by the region outline and hero heightmap scripts."""

from pathlib import Path

STATIC_SUBDIR = "static"

# --- 3D map terrain ---------------------------------------------------------
# Heights are sampled the way the post's 3D map renders its terrain
# (src/lib/hikes/map-3d.ts + meshline/dem-height.ts). Change these only
# together with their TypeScript counterparts.
DEM_SUBDIR = "_projects/data-viz/maps/mapbox-terrain-dem-v1"  # under STATIC_SUBDIR
TERRAIN_ZOOM = 13            # map-3d.ts ZOOM
TERRAIN_TILE_SEGMENTS = 64   # map-3d.ts TILE_SEGMENTS
DEM_BUFFER_PX = 1            # map-providers.js mapboxDEM: 514px tiles = 512 + 1px each side


def repo_root() -> Path:
    """Repository root, derived from this file's location."""
    return Path(__file__).resolve().parents[3]
