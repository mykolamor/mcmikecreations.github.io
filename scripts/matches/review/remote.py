"""Immich access for the GUI.

The client is built lazily so the app still opens (and local editing still
works) when no API key is set.
"""

from datetime import datetime
from pathlib import Path

from .. import config
from ..immich import Asset, ImmichClient


class RemoteUnavailable(RuntimeError):
    """No API key, or the instance could not be reached."""


class Remote:
    """Lazily-connected Immich client with a few GUI-shaped lookups."""

    def __init__(self, settings: config.Settings):
        self.settings = settings
        self._client: ImmichClient | None = None
        self._albums = None
        self._asset_cache: dict[str, list[Asset]] = {}

    @property
    def available(self) -> bool:
        return bool(self.settings.api_key and self.settings.immich_url)

    @property
    def client(self) -> ImmichClient:
        if self._client is None:
            if not self.settings.immich_url:
                raise RemoteUnavailable(
                    f"No Immich URL. Enter one in Settings, or set "
                    f"${config.IMMICH_URL_ENV} before starting."
                )
            if not self.settings.api_key:
                raise RemoteUnavailable(
                    f"No Immich API key. Enter one in Settings, or set "
                    f"${config.API_KEY_ENV} before starting."
                )
            self._client = ImmichClient(self.settings)
        return self._client

    def albums(self):
        if self._albums is None:
            self._albums = self.client.list_albums()
        return self._albums

    def preview_path(self, asset_id: str) -> Path:
        """Local path to a cached preview of an asset."""
        return self.client.preview(asset_id)

    def original_bytes(self, asset_id: str) -> bytes:
        """The untouched original, for converting into a web copy."""
        r = self.client.session.get(
            f"{self.client.base}/api/assets/{asset_id}/original",
            timeout=self.settings.timeout,
        )
        r.raise_for_status()
        return r.content

    # --- lookups ------------------------------------------------------------

    def candidates_for(self, post) -> list[Asset]:
        """Assets in the album and date window a report recorded for a post.

        Falls back to the window alone when the report named no album, and to
        the post's own date when there is no report at all.
        """
        key = post.name
        if key in self._asset_cache:
            return self._asset_cache[key]

        report = post.report or {}
        window = report.get("date_window") or {}
        lo, hi = window.get("from"), window.get("to")
        if not (lo and hi):
            lo, hi = self._window_from_post(post)
        album_id = (report.get("album") or {}).get("id")

        assets = self.client.search_assets(
            album_ids=[album_id] if album_id else None,
            taken_after=datetime.fromisoformat(f"{lo}T00:00:00"),
            taken_before=datetime.fromisoformat(f"{hi}T23:59:59"),
        )
        self._asset_cache[key] = assets
        return assets

    def _window_from_post(self, post) -> tuple[str, str]:
        from datetime import timedelta

        from ..markdown import find_media_refs, parse_capture_date
        from ..matcher import date_window

        refs = find_media_refs(post.path, self.settings.static_root)
        lo, hi = date_window(refs, parse_capture_date(post.path.stem),
                             self.settings.date_window_days)
        return lo.date().isoformat(), hi.date().isoformat()

    def find_asset(self, post, text: str) -> Asset | None:
        """Resolve a filename, an asset id, or an Immich web/app URL

        (e.g. `.../albums/<id>/photos/<asset-id>`) against the post's candidates.
        """
        text = (text or "").strip()
        if not text:
            return None
        path = text.split("?", 1)[0].split("#", 1)[0].rstrip("/")
        needle = path.rsplit("/", 1)[-1].lower()
        for a in self.candidates_for(post):
            if a.id == text or a.id.lower() == needle:
                return a
            if a.original_file_name.lower() == needle:
                return a
            if a.original_path.lower() == text.lower():
                return a
        return None

    def invalidate(self, post=None) -> None:
        if post is None:
            self._asset_cache.clear()
        else:
            self._asset_cache.pop(post.name, None)


def asset_to_dict(asset: Asset) -> dict:
    """Shape an Asset the way `model.build_entry` expects."""
    return {
        "asset_id": asset.id,
        "original_path": asset.original_path,
        "original_file_name": asset.original_file_name,
        "file_created_at": asset.file_created_at,
        "local_date_time": asset.local_date_time,
        "width": asset.width,
        "height": asset.height,
        "latitude": asset.latitude,
        "longitude": asset.longitude,
        "file_size": asset.file_size,
    }
