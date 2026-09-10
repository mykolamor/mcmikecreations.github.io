"""The slow operations the GUI triggers.

Every function here is called on a worker thread and must not touch widgets.
"""

import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from .. import config
from ..markdown import MediaRef, parse_capture_date
from ..matcher import match_image
from ..optimize import encode_avif_tiers, encode_lqip_data_uri, open_exif_corrected
from ..postwriter import upsert_image_front_matter
from .model import build_entry, web_path_for
from .remote import asset_to_dict

# What the caller wants done. Front ends only collect this; the work happens
# here, off whatever thread the interface runs on.
MODE_LOCAL = "local"      # have the local file, find its Immich original
MODE_REMOTE = "remote"    # have the Immich original, make the local web copy
MODE_BOTH = "both"        # have both, just record the mapping
MODES = (MODE_LOCAL, MODE_REMOTE, MODE_BOTH)


@dataclass
class AddSpec:
    mode: str
    local_path: Path | None = None
    asset_id: str | None = None
    asset_name: str = ""
    out_name: str = ""      # filename to write for MODE_REMOTE


def validate(spec: "AddSpec") -> str:
    """Empty string when the spec is usable, else the reason it is not."""
    if spec.mode not in MODES:
        return f"Unknown mode: {spec.mode}"
    if spec.mode in (MODE_LOCAL, MODE_BOTH):
        if not spec.local_path:
            return "Choose a local image."
        if not Path(spec.local_path).is_file():
            return f"No such file: {spec.local_path}"
    if spec.mode in (MODE_REMOTE, MODE_BOTH) and not (spec.asset_id or spec.asset_name):
        return "Choose an Immich asset."
    if spec.mode == MODE_REMOTE and not spec.out_name:
        return "Give the converted file a name."
    return ""


def stories_dir(settings: config.Settings, slug: str) -> Path:
    return settings.static_root / "images/projects/data-viz/hikes/stories" / slug


_AVIF_TIER_SUFFIX = "|".join(str(t) for t in config.AVIF_TIERS)
# `<NN>.ext` for a plain file, or `<NN>-<tier>.avif` for one of
# optimize.py's tiers - it deletes the original once those are written, so
# that's the only trace of the index left on disk (see optimize.optimize_post
# and review.actions.download_and_optimize).
_INDEX_RE = re.compile(rf"^(\d+)(?:-(?:{_AVIF_TIER_SUFFIX})\.avif|\.[^.]+)$")


def next_out_name(settings: config.Settings, slug: str, date: str,
                  ext: str = ".jpg") -> str:
    """Suggest `<date>-<NN><ext>`, one past the highest index already on disk

    for that date in the hike's folder - the naming convention every existing
    story image already follows.
    """
    prefix = f"{date}-"
    next_index = 0
    folder = stories_dir(settings, slug)
    if folder.is_dir():
        for f in folder.iterdir():
            if not f.name.startswith(prefix):
                continue
            m = _INDEX_RE.match(f.name[len(prefix):])
            if m:
                next_index = max(next_index, int(m.group(1)) + 1)
    return f"{prefix}{next_index:02d}{ext}"


def match_single(settings, remote, post, local_path: Path) -> dict:
    """Run the cascade for one local image and return a report entry."""
    assets = remote.candidates_for(post)
    slug = post.slug
    web = web_path_for(slug, local_path.name)
    ref = MediaRef(
        index=-1, web_path=web, local_path=local_path, kind="image",
        capture_date=parse_capture_date(local_path.name), exists=True,
    )
    query = Image.open(local_path)
    query.load()
    decision = match_image(query, ref, assets, remote.client, settings)

    asset = None
    if decision.best is not None:
        asset = asset_to_dict(decision.best.asset)
        r = decision.best.residual
        asset["scores"] = {
            "phash": decision.best.phash_distance,
            "blockmean": round(decision.best.bm_distance, 6),
            "mae": round(r.mae, 4) if r else None,
            "ncc": round(r.ncc, 6) if r else None,
            "inliers": r.inliers if r else None,
            "coverage": round(r.coverage, 4) if r else None,
        }
    return build_entry(web, local_path, asset, decision.status,
                       decision.resolved_by, decision.confidence)


