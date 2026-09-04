"""Tunable constants and resolved settings for image matching.

Every magic number in this package lives here. Each has a CLI override in
`matches.cli`; nothing else in the package should hardcode a threshold.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path

# --- Immich -----------------------------------------------------------------
# Both the instance address and its key come from the environment (or the CLI,
# or the web app's Settings dialog). Neither is baked into this file, because
# this file is committed.
IMMICH_URL_ENV = "IMMICH_URL"
API_KEY_ENV = "IMMICH_API_KEY"
DEFAULT_TIMEOUT = 120
DEFAULT_WORKERS = 8
SEARCH_PAGE_SIZE = 1000

# --- Repository layout ------------------------------------------------------
POSTS_SUBDIR = "static/_projects/data-viz/hikes/markdown"
STATIC_SUBDIR = "static"
OUT_SUBDIR = "scripts/matches/hikes"
CACHE_DIRNAME = ".image-match-cache"

# --- Deployed site ----------------------------------------------------------
# Posts are published at <site>/hikes/<markdown stem>/. The stem doubles as the
# post's anchor on the site, so no extra mapping is needed.
DEFAULT_SITE_URL = "https://mykolamor.com"
SITE_HIKE_PATH = "/hikes"

# --- Candidate selection ----------------------------------------------------
# Window spans min..max of the capture dates encoded in the web filenames,
# widened by this many days on each side.
DEFAULT_DATE_WINDOW_DAYS = 3
# Relative aspect-ratio difference tolerated between query and candidate.
DEFAULT_AR_TOLERANCE = 0.06
# Minimum slug-token coverage to trust a guessed album.
DEFAULT_ALBUM_COVERAGE_MIN = 0.5
# Once an album is resolved, membership of it is stronger evidence than a
# timestamp. Cameras with an unset clock stamp a factory default (2000-01-01
# here) and whole imports can carry the wrong month, which a date window then
# silently discards - one album in this library has 148 of 339 assets stamped
# three months late. So the window narrows the search only when no album is
# known; with an album it is skipped entirely.
DEFAULT_TRUST_ALBUM = True

# --- Stage 2: thumbnail signatures ------------------------------------------
PHASH_SIZE = 8            # kept DCT coefficients per axis
PHASH_FACTOR = 4          # image is resized to PHASH_SIZE * PHASH_FACTOR
BLOCK_MEAN_GRID = 8       # NxN RGB grid
DEFAULT_PHASH_TOP_K = 15
# True matches measured 0.0009-0.0016; best impostor 0.0054.
DEFAULT_BM_ACCEPT = 0.004
DEFAULT_BM_MARGIN = 3.0

# --- Stage 3: aligned residual ----------------------------------------------
DEFAULT_RESIDUAL_TOP_K = 5
DEFAULT_SIFT_MAX_EDGE = 1000
SIFT_FEATURES = 2000
SIFT_RATIO = 0.75
RANSAC_REPROJ_THRESHOLD = 3.0
MIN_GOOD_MATCHES = 8
# Resolved against cv2 in `signatures`, so this module stays import-free.
# MAGSAC++ is better conditioned than vanilla RANSAC at no extra cost.
RANSAC_METHOD_NAME = "USAC_MAGSAC"
# Gaussian sigma applied to both images before the residual is measured.
# Web copies are downscaled far more aggressively than the originals (765x1020
# against 6120x8160 in one measured case), so the high-frequency band carries
# only resampling and compression difference. Discarding it fixed a false
# negative (12.05 -> 1.44 MAE) and *widened* burst-sibling separation from
# 1.58x to 2.64x. Set to 0 to compare at full detail.
DEFAULT_RESIDUAL_BLUR = 3.0
# Calibrated over 95 queries across 6 posts with DEFAULT_RESIDUAL_BLUR applied.
# True matches then span 0.11-1.44 MAE and the one genuine absence in that
# sample scores 50.63 - a 35x gap with nothing in between. This sits ~1.7x
# above the worst true match and ~20x below the rejection. The margin below
# still does the fine discrimination; this is the absolute ceiling.
DEFAULT_MAE_ACCEPT = 2.5
DEFAULT_MAE_MARGIN = 1.5

# --- Media classification ---------------------------------------------------
VIDEO_EXTENSIONS = frozenset({".mp4", ".mov", ".webm", ".m4v"})
IMAGE_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"})
# Embedded with image syntax - ![alt](https://www.youtube.com/watch?v=...) - so
# they are references like any other, but they have no local file and nothing
# to match against Immich. They get their own kind and status rather than being
# lumped in with local videos.
YOUTUBE_HOSTS = ("youtube.com", "youtu.be")

# --- AVIF/LQIP generation ---------------------------------------------------
# Target long edge (larger of width/height) per tier, not target width — a
# portrait photo scales by height, not width. See scripts/image_optimize.py.
AVIF_TIERS = (640, 1280, 2560)
DEFAULT_AVIF_QUALITY = 50
DEFAULT_LQIP_LONG_EDGE = 24
DEFAULT_LQIP_QUALITY = 50


def repo_root() -> Path:
    """Repository root, derived from this file's location."""
    return Path(__file__).resolve().parents[2]


@dataclass
class Settings:
    """Fully resolved runtime configuration."""

    immich_url: str = field(
        default_factory=lambda: os.environ.get(IMMICH_URL_ENV, ""))
    site_url: str = DEFAULT_SITE_URL
    api_key: str = field(default_factory=lambda: os.environ.get(API_KEY_ENV, ""))
    posts_dir: Path = field(default_factory=lambda: repo_root() / POSTS_SUBDIR)
    static_root: Path = field(default_factory=lambda: repo_root() / STATIC_SUBDIR)
    out_dir: Path = field(default_factory=lambda: repo_root() / OUT_SUBDIR)
    cache_dir: Path | None = None
    use_cache: bool = True
    date_window_days: int = DEFAULT_DATE_WINDOW_DAYS
    ar_tolerance: float = DEFAULT_AR_TOLERANCE
    phash_top_k: int = DEFAULT_PHASH_TOP_K
    bm_accept: float = DEFAULT_BM_ACCEPT
    bm_margin: float = DEFAULT_BM_MARGIN
    residual_top_k: int = DEFAULT_RESIDUAL_TOP_K
    mae_accept: float = DEFAULT_MAE_ACCEPT
    mae_margin: float = DEFAULT_MAE_MARGIN
    sift_max_edge: int = DEFAULT_SIFT_MAX_EDGE
    residual_blur: float = DEFAULT_RESIDUAL_BLUR
    album_coverage_min: float = DEFAULT_ALBUM_COVERAGE_MIN
    trust_album: bool = DEFAULT_TRUST_ALBUM
    workers: int = DEFAULT_WORKERS
    timeout: int = DEFAULT_TIMEOUT
    avif_quality: int = DEFAULT_AVIF_QUALITY
    lqip_long_edge: int = DEFAULT_LQIP_LONG_EDGE
    lqip_quality: int = DEFAULT_LQIP_QUALITY
    force: bool = False
    verbose: bool = False

    def __post_init__(self) -> None:
        self.posts_dir = Path(self.posts_dir).resolve()
        self.static_root = Path(self.static_root).resolve()
        self.out_dir = Path(self.out_dir).resolve()
        if self.cache_dir is None:
            self.cache_dir = self.out_dir / CACHE_DIRNAME
        self.cache_dir = Path(self.cache_dir).resolve()
