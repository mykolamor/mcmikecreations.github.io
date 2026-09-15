"""Open camera RAW/DNG files that Pillow cannot decode on its own.

Immich serves some assets' full-resolution `original` in the camera's native
raw format rather than JPEG/HEIC. rawpy (a LibRaw wrapper) extracts the
embedded preview JPEG when present - fast, and already white-balanced and
color-corrected by the camera - falling back to a full demosaic only when no
usable embedded preview exists.
"""

import io
from pathlib import Path

import rawpy
from PIL import Image

from . import config


def open_image(path: Path) -> Image.Image:
    """A Pillow Image for `path`, decoding camera raw formats via rawpy."""
    if path.suffix.lower() not in config.RAW_EXTENSIONS:
        return Image.open(path)
    with rawpy.imread(str(path)) as raw:
        try:
            thumb = raw.extract_thumb()
        except (rawpy.LibRawNoThumbnailError, rawpy.LibRawUnsupportedThumbnailError):
            thumb = None
        if thumb is not None and thumb.format == rawpy.ThumbFormat.JPEG:
            return Image.open(io.BytesIO(thumb.data))
        if thumb is not None and thumb.format == rawpy.ThumbFormat.BITMAP:
            return Image.fromarray(thumb.data)
        return Image.fromarray(raw.postprocess())
