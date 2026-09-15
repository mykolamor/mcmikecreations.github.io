import json

import pytest

from matches import config
from matches.immich import Album, Asset, ImmichClient

ASSET_JSON = {
    "id": "8b1b2166",
    "type": "IMAGE",
    "originalPath": "/data/library/admin/2024_08_/IMG_20240831_112834.jpg",
    "originalFileName": "IMG_20240831_112834.jpg",
    "fileCreatedAt": "2024-08-31T09:28:34.331Z",
    "localDateTime": "2024-08-31T11:28:34.331Z",
    "width": 4640,
    "height": 3472,
    "exifInfo": {"latitude": 47.661086, "longitude": 11.885, "fileSizeInByte": 7654321},
}


class StubSession:
    """Records calls and replays canned responses."""

    def __init__(self, pages):
        self.pages = list(pages)
        self.posted = []
        self.headers = {}

    class _R:
        def __init__(self, payload=None, content=b"", content_type="image/webp"):
            self._payload = payload
            self.content = content
            self.headers = {"Content-Type": content_type}

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    def get(self, url, timeout=None):
        if url.endswith("/api/albums"):
            return self._R([{"id": "a1", "albumName": "Germany_Spitzingsee_Aiplspitz",
                             "assetCount": 236}])
        return self._R(content=b"BINARYIMAGE")

    def post(self, url, json=None, timeout=None):
        self.posted.append(json)
        return self._R(self.pages.pop(0))


BASE = "https://immich.example"


def _client(tmp_path, session):
    s = config.Settings(api_key="k", immich_url=BASE, cache_dir=tmp_path / "cache")
    c = ImmichClient(s, session=session)
    return c


def test_list_albums(tmp_path):
    c = _client(tmp_path, StubSession([]))
    albums = c.list_albums()
    assert albums == [Album(id="a1", name="Germany_Spitzingsee_Aiplspitz", asset_count=236)]


def test_search_paginates(tmp_path):
    pages = [
        {"assets": {"items": [ASSET_JSON], "nextPage": "2"}},
        {"assets": {"items": [dict(ASSET_JSON, id="second")], "nextPage": None}},
    ]
    session = StubSession(pages)
    c = _client(tmp_path, session)
    assets = c.search_assets(album_ids=["a1"])
    assert [a.id for a in assets] == ["8b1b2166", "second"]
    assert session.posted[0]["albumIds"] == ["a1"]
    assert session.posted[0]["type"] == "IMAGE"
    assert session.posted[1]["page"] == 2


def test_asset_parses_exif_and_aspect(tmp_path):
    c = _client(tmp_path, StubSession([{"assets": {"items": [ASSET_JSON], "nextPage": None}}]))
    a = c.search_assets()[0]
    assert a.original_file_name == "IMG_20240831_112834.jpg"
    assert a.latitude == pytest.approx(47.661086)
    assert a.aspect == pytest.approx(4640 / 3472)
    assert a.file_size == 7654321


def test_asset_without_exif_has_none_coords(tmp_path):
    payload = {"assets": {"items": [dict(ASSET_JSON, exifInfo=None)], "nextPage": None}}
    c = _client(tmp_path, StubSession([payload]))
    a = c.search_assets()[0]
    assert a.latitude is None and a.longitude is None
    assert a.file_size == 0


def test_get_asset_fetches_by_id(tmp_path):
    session = StubSession([])
    calls = []
    session.get = lambda url, timeout=None: (calls.append(url), StubSession._R(payload=ASSET_JSON))[1]
    c = _client(tmp_path, session)
    a = c.get_asset("8b1b2166")
    assert a.id == "8b1b2166"
    assert a.file_size == 7654321
    assert calls[0].endswith("/api/assets/8b1b2166")


def test_thumbnail_is_cached_and_downloaded_once(tmp_path):
    session = StubSession([])
    calls = []
    original_get = session.get

    def counting_get(url, timeout=None):
        calls.append(url)
        return original_get(url, timeout=timeout)

    session.get = counting_get
    c = _client(tmp_path, session)
    p1 = c.thumbnail("abc")
    p2 = c.thumbnail("abc")
    assert p1 == p2
    assert p1.read_bytes() == b"BINARYIMAGE"
    assert len([u for u in calls if "abc" in u]) == 1, "cache was not used"
    assert "size=thumbnail" in calls[0]


def test_preview_uses_preview_size(tmp_path):
    session = StubSession([])
    calls = []
    session.get = lambda url, timeout=None: (calls.append(url), StubSession._R(content=b"P"))[1]
    c = _client(tmp_path, session)
    c.preview("xyz")
    assert "size=preview" in calls[0]


def test_original_is_cached_and_uses_source_extension(tmp_path):
    session = StubSession([])
    calls = []
    session.get = lambda url, timeout=None: (calls.append(url), StubSession._R(content=b"FULLRES"))[1]
    c = _client(tmp_path, session)
    p1 = c.original("abc123", "IMG_20240831_112834.HEIC")
    p2 = c.original("abc123", "IMG_20240831_112834.HEIC")
    assert p1 == p2
    assert p1.suffix == ".heic"
    assert p1.read_bytes() == b"FULLRES"
    assert len([u for u in calls if "abc123" in u]) == 1, "cache was not used"
    assert calls[0].endswith("/api/assets/abc123/original")


