from matches import track_metrics as tm


def _gpx(points):
    """points: (lat, lon, "HH:MM:SS"[, ele])"""
    pts = "".join(
        f'<trkpt lat="{p[0]}" lon="{p[1]}">' + (f"<ele>{p[3]}</ele>" if len(p) > 3 else "")
        + f"<time>2026-01-01T{p[2]}Z</time></trkpt>"
        for p in points
    )
    return f"<gpx><metadata><time>2026-02-02T00:00:00Z</time></metadata><trk><trkseg>{pts}</trkseg></trk></gpx>"


def _minutes(points):
    return tm.moving_minutes(tm.read_track(_gpx(points)))


def test_planned_track_has_no_metrics():
    assert tm.track_metrics(tm.read_track('<gpx><trkpt lat="47" lon="11"><ele>5</ele></trkpt></gpx>')) is None


def test_walking_counts_and_standing_does_not():
    # ~4.5 km/h for 10 minutes (one point a minute, ~75 m apart), then 10 minutes standing still.
    walk = [(47 + i * 0.000675, 11.0, f"10:{i:02d}:00") for i in range(11)]
    stand = [(walk[-1][0], 11.0, f"10:{i:02d}:00") for i in range(11, 21)]
    assert 9 <= _minutes(walk + stand) <= 11


def test_gps_jitter_while_standing_is_not_moving():
    # 20 minutes standing, the fix wandering ~10 m back and forth every few seconds.
    jitter = [(47.0 + (0.00009 if i % 2 else 0), 11.0, f"10:{i // 12:02d}:{(i % 12) * 5:02d}") for i in range(240)]
    assert _minutes(jitter) < 1


def test_recording_gap_is_not_moving():
    # Two points six hours apart: a night at a hut, not twelve hours of walking.
    points = [(47.0, 11.0, "08:00:00"), (47.001, 11.0, "08:01:00"), (47.5, 11.0, "14:01:00")]
    assert _minutes(points) == 1


def test_climb_ignores_noise_below_threshold():
    # A steady 100 m climb with ±1 m wobble, then a 50 m descent.
    eles = [i * 10 + (1 if i % 2 else -1) for i in range(11)] + [100 - i * 10 for i in range(1, 6)]
    points = [(47.0 + i * 0.001, 11.0, f"10:{i:02d}:00", z) for i, z in enumerate(eles)]
    up, down = tm.climb_m(tm.read_track(_gpx(points)))
    assert 95 <= up <= 105
    assert 45 <= down <= 55


def test_distance_is_track_length():
    # 1 km due north in ten 100 m steps (0.0009° of latitude ≈ 100 m).
    points = [(47.0 + i * 0.0009, 11.0, f"10:{i:02d}:00", 500) for i in range(11)]
    assert 990 <= tm.distance_m(tm.read_track(_gpx(points))) <= 1010


def test_set_metrics_replaces_keys_in_one_commented_block():
    md = "---\ntitle: X\nascent: 1\nduration: 500\nimages:\n  a.jpg: {w: 1}\n---\nBody\n"
    out = tm.set_metrics(md, {"distance": 1000, "ascent": 50, "descent": 40, "duration": 321})
    front = out.split("---\n")[1]
    assert "duration: 500" not in front and "ascent: 1\n" not in front
    assert front.index(tm.COMMENT) < front.index("distance: 1000") < front.index("images:")
    assert out.endswith("---\nBody\n")
    # Re-running doesn't stack comments.
    assert tm.set_metrics(out, {"duration": 322}).count(tm.COMMENT) == 1


def test_set_metrics_keeps_untouched_keys():
    md = "---\ntitle: X\ndistance: 777\n---\nBody\n"
    out = tm.set_metrics(md, {"duration": 90})
    assert tm.read_metrics(out) == {"distance": 777, "duration": 90}


def test_old_moving_time_comment_is_replaced():
    md = ("---\ntitle: X\n# Moving time from the GPX: 60 s displacement >= 0.5 km/h "
          "(scripts/moving_time.py).\nduration: 5\n---\nBody\n")
    out = tm.set_metrics(md, {"duration": 6})
    assert "Moving time from the GPX" not in out and out.count(tm.COMMENT) == 1
