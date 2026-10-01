from matches import moving_time as mt


def _gpx(points):
    pts = "".join(
        f'<trkpt lat="{lat}" lon="{lon}"><time>2026-01-01T{t}Z</time></trkpt>' for lat, lon, t in points
    )
    return f"<gpx><metadata><time>2026-02-02T00:00:00Z</time></metadata><trk><trkseg>{pts}</trkseg></trk></gpx>"


def test_planned_track_has_no_moving_time():
    assert mt.moving_minutes(mt.read_track('<gpx><trkpt lat="47" lon="11"></trkpt></gpx>')) is None


def test_walking_counts_and_standing_does_not():
    # ~4.5 km/h for 10 minutes (one point a minute, ~75 m apart), then 10 minutes standing still.
    walk = [(47 + i * 0.000675, 11.0, f"10:{i:02d}:00") for i in range(11)]
    stand = [(walk[-1][0], 11.0, f"10:{i:02d}:00") for i in range(11, 21)]
    minutes = mt.moving_minutes(mt.read_track(_gpx(walk + stand)))
    assert 9 <= minutes <= 11


def test_gps_jitter_while_standing_is_not_moving():
    # 20 minutes standing, the fix wandering ~10 m back and forth every few seconds.
    jitter = [(47.0 + (0.00009 if i % 2 else 0), 11.0, f"10:{i // 12:02d}:{(i % 12) * 5:02d}") for i in range(240)]
    assert mt.moving_minutes(mt.read_track(_gpx(jitter))) < 1


def test_recording_gap_is_not_moving():
    # Two points six hours apart: a night at a hut, not twelve hours of walking.
    points = [(47.0, 11.0, "08:00:00"), (47.001, 11.0, "08:01:00"), (47.5, 11.0, "14:01:00")]
    assert mt.moving_minutes(mt.read_track(_gpx(points))) == 1


def test_set_duration_replaces_and_comments():
    md = "---\ntitle: X\nduration: 500\nimages:\n  a.jpg: {w: 1}\n---\nBody\n"
    out = mt.set_duration(md, 321)
    assert "duration: 321\n" in out and "duration: 500" not in out
    assert "# Moving time from the GPX" in out
    assert out.endswith("---\nBody\n")
    # Re-running doesn't stack comments.
    assert mt.set_duration(out, 322).count("# Moving time from the GPX") == 1


def test_set_duration_inserts_before_images():
    out = mt.set_duration("---\ntitle: X\nimages:\n  a.jpg: {w: 1}\n---\nBody\n", 90)
    assert out.index("duration: 90") < out.index("images:")
