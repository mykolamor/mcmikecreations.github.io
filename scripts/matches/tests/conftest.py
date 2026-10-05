"""Shared fixtures and builders: synthetic images, a stub Immich, fake
terrain, and a throwaway posts/places/static/reports tree.

Random noise survives neither downscaling nor SIFT well, so the synthetic
images are built from drawn shapes: strong corners for SIFT, stable
low-frequency structure for pHash.
"""

import dataclasses
import io
import random
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

from matches import config
from matches.immich import Asset
from matches.review.remote import Remote
from matches.terrain import Terrain

BLUR = "data:image/webp;base64,ZZ"
WEB = "/images/projects/data-viz/hikes/stories/demo/"
# The site's image folders, under the static root.
IMAGES_SUBDIR = "images/projects/data-viz/hikes"
BASE = "https://immich.example"


def synthetic_image(seed: int, size: tuple[int, int] = (1200, 900)) -> Image.Image:
    rng = random.Random(seed)
    img = Image.new("RGB", size, (240, 240, 235))
    d = ImageDraw.Draw(img)
    for _ in range(120):
        x0 = rng.randint(0, size[0] - 1)
        y0 = rng.randint(0, size[1] - 1)
        x1 = x0 + rng.randint(20, 260)
        y1 = y0 + rng.randint(20, 260)
        color = (rng.randint(0, 255), rng.randint(0, 255), rng.randint(0, 255))
        if rng.random() < 0.5:
            d.rectangle([x0, y0, x1, y1], fill=color)
        else:
            d.ellipse([x0, y0, x1, y1], fill=color)
    return img


def recompress(img: Image.Image, scale: float = 0.5, quality: int = 60) -> Image.Image:
    """Approximate the web pipeline: downscale then lossy re-encode."""
    w = max(1, int(img.width * scale))
    h = max(1, int(img.height * scale))
    small = img.resize((w, h), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    small.save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


@pytest.fixture
def scene_a() -> Image.Image:
    return synthetic_image(1)


@pytest.fixture
def scene_b() -> Image.Image:
    return synthetic_image(2)


# --- Immich ---------------------------------------------------------------------

ASSET = Asset(
    id="953e18b3-3d1e-4e21-9e31-1f64a6015c14",
    original_path="/originals/IMG_1234.jpg",
    original_file_name="IMG_1234.jpg",
    file_created_at="2024-08-31T00:00:00Z",
    local_date_time="2024-08-31T00:00:00",
    width=100, height=100, latitude=None, longitude=None,
)


def make_asset(**overrides) -> Asset:
    """ASSET with some fields changed."""
    return dataclasses.replace(ASSET, **overrides)


class StubSession:
    """Records calls and replays canned responses."""

    def __init__(self, pages):
        self.pages = list(pages)
        self.posted = []
        self.urls = []
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
        self.urls.append(url)
        self.posted.append(json)
        return self._R(self.pages.pop(0))


def make_remote() -> Remote:
    """A Remote with credentials set, for a test to give a fake client."""
    return Remote(config.Settings(api_key="k", immich_url=BASE))


@pytest.fixture
def remote(monkeypatch):
    """A Remote whose candidates for any post are just ASSET."""
    r = make_remote()
    monkeypatch.setattr(r, "candidates_for", lambda post: [ASSET])
    return r


# --- terrain and reports ----------------------------------------------------------

class FakeTerrain(Terrain):
    """Height = 1000 + lat, None south of 40°; no DEM tiles involved."""

    def __init__(self):
        super().__init__(Path("/nonexistent"))

    def height(self, lat, lon):
        return None if lat < 40 else round(1000 + lat, 1)


def report_entry(name: str, match: dict | None, status: str = "matched") -> dict:
    """A minimal report entry for the demo post's story image `name`."""
    return {"web_path": WEB + name, "status": status, "match": match}


# --- a hike tree on disk ------------------------------------------------------------

def hike_tree(tmp_path: Path, posts: dict | None = None, places: dict | None = None,
              story_files: dict | None = None, **settings) -> SimpleNamespace:
    """`markdown/` (posts: name -> text), `places/` beside it (places: name ->
    text), `static/` (story_files: path under IMAGES_SUBDIR -> bytes) and an
    empty `out/` for reports under `tmp_path`, plus Settings for them. `settings` overrides the Settings fields; Immich is off by default."""
    root = Path(tmp_path)
    tree = SimpleNamespace(root=root, posts=root / "markdown", places=root / "places",
                           static=root / "static", out=root / "out")
    tree.images = tree.static / IMAGES_SUBDIR
    tree.posts.mkdir()
    tree.out.mkdir()
    for name, text in (posts or {}).items():
        (tree.posts / name).write_text(text, encoding="utf-8")
    if places:
        tree.places.mkdir()
        for name, text in places.items():
            (tree.places / name).write_text(text, encoding="utf-8")
    for rel, data in (story_files or {}).items():
        path = tree.images / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    tree.settings = config.Settings(**{
        "posts_dir": tree.posts, "static_root": tree.static, "out_dir": tree.out,
        "api_key": "", "immich_url": "", **settings,
    })
    return tree


def app_state(tree: SimpleNamespace, monkeypatch):
    """The web app's state over `tree`, never touching the developer's real
    remembered-key file."""
    from matches.web import state as web_state

    monkeypatch.setattr(web_state, "CONFIG_PATH", tree.root / "cfg.json")
    return web_state.AppState(tree.settings)
