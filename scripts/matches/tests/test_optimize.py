import base64
import io

from PIL import Image

from matches.optimize import encode_avif_tiers, encode_lqip_data_uri, open_exif_corrected, probe_dimensions, tier_dimensions


def _save_with_orientation(path, size, orientation):
    img = Image.new("RGB", size, (200, 50, 50))
    exif = img.getexif()
    exif[0x0112] = orientation  # Orientation tag
    img.save(path, "JPEG", exif=exif)


def test_open_exif_corrected_passes_through_without_orientation(tmp_path):
    path = tmp_path / "plain.jpg"
    Image.new("RGB", (400, 300), (10, 20, 30)).save(path, "JPEG")
    img = open_exif_corrected(path)
    assert img.size == (400, 300)
    assert img.mode == "RGB"


def test_open_exif_corrected_rotates_90_degrees(tmp_path):
    path = tmp_path / "rotated.jpg"
    # Orientation 6 = rotate 90 CW to display correctly; a 400x300 sensor
    # image tagged this way should present as 300x400.
    _save_with_orientation(path, (400, 300), 6)
    img = open_exif_corrected(path)
    assert img.size == (300, 400)


def test_landscape_scales_by_width():
    assert tier_dimensions(8160, 6120, 2560) == (2560, 1920)


def test_portrait_scales_by_height():
    # Same aspect ratio as above, rotated: long edge (height) hits the
    # target, width comes out proportionally narrower than 2560.
    assert tier_dimensions(6120, 8160, 2560) == (1920, 2560)


def test_square_scales_either_edge_the_same():
    assert tier_dimensions(3000, 3000, 640) == (640, 640)


def test_skips_when_target_exceeds_landscape_long_edge():
    assert tier_dimensions(600, 400, 640) is None


def test_skips_when_target_exceeds_portrait_long_edge():
    assert tier_dimensions(400, 600, 640) is None


def test_target_equal_to_long_edge_is_allowed_not_upscale():
    assert tier_dimensions(2560, 1920, 2560) == (2560, 1920)


def test_encode_avif_tiers_writes_expected_files_and_skips_upscale(tmp_path):
    img = Image.new("RGB", (3000, 2000), (100, 150, 200))
    out_base = tmp_path / "story" / "2026-01-01-00"
    out_base.parent.mkdir()
    results = encode_avif_tiers(img, out_base, (640, 1280, 2560, 5000), quality=50)

    assert [t for t, _, _ in results] == [640, 1280, 2560]  # 5000 skipped: upscale
    for target, w, h in results:
        path = tmp_path / "story" / f"2026-01-01-00-{target}.avif"
        assert path.is_file()
        with Image.open(path) as saved:
            assert saved.size == (w, h)
        assert w == target  # 3000x2000 is landscape: long edge is width


def test_lqip_data_uri_is_a_small_valid_webp():
    img = Image.new("RGB", (3000, 2000), (50, 80, 120))
    uri = encode_lqip_data_uri(img, long_edge=24, quality=50)

    assert uri.startswith("data:image/webp;base64,")
    raw = base64.b64decode(uri.split(",", 1)[1])
    assert len(raw) < 2000  # a 24px-long-edge q50 WebP is tiny
    with Image.open(io.BytesIO(raw)) as decoded:
        assert decoded.format == "WEBP"
        assert max(decoded.size) == 24
        assert decoded.size == (24, 16)  # 3000x2000 landscape: width is long edge


def test_probe_dimensions_reads_exif_corrected_size(tmp_path):
    path = tmp_path / "local.jpg"
    _save_with_orientation(path, (400, 300), 6)
    assert probe_dimensions(path) == (300, 400)


import json

import pytest

from matches import config
from matches.immich import ImmichClient
from matches.optimize import optimize_post
from matches.tests.test_immich import StubSession, BASE  # reuse the existing stub


def _write_post(dir_, name, web_paths):
    lines = ["---", "title: Test Post", "---", ""]
    for wp in web_paths:
        lines.append(f"![alt text]({wp})")
        lines.append("")
    (dir_ / name).write_text("\n".join(lines), encoding="utf-8")


def _write_report(out_dir, post_name, entries):
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {"post": post_name, "entries": entries}
    (out_dir / (post_name[:-3] + ".json")).write_text(json.dumps(payload), encoding="utf-8")


