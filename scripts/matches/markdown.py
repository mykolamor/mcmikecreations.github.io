"""Extract media references from a hike post.

The URL is matched directly rather than the whole `![alt](url)` construct.
A naive `!\\[[^\\]]*\\]\\(...\\)` breaks on nested links in alt text, which do
occur in this corpus, e.g.

    ![Compilation ... by [David Bilan](https://bilandavid.com/)](/images/...)
"""

import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from . import config

STORY_PREFIX = "/images/projects/data-viz/hikes/stories/"
# A place doc's images: `places/<slug>/`, named like a post's story images.
PLACES_PREFIX = "/images/projects/data-viz/hikes/places/"
# A story or place asset, or a YouTube embed. All use image syntax in this
# corpus, so one pass keeps them in document order relative to each other.
MEDIA_URL_RE = re.compile(
    r"\((" + "(?:" + re.escape(STORY_PREFIX) + "|" + re.escape(PLACES_PREFIX) + ")" + r"[^)\s]+?"
    r"|https?://(?:www\.)?(?:youtube\.com|youtu\.be)/[^)\s]+?)"
    r"(?:\s+\"[^\"]*\")?\)"
)
DATE_PREFIX_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def images_prefix(kind: str = "post") -> str:
    """Served folder prefix of a post's story images, or a place doc's (kind "place")."""
    return PLACES_PREFIX if kind == "place" else STORY_PREFIX


@dataclass
class MediaRef:
    """One media file referenced by a post, in document order."""

    index: int
    web_path: str
    local_path: Path | None   # None for YouTube, which has no local file
    kind: str
    capture_date: date | None
    exists: bool


def parse_capture_date(filename: str) -> date | None:
    """Capture date encoded in a `YYYY-MM-DD-NN.ext` filename, if present."""
    m = DATE_PREFIX_RE.match(filename)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def is_place_doc(path: Path) -> bool:
    """A place doc (`knorrhuette.md`) rather than a dated hike post
    (`2026-07-19-schneefernerkopf.md`). Place docs have no date: nothing
    date-driven (time windows, `taken`, the recorded track) applies to them."""
    return DATE_PREFIX_RE.match(Path(path).name) is None


def post_slug(post_path: Path) -> str:
    """`2024-08-31-aiplspitz.md` -> `aiplspitz`."""
    stem = Path(post_path).stem
    m = DATE_PREFIX_RE.match(stem)
    return stem[len(m.group(0)) + 1:] if m else stem


def _classify(url: str) -> str:
    """One of "youtube", "video", "image" or "other"."""
    if url.startswith("http"):
        host = url.split("/")[2].lower() if "//" in url else ""
        if any(host.endswith(h) for h in config.YOUTUBE_HOSTS):
            return "youtube"
        return "other"
    s = Path(url).suffix.lower()
    if s in config.VIDEO_EXTENSIONS:
        return "video"
    if s in config.IMAGE_EXTENSIONS:
        return "image"
    return "other"


def avif_tier_paths(path: Path) -> list[Path]:
    """The `<stem>-<tier>.avif` files `image_optimize.py` writes in place of
    `path` (see `optimize.encode_avif_tiers`), largest tier first."""
    path = Path(path)
    return [path.with_name(f"{path.stem}-{t}.avif") for t in sorted(config.AVIF_TIERS, reverse=True)]


def on_disk(local_path: Path | None) -> Path | None:
    """The file to read for `local_path`: itself if present, else the
    largest AVIF tier generated in its place - `image_optimize.py` deletes
    the original once conversion succeeds (see `optimize.optimize_post`)."""
    if local_path is None:
        return None
    for candidate in [Path(local_path), *avif_tier_paths(local_path)]:
        if candidate.is_file():
            return candidate
    return None


def find_media_refs(post_path: Path, static_root: Path) -> list[MediaRef]:
    """All story media referenced by the post, deduplicated, in document order."""
    text = Path(post_path).read_text(encoding="utf-8")
    static_root = Path(static_root)
    refs: list[MediaRef] = []
    seen: set[str] = set()
    for web_path in MEDIA_URL_RE.findall(text):
        if web_path in seen:
            continue
        seen.add(web_path)
        kind = _classify(web_path)
        if kind == "youtube":
            local = None
            capture_date = None
        else:
            local = static_root / web_path.lstrip("/")
            capture_date = parse_capture_date(Path(web_path).name)
        refs.append(
            MediaRef(
                index=len(refs),
                web_path=web_path,
                local_path=local,
                kind=kind,
                capture_date=capture_date,
                exists=on_disk(local) is not None,
            )
        )
    return refs
