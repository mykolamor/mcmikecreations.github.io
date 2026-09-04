"""Generate responsive AVIF tiers and LQIP blur placeholders for hike post
images that have a confirmed Immich match, and record intrinsic dimensions
for every other inline story image.

Tiers scale by the LONG EDGE (larger of width/height), matching
image_compress.py's existing --max-edge convention, not by a fixed target
width — a portrait photo's "2560" tier is 2560px tall and proportionally
narrower, not 2560px wide with an even taller height. This keeps file size
comparable across orientations for the same tier.
"""

import base64
import io
from collections.abc import Sequence
from pathlib import Path

from PIL import Image, ImageOps

import pillow_avif  # noqa: F401  (registers AVIF read/write support in Pillow)
import pillow_heif

pillow_heif.register_heif_opener()  # Immich originals are frequently HEIC

from . import config
from .markdown import find_media_refs
from .report import read_report


def tier_dimensions(width: int, height: int, target_long_edge: int) -> tuple[int, int] | None:
    """Output (width, height) for one tier, or None if it would upscale.

    The longer of `width`/`height` is scaled to `target_long_edge`; the
    other dimension follows the original aspect ratio, rounded to the
    nearest pixel.
    """
    if width <= 0 or height <= 0:
        return None
    if width >= height:
        if target_long_edge > width:
            return None
        return target_long_edge, round(target_long_edge * height / width)
    if target_long_edge > height:
        return None
    return round(target_long_edge * width / height), target_long_edge


def open_exif_corrected(path: Path) -> Image.Image:
    """Open an image, apply its EXIF orientation, and normalize to RGB."""
    img = Image.open(path)
    img.load()
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def encode_avif_tiers(
    img: Image.Image, out_base: Path, tiers: Sequence[int], quality: int
) -> list[tuple[int, int, int]]:
    """Write one AVIF file per tier that fits without upscaling.

    Files are named `{out_base}-{target}.avif`. Returns the tiers actually
    written, ascending, as (target_long_edge, actual_width, actual_height).
    """
    written: list[tuple[int, int, int]] = []
    for target in tiers:
        dims = tier_dimensions(img.width, img.height, target)
        if dims is None:
            continue
        w, h = dims
        resized = img.resize((w, h), Image.Resampling.LANCZOS)
        path = out_base.parent / f"{out_base.name}-{target}.avif"
        resized.save(path, "AVIF", quality=quality)
        written.append((target, w, h))
    return written


def encode_lqip_data_uri(img: Image.Image, long_edge: int, quality: int) -> str:
    """A tiny inlineable blur placeholder: WebP, `long_edge`px on its long
    side, base64-encoded as a data URI."""
    dims = tier_dimensions(img.width, img.height, long_edge)
    w, h = dims if dims is not None else (img.width, img.height)
    small = img.resize((w, h), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    small.save(buf, "WEBP", quality=quality)
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{encoded}"


def probe_dimensions(path: Path) -> tuple[int, int]:
    """Intrinsic (EXIF-corrected) dimensions of a local image, no Immich call."""
    img = open_exif_corrected(path)
    return img.size


def optimize_post(
    post_path: Path, client, settings: "config.Settings", dry_run: bool = False
) -> dict[str, dict]:
    """Convert every matched image to AVIF+LQIP and probe every other
    image's dimensions. Returns the `images` map for the front matter.

    Raises FileNotFoundError if the post has no match report (§ scope:
    matcher must run before optimizer).

    If dry_run is True, no AVIF tier files are written and no original
    (or its `_wa` sibling) is deleted — the returned map still reports
    what would be generated, computed from the fetched original's pixels.
    """
    report = read_report(settings.out_dir, post_path.name)
    entries_by_path = {e["web_path"]: e for e in report["entries"]}
    refs = find_media_refs(post_path, settings.static_root)

    images: dict[str, dict] = {}
    for ref in refs:
        if ref.kind != "image":
            continue
        entry = entries_by_path.get(ref.web_path)
        if entry is None:
            continue
        filename = Path(ref.web_path).name

        if entry["status"] == "matched" and entry["match"]:
            match = entry["match"]
            original_path = client.original(match["asset_id"], match["original_file_name"])
            img = open_exif_corrected(original_path)
            out_base = ref.local_path.with_suffix("")
            if dry_run:
                tiers = [
                    t for t in config.AVIF_TIERS if tier_dimensions(img.width, img.height, t)
                ]
            else:
                tiers = encode_avif_tiers(img, out_base, config.AVIF_TIERS, settings.avif_quality)
            if not tiers:
                # Original smaller than the smallest tier: fall back to
                # dims-only, same as an unmatched image.
                images[filename] = {"w": img.width, "h": img.height}
                continue
            blur = encode_lqip_data_uri(img, settings.lqip_long_edge, settings.lqip_quality)
            images[filename] = {"w": img.width, "h": img.height, "blur": blur}
            if dry_run:
                continue
            if ref.local_path.exists():
                ref.local_path.unlink()
            wa_sibling = ref.local_path.with_name(ref.local_path.stem + "_wa" + ref.local_path.suffix)
            if wa_sibling.exists():
                wa_sibling.unlink()
        elif ref.exists:
            w, h = probe_dimensions(ref.local_path)
            images[filename] = {"w": w, "h": h}
        # else: unmatched/ambiguous with no local file (missing_local) — nothing to record.

    return images