def _setup_testhike_post(tmp_path):
    """Shared fixture: a post with one matched and one unmatched image,
    a match report, and a stub Immich session serving a 3000x2000 original
    for the matched image. Returns (post_path, client, settings, story_dir)."""
    posts_dir = tmp_path / "posts"
    static_root = tmp_path / "static"
    out_dir = tmp_path / "out"
    posts_dir.mkdir()
    story = static_root / "images/projects/data-viz/hikes/stories/testhike"
    story.mkdir(parents=True)

    matched_web = "/images/projects/data-viz/hikes/stories/testhike/2026-01-01-00.jpg"
    unmatched_web = "/images/projects/data-viz/hikes/stories/testhike/2026-01-01-01.jpg"

    _write_post(posts_dir, "2026-01-01-testhike.md", [matched_web, unmatched_web])

    # The "matched" image's local jpg exists (as it does pre-generation);
    # the "unmatched" one must exist too, since its dims are probed locally.
    Image.new("RGB", (100, 80), (1, 2, 3)).save(story / "2026-01-01-00.jpg", "JPEG")
    Image.new("RGB", (300, 400), (4, 5, 6)).save(story / "2026-01-01-01.jpg", "JPEG")

    _write_report(out_dir, "2026-01-01-testhike.md", [
        {
            "web_path": matched_web, "status": "matched",
            "match": {"asset_id": "orig1", "original_file_name": "orig1.jpg"},
        },
        {"web_path": unmatched_web, "status": "unmatched", "match": None},
    ])

    session = StubSession([])
    original_bytes = io.BytesIO()
    Image.new("RGB", (3000, 2000), (10, 20, 30)).save(original_bytes, "JPEG")
    session.get = lambda url, timeout=None: StubSession._R(content=original_bytes.getvalue())

    settings = config.Settings(
        api_key="k", immich_url=BASE,
        posts_dir=posts_dir, static_root=static_root, out_dir=out_dir,
        cache_dir=tmp_path / "cache",
    )
    client = ImmichClient(settings, session=session)
    return posts_dir / "2026-01-01-testhike.md", client, settings, story


def test_optimize_post_converts_matched_and_probes_unmatched(tmp_path):
    post_path, client, settings, story = _setup_testhike_post(tmp_path)

    images = optimize_post(post_path, client, settings)

    assert set(images) == {"2026-01-01-00.jpg", "2026-01-01-01.jpg"}
    matched_meta = images["2026-01-01-00.jpg"]
    assert matched_meta["w"] == 3000 and matched_meta["h"] == 2000
    assert matched_meta["blur"].startswith("data:image/webp;base64,")
    assert not (story / "2026-01-01-00.jpg").exists()  # original deleted
    assert (story / "2026-01-01-00-640.avif").exists()
    assert (story / "2026-01-01-00-1280.avif").exists()
    assert (story / "2026-01-01-00-2560.avif").exists()

    unmatched_meta = images["2026-01-01-01.jpg"]
    assert unmatched_meta == {"w": 300, "h": 400}
    assert (story / "2026-01-01-01.jpg").exists()  # untouched


def test_optimize_post_dry_run_writes_nothing_and_deletes_nothing(tmp_path):
    post_path, client, settings, story = _setup_testhike_post(tmp_path)

    images = optimize_post(post_path, client, settings, dry_run=True)

    assert set(images) == {"2026-01-01-00.jpg", "2026-01-01-01.jpg"}
    matched_meta = images["2026-01-01-00.jpg"]
    assert matched_meta["w"] == 3000 and matched_meta["h"] == 2000
    assert matched_meta["blur"].startswith("data:image/webp;base64,")

    # Nothing on disk changed: original still present, no AVIF tiers written.
    assert (story / "2026-01-01-00.jpg").exists()
    assert not (story / "2026-01-01-00-640.avif").exists()
    assert not (story / "2026-01-01-00-1280.avif").exists()
    assert not (story / "2026-01-01-00-2560.avif").exists()

    unmatched_meta = images["2026-01-01-01.jpg"]
    assert unmatched_meta == {"w": 300, "h": 400}
    assert (story / "2026-01-01-01.jpg").exists()


def test_optimize_post_raises_without_a_report(tmp_path):
    posts_dir = tmp_path / "posts"
    posts_dir.mkdir()
    _write_post(posts_dir, "2026-01-01-nomatch.md", [])
    settings = config.Settings(api_key="k", immich_url=BASE, posts_dir=posts_dir,
                                out_dir=tmp_path / "out", cache_dir=tmp_path / "cache")
    client = ImmichClient(settings, session=StubSession([]))
    with pytest.raises(FileNotFoundError):
        optimize_post(posts_dir / "2026-01-01-nomatch.md", client, settings)
