"""Offline tests for the web layer: no server, no network."""

import json
from pathlib import Path

import pytest

from matches import config
from matches.review.actions import settings_to_argv
from matches.review.model import build_entry, web_path_for
from matches.web import api, state as web_state

POST = """---
title: Test
---
![One](/images/projects/data-viz/hikes/stories/demo/2024-08-31-00.jpg)
![Tube](https://www.youtube.com/watch?v=abc123)
"""


@pytest.fixture
def app(tmp_path, monkeypatch):
    posts = tmp_path / "markdown"
    posts.mkdir()
    (posts / "2024-08-31-demo.md").write_text(POST, encoding="utf-8")
    stories = tmp_path / "static/images/projects/data-viz/hikes/stories/demo"
    stories.mkdir(parents=True)
    (stories / "2024-08-31-00.jpg").write_bytes(b"\xff\xd8\xff\xd9")
    out = tmp_path / "out"
    out.mkdir()
    entry = build_entry(web_path_for("demo", "2024-08-31-00.jpg"),
                        stories / "2024-08-31-00.jpg",
                        {"asset_id": "a1", "original_file_name": "IMG_1.jpg"},
                        "matched")
    (out / "2024-08-31-demo.json").write_text(json.dumps({
        "post": "2024-08-31-demo.md", "slug": "demo", "entries": [entry],
        "stats": {}, "album": {"name": "Demo_Album", "id": "x", "source": "guessed"},
        "date_window": {"from": "2024-08-28", "to": "2024-09-03"},
        "candidate_count": 5, "immich_url": "x", "generated_at": "x",
    }))
    # Never touch the developer's real remembered-key file.
    monkeypatch.setattr(web_state, "CONFIG_PATH", tmp_path / "cfg.json")
    settings = config.Settings(posts_dir=posts, static_root=tmp_path / "static",
                               out_dir=out, api_key="", immich_url="")
    return web_state.AppState(settings)


def test_list_and_detail(app):
    assert [h["name"] for h in api.list_hikes(app)["hikes"]] == ["2024-08-31-demo.md"]
    d = api.hike_detail(app, "2024-08-31-demo.md")
    assert [m["status"] for m in d["media"]] == ["matched", "skipped_youtube"]
    assert d["media"][0]["color"] == "#1a7f37"
    assert d["media"][1]["color"] == "#8c959f"
    assert d["album"]["name"] == "Demo_Album"


def test_detail_reports_local_and_remote_file_sizes(app):
    d = api.hike_detail(app, "2024-08-31-demo.md")
    matched, youtube = d["media"]
    assert matched["local_size"] == len(b"\xff\xd8\xff\xd9")
    assert youtube["local_size"] is None  # has_local is False for a YouTube ref


def test_unknown_post_is_404(app):
    with pytest.raises(api.ApiError) as exc:
        api.hike_detail(app, "nope.md")
    assert exc.value.status == 404


def test_local_file_serves_and_blocks_traversal(app):
    body, ctype = api.local_file(app, "/images/projects/data-viz/hikes/stories/demo/2024-08-31-00.jpg")
    assert body.startswith(b"\xff\xd8")
    assert ctype == "image/jpeg"
    for bad in ("/../../../etc/passwd", "/images/../../../../etc/passwd"):
        with pytest.raises(api.ApiError) as exc:
            api.local_file(app, bad)
        assert exc.value.status == 403


def test_settings_never_expose_the_key(app):
    app.set_credentials("supersecret123", "https://immich.example", False)
    payload = api.get_settings(app)
    assert "api_key" not in payload
    assert payload["has_key"] is True
    assert payload["key_hint"] == "...t123"
    assert "supersecret" not in json.dumps(payload)


def test_keep_flag_preserves_the_existing_key(app):
    app.set_credentials("abc123", "https://immich.example", False)
    api.put_settings(app, {"remember": False, "keep": True})
    assert app.settings.api_key == "abc123"


def test_empty_key_without_keep_clears_it(app):
    app.set_credentials("abc123", "https://immich.example", False)
    api.put_settings(app, {"api_key": "", "remember": False})
    assert app.settings.api_key == ""


