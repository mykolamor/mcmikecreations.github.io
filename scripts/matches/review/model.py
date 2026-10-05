"""Data layer: hike posts, their media, and the JSON mapping.

The report's `index` counts every reference the parser finds, but entries can
also be added by hand, so markdown and report are joined on `web_path` and
never on position.
"""

import json
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .. import config
from ..cliutil import all_posts
from ..immich import Asset
from ..markdown import find_media_refs, images_prefix, is_place_doc, post_slug
from .remote import asset_to_dict

# Statuses the report emits, plus one the GUI adds for a reference the report
# has never seen.
STATUS_NOT_IN_JSON = "not_in_json"

COLORS = {
    "matched": "#1a7f37",          # green
    "unmatched": "#cf222e",        # red
    "ambiguous": "#9a6700",        # amber
    "skipped_video": "#8c959f",    # gray
    "skipped_youtube": "#8c959f",  # gray
    "missing_local": "#cf222e",
    STATUS_NOT_IN_JSON: "#1f2328",  # normal black
}


def status_color(status: str) -> str:
    return COLORS.get(status, COLORS[STATUS_NOT_IN_JSON])


@dataclass
class MediaEntry:
    """One media reference, joined against the report when present."""

    order: int                 # position in the document, YouTube included
    web_path: str
    kind: str                  # image | video | youtube
    status: str
    local_path: Path | None = None
    entry: dict | None = None  # the raw JSON entry, if any

    @property
    def label(self) -> str:
        if self.kind == "youtube":
            return f"[youtube] {self.web_path.rsplit('/', 1)[-1]}"
        return self.web_path.rsplit("/", 1)[-1]

    @property
    def matched_name(self) -> str:
        if self.entry and self.entry.get("match"):
            return self.entry["match"].get("original_file_name", "")
        return ""

    @property
    def color(self) -> str:
        return status_color(self.status)


