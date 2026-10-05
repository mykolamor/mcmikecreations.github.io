"""Offline tests for AddSpec resolution in review.actions."""

import io
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from matches import config
from matches.review import actions
from matches.tests.conftest import ASSET, make_asset

URL = ("https://immich.example/albums/"
       "7b14d8c7-f4be-429f-adc2-d35a2e974677/photos/" + ASSET.id)


def test_remote_mode_resolves_a_pasted_url_to_the_asset_id(remote, monkeypatch):
    """A filename/id-only AddSpec.asset_id is None; the URL lives in asset_name."""
    calls = {}

    def fake_download(settings, remote, post, asset_id, out_name):
        calls["asset_id"] = asset_id
        return Path("out.jpg"), {"web_path": "/x", "status": "matched"}

    monkeypatch.setattr(actions, "download_and_optimize", fake_download)
    spec = actions.AddSpec(mode=actions.MODE_REMOTE, asset_name=URL,
                           out_name="out.jpg")
    entry = actions.apply_add_spec(None, remote, SimpleNamespace(), spec)
    assert calls["asset_id"] == ASSET.id
    assert entry["status"] == "matched"


def test_remote_mode_raises_for_an_unresolvable_asset(remote):
    spec = actions.AddSpec(mode=actions.MODE_REMOTE, asset_name="nope.jpg",
                           out_name="out.jpg")
    with pytest.raises(ValueError):
        actions.apply_add_spec(None, remote, SimpleNamespace(), spec)


@pytest.fixture
def download(tmp_path):
    """Runs download_and_optimize for a 3000x2000 original of `asset` into a
    fresh post as `2026-01-01-00.jpg`."""
    settings = config.Settings(static_root=tmp_path / "static", out_dir=tmp_path / "out")
    post_path = tmp_path / "2026-01-01-demo.md"
    post_path.write_text("---\ntitle: Test\n---\nbody\n", encoding="utf-8")
    post = SimpleNamespace(slug="demo", path=post_path)
    original = io.BytesIO()
    Image.new("RGB", (3000, 2000), (10, 20, 30)).save(original, "JPEG")

    def run(asset=ASSET):
        class FakeRemote:
            def candidates_for(self, post):
                return [asset]

            def original_bytes(self, asset_id):
                return original.getvalue()

        out_path, entry = actions.download_and_optimize(
            settings, FakeRemote(), post, asset.id, "2026-01-01-00.jpg")
        return SimpleNamespace(out_path=out_path, entry=entry,
                               text=post_path.read_text(encoding="utf-8"),
                               story=actions.stories_dir(settings, "demo"))
    return run


def test_download_and_optimize_writes_avif_tiers_and_updates_front_matter(download):
    r = download()
    assert (r.story / "2026-01-01-00-640.avif").is_file()
    assert (r.story / "2026-01-01-00-1280.avif").is_file()
    assert (r.story / "2026-01-01-00-2560.avif").is_file()
    assert not (r.story / "2026-01-01-00.jpg").exists()  # no whatsapp-style jpeg written

    assert r.out_path.name == "2026-01-01-00.jpg"
    assert r.entry["status"] == "matched"
    assert r.entry["match"]["asset_id"] == ASSET.id

    assert "images:" in r.text
    assert "2026-01-01-00.jpg: {w: 3000, h: 2000, blur:" in r.text


def test_download_and_optimize_records_gps_from_the_asset(download):
    r = download(make_asset(latitude=47.5, longitude=11.25))
    assert "2026-01-01-00.jpg: {w: 3000, h: 2000, lat: 47.5, lon: 11.25, blur:" in r.text


def test_next_out_name_starts_at_zero_for_an_empty_folder(tmp_path):
    settings = config.Settings(static_root=tmp_path)
    assert actions.next_out_name(settings, "demo", "2026-06-10") == "2026-06-10-00.jpg"


def test_next_out_name_continues_past_the_highest_existing_index(tmp_path):
    settings = config.Settings(static_root=tmp_path)
    folder = actions.stories_dir(settings, "demo")
    folder.mkdir(parents=True)
    (folder / "2026-06-10-00.jpg").touch()
    (folder / "2026-06-10-01.heic").touch()
    (folder / "2026-06-10-17.mp4").touch()
    (folder / "2026-06-11-00.jpg").touch()  # different date, ignored
    assert actions.next_out_name(settings, "demo", "2026-06-10") == "2026-06-10-18.jpg"
    assert actions.next_out_name(settings, "demo", "2026-06-12") == "2026-06-12-00.jpg"


def test_next_out_name_continues_past_avif_converted_images(tmp_path):
    """image_optimize.py (and now download_and_optimize) deletes the plain
    original once it writes `<stem>-<tier>.avif` tiers - the suggested name
    must still count that index, or newly added images collide with
    already-converted ones."""
    settings = config.Settings(static_root=tmp_path)
    folder = actions.stories_dir(settings, "demo")
    folder.mkdir(parents=True)
    for tier in (640, 1280, 2560):
        (folder / f"2026-06-10-00-{tier}.avif").touch()
    assert actions.next_out_name(settings, "demo", "2026-06-10") == "2026-06-10-01.jpg"
