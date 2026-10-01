"""Offline tests for the photo timestamp / track-position backfill."""

from datetime import datetime, timezone

from matches import backfill_time as bt
from matches.track_metrics import Point

BLUR = "data:image/webp;base64,ZZ"
WEB = "/images/projects/data-viz/hikes/stories/demo/"


class FakeTerrain:
    def meta(self, lat, lon):
        return {} if lat is None else {"demEle": round(1000 + lat, 1)}


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso).timestamp()


def _entry(name, local, utc, status="matched"):
    match = {"local_date_time": local, "file_created_at": utc} if status == "matched" else None
    return {"web_path": WEB + name, "status": status, "match": match}


# A straight track north along lon 11.0, 10:00-11:00 UTC, ~1.1 km per 10 min.
TRACK = [Point(47.00 + i * 0.01, 11.0, 1000.0 + i * 50, _ts("2026-06-01T10:00:00+00:00") + i * 600)
         for i in range(7)]


def test_taken_keeps_local_wall_clock_and_offset():
    match = {"local_date_time": "2026-06-01T12:18:16.546Z", "file_created_at": "2026-06-01T10:18:16.546Z"}
    stamp = bt.read_stamp(match)
    assert stamp.offset_min == 120
    assert stamp.taken == "2026-06-01T12:18:16+02:00"
    assert stamp.utc == datetime(2026, 6, 1, 10, 18, 16, 546000, tzinfo=timezone.utc).timestamp()


def test_position_at_interpolates_and_refuses_outside_or_across_long_gaps():
    lat, lon = bt.position_at(TRACK, _ts("2026-06-01T10:05:00+00:00"))
    assert abs(lat - 47.005) < 1e-9 and lon == 11.0
    assert bt.position_at(TRACK, _ts("2026-06-01T09:59:00+00:00")) is None
    gap = [Point(47.0, 11.0, None, 0.0), Point(47.1, 11.0, None, 3600.0)]
    assert bt.position_at(gap, 1800.0) is None
    hut = [Point(47.0, 11.0, None, 0.0), Point(47.0001, 11.0, None, 36000.0)]
    assert bt.position_at(hut, 18000.0) is not None


def test_recorded_hike_photo_with_agreeing_gps_keeps_taken():
    images = {"a.jpg": {"w": 4, "h": 3, "lat": 47.02, "lon": 11.0}}
    report = {"entries": [_entry("a.jpg", "2026-06-01T12:20:00Z", "2026-06-01T10:20:00Z")]}
    assert bt.time_updates("2026-06-01", images, report, TRACK, FakeTerrain()) == {
        "a.jpg": {"taken": "2026-06-01T12:20:00+02:00"}}


def test_recorded_hike_photo_whose_gps_disagrees_with_its_time_drops_taken():
    # Taken at 10:20 (track at 47.02) but pinned at 47.05, ~3.3 km away.
    images = {"a.jpg": {"w": 4, "h": 3, "lat": 47.05, "lon": 11.0, "taken": "stale"}}
    report = {"entries": [_entry("a.jpg", "2026-06-01T12:20:00Z", "2026-06-01T10:20:00Z")]}
    assert bt.time_updates("2026-06-01", images, report, TRACK, FakeTerrain()) == {"a.jpg": {"taken": None}}


def test_recorded_hike_photo_without_gps_is_placed_on_the_track_by_time():
    images = {"a.jpg": {"w": 4, "h": 3}}
    report = {"entries": [_entry("a.jpg", "2026-06-01T12:30:00Z", "2026-06-01T10:30:00Z")]}
    assert bt.time_updates("2026-06-01", images, report, TRACK, FakeTerrain()) == {"a.jpg": {
        "taken": "2026-06-01T12:30:00+02:00", "lat": 47.03, "lon": 11.0, "demEle": 1047.0, "located": "track"}}


def test_recorded_hike_uses_the_track_span_not_the_post_date():
    # Overnight hike: the track runs past midnight local time.
    night = [Point(47.0, 11.0, None, _ts("2026-06-01T21:00:00+00:00")),
             Point(47.01, 11.0, None, _ts("2026-06-01T22:30:00+00:00"))]
    images = {"a.jpg": {"w": 4, "h": 3, "lat": 47.01, "lon": 11.0}}
    report = {"entries": [_entry("a.jpg", "2026-06-02T00:30:00Z", "2026-06-01T22:30:00Z")]}
    assert bt.time_updates("2026-06-01", images, report, night, FakeTerrain()) == {
        "a.jpg": {"taken": "2026-06-02T00:30:00+02:00"}}


