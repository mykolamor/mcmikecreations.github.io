"""Offline tests for the region outline builder."""

import json

from shapely.geometry import LineString, Point, box, shape

from hikegeo import config, regions


class FakeNominatim:
    def __init__(self, geoms):
        self.geoms = geoms
        self.calls = []

    def geometry(self, osm_id):
        self.calls.append(osm_id)
        return self.geoms[osm_id]


def test_every_region_slug_has_a_source():
    slugs = regions.region_slugs(config.repo_root())
    assert "wetterstein" in slugs
    assert sorted(slugs) == sorted(regions.SOURCES)


def test_split_by_river_keeps_one_side():
    region = box(0, 0, 10, 10)
    # A wiggly river from south to north through the middle.
    river = LineString([(5, -1), (4, 3), (6, 6), (5, 11)])
    east = regions.split_by_river(region, river, "east")
    west = regions.split_by_river(region, river, "west")
    assert abs(east.area + west.area - 100) < 1e-3
    assert east.contains(Point(9, 5)) and west.contains(Point(1, 5))


def test_buffer_metres_is_round():
    # 1 km around a point at 47.5° N: about 0.0133° of longitude, 0.009° of latitude.
    b = regions.buffer_metres(Point(11.0, 47.5), 1000)
    xmin, ymin, xmax, ymax = b.bounds
    assert abs((xmax - xmin) / 2 - 1000 / (111_320 * 0.6756)) < 2e-4
    assert abs((ymax - ymin) / 2 - 1000 / 110_540) < 2e-4


def test_build_union_split_and_minus():
    sources = {
        "big": {"kind": "range", "osm": ["R1"]},
        "small": {"kind": "range", "osm": ["R2"]},
        "west": {"kind": "range", "split": {"of": "big", "river": "R9", "side": "west", "minus": ["small"]}},
        "two": {"kind": "area", "osm": ["R1", "R2"]},
    }
    nominatim = FakeNominatim({
        "R1": box(0, 0, 10, 10),
        "R2": box(1, 1, 2, 2),
        "R9": LineString([(5, -1), (5, 11)]),
    })
    built = {}
    west = regions.build("west", sources, nominatim, built)
    assert abs(west.area - (50 - 1)) < 1e-3
    assert not west.contains(Point(1.5, 1.5))
    assert abs(regions.build("two", sources, nominatim, {}).area - 100) < 1e-6


def test_main_writes_missing_files_and_index(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    (repo / "src/lib/hikes").mkdir(parents=True)
    (repo / regions.FACTS_SCHEMA).write_text("export const REGIONS = [\n\t'a', 'b'\n] as const;\n", encoding="utf-8")
    monkeypatch.setattr(regions, "SOURCES", {
        "a": {"kind": "range", "osm": ["R1"]},
        "b": {"kind": "area", "buffer": {"osm": "W2", "metres": 500}},
    })
    nominatim = FakeNominatim({"R1": box(11, 47, 11.1, 47.1), "W2": LineString([(11, 47), (11.05, 47.05)])})
    static = tmp_path / "static"

    assert regions.main(["--static-root", str(static)], nominatim=nominatim, repo_root=repo) == 0
    out = static / regions.REGIONS_SUBDIR
    a = json.loads((out / "a.json").read_text(encoding="utf-8"))
    assert a["properties"] == {"slug": "a", "kind": "range", "source": "osm", "osm": ["R1"],
                               "attribution": regions.ATTRIBUTION}
    assert a["geometry"]["type"] == "MultiPolygon"
    assert shape(a["geometry"]).area > 0
    index = json.loads((out / "index.json").read_text(encoding="utf-8"))
    assert [e["slug"] for e in index] == ["a", "b"]

    # Present: nothing fetched again.
    nominatim.calls.clear()
    assert regions.main(["--static-root", str(static)], nominatim=nominatim, repo_root=repo) == 0
    assert nominatim.calls == []


def test_main_fails_on_a_region_without_source(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    (repo / "src/lib/hikes").mkdir(parents=True)
    (repo / regions.FACTS_SCHEMA).write_text("export const REGIONS = ['a', 'new'] as const;", encoding="utf-8")
    monkeypatch.setattr(regions, "SOURCES", {"a": {"kind": "range", "osm": ["R1"]}})
    assert regions.main(["--static-root", str(tmp_path)], nominatim=FakeNominatim({}), repo_root=repo) == 1
