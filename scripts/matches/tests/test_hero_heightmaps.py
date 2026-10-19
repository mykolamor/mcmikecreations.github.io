"""Offline tests for the hero map heightmaps."""

import json
import math

from PIL import Image

from matches import config
from matches import hero_heightmaps as hh
from matches.terrain import Terrain, decode_height


def test_encode_round_trips_through_decode():
    for h in (-12.3, 0.0, 612.4, 2962.0, 8848.9):
        assert abs(decode_height(*hh.encode_height(h)) - h) <= 0.05


def test_area_is_centred_on_origin_and_height_wide():
    x0, y0, size = hh.hike_area({"lat": 47.4, "lon": 10.97}, 512)
    assert size == 512
    b = hh.area_bounds((x0, y0, size))
    assert math.isclose((b["west"] + b["east"]) / 2, 10.97, abs_tol=1e-9)
    assert math.isclose(b["east"] - b["west"], 512 * 360 / hh.WORLD_PX, rel_tol=1e-9)
    assert b["south"] < 47.4 < b["north"]


def test_peak_count_counts_only_natural_peaks():
    meta = {"nodes": [{"tags": {"natural": "peak"}}, {"tags": {"natural": "saddle"}}, {"tags": {}}]}
    assert hh.peak_count(meta) == 1
    assert hh.peak_count({}) == 0


def test_build_heightmap_has_border_and_reports_range():
    area = hh.hike_area({"lat": 47.4, "lon": 10.97}, 512)
    img, lo, hi = hh.build_heightmap(area, lambda x, y: 1000.0 + (y - math.floor(y)) * 10)
    assert img.size == (hh.SIZE, hh.SIZE) == (258, 258)
    assert 1000.0 <= lo <= hi <= 1010.0


def test_build_heightmap_gives_up_on_missing_samples():
    area = hh.hike_area({"lat": 47.4, "lon": 10.97}, 512)
    assert hh.build_heightmap(area, lambda x, y: None) is None


# --- end to end over a throwaway static tree -------------------------------------

def _sidecar(peaks: int) -> dict:
    return {
        "name": "Demo", "origin": {"lat": 47.4, "lon": 10.97}, "height": 512,
        "nodes": [{"id": i, "lat": 47.4, "lon": 10.97, "tags": {"natural": "peak"}} for i in range(peaks)],
    }


def _tree(tmp_path, peaks=5, height=1234.5):
    static = tmp_path / "static"
    (static / hh.SIDECAR_SUBDIR).mkdir(parents=True)
    (static / hh.SIDECAR_SUBDIR / "demo.hike.json").write_text(json.dumps(_sidecar(peaks)), encoding="utf-8")
    dem = static / config.DEM_SUBDIR
    dem.mkdir(parents=True)
    # Small buffered tiles (16 inner px) are enough: DemTile reads its size from the file.
    tile = Image.new("RGB", (18, 18), hh.encode_height(height))
    for tx, ty in hh.area_tiles(hh.hike_area(_sidecar(peaks)["origin"], 512)):
        tile.save(dem / f"{config.TERRAIN_ZOOM}_{tx}_{ty}.png")
    return static


def test_main_writes_heightmap_and_metadata(tmp_path):
    static = _tree(tmp_path)
    assert hh.main(["--static-root", str(static)]) == 0
    out = static / hh.HERO_SUBDIR
    meta = json.loads((out / "demo.json").read_text(encoding="utf-8"))
    assert set(meta) == {"west", "south", "east", "north", "minEle", "maxEle"}
    assert meta["minEle"] == meta["maxEle"] == 1234.5
    img = Image.open(out / "demo.webp")
    assert img.size == (258, 258)
    assert abs(decode_height(*img.convert("RGB").getpixel((129, 129))) - 1234.5) <= 0.05


def test_main_skips_up_to_date_and_force_rewrites(tmp_path, capsys):
    static = _tree(tmp_path)
    hh.main(["--static-root", str(static)])
    webp = static / hh.HERO_SUBDIR / "demo.webp"
    first = webp.stat().st_mtime_ns
    hh.main(["--static-root", str(static)])
    assert webp.stat().st_mtime_ns == first
    assert "up to date" in capsys.readouterr().out
    hh.main(["--static-root", str(static), "--force"])
    assert webp.stat().st_mtime_ns >= first
    assert "written" in capsys.readouterr().out


def test_too_few_peaks_writes_nothing(tmp_path):
    static = _tree(tmp_path, peaks=4)
    assert hh.main(["--static-root", str(static)]) == 0
    assert not (static / hh.HERO_SUBDIR / "demo.webp").exists()


def test_missing_tile_skips_hike(tmp_path, capsys):
    static = _tree(tmp_path)
    next((static / config.DEM_SUBDIR).iterdir()).unlink()
    assert hh.main(["--static-root", str(static)]) == 0
    assert not (static / hh.HERO_SUBDIR / "demo.webp").exists()
    assert "missing DEM tiles" in capsys.readouterr().out


def test_terrain_sample_is_raw_bilinear_dem(tmp_path):
    Image.new("RGB", (18, 18), hh.encode_height(500.0)).save(tmp_path / f"{config.TERRAIN_ZOOM}_3_4.png")
    t = Terrain(tmp_path)
    assert abs(t.sample(3.5, 4.5) - 500.0) <= 0.05
    assert t.sample(9.5, 9.5) is None
