"""Terrain height at a coordinate, exactly as the post's 3D map draws it.

The 3D map (src/lib/hikes/map-3d.ts) renders each zoom-13 tile as a
TERRAIN_TILE_SEGMENTS x TERRAIN_TILE_SEGMENTS `PlaneGeometry`. Its vertex
shader lifts every vertex by the DEM height bilinearly sampled at that
vertex (meshline/dem-height.ts), and the GPU interpolates linearly across
each triangle in between. Reading the DEM directly at a photo's coordinate
would put its marker a few metres off that surface on steep ground, so this
reproduces the mesh instead: the same per-vertex sampling, then the same
triangle.

Heights are in metres above sea level; map-3d.ts converts them to scene
units with the same factor the shader uses.
"""

import math
from functools import lru_cache
from pathlib import Path

from PIL import Image

from . import config


def tile_position(lat: float, lon: float, zoom: int = config.TERRAIN_ZOOM) -> tuple[float, float]:
    """Web Mercator tile coordinates of a point, fractional part included
    (y grows southwards, as in tile file names). Matches d3's geoMercator,
    which map-3d.ts projects with."""
    n = 2 ** zoom
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def decode_height(r: int, g: int, b: int) -> float:
    """Mapbox Terrain-RGB pixel -> metres."""
    return -10000.0 + (r * 65536 + g * 256 + b) * 0.1


class DemTile:
    """One buffered DEM tile, sampled like the 3D map's vertex shader."""

    def __init__(self, path: Path):
        img = Image.open(path).convert("RGB")
        self.size = img.width
        self.inner = self.size - 2 * config.DEM_BUFFER_PX
        self.pixels = img.load()

    def _texel(self, x: int, y: int) -> float:
        x = min(max(x, 0), self.size - 1)
        y = min(max(y, 0), self.size - 1)
        return decode_height(*self.pixels[x, y])

    def sample(self, fx: float, fy: float) -> float:
        """Bilinear height at tile fraction (fx, fy), with fy measured from
        the tile's top (north) edge. Inner pixel j covers [j, j+1) / inner of
        the tile and sits at column j + buffer in the file."""
        bx = fx * self.inner - 0.5 + config.DEM_BUFFER_PX
        by = fy * self.inner - 0.5 + config.DEM_BUFFER_PX
        x0, y0 = math.floor(bx), math.floor(by)
        tx, ty = bx - x0, by - y0
        top = self._texel(x0, y0) * (1 - tx) + self._texel(x0 + 1, y0) * tx
        bottom = self._texel(x0, y0 + 1) * (1 - tx) + self._texel(x0 + 1, y0 + 1) * tx
        return top * (1 - ty) + bottom * ty

    def mesh_height(self, fx: float, fy: float, segments: int = config.TERRAIN_TILE_SEGMENTS) -> float:
        """Height of the rendered tile surface at (fx, fy).

        three.js's PlaneGeometry numbers vertices row by row from the top
        left and splits each cell (a = top-left, b = bottom-left,
        c = bottom-right, d = top-right) into triangles (a, b, d) and
        (b, c, d), i.e. along the b-d diagonal."""
        gx, gy = fx * segments, fy * segments
        ix = min(int(math.floor(gx)), segments - 1)
        iy = min(int(math.floor(gy)), segments - 1)
        s, t = gx - ix, gy - iy

        def vertex(i: int, j: int) -> float:
            return self.sample(i / segments, j / segments)

        hb, hd = vertex(ix, iy + 1), vertex(ix + 1, iy)
        if s + t <= 1.0:
            ha = vertex(ix, iy)
            return ha + s * (hd - ha) + t * (hb - ha)
        hc = vertex(ix + 1, iy + 1)
        return hc + (1 - s) * (hb - hc) + (1 - t) * (hd - hc)


class Terrain:
    """Looks up rendered terrain heights from the site's local DEM tiles."""

    def __init__(self, dem_dir: Path, zoom: int = config.TERRAIN_ZOOM):
        self.dem_dir = Path(dem_dir)
        self.zoom = zoom
        self._tile = lru_cache(maxsize=64)(self._load)

    @classmethod
    def for_settings(cls, settings: "config.Settings") -> "Terrain":
        return cls(settings.static_root / config.DEM_SUBDIR)

    def _load(self, tx: int, ty: int) -> DemTile | None:
        path = self.dem_dir / f"{self.zoom}_{tx}_{ty}.png"
        return DemTile(path) if path.exists() else None

    def height(self, lat: float, lon: float) -> float | None:
        """Rendered terrain height in metres, rounded to 0.1 m, or None when
        the tile isn't downloaded (then the point is off the 3D map anyway)."""
        x, y = tile_position(lat, lon, self.zoom)
        tx, ty = math.floor(x), math.floor(y)
        tile = self._tile(tx, ty)
        if tile is None:
            return None
        return round(tile.mesh_height(x - tx, y - ty), 1)

    def meta(self, lat: float | None, lon: float | None) -> dict:
        """`{"demEle": h}` for merging into an image entry, or {} when there's
        no coordinate or no tile for it."""
        if lat is None or lon is None:
            return {}
        h = self.height(lat, lon)
        return {} if h is None else {"demEle": h}
