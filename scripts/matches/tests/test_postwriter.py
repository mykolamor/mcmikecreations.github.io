from matches.postwriter import merge_images_front_matter

SAMPLE = """---
title: Hochalm in Completionist Mode
description: Taking the wild ridge by storm.
tags:
  - Web
gpx: /_projects/data-viz/hikes/gpx/hochalm.gpx
ascent: 1414
---
This was supposed to be the grand hike.

Second paragraph with a [link](https://example.com/).
"""


def test_merge_adds_images_key_preserving_body_and_existing_fields(tmp_path):
    post = tmp_path / "post.md"
    post.write_text(SAMPLE, encoding="utf-8")

    merge_images_front_matter(post, {
        "2026-08-23-00.jpg": {"w": 4080, "h": 3060, "blur": "data:image/webp;base64,AAAA"},
        "2026-08-23-01.jpg": {"w": 3060, "h": 4080},
    })

    text = post.read_text(encoding="utf-8")
    assert text.startswith("---\ntitle: Hochalm in Completionist Mode\n")
    assert "description: Taking the wild ridge by storm.\n" in text
    assert "ascent: 1414\n" in text
    assert "tags:\n  - Web\n" in text  # existing block-style list untouched
    assert "images:\n  2026-08-23-00.jpg: {w: 4080, h: 3060, blur: 'data:image/webp;base64,AAAA'}\n" in text
    assert "images:\n  2026-08-23-00.jpg:" in text and "2026-08-23-01.jpg: {w: 3060, h: 4080}\n" in text
    assert text.endswith(
        "---\nThis was supposed to be the grand hike.\n\n"
        "Second paragraph with a [link](https://example.com/).\n"
    )


def test_merge_is_idempotent_and_replaces_not_duplicates(tmp_path):
    post = tmp_path / "post.md"
    post.write_text(SAMPLE, encoding="utf-8")

    merge_images_front_matter(post, {"a.jpg": {"w": 1, "h": 1}})
    merge_images_front_matter(post, {"b.jpg": {"w": 2, "h": 2}})

    text = post.read_text(encoding="utf-8")
    assert text.count("images:") == 1
    assert "a.jpg" not in text
    assert "b.jpg: {w: 2, h: 2}" in text
