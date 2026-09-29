"""Offline tests for the demEle backfill into front matter and .hike.json."""

import json

from matches import backfill_terrain as bt

BLUR = "data:image/webp;base64,ZZ"


class FakeTerrain:
    """Height = 1000 + lat, None south of 40°."""

    def height(self, lat, lon):
        return None if lat < 40 else round(1000 + lat, 1)

    def meta(self, lat, lon):
        if lat is None or lon is None:
            return {}
        h = self.height(lat, lon)
        return {} if h is None else {"demEle": h}


def test_photo_updates_only_for_located_images_on_tiles():
    images = {
        "a.jpg": {"w": 4, "h": 3, "lat": 47.5, "lon": 11.25, "blur": BLUR},
        "b.jpg": {"w": 1, "h": 2},
        "c.jpg": {"w": 1, "h": 2, "lat": 28.6, "lon": 83.9},
    }
    assert bt.photo_updates(images, FakeTerrain()) == {"a.jpg": {"demEle": 1047.5}}


def test_photo_backfill_writes_dem_ele_before_blur(tmp_path):
    post = tmp_path / "2026-01-01-demo.md"
    post.write_text(
        f"---\ntitle: Demo\nimages:\n  a.jpg: {{w: 4, h: 3, lat: 47.5, lon: 11.25, blur: '{BLUR}'}}\n---\nbody\n",
        encoding="utf-8",
    )
    assert bt.main(["--posts-dir", str(tmp_path), "--no-nodes"]) == 0
    assert (f"  a.jpg: {{w: 4, h: 3, lat: 47.5, lon: 11.25, demEle: "
            in post.read_text(encoding="utf-8"))


HIKE = """{
  "name": "Demo",
  "origin": {
    "lat": 47.51432904852429,
    "lon": 11.126458152207123
  },
  "height": 512,
  "checkpoints": [
    [11.1148716, 47.5311050],
    [11.1322409, 47.5257291]
  ],
  "nodes": [
    {
      "id": 1,
      "lat": 47.5313450,
      "lon": 11.1531653,
      "tags": {
        "name": "Peak",
        "ele": "1940"
      }
    },
    {
      "id": 2,
      "lat": 28.6,
      "lon": 83.9,
      "tags": {}
    }
  ]
}
"""


def test_dump_hike_json_roundtrips_hand_formatting():
    from decimal import Decimal
    assert bt.dump_hike_json(json.loads(HIKE, parse_float=Decimal)) + "\n" == HIKE


def test_hike_json_backfill_adds_dem_ele_after_lon_and_keeps_osm_ele(tmp_path):
    path = tmp_path / "demo.hike.json"
    path.write_text(HIKE, encoding="utf-8")
    assert bt.backfill_hike_json(path, FakeTerrain()) == 1
    text = path.read_text(encoding="utf-8")
    assert '      "lon": 11.1531653,\n      "demEle": 1047.5,\n      "tags": {' in text
    assert '"ele": "1940"' in text
    assert "[11.1148716, 47.5311050]" in text  # untouched formatting elsewhere
    assert json.loads(text)["nodes"][1] == {"id": 2, "lat": 28.6, "lon": 83.9, "tags": {}}
    # Re-running is a no-op.
    assert bt.backfill_hike_json(path, FakeTerrain()) == 0


def test_hike_json_dry_run_writes_nothing(tmp_path):
    path = tmp_path / "demo.hike.json"
    path.write_text(HIKE, encoding="utf-8")
    assert bt.backfill_hike_json(path, FakeTerrain(), dry_run=True) == 1
    assert path.read_text(encoding="utf-8") == HIKE