def test_original_falls_back_to_bin_suffix_when_unknown(tmp_path):
    session = StubSession([])
    session.get = lambda url, timeout=None: StubSession._R(content=b"X")
    c = _client(tmp_path, session)
    p = c.original("noext", "")
    assert p.suffix == ".bin"


def test_open_image_decodes_raw_originals_via_rawpy(tmp_path, monkeypatch):
    """A DNG fetched as the original-file fallback must still open, using
    rawpy rather than Pillow's native (raw-incapable) decoders."""
    import rawpy

    from matches import rawimage

    path = tmp_path / "abc123.dng"
    path.write_bytes(b"fake-raw-bytes")

    class FakeRaw:
        def extract_thumb(self):
            raise rawpy.LibRawNoThumbnailError("no thumb")

        def postprocess(self):
            import numpy as np
            return np.zeros((3, 5, 3), dtype="uint8")

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

    monkeypatch.setattr(rawimage.rawpy, "imread", lambda p: FakeRaw())
    img = ImmichClient.open_image(path)
    assert img.size == (5, 3)


def test_missing_api_key_raises(tmp_path):
    s = config.Settings(api_key="", immich_url=BASE, cache_dir=tmp_path / "c")
    with pytest.raises(ValueError, match="IMMICH_API_KEY"):
        ImmichClient(s, session=StubSession([]))


def test_missing_url_raises(tmp_path):
    """The instance address is no longer baked into the source."""
    s = config.Settings(api_key="k", immich_url="", cache_dir=tmp_path / "c")
    with pytest.raises(ValueError, match="IMMICH_URL"):
        ImmichClient(s, session=StubSession([]))


def test_thumbnail_saves_avif_when_content_type_says_so(tmp_path):
    """When Immich returns image/avif, the cached file gets .avif extension."""
    session = StubSession([{"assets": {"items": [], "nextPage": None}}])
    c = _client(tmp_path, session)
    # Override get to return AVIF content-type
    class AVIFResponse:
        content = b"AVIFDATA"
        headers = {"Content-Type": "image/avif"}
        def raise_for_status(self):
            pass
    session.get = lambda url, timeout=None: AVIFResponse()
    path = c.thumbnail("abc123")
    assert path.suffix == ".avif"
    assert path.name == "abc123.avif"


def test_thumbnail_replaces_stale_webp_cache_with_avif(tmp_path):
    """When Content-Type changes from webp to avif, old cache is cleaned up
    and the new format is used on re-download."""
    class AVIFResponse:
        content = b"AVIFDATA"
        headers = {"Content-Type": "image/avif"}
        def raise_for_status(self):
            pass
    # Use no_cache so the stale .webp is not returned from cache;
    # the download will clean it up and save as .avif
    s = config.Settings(api_key="k", immich_url=BASE, cache_dir=tmp_path / "cache",
                        use_cache=False)
    session = StubSession([])
    session.get = lambda url, timeout=None: AVIFResponse()
    c = ImmichClient(s, session=session)
    path = c.thumbnail("abc123")
    assert path.suffix == ".avif"
    assert path.read_bytes() == b"AVIFDATA"


def test_thumbnail_keeps_webp_when_content_type_is_webp(tmp_path):
    """Normal case: webp content-type produces .webp file."""
    session = StubSession([])
    c = _client(tmp_path, session)
    path = c.thumbnail("abc123")
    assert path.suffix == ".webp"


def test_thumbnail_cache_is_reused_when_content_type_differs_from_default(tmp_path):
    """A previously cached .avif thumbnail must be recognized as a cache hit
    on the next run, even though the guessed default suffix is .webp."""
    session = StubSession([])
    calls = []
    original_get = session.get

    def counting_get(url, timeout=None):
        calls.append(url)
        return original_get(url, timeout=timeout)

    session.get = counting_get

    class AVIFResponse:
        content = b"AVIFDATA"
        headers = {"Content-Type": "image/avif"}
        def raise_for_status(self):
            pass

    session.get = lambda url, timeout=None: (calls.append(url), AVIFResponse())[1]
    c = _client(tmp_path, session)
    p1 = c.thumbnail("abc123")
    p2 = c.thumbnail("abc123")
    assert p1 == p2 and p1.suffix == ".avif"
    assert len(calls) == 1, "cached .avif file was not recognized; re-downloaded instead"


def test_thumbnail_falls_back_to_suffix_for_unknown_content_type(tmp_path):
    """Unknown Content-Type falls back to the requested suffix."""
    class UnknownResponse:
        content = b"DATA"
        headers = {"Content-Type": "application/octet-stream"}
        def raise_for_status(self):
            pass
    session = StubSession([])
    session.get = lambda url, timeout=None: UnknownResponse()
    c = _client(tmp_path, session)
    path = c.thumbnail("abc123")
    assert path.suffix == ".webp"