def test_recorded_hike_photo_on_another_day_gets_no_taken():
    images = {"a.jpg": {"w": 4, "h": 3, "lat": 47.0, "lon": 11.0}}
    report = {"entries": [_entry("a.jpg", "2026-06-02T15:00:00Z", "2026-06-02T13:00:00Z")]}
    assert bt.time_updates("2026-06-01", images, report, TRACK, FakeTerrain()) == {}


def test_planned_hike_needs_the_post_date():
    images = {"a.jpg": {"w": 4, "h": 3, "lat": 47.0, "lon": 11.0}, "b.jpg": {"w": 4, "h": 3}}
    report = {"entries": [
        _entry("a.jpg", "2026-06-01T12:00:00Z", "2026-06-01T10:00:00Z"),
        _entry("b.jpg", "2000-01-01T00:00:00Z", "1999-12-31T22:00:00Z"),
    ]}
    assert bt.time_updates("2026-06-01", images, report, [], FakeTerrain()) == {
        "a.jpg": {"taken": "2026-06-01T12:00:00+02:00"}}


def test_offset_differing_from_the_posts_usual_one_is_a_broken_copy():
    images = {n: {"w": 4, "h": 3} for n in ("a.jpg", "b.jpg", "c.jpg")}
    report = {"entries": [
        _entry("a.jpg", "2026-06-01T12:00:00Z", "2026-06-01T10:00:00Z"),
        _entry("b.jpg", "2026-06-01T13:00:00Z", "2026-06-01T11:00:00Z"),
        _entry("c.jpg", "2026-06-01T12:00:00Z", "2026-06-01T12:00:00Z"),
    ]}
    updates = bt.time_updates("2026-06-01", images, report, [], FakeTerrain())
    assert set(updates) == {"a.jpg", "b.jpg"}


def test_track_located_photo_loses_its_location_when_no_longer_placeable():
    images = {"a.jpg": {"w": 4, "h": 3, "lat": 47.03, "lon": 11.0, "demEle": 1047.0,
                        "located": "track", "taken": "x"}}
    assert bt.time_updates("2026-06-01", images, {"entries": []}, TRACK, FakeTerrain()) == {
        "a.jpg": {"taken": None, "lat": None, "lon": None, "demEle": None, "located": None}}


def test_backfill_writes_and_is_idempotent(tmp_path):
    post = tmp_path / "2026-06-01-demo.md"
    post.write_text(f"---\ntitle: Demo\nimages:\n  a.jpg: {{w: 4, h: 3, blur: '{BLUR}'}}\n---\nbody\n",
                    encoding="utf-8")
    updates = {"a.jpg": {"taken": "2026-06-01T12:30:00+02:00", "lat": 47.03, "lon": 11.0,
                         "demEle": 1047.0, "located": "track"}}
    assert bt.backfill_post(post, updates) == 1
    text = post.read_text(encoding="utf-8")
    assert ("  a.jpg: {w: 4, h: 3, taken: '2026-06-01T12:30:00+02:00', lat: 47.03, lon: 11.0, "
            f"demEle: 1047.0, located: track, blur: '{BLUR}'}}\n") in text
    assert bt.backfill_post(post, updates) == 0


def test_photo_after_the_recording_ended_passes_at_the_end_point():
    images = {"a.jpg": {"w": 4, "h": 3, "lat": 47.06, "lon": 11.0},
              "b.jpg": {"w": 4, "h": 3, "lat": 47.03, "lon": 11.0}}
    report = {"entries": [_entry("a.jpg", "2026-06-01T15:00:00Z", "2026-06-01T13:00:00Z"),
                          _entry("b.jpg", "2026-06-01T15:00:00Z", "2026-06-01T13:00:00Z")]}
    assert bt.time_updates("2026-06-01", images, report, TRACK, FakeTerrain()) == {
        "a.jpg": {"taken": "2026-06-01T15:00:00+02:00"}}


def test_photo_inside_a_moving_gap_is_checked_against_the_gap_line():
    gap = [Point(47.0, 11.0, None, 0.0), Point(47.1, 11.0, None, 3600.0)]
    assert bt.track_distance_m(gap, 1800.0, 47.07, 11.0) < 1
    assert bt.track_distance_m(gap, 1800.0, 47.05, 11.01) > 700


def test_photo_without_gps_well_after_the_recording_keeps_only_its_time():
    images = {"a.jpg": {"w": 4, "h": 3}}
    report = {"entries": [_entry("a.jpg", "2026-06-01T15:00:00Z", "2026-06-01T13:00:00Z")]}
    assert bt.time_updates("2026-06-01", images, report, TRACK, FakeTerrain()) == {
        "a.jpg": {"taken": "2026-06-01T15:00:00+02:00"}}
