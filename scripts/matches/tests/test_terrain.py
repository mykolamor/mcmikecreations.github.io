"""Offline tests for the 3D map terrain sampler."""

import math

import pytest
from PIL import Image

from matches import config
from matches.terrain import DemTile, Terrain, decode_height, tile_position

SIZE = 514
INNER = SIZE - 2 * config.DEM_BUFFER_PX


def encode(h: float) -> tuple[int, int, int]:
    v = round((h + 10000) / 0.1)
    return (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF


def write_tile(path, height_at):
    """Tile whose file pixel (x, y) holds height_at(x, y)."""
    img = Image.new("RGB", (SIZE, SIZE))
    px = img.load()
    for y in range(SIZE):
        for x in range(SIZE):
            px[x, y] = encode(height_at(x, y))
    img.save(path)
    return path


def test_decode_roundtrips_encoding():
    assert decode_height(*encode(1234.5)) == pytest.approx(1234.5)
    assert decode_height(0, 0, 0) == -10000.0


def test_tile_position_matches_slippy_map_tiles():
    # Hoher Fricken's origin lies in the downloaded DEM tile 13_4349_2864.png.
    x, y = tile_position(47.51432904852429, 11.126458152207123, 13)
    assert (math.floor(x), math.floor(y)) == (4349, 2864)
    x, y = tile_position(0.0, 0.0, 13)
    assert (x, y) == pytest.approx((4096.0, 4096.0))


def test_sample_uses_inner_pixel_centres_skipping_the_buffer(tmp_path):
    # Height = 10 * file column: the buffer column 0 holds 0 m, inner pixel 0 holds 10 m.
    tile = DemTile(write_tile(tmp_path / "t.png", lambda x, y: 10.0 * x))
    # The centre of inner pixel 0 is at tile fraction 0.5 / INNER.
    assert tile.sample(0.5 / INNER, 0.5) == pytest.approx(10.0, abs=0.06)
    # Tile edges fall halfway into the buffer, so both neighbouring tiles agree there.
    assert tile.sample(0.0, 0.5) == pytest.approx(5.0, abs=0.06)
    assert tile.sample(1.0, 0.5) == pytest.approx(10.0 * (SIZE - 1.5), abs=0.06)


def test_mesh_height_is_exact_on_planar_terrain(tmp_path):
    # A plane is reproduced exactly by both bilinear sampling and the mesh.
    tile = DemTile(write_tile(tmp_path / "t.png", lambda x, y: 500 + 2.0 * x + 3.0 * y))

    def expected(fx, fy):
        bx, by = fx * INNER + 0.5, fy * INNER + 0.5
        return 500 + 2.0 * bx + 3.0 * by

    for fx, fy in [(0.0, 0.0), (0.3, 0.71), (0.999, 0.5), (1.0, 1.0)]:
        assert tile.mesh_height(fx, fy) == pytest.approx(expected(fx, fy), abs=0.06)


def test_mesh_height_follows_plane_geometry_diagonal(tmp_path):
    # One lifted vertex (the cell's top-left corner a) only affects triangle a-b-d.
    seg = config.TERRAIN_TILE_SEGMENTS
    tile = DemTile(write_tile(tmp_path / "t.png", lambda x, y: 0.0))
    tile.sample = lambda fx, fy: 100.0 if (fx, fy) == (0.0, 0.0) else 0.0
    cell = 1 / seg
    assert tile.mesh_height(0.0, 0.0) == pytest.approx(100.0)
    # Near a, inside a-b-d: interpolated.
    assert tile.mesh_height(0.25 * cell, 0.25 * cell) == pytest.approx(50.0)
    # Beyond the b-d diagonal (s + t > 1): triangle b-c-d, untouched by a.
    assert tile.mesh_height(0.75 * cell, 0.75 * cell) == pytest.approx(0.0)


def test_terrain_height_picks_the_tile_and_rounds(tmp_path):
    x, y = tile_position(47.5, 11.1, 13)
    tx, ty = math.floor(x), math.floor(y)
    write_tile(tmp_path / f"13_{tx}_{ty}.png", lambda px, py: 1500.04)
    terrain = Terrain(tmp_path)
    assert terrain.height(47.5, 11.1) == 1500.0
    assert terrain.meta(47.5, 11.1) == {"demEle": 1500.0}


def test_terrain_without_tile_or_coordinates_is_empty(tmp_path):
    terrain = Terrain(tmp_path)
    assert terrain.height(47.5, 11.1) is None
    assert terrain.meta(47.5, 11.1) == {}
    assert terrain.meta(None, None) == {}