@dataclass
class HikePost:
    """A markdown post plus its report, if one has been generated."""

    path: Path
    settings: config.Settings
    report: dict | None = None
    report_path: Path | None = None
    media: list[MediaEntry] = field(default_factory=list)

    @property
    def name(self) -> str:
        return self.path.name

    @property
    def slug(self) -> str:
        return post_slug(self.path)

    @property
    def kind(self) -> str:
        """"post" for a dated hike post, "place" for a place doc."""
        return "place" if is_place_doc(self.path) else "post"

    @property
    def stats(self) -> dict:
        return (self.report or {}).get("stats", {})

    @property
    def counts(self) -> dict:
        """matched / photos / media, where photos excludes video and YouTube.

        Derived from the media list rather than the report's stats, so it stays
        correct for a post with no report yet and always agrees with what the
        media panel shows.
        """
        return {
            "matched": sum(1 for m in self.media if m.status == "matched"),
            "photos": sum(1 for m in self.media if m.kind == "image"),
            "media": len(self.media),
        }

    def load(self) -> "HikePost":
        """Re-read the markdown and the report from disk."""
        from ..report import report_path as _rp

        self.report_path = _rp(self.settings.out_dir, self.path.name)
        self.report = None
        if self.report_path.is_file():
            try:
                self.report = json.loads(self.report_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                self.report = None

        by_path = {e["web_path"]: e for e in (self.report or {}).get("entries", [])}
        self.media = []
        for ref in find_media_refs(self.path, self.settings.static_root):
            entry = by_path.pop(ref.web_path, None)
            self.media.append(self._build(ref, entry))

        # Entries the report holds but the markdown no longer references.
        for url, entry in by_path.items():
            self.media.append(MediaEntry(
                order=len(self.media),
                web_path=url,
                kind="image",
                status=entry.get("status", STATUS_NOT_IN_JSON),
                local_path=Path(entry["local_path"]) if entry.get("local_path") else None,
                entry=entry,
            ))
        return self

    def _build(self, ref, entry: dict | None) -> MediaEntry:
        if entry is not None:
            status = entry.get("status", STATUS_NOT_IN_JSON)
        elif ref.kind == "youtube":
            status = "skipped_youtube"
        elif ref.kind == "video":
            status = "skipped_video"
        else:
            # In the markdown but absent from the report: shown in plain black.
            status = STATUS_NOT_IN_JSON
        return MediaEntry(
            order=len(self.media),
            web_path=ref.web_path,
            kind=ref.kind,
            status=status,
            local_path=ref.local_path,
            entry=entry,
        )

    # --- mutation -----------------------------------------------------------

    def ensure_report(self) -> dict:
        """A report skeleton, so entries can be added before a full run."""
        if self.report is None:
            self.report = {
                "post": self.name,
                "slug": self.slug,
                "generated_at": _now(),
                "immich_url": self.settings.immich_url,
                "album": {"name": None, "id": None, "source": "none"},
                "date_window": {"from": None, "to": None},
                "candidate_count": 0,
                "stats": {},
                "entries": [],
            }
        return self.report

    def upsert_entry(self, entry: dict) -> None:
        """Insert or replace an entry, keyed on web_path."""
        report = self.ensure_report()
        entries = report["entries"]
        for i, existing in enumerate(entries):
            if existing["web_path"] == entry["web_path"]:
                entries[i] = entry
                break
        else:
            entries.append(entry)
        self.recount()

    def recount(self) -> None:
        report = self.ensure_report()
        entries = report["entries"]
        stats = {"total": len(entries)}
        from ..report import STATUSES
        for status in STATUSES:
            stats[status] = sum(1 for e in entries if e.get("status") == status)
        report["stats"] = stats

    def save(self) -> Path:
        """Write the report back, keeping a single .bak of the previous state."""
        report = self.ensure_report()
        from ..report import dump_report, report_path as _rp

        out = self.report_path or _rp(self.settings.out_dir, self.name)
        if out.is_file():
            shutil.copy2(out, out.with_suffix(".json.bak"))
        report["generated_at"] = _now()
        dump_report(report, out)
        self.report_path = out
        return out


class HikeIndex:
    """All posts in the configured directory, then all place docs."""

    def __init__(self, settings: config.Settings):
        self.settings = settings
        self.posts: list[HikePost] = []

    def refresh(self) -> list[HikePost]:
        self.posts = [HikePost(p, self.settings).load() for p in all_posts(self.settings)]
        return self.posts


def _match_block(asset: dict) -> dict:
    """A report entry's `match`, from an `asset_to_dict`-shaped asset. One
    without `scores` (picked by hand, not by the cascade) gets empty ones."""
    return {
        "asset_id": asset.get("asset_id") or asset.get("id"),
        "original_path": asset.get("original_path", ""),
        "original_file_name": asset.get("original_file_name", ""),
        "file_created_at": asset.get("file_created_at", ""),
        "local_date_time": asset.get("local_date_time", ""),
        "width": asset.get("width", 0),
        "height": asset.get("height", 0),
        "latitude": asset.get("latitude"),
        "longitude": asset.get("longitude"),
        "file_size": asset.get("file_size", 0),
        "scores": asset.get("scores") or {
            "phash": None, "blockmean": None, "mae": None,
            "ncc": None, "inliers": None, "coverage": None,
        },
    }


def match_from_asset(asset: Asset) -> dict:
    """The `match` recording a hand-picked Immich asset."""
    return _match_block(asset_to_dict(asset))


def build_entry(web_path: str, local_path: Path, asset: dict | None,
                status: str, resolved_by: str | None = "manual",
                confidence: str | None = None) -> dict:
    """A report entry in the same shape `matches.report` emits."""
    match = _match_block(asset) if asset else None
    return {
        "index": -1,
        "web_path": web_path,
        "local_path": str(local_path),
        "status": status,
        "confidence": confidence,
        "resolved_by": resolved_by if match else None,
        "match": match,
        "alternatives": [],
    }


def manual_entry(web_path: str, local_path: Path, asset: Asset | None) -> dict:
    """The entry for a media item mapped by hand: matched to `asset`, or
    unmatched without one."""
    return build_entry(web_path, local_path, asset_to_dict(asset) if asset else None,
                       "matched" if asset else "unmatched", "manual", "manual")


def site_url_for(post_name: str, site_url: str = config.DEFAULT_SITE_URL) -> str | None:
    """Public URL of a published hike post, e.g.

        2025-05-18-breitenstein_wendelstein.md
        -> https://mykolamor.com/hikes/2025-05-18-breitenstein_wendelstein/

    None for a place doc: it has no page of its own, only a section in every
    post that lists it.
    """
    if is_place_doc(Path(post_name)):
        return None
    stem = Path(post_name).stem
    return f"{site_url.rstrip('/')}{config.SITE_HIKE_PATH}/{stem}/"


def web_path_for(slug: str, filename: str, kind: str = "post") -> str:
    """Served path of an image in a post's story folder, or a place doc's folder."""
    return f"{images_prefix(kind)}{slug}/{filename}"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
