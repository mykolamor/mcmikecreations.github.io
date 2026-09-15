from datetime import date

from matches.markdown import find_media_refs, parse_capture_date, post_slug

POST = """---
title: Test
---
Intro text.

![Plain alt](/images/projects/data-viz/hikes/stories/aiplspitz/2024-08-31-00.jpg)
![Nested [link](https://example.com/) inside](/images/projects/data-viz/hikes/stories/aiplspitz/2024-08-31-01.jpg)
![Video](/images/projects/data-viz/hikes/stories/aiplspitz/2024-08-31-02.mp4 "autoplay")
Not media: [a link](/hikes/2024-09-29-rotwand/) and https://youtube.com/watch?v=x
![Odd name](/images/projects/data-viz/hikes/stories/aiplspitz/summit-panorama.jpg)
![The 360 climb](https://www.youtube.com/watch?v=B5yRsnelCsw)
![Short form](https://youtu.be/B5yRsnelCsw)
"""


def _write(tmp_path, text=POST):
    d = tmp_path / "markdown"
    d.mkdir(parents=True, exist_ok=True)
    p = d / "2024-08-31-aiplspitz.md"
    p.write_text(text, encoding="utf-8")
    return p


def test_finds_all_media_in_document_order(tmp_path):
    refs = find_media_refs(_write(tmp_path), tmp_path / "static")
    assert [r.index for r in refs] == [0, 1, 2, 3, 4, 5]
    assert refs[0].web_path.endswith("2024-08-31-00.jpg")
    assert refs[1].web_path.endswith("2024-08-31-01.jpg")
    assert refs[2].web_path.endswith("2024-08-31-02.mp4")
    assert refs[3].web_path.endswith("summit-panorama.jpg")
    assert "youtube.com" in refs[4].web_path
    assert "youtu.be" in refs[5].web_path


def test_ignores_non_media_links(tmp_path):
    """A bare URL in prose is not an embed; only the parenthesised form is."""
    refs = find_media_refs(_write(tmp_path), tmp_path / "static")
    joined = " ".join(r.web_path for r in refs)
    assert "rotwand" not in joined
    assert "watch?v=x" not in joined


def test_youtube_is_its_own_kind_with_no_local_file(tmp_path):
    refs = find_media_refs(_write(tmp_path), tmp_path / "static")
    yt = [r for r in refs if r.kind == "youtube"]
    assert len(yt) == 2
    assert all(r.local_path is None for r in yt)
    assert all(r.exists is False for r in yt)
    assert all(r.capture_date is None for r in yt)


def test_classifies_kind(tmp_path):
    refs = find_media_refs(_write(tmp_path), tmp_path / "static")
    assert refs[0].kind == "image"
    assert refs[2].kind == "video"


def test_local_path_resolves_under_static(tmp_path):
    refs = find_media_refs(_write(tmp_path), tmp_path / "static")
    expected = tmp_path / "static/images/projects/data-viz/hikes/stories/aiplspitz/2024-08-31-00.jpg"
    assert refs[0].local_path == expected
    assert refs[0].exists is False


def test_capture_date_from_filename():
    assert parse_capture_date("2024-08-31-00.jpg") == date(2024, 8, 31)
    assert parse_capture_date("2026-06-10-17.mp4") == date(2026, 6, 10)
    assert parse_capture_date("summit-panorama.jpg") is None


def test_youtube_gets_its_own_status(tmp_path):
    from matches.matcher import decide_non_image

    refs = find_media_refs(_write(tmp_path), tmp_path / "static")
    yt = next(r for r in refs if r.kind == "youtube")
    vid = next(r for r in refs if r.kind == "video")
    assert decide_non_image(yt).status == "skipped_youtube"
    assert decide_non_image(vid).status == "skipped_video"


def test_outlier_filename_has_no_capture_date(tmp_path):
    refs = find_media_refs(_write(tmp_path), tmp_path / "static")
    assert refs[0].capture_date == date(2024, 8, 31)
    assert refs[3].capture_date is None


def test_avif_tier_makes_ref_exist(tmp_path):
    """find_media_refs reports exists=True when AVIF tiers exist
    even if the original .jpg was deleted by optimize.py."""
    static = tmp_path / "static"
    story = static / "images/projects/data-viz/hikes/stories/aiplspitz"
    story.mkdir(parents=True, exist_ok=True)
    # Only AVIF tiers exist, no original .jpg
    for tier in (640, 1280, 2560):
        (story / f"2024-08-31-00-{tier}.avif").write_bytes(b"avif")
    post = _write(tmp_path)
    refs = find_media_refs(post, static)
    ref = [r for r in refs if r.web_path.endswith("2024-08-31-00.jpg")][0]
    assert ref.exists is True
    assert ref.local_path == story / "2024-08-31-00.jpg"


def test_post_slug_strips_date_prefix(tmp_path):
    assert post_slug(_write(tmp_path)) == "aiplspitz"
