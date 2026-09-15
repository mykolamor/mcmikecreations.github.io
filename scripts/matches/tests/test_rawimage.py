import io

import numpy as np
import rawpy
from PIL import Image

from matches import rawimage


def test_open_image_passes_through_non_raw_files(tmp_path):
    path = tmp_path / "plain.jpg"
    Image.new("RGB", (10, 8), (1, 2, 3)).save(path, "JPEG")
    img = rawimage.open_image(path)
    img.load()
    assert img.size == (10, 8)


class _FakeThumb:
    def __init__(self, fmt, data):
        self.format = fmt
        self.data = data


class _FakeRaw:
    """Stands in for `rawpy.imread(...)`'s context-managed RawPy object."""

    def __init__(self, thumb=None, thumb_error=None, postprocessed=None):
        self._thumb = thumb
        self._thumb_error = thumb_error
        self._postprocessed = postprocessed

    def extract_thumb(self):
        if self._thumb_error is not None:
            raise self._thumb_error
        return self._thumb

    def postprocess(self):
        return self._postprocessed

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


def _jpeg_bytes(size, color):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


def test_open_image_uses_embedded_jpeg_thumb_when_present(tmp_path, monkeypatch):
    path = tmp_path / "photo.dng"
    path.write_bytes(b"fake-raw-bytes")
    fake = _FakeRaw(thumb=_FakeThumb(rawpy.ThumbFormat.JPEG, _jpeg_bytes((6, 4), (10, 20, 30))))
    monkeypatch.setattr(rawimage.rawpy, "imread", lambda p: fake)

    img = rawimage.open_image(path)
    img.load()

    assert img.size == (6, 4)


def test_open_image_uses_bitmap_thumb_when_no_jpeg(tmp_path, monkeypatch):
    path = tmp_path / "photo.dng"
    path.write_bytes(b"fake-raw-bytes")
    arr = np.zeros((4, 6, 3), dtype="uint8")
    fake = _FakeRaw(thumb=_FakeThumb(rawpy.ThumbFormat.BITMAP, arr))
    monkeypatch.setattr(rawimage.rawpy, "imread", lambda p: fake)

    img = rawimage.open_image(path)

    assert img.size == (6, 4)


def test_open_image_falls_back_to_postprocess_without_a_thumb(tmp_path, monkeypatch):
    path = tmp_path / "photo.dng"
    path.write_bytes(b"fake-raw-bytes")
    arr = np.zeros((5, 7, 3), dtype="uint8")
    fake = _FakeRaw(thumb_error=rawpy.LibRawNoThumbnailError("no thumb"), postprocessed=arr)
    monkeypatch.setattr(rawimage.rawpy, "imread", lambda p: fake)

    img = rawimage.open_image(path)

    assert img.size == (7, 5)


def test_open_image_falls_back_to_postprocess_on_unsupported_thumb(tmp_path, monkeypatch):
    path = tmp_path / "photo.dng"
    path.write_bytes(b"fake-raw-bytes")
    arr = np.zeros((5, 7, 3), dtype="uint8")
    fake = _FakeRaw(
        thumb_error=rawpy.LibRawUnsupportedThumbnailError("unsupported"),
        postprocessed=arr,
    )
    monkeypatch.setattr(rawimage.rawpy, "imread", lambda p: fake)

    img = rawimage.open_image(path)

    assert img.size == (7, 5)


def test_raw_extension_matching_is_case_insensitive(tmp_path, monkeypatch):
    path = tmp_path / "photo.DNG"
    path.write_bytes(b"fake-raw-bytes")
    fake = _FakeRaw(thumb=_FakeThumb(rawpy.ThumbFormat.JPEG, _jpeg_bytes((3, 2), (1, 1, 1))))
    monkeypatch.setattr(rawimage.rawpy, "imread", lambda p: fake)

    img = rawimage.open_image(path)
    img.load()

    assert img.size == (3, 2)