def download_and_optimize(settings, remote, post, asset_id: str,
                          out_name: str) -> tuple[Path, dict]:
    """Fetch an original and convert it straight to AVIF tiers + an LQIP
    blur placeholder in the hike's folder - the same pipeline
    `image_optimize.py` runs after a match, but for one freshly added image.
    Updates the post's front matter and returns the report entry. No
    original-resolution file is written to the folder, matching what
    `optimize.optimize_post` leaves behind for every other matched image.
    """
    target_dir = stories_dir(settings, post.slug)
    target_dir.mkdir(parents=True, exist_ok=True)
    out_path = target_dir / out_name

    asset = next((a for a in remote.candidates_for(post) if a.id == asset_id), None)
    data = remote.original_bytes(asset_id)
    suffix = Path(asset.original_file_name).suffix if asset else ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)
    try:
        img = open_exif_corrected(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)

    out_base = out_path.with_suffix("")
    tiers = encode_avif_tiers(img, out_base, config.AVIF_TIERS, settings.avif_quality)
    if tiers:
        blur = encode_lqip_data_uri(img, settings.lqip_long_edge, settings.lqip_quality)
        meta = {"w": img.width, "h": img.height, "blur": blur}
    else:
        # Smaller than the smallest tier: record dims only, same as an
        # unmatched image (see optimize.optimize_post).
        meta = {"w": img.width, "h": img.height}
    upsert_image_front_matter(post.path, out_path.name, meta)

    entry = build_entry(
        web_path_for(post.slug, out_path.name), out_path,
        asset_to_dict(asset) if asset else None,
        "matched" if asset else "unmatched", "manual", "manual",
    )
    return out_path, entry


def apply_add_spec(settings, remote, post, spec: AddSpec) -> dict:
    """Execute an AddSpec and return the entry to store."""
    if spec.mode == MODE_LOCAL:
        return match_single(settings, remote, post, spec.local_path)

    if spec.mode == MODE_REMOTE:
        asset = remote.find_asset(post, spec.asset_id or spec.asset_name)
        if asset is None:
            raise ValueError(
                f"No Immich asset found for {spec.asset_id or spec.asset_name!r}"
            )
        _, entry = download_and_optimize(
            settings, remote, post, asset.id, spec.out_name
        )
        return entry

    if spec.mode == MODE_BOTH:
        asset = remote.find_asset(post, spec.asset_id or spec.asset_name)
        return build_entry(
            web_path_for(post.slug, spec.local_path.name), spec.local_path,
            asset_to_dict(asset) if asset else None,
            "matched" if asset else "unmatched", "manual", "manual",
        )
    raise ValueError(f"Unknown mode: {spec.mode}")


def settings_to_argv(settings: config.Settings) -> list[str]:
    """CLI flags reproducing these settings, so a subprocess inherits them.

    Without this the child would silently fall back to defaults and write to
    the wrong directory whenever the caller overrode anything.
    """
    argv = [
        "--immich-url", settings.immich_url,
        "--site-url", settings.site_url,
        "--posts-dir", str(settings.posts_dir),
        "--static-root", str(settings.static_root),
        "--out-dir", str(settings.out_dir),
        "--cache-dir", str(settings.cache_dir),
        "--date-window-days", str(settings.date_window_days),
        "--ar-tolerance", str(settings.ar_tolerance),
        "--phash-top-k", str(settings.phash_top_k),
        "--bm-accept", str(settings.bm_accept),
        "--bm-margin", str(settings.bm_margin),
        "--residual-top-k", str(settings.residual_top_k),
        "--mae-accept", str(settings.mae_accept),
        "--mae-margin", str(settings.mae_margin),
        "--sift-max-edge", str(settings.sift_max_edge),
        "--residual-blur", str(settings.residual_blur),
        "--album-coverage-min", str(settings.album_coverage_min),
        "--workers", str(settings.workers),
        "--timeout", str(settings.timeout),
    ]
    if not settings.use_cache:
        argv.append("--no-cache")
    if not settings.trust_album:
        argv.append("--no-trust-album")
    return argv


def rerun_match(settings: config.Settings, post_name: str) -> str:
    """Re-run image_match.py for one post as a subprocess, returning its output."""
    script = Path(__file__).resolve().parents[2] / "image_match.py"
    cmd = [sys.executable, str(script), post_name, "--force",
           *settings_to_argv(settings)]
    env = dict(os.environ)
    if settings.api_key:
        # The key may have been entered at runtime rather than exported.
        env[config.API_KEY_ENV] = settings.api_key
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          cwd=str(script.parent), env=env)
    output = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        raise RuntimeError(output.strip() or f"exit code {proc.returncode}")
    return output.strip()
