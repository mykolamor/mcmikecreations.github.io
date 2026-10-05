"""Shared server state: settings, the hike index, and the Immich connection.

The API key can be supplied by environment, by flag, or typed into the app at
runtime. It is never sent back to the browser - only whether one is set.
"""

import json
import os
import threading
from pathlib import Path

from .. import config
from ..review.model import HikeIndex, HikePost
from ..review.remote import Remote

CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
CONFIG_PATH = CONFIG_DIR / "hike-image-match" / "config.json"


def load_saved() -> dict:
    """Credentials remembered on this machine, if any."""
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def save_credentials(api_key: str, immich_url: str) -> Path:
    """Remember credentials outside the repository, readable only by this user."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        json.dumps({"api_key": api_key, "immich_url": immich_url}, indent=2),
        encoding="utf-8")
    CONFIG_PATH.chmod(0o600)
    return CONFIG_PATH


def forget_credentials() -> None:
    CONFIG_PATH.unlink(missing_ok=True)


class AppState:
    """Everything the request handlers need, guarded by one lock."""

    def __init__(self, settings: config.Settings):
        self.settings = settings
        self.lock = threading.RLock()
        self.index = HikeIndex(settings)
        self.remote = Remote(settings)
        self._posts: dict[str, HikePost] = {}
        saved = load_saved()
        # The environment wins; the remembered file only fills the gaps.
        if not self.settings.api_key:
            self.settings.api_key = saved.get("api_key", "")
        if not self.settings.immich_url:
            self.settings.immich_url = saved.get("immich_url", "")
        self.refresh()

    # --- hikes --------------------------------------------------------------

    def refresh(self) -> list[HikePost]:
        with self.lock:
            posts = self.index.refresh()
            self._posts = {p.name: p for p in posts}
            return posts

    def posts(self) -> list[HikePost]:
        with self.lock:
            return list(self._posts.values())

    def post(self, name: str) -> HikePost:
        with self.lock:
            post = self._posts.get(name)
            if post is None:
                raise KeyError(name)
            return post

    # --- credentials --------------------------------------------------------

    def set_credentials(self, api_key: str, immich_url: str,
                        remember: bool) -> None:
        with self.lock:
            self.settings.api_key = api_key or ""
            self.settings.immich_url = (immich_url or "").strip().rstrip("/")
            # A fresh client, and drop anything fetched with the old settings.
            self.remote = Remote(self.settings)
            if remember and (api_key or immich_url):
                save_credentials(self.settings.api_key, self.settings.immich_url)
            elif not remember:
                forget_credentials()

    def settings_payload(self) -> dict:
        """Never includes the key itself."""
        key = self.settings.api_key
        return {
            "immich_url": self.settings.immich_url,
            "has_key": bool(key),
            "has_url": bool(self.settings.immich_url),
            "key_hint": f"...{key[-4:]}" if key else "",
            "key_remembered": bool(load_saved()),
            "posts_dir": str(self.settings.posts_dir),
            "places_dir": str(self.settings.places_root),
            "static_root": str(self.settings.static_root),
            "out_dir": str(self.settings.out_dir),
            "config_path": str(CONFIG_PATH),
        }
