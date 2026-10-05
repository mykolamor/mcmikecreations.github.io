"""Offline tests for the shared review data layer. No network, no widgets."""

import json
from pathlib import Path

import pytest

from matches.review.model import (STATUS_NOT_IN_JSON, HikeIndex, HikePost,
                               build_entry, status_color, web_path_for)
from matches.tests.conftest import hike_tree

POST = """---
title: Test
---
![One](/images/projects/data-viz/hikes/stories/demo/2024-08-31-00.jpg)
![Two](/images/projects/data-viz/hikes/stories/demo/2024-08-31-01.jpg)
![Clip](/images/projects/data-viz/hikes/stories/demo/2024-08-31-02.mp4)
![Tube](https://www.youtube.com/watch?v=abc123)
"""


@pytest.fixture
def workspace(tmp_path):
    tree = hike_tree(tmp_path, posts={"2024-08-31-demo.md": POST},
                     story_files={"stories/demo/2024-08-31-00.jpg": b"x"}, api_key="k")
    return tree.settings, tree.posts / "2024-08-31-demo.md", tree.out


def _report(entries):
    return {"post": "2024-08-31-demo.md", "slug": "demo", "entries": entries,
            "stats": {}, "album": {"name": None, "id": None, "source": "none"},
            "date_window": {"from": "2024-08-28", "to": "2024-09-03"},
            "candidate_count": 0, "immich_url": "x", "generated_at": "x"}


def test_media_without_report_is_classified_by_kind(workspace):
    settings, post_path, _ = workspace
    post = HikePost(post_path, settings).load()
    assert [m.status for m in post.media] == [
        STATUS_NOT_IN_JSON, STATUS_NOT_IN_JSON, "skipped_video", "skipped_youtube",
    ]


def test_youtube_is_gray_and_video_is_gray_but_unmatched_is_red():
    assert status_color("skipped_youtube") == status_color("skipped_video")
    assert status_color("unmatched") != status_color("matched")
    assert status_color(STATUS_NOT_IN_JSON) == "#1f2328"


def test_report_status_wins_over_kind(workspace):
    settings, post_path, out = workspace
    entry = build_entry(web_path_for("demo", "2024-08-31-00.jpg"),
                        Path("/x/2024-08-31-00.jpg"),
                        {"asset_id": "a1", "original_file_name": "IMG_1.jpg"},
                        "matched")
    (out / "2024-08-31-demo.json").write_text(json.dumps(_report([entry])))
    post = HikePost(post_path, settings).load()
    assert post.media[0].status == "matched"
    assert post.media[0].matched_name == "IMG_1.jpg"
    assert post.media[1].status == STATUS_NOT_IN_JSON


def test_join_is_by_web_path_not_position(workspace):
    """An entry for the *second* image must not attach to the first."""
    settings, post_path, out = workspace
    entry = build_entry(web_path_for("demo", "2024-08-31-01.jpg"),
                        Path("/x/2024-08-31-01.jpg"),
                        {"asset_id": "a2", "original_file_name": "IMG_2.jpg"},
                        "matched")
    (out / "2024-08-31-demo.json").write_text(json.dumps(_report([entry])))
    post = HikePost(post_path, settings).load()
    assert post.media[0].status == STATUS_NOT_IN_JSON
    assert post.media[1].status == "matched"


def test_upsert_replaces_rather_than_duplicates(workspace):
    settings, post_path, _ = workspace
    post = HikePost(post_path, settings).load()
    web = web_path_for("demo", "new.jpg")
    post.upsert_entry(build_entry(web, Path("/x/new.jpg"), None, "unmatched"))
    post.upsert_entry(build_entry(web, Path("/x/new.jpg"), None, "matched"))
    assert len(post.report["entries"]) == 1
    assert post.report["entries"][0]["status"] == "matched"


def test_save_keeps_a_backup_and_recounts(workspace):
    settings, post_path, out = workspace
    post = HikePost(post_path, settings).load()
    post.upsert_entry(build_entry(web_path_for("demo", "a.jpg"),
                                  Path("/x/a.jpg"), None, "unmatched"))
    path = post.save()
    assert not path.with_suffix(".json.bak").exists()   # nothing to back up yet
    post.upsert_entry(build_entry(web_path_for("demo", "b.jpg"),
                                  Path("/x/b.jpg"), None, "matched"))
    post.save()
    assert path.with_suffix(".json.bak").is_file()
    saved = json.loads(path.read_text())
    assert saved["stats"]["total"] == 2
    assert saved["stats"]["unmatched"] == 1
    assert saved["stats"]["matched"] == 1


def test_build_entry_without_asset_has_null_match():
    e = build_entry("/w/x.jpg", Path("/l/x.jpg"), None, "unmatched")
    assert e["match"] is None
    assert e["resolved_by"] is None


def test_build_entry_carries_file_size_through():
    e = build_entry("/w/x.jpg", Path("/l/x.jpg"),
                     {"asset_id": "a1", "file_size": 123456}, "matched")
    assert e["match"]["file_size"] == 123456


def test_build_entry_defaults_file_size_when_asset_lacks_it():
    e = build_entry("/w/x.jpg", Path("/l/x.jpg"), {"asset_id": "a1"}, "matched")
    assert e["match"]["file_size"] == 0


def test_index_lists_every_post(workspace):
    settings, _, _ = workspace
    assert [p.name for p in HikeIndex(settings).refresh()] == ["2024-08-31-demo.md"]


def test_counts_are_derived_from_media_not_stats(workspace):
    """Works even when the report has no stats block at all."""
    settings, post_path, out = workspace
    post = HikePost(post_path, settings).load()
    # Two images, one video, one YouTube embed; no report yet.
    assert post.counts == {"matched": 0, "photos": 2, "media": 4}


def test_counts_track_matches(workspace):
    settings, post_path, out = workspace
    entry = build_entry(web_path_for("demo", "2024-08-31-00.jpg"),
                        Path("/x/2024-08-31-00.jpg"),
                        {"asset_id": "a1", "original_file_name": "IMG_1.jpg"}, "matched")
    (out / "2024-08-31-demo.json").write_text(json.dumps(_report([entry])))
    post = HikePost(post_path, settings).load()
    assert post.counts == {"matched": 1, "photos": 2, "media": 4}
