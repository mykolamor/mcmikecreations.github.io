"""Offline tests for Remote.find_asset's filename/id/URL resolution."""

import pytest

from matches import config
from matches.immich import Asset
from matches.review.remote import Remote

ASSET = Asset(
    id="953e18b3-3d1e-4e21-9e31-1f64a6015c14",
    original_path="/originals/IMG_1234.jpg",
    original_file_name="IMG_1234.jpg",
    file_created_at="2024-08-31T00:00:00Z",
    local_date_time="2024-08-31T00:00:00",
    width=100, height=100, latitude=None, longitude=None,
)


@pytest.fixture
def remote(monkeypatch):
    r = Remote(config.Settings(api_key="k", immich_url="https://immich.example"))
    monkeypatch.setattr(r, "candidates_for", lambda post: [ASSET])
    return r


def test_finds_by_bare_id(remote):
    assert remote.find_asset(None, ASSET.id) is ASSET


def test_finds_by_filename(remote):
    assert remote.find_asset(None, "IMG_1234.jpg") is ASSET


def test_finds_by_photo_viewer_url(remote):
    url = ("https://immich.example/albums/"
           "7b14d8c7-f4be-429f-adc2-d35a2e974677/photos/" + ASSET.id)
    assert remote.find_asset(None, url) is ASSET


def test_finds_by_url_with_trailing_slash_and_query(remote):
    url = f"https://immich.example/photos/{ASSET.id}/?open=true"
    assert remote.find_asset(None, url) is ASSET


def test_unmatched_url_returns_none(remote):
    url = "https://immich.example/photos/00000000-0000-0000-0000-000000000000"
    assert remote.find_asset(None, url) is None


class _FakeSearchClient:
    def __init__(self):
        self.calls = []

    def search_assets(self, album_ids=None, taken_after=None, taken_before=None):
        self.calls.append(album_ids[0] if album_ids else None)
        return [ASSET]


def _post(album_id: str):
    from types import SimpleNamespace
    return SimpleNamespace(
        name="p.md",
        report={"album": {"id": album_id},
                "date_window": {"from": "2025-01-01", "to": "2025-01-10"}},
    )


def test_candidates_for_caches_by_post_and_album():
    r = Remote(config.Settings(api_key="k", immich_url="https://immich.example"))
    fake = _FakeSearchClient()
    r._client = fake
    post = _post("alpha")
    assert r.candidates_for(post) == [ASSET]
    assert r.candidates_for(post) == [ASSET]
    assert fake.calls == ["alpha"], "repeat lookups for the same album re-queried Immich"


def test_candidates_for_requeries_when_the_reports_album_changes():
    """A report rewritten on disk since the last lookup (a CLI rerun, a
    manual album fix) must trigger a fresh Immich query rather than replay
    whatever the previous album search happened to find."""
    r = Remote(config.Settings(api_key="k", immich_url="https://immich.example"))
    fake = _FakeSearchClient()
    r._client = fake
    post = _post("alpha")
    r.candidates_for(post)
    post.report["album"]["id"] = "beta"
    r.candidates_for(post)
    assert fake.calls == ["alpha", "beta"]
