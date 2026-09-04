"""Immich API client (v3.0.1) with an on-disk image cache.

v3 note: `GET /api/albums/{id}` does not return assets even with
`?withoutAssets=false`. Album contents come from `POST /api/search/metadata`
with `albumIds`.
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import requests
from PIL import Image

from . import config


@dataclass(frozen=True)
class Album:
    id: str
    name: str
    asset_count: int


@dataclass
class Asset:
    id: str
    original_path: str
    original_file_name: str
    file_created_at: str
    local_date_time: str
    width: int
    height: int
    latitude: float | None
    longitude: float | None
    file_size: int = 0

    @property
    def aspect(self) -> float:
        if self.width <= 0 or self.height <= 0:
            return 0.0
        return max(self.width, self.height) / min(self.width, self.height)

    @classmethod
    def from_json(cls, raw: dict) -> "Asset":
        exif = raw.get("exifInfo") or {}
        return cls(
            id=raw["id"],
            original_path=raw.get("originalPath", ""),
            original_file_name=raw.get("originalFileName", ""),
            file_created_at=raw.get("fileCreatedAt", ""),
            local_date_time=raw.get("localDateTime", ""),
            width=int(raw.get("width") or 0),
            height=int(raw.get("height") or 0),
            latitude=exif.get("latitude"),
            longitude=exif.get("longitude"),
            file_size=int(exif.get("fileSizeInByte") or 0),
        )


class ImmichClient:
    """Talks to Immich and caches every fetched image on disk."""

    def __init__(self, settings: config.Settings, session=None):
        if not settings.immich_url:
            raise ValueError(
                f"No Immich URL. Set {config.IMMICH_URL_ENV} or pass --immich-url."
            )
        if not settings.api_key:
            raise ValueError(
                f"No Immich API key. Set {config.API_KEY_ENV} or pass --api-key."
            )
        self.settings = settings
        self.base = settings.immich_url.rstrip("/")
        self.session = session or requests.Session()
        self.session.headers.update({"x-api-key": settings.api_key})

    # --- metadata -----------------------------------------------------------

    def list_albums(self) -> list[Album]:
        r = self.session.get(f"{self.base}/api/albums", timeout=self.settings.timeout)
        r.raise_for_status()
        return [
            Album(id=a["id"], name=a["albumName"], asset_count=a.get("assetCount", 0))
            for a in r.json()
        ]

    def get_asset(self, asset_id: str) -> Asset:
        r = self.session.get(f"{self.base}/api/assets/{asset_id}", timeout=self.settings.timeout)
        r.raise_for_status()
        return Asset.from_json(r.json())

    def search_assets(
        self,
        album_ids: list[str] | None = None,
        taken_after: datetime | None = None,
        taken_before: datetime | None = None,
    ) -> list[Asset]:
        """All IMAGE assets matching the filters, following pagination."""
        assets: list[Asset] = []
        page = 1
        while True:
            body: dict = {
                "size": config.SEARCH_PAGE_SIZE,
                "page": page,
                "withExif": True,
                "type": "IMAGE",
            }
            if album_ids:
                body["albumIds"] = list(album_ids)
            if taken_after:
                body["takenAfter"] = _iso(taken_after)
            if taken_before:
                body["takenBefore"] = _iso(taken_before)

            r = self.session.post(
                f"{self.base}/api/search/metadata",
                json=body,
                timeout=self.settings.timeout,
            )
            r.raise_for_status()
            block = r.json()["assets"]
            assets.extend(Asset.from_json(i) for i in block.get("items", []))
            nxt = block.get("nextPage")
            if not nxt:
                return assets
            page = int(nxt)

    # --- images -------------------------------------------------------------

    def thumbnail(self, asset_id: str) -> Path:
        return self._fetch_image(asset_id, "thumbnail", ".webp")

    def preview(self, asset_id: str) -> Path:
        return self._fetch_image(asset_id, "preview", ".jpg")

    def original(self, asset_id: str, original_file_name: str) -> Path:
        """Full-resolution original, cached by asset id.

        Unlike thumbnail/preview, the original is served in its native
        format (HEIC, JPEG, ...), so the cache file's extension is taken
        from the source filename rather than fixed.
        """
        suffix = Path(original_file_name).suffix.lower() or ".bin"
        directory = self.settings.cache_dir / "original"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{asset_id}{suffix}"
        if self.settings.use_cache and path.is_file() and path.stat().st_size > 0:
            return path
        r = self.session.get(
            f"{self.base}/api/assets/{asset_id}/original",
            timeout=self.settings.timeout,
        )
        r.raise_for_status()
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(r.content)
        tmp.replace(path)
        return path

    def _fetch_image(self, asset_id: str, size: str, suffix: str) -> Path:
        directory = self.settings.cache_dir / size
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{asset_id}{suffix}"
        if self.settings.use_cache and path.is_file() and path.stat().st_size > 0:
            return path
        r = self.session.get(
            f"{self.base}/api/assets/{asset_id}/thumbnail?size={size}",
            timeout=self.settings.timeout,
        )
        r.raise_for_status()
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(r.content)
        tmp.replace(path)
        return path

    def prefetch(self, asset_ids: list[str], kind: str = "thumbnail") -> None:
        """Download many images concurrently; the cache makes this idempotent."""
        fetch = self.thumbnail if kind == "thumbnail" else self.preview
        if not asset_ids:
            return
        with ThreadPoolExecutor(max_workers=self.settings.workers) as pool:
            list(pool.map(fetch, asset_ids))

    @staticmethod
    def open_image(path: Path) -> Image.Image:
        img = Image.open(path)
        img.load()
        return img


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
