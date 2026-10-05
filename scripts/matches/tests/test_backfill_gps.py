"""Offline tests for the one-time GPS backfill into front matter."""

from matches import backfill_gps as bg
from matches.postwriter import merge_image_fields
from matches.tests.conftest import BLUR, report_entry


def _post(tmp_path, images_yaml):
    path = tmp_path / "2026-01-01-demo.md"
    path.write_text(
        "---\ntitle: Demo\npeople:\n  - Someone\nimages:\n" + images_yaml + "---\nbody text\n",
        encoding="utf-8",
    )
    return path


def _entry(name, status="matched", lat=47.1234567, lon=11.7654321):
    match = {"asset_id": "a", "latitude": lat, "longitude": lon} if status == "matched" else None
    return report_entry(name, match, status)


def test_gps_updates_takes_only_matched_entries_with_coordinates():
    report = {"entries": [
        _entry("a.jpg"),
        _entry("b.jpg", lat=None, lon=None),
        _entry("c.jpg", status="unmatched"),
    ]}
    assert bg.gps_updates(report) == {"a.jpg": {"lat": 47.123457, "lon": 11.765432}}


def test_backfill_inserts_lat_lon_before_blur(tmp_path):
    post = _post(tmp_path, f"  a.jpg: {{w: 4, h: 3, blur: '{BLUR}'}}\n  b.jpg: {{w: 1, h: 2}}\n")
    updated = merge_image_fields(post, {"a.jpg": {"lat": 47.5, "lon": 11.25}})
    assert updated == 1
    text = post.read_text(encoding="utf-8")
    assert f"  a.jpg: {{w: 4, h: 3, lat: 47.5, lon: 11.25, blur: '{BLUR}'}}\n" in text
    assert "  b.jpg: {w: 1, h: 2}\n" in text
    assert "people:\n  - Someone\n" in text
    assert text.endswith("---\nbody text\n")


def test_backfill_never_adds_new_image_entries(tmp_path):
    post = _post(tmp_path, "  a.jpg: {w: 4, h: 3}\n")
    before = post.read_text(encoding="utf-8")
    assert merge_image_fields(post, {"zzz.jpg": {"lat": 1.0, "lon": 2.0}}) == 0
    assert post.read_text(encoding="utf-8") == before


def test_backfill_is_idempotent(tmp_path):
    post = _post(tmp_path, f"  a.jpg: {{w: 4, h: 3, blur: '{BLUR}'}}\n")
    gps = {"a.jpg": {"lat": 47.5, "lon": 11.25}}
    assert merge_image_fields(post, gps) == 1
    once = post.read_text(encoding="utf-8")
    assert merge_image_fields(post, gps) == 0
    assert post.read_text(encoding="utf-8") == once


def test_backfill_dry_run_writes_nothing(tmp_path):
    post = _post(tmp_path, f"  a.jpg: {{w: 4, h: 3, blur: '{BLUR}'}}\n")
    before = post.read_text(encoding="utf-8")
    assert merge_image_fields(post, {"a.jpg": {"lat": 47.5, "lon": 11.25}}, dry_run=True) == 1
    assert post.read_text(encoding="utf-8") == before


def test_backfill_leaves_a_post_without_images_alone(tmp_path):
    post = tmp_path / "2026-01-01-demo.md"
    post.write_text("---\ntitle: Demo\n---\nbody\n", encoding="utf-8")
    assert merge_image_fields(post, {"a.jpg": {"lat": 1.0, "lon": 2.0}}) == 0
