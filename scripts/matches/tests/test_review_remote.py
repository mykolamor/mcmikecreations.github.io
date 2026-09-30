"""Offline tests for Remote.find_asset's filename/id/URL resolution."""

import pytest
import requests

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


class _MissingAssetClient:
    """Answers a by-id lookup the way Immich does for an unknown id."""

    def get_asset(self, asset_id):
        response = requests.Response()
        response.status_code = 400
        raise requests.HTTPError(response=response)


@pytest.fixture
def remote(monkeypatch):
    r = Remote(config.Settings(api_key="k", immich_url="https://immich.example"))
    r._client = _MissingAssetClient()
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


UPLOADED = Asset(
    id="67a32af0-0198-4a6c-9e0c-9b0e5621480b",
    original_path="/originals/Topo.jpg",
    original_file_name="Topo.jpg",
    file_created_at="2025-01-05T00:00:00Z",
    local_date_time="2025-01-05T00:00:00",
    width=100, height=100, latitude=None, longitude=None,
)


def test_finds_an_asset_uploaded_after_the_candidates_were_cached():
    """The candidate list is cached per post, so a photo added to Immich
    while the app runs must still resolve instead of replaying the stale
    list."""
    r = Remote(config.Settings(api_key="k", immich_url="https://immich.example"))
    fake = _FakeSearchClient()
    r._client = fake
    post = _post("alpha")
    r.candidates_for(post)
    fake.search_assets = lambda **kw: [ASSET, UPLOADED]
    assert r.find_asset(post, UPLOADED.id) is UPLOADED


class _ByIdClient(_FakeSearchClient):
    def get_asset(self, asset_id):
        assert asset_id == UPLOADED.id
        return UPLOADED


def test_explicit_id_outside_the_album_and_window_is_fetched_directly():
    """A scan or a screenshot carries its upload date, not the hike's, so an
    id the user pasted resolves even when no candidate search returns it."""
    r = Remote(config.Settings(api_key="k", immich_url="https://immich.example"))
    r._client = _ByIdClient()
    url = ("https://immich.example/albums/"
           "d449afe2-277a-4462-8953-f44b1d8dd111/photos/" + UPLOADED.id)
    assert r.find_asset(_post("alpha"), url) is UPLOADED