def test_remembered_key_round_trips_and_is_private(app, tmp_path):
    app.set_credentials("remembered-key", "https://immich.example", True)
    path = tmp_path / "cfg.json"
    assert path.is_file()
    assert path.stat().st_mode & 0o777 == 0o600
    assert web_state.load_saved()["api_key"] == "remembered-key"
    assert web_state.load_saved()["immich_url"] == "https://immich.example"
    app.set_credentials("remembered-key", "https://immich.example", False)
    assert not path.exists()


def test_clearing_a_match_marks_it_unmatched(app):
    web = web_path_for("demo", "2024-08-31-00.jpg")
    r = api.set_remote_match(app, {"post": "2024-08-31-demo.md",
                                   "web_path": web, "value": ""})
    media = {m["web_path"]: m for m in r["detail"]["media"]}
    assert media[web]["status"] == "unmatched"
    assert media[web]["match"] is None


def test_repointing_local_path_to_a_missing_file(app):
    web = web_path_for("demo", "2024-08-31-00.jpg")
    r = api.set_local_path(app, {"post": "2024-08-31-demo.md", "web_path": web,
                                 "value": web_path_for("demo", "gone.jpg")})
    media = {m["web_path"]: m for m in r["detail"]["media"]}
    assert media[web_path_for("demo", "gone.jpg")]["status"] == "missing_local"


def test_avif_converted_image_shows_as_present(app, tmp_path):
    """image_optimize.py deletes the matched original and leaves
    `<stem>-<tier>.avif` tiers in its place; the review UI must still
    treat that as present on disk instead of "missing on disk"."""
    stories = tmp_path / "static/images/projects/data-viz/hikes/stories/demo"
    (stories / "2024-08-31-00.jpg").unlink()
    (stories / "2024-08-31-00-640.avif").write_bytes(b"small")
    (stories / "2024-08-31-00-2560.avif").write_bytes(b"biggest-tier")
    d = api.hike_detail(app, "2024-08-31-demo.md")
    matched = d["media"][0]
    assert matched["has_local"] is True
    assert matched["local_size"] == len(b"biggest-tier")


def test_local_file_serves_the_largest_avif_tier_when_the_original_is_gone(app, tmp_path):
    stories = tmp_path / "static/images/projects/data-viz/hikes/stories/demo"
    (stories / "2024-08-31-00.jpg").unlink()
    (stories / "2024-08-31-00-640.avif").write_bytes(b"small")
    (stories / "2024-08-31-00-2560.avif").write_bytes(b"biggest-tier")
    body, ctype = api.local_file(
        app, "/images/projects/data-viz/hikes/stories/demo/2024-08-31-00.jpg")
    assert body == b"biggest-tier"
    assert ctype == "image/avif"


def test_add_rejects_an_invalid_spec(app):
    from matches.web.jobs import JobRegistry
    with pytest.raises(api.ApiError):
        api.start_add(app, JobRegistry(), {"post": "2024-08-31-demo.md",
                                           "mode": "local"})
    with pytest.raises(api.ApiError):
        api.start_add(app, JobRegistry(), {"post": "2024-08-31-demo.md",
                                           "mode": "bogus"})


def test_suggest_name_requires_credentials(app):
    with pytest.raises(api.ApiError) as exc:
        api.suggest_out_name(app, {"post": "2024-08-31-demo.md", "asset": "IMG_1.jpg"})
    assert exc.value.status == 409


def test_suggest_name_builds_a_dated_index(app, monkeypatch):
    from matches.immich import Asset

    asset = Asset(id="a9", original_path="/o/IMG_9.jpg", original_file_name="IMG_9.jpg",
                 file_created_at="2024-08-31T10:00:00Z",
                 local_date_time="2024-08-31T10:00:00",
                 width=10, height=10, latitude=None, longitude=None)
    monkeypatch.setattr(app.remote, "find_asset", lambda post, text: asset)
    r = api.suggest_out_name(app, {"post": "2024-08-31-demo.md", "asset": "IMG_9.jpg"})
    # 2024-08-31-00.jpg is already on disk for this post (see the `app` fixture).
    assert r["name"] == "2024-08-31-01.jpg"


def test_suggest_name_404s_for_an_unresolvable_asset(app, monkeypatch):
    monkeypatch.setattr(app.remote, "find_asset", lambda post, text: None)
    with pytest.raises(api.ApiError) as exc:
        api.suggest_out_name(app, {"post": "2024-08-31-demo.md", "asset": "nope.jpg"})
    assert exc.value.status == 404


def test_rerun_requires_a_key(app):
    from matches.web.jobs import JobRegistry
    with pytest.raises(api.ApiError) as exc:
        api.start_rerun(app, JobRegistry(), {"post": "2024-08-31-demo.md"})
    assert exc.value.status == 409


def test_settings_survive_a_subprocess_round_trip(tmp_path):
    """A re-run must inherit overrides instead of silently using defaults."""
    from matches.cli import build_parser, settings_from_args

    original = config.Settings(out_dir=tmp_path / "o", mae_accept=9.5,
                               residual_blur=1.25, date_window_days=7)
    argv = settings_to_argv(original)
    parsed = settings_from_args(build_parser().parse_args(["x.md"] + argv))
    assert parsed.out_dir == original.out_dir
    assert parsed.mae_accept == 9.5
    assert parsed.residual_blur == 1.25
    assert parsed.date_window_days == 7


def test_detail_carries_the_deployed_site_url(app):
    d = api.hike_detail(app, "2024-08-31-demo.md")
    assert d["site_url"] == "https://mykolamor.com/hikes/2024-08-31-demo/"


def test_site_url_honours_an_override(app):
    app.settings.site_url = "https://staging.example.com/"
    d = api.hike_detail(app, "2024-08-31-demo.md")
    assert d["site_url"] == "https://staging.example.com/hikes/2024-08-31-demo/"


def test_site_url_matches_the_published_pattern():
    from matches.review.model import site_url_for
    assert site_url_for("2025-05-18-breitenstein_wendelstein.md") == (
        "https://mykolamor.com/hikes/2025-05-18-breitenstein_wendelstein/")


def test_counts_split_photos_from_other_media(app):
    """The demo post has one photo and one YouTube embed."""
    c = api.list_hikes(app)["hikes"][0]["counts"]
    assert c == {"matched": 1, "photos": 1, "media": 2}


def test_no_hardcoded_instance_address_in_the_package():
    """The instance address must come from the environment, never the source.

    Only real string literals count - comments and docstrings legitimately
    mention URLs (a YouTube embed example, a photo credit).
    """
    import ast
    import re
    from pathlib import Path

    allowed = re.compile(r"^https?://(immich\.example|localhost|127\.0\.0\.1"
                         r"|mykolamor\.com)")
    url = re.compile(r"https?://[a-z0-9.-]+\.[a-z]{2,}", re.I)
    root = Path(config.__file__).resolve().parent
    offenders = []
    for path in sorted(root.rglob("*.py")):
        if "hikes" in path.parts or path.name.startswith("test_"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        docstrings = {
            ast.get_docstring(n, clean=False)
            for n in ast.walk(tree)
            if isinstance(n, (ast.Module, ast.ClassDef, ast.FunctionDef,
                              ast.AsyncFunctionDef))
        }
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
                continue
            if node.value in docstrings:
                continue
            for found in url.findall(node.value):
                if not allowed.match(found):
                    offenders.append(f"{path.name}:{node.lineno}: {found}")
    assert not offenders, "hardcoded host in package source:\n" + "\n".join(offenders)


def test_url_and_key_both_required_for_remote_access(app):
    app.set_credentials("", "", remember=False)
    assert app.remote.available is False
    app.set_credentials("k", "", remember=False)
    assert app.remote.available is False
    app.set_credentials("", "https://immich.example", remember=False)
    assert app.remote.available is False
    app.set_credentials("k", "https://immich.example", remember=False)
    assert app.remote.available is True


def test_settings_report_url_presence(app):
    app.set_credentials("k", "https://immich.example/", remember=False)
    payload = api.get_settings(app)
    assert payload["has_url"] is True
    assert payload["immich_url"] == "https://immich.example"   # trailing slash trimmed
