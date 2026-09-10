"""JSON endpoints. Each returns (status, payload) and raises ApiError to fail."""

import mimetypes
from pathlib import Path

from .. import config
from ..review import actions
from ..review.model import site_url_for, status_color
from ..review.remote import RemoteUnavailable, asset_to_dict


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _post(state, name: str):
    try:
        return state.post(name)
    except KeyError:
        raise ApiError(f"No such post: {name}", 404)


def _entry(post, web_path: str) -> dict:
    for e in (post.report or {}).get("entries", []):
        if e["web_path"] == web_path:
            return e
    raise ApiError(f"No entry for {web_path}", 404)


# --- reads ------------------------------------------------------------------

def list_hikes(state) -> dict:
    return {"hikes": [
        {
            "name": p.name,
            "slug": p.slug,
            "stats": p.stats,
            "counts": p.counts,
            "has_report": p.report is not None,
        }
        for p in state.posts()
    ]}


def _on_disk(local_path: Path | None) -> Path | None:
    """The file to show/serve for `local_path`: itself if present, else the
    largest AVIF tier `image_optimize.py` generated in its place - it deletes
    the original once conversion succeeds (see `optimize.optimize_post`)."""
    if local_path is None:
        return None
    if local_path.is_file():
        return local_path
    for target in sorted(config.AVIF_TIERS, reverse=True):
        candidate = local_path.with_name(f"{local_path.stem}-{target}.avif")
        if candidate.is_file():
            return candidate
    return None


def _media_row(m) -> dict:
    local_path = Path(m.local_path) if m.local_path else None
    on_disk = _on_disk(local_path)
    return {
        "order": m.order,
        "label": m.label,
        "web_path": m.web_path,
        "kind": m.kind,
        "status": m.status,
        "color": status_color(m.status),
        "matched_name": m.matched_name,
        "has_local": on_disk is not None,
        "local_size": on_disk.stat().st_size if on_disk else None,
        "match": (m.entry or {}).get("match"),
        "confidence": (m.entry or {}).get("confidence"),
        "resolved_by": (m.entry or {}).get("resolved_by"),
        "alternatives": (m.entry or {}).get("alternatives", []),
        "in_report": m.entry is not None,
    }


def hike_detail(state, name: str) -> dict:
    post = _post(state, name).load()
    report = post.report or {}
    return {
        "name": post.name,
        "slug": post.slug,
        "stats": post.stats,
        "counts": post.counts,
        "site_url": site_url_for(post.name, state.settings.site_url),
        "album": report.get("album"),
        "date_window": report.get("date_window"),
        "candidate_count": report.get("candidate_count", 0),
        "media": [_media_row(m) for m in post.media],
    }


def candidate_assets(state, name: str) -> dict:
    post = _post(state, name)
    try:
        assets = state.remote.candidates_for(post)
    except RemoteUnavailable as exc:
        raise ApiError(str(exc), 409)
    return {"assets": [
        {
            "id": a.id,
            "name": a.original_file_name,
            "taken": a.local_date_time[:19].replace("T", " "),
            "size": f"{a.width}x{a.height}",
        }
        for a in assets
    ]}


# --- file bytes -------------------------------------------------------------

def local_file(state, web_path: str) -> tuple[bytes, str]:
    """Serve a file under static_root, refusing anything that escapes it."""
    root = state.settings.static_root.resolve()
    target = (root / web_path.lstrip("/")).resolve()
    if not target.is_relative_to(root):
        raise ApiError("Path escapes the static root", 403)
    on_disk = _on_disk(target)
    if on_disk is None:
        raise ApiError(f"Not found: {web_path}", 404)
    ctype = mimetypes.guess_type(on_disk.name)[0] or "application/octet-stream"
    return on_disk.read_bytes(), ctype


def preview_file(state, asset_id: str) -> tuple[bytes, str]:
    try:
        path = state.remote.preview_path(asset_id)
    except RemoteUnavailable as exc:
        raise ApiError(str(exc), 409)
    return Path(path).read_bytes(), "image/jpeg"


# --- writes -----------------------------------------------------------------

def set_local_path(state, body: dict) -> dict:
    post = _post(state, body["post"])
    entry = _entry(post, body["web_path"])
    new = (body.get("value") or "").strip()
    if not new:
        raise ApiError("Local path cannot be empty")
    web = new if new.startswith("/") else f"/{new}"
    local = state.settings.static_root / web.lstrip("/")
    entry["web_path"] = web
    entry["local_path"] = str(local)
    if not local.is_file():
        entry["status"] = "missing_local"
    elif entry["status"] == "missing_local":
        entry["status"] = "matched" if entry.get("match") else "unmatched"
    post.recount()
    post.save()
    return {"ok": True, "web_path": web, "detail": hike_detail(state, post.name)}


def set_remote_match(state, body: dict) -> dict:
    post = _post(state, body["post"])
    entry = _entry(post, body["web_path"])
    text = (body.get("value") or "").strip()

    if not text:
        entry["match"] = None
        entry["status"] = "unmatched"
        entry["confidence"] = None
        entry["resolved_by"] = None
    else:
        try:
            asset = state.remote.find_asset(post, text)
        except RemoteUnavailable as exc:
            raise ApiError(str(exc), 409)
        if asset is None:
            raise ApiError(f"No asset named {text!r} among this hike's candidates", 404)
        match = asset_to_dict(asset)
        match["scores"] = {"phash": None, "blockmean": None, "mae": None,
                           "ncc": None, "inliers": None, "coverage": None}
        entry["match"] = match
        entry["status"] = "matched"
        entry["confidence"] = "manual"
        entry["resolved_by"] = "manual"
    post.recount()
    post.save()
    return {"ok": True, "detail": hike_detail(state, post.name)}


def suggest_out_name(state, body: dict) -> dict:
    """Suggest `<capture-date>-<NN>.jpg`, following this hike's existing naming."""
    post = _post(state, body["post"])
    text = (body.get("asset") or "").strip()
    if not text:
        raise ApiError("No asset given")
    try:
        asset = state.remote.find_asset(post, text)
    except RemoteUnavailable as exc:
        raise ApiError(str(exc), 409)
    if asset is None:
        raise ApiError(f"No asset named {text!r} among this hike's candidates", 404)
    date = (asset.local_date_time or asset.file_created_at or "")[:10]
    if not date:
        raise ApiError("Asset has no capture date")
    return {"name": actions.next_out_name(state.settings, post.slug, date)}


def start_add(state, jobs, body: dict) -> dict:
    post = _post(state, body["post"])
    spec = actions.AddSpec(
        mode=body.get("mode", ""),
        local_path=Path(body["local_path"]) if body.get("local_path") else None,
        asset_id=body.get("asset_id") or None,
        asset_name=body.get("asset_name", ""),
        out_name=body.get("out_name", ""),
    )
    problem = actions.validate(spec)
    if problem:
        raise ApiError(problem)

    def run():
        entry = actions.apply_add_spec(state.settings, state.remote, post, spec)
        with state.lock:
            post.upsert_entry(entry)
            post.save()
            post.load()
        return {"web_path": entry["web_path"], "status": entry["status"]}

    return {"job": jobs.payload(jobs.start(f"add:{spec.mode}", run))}


def start_rerun(state, jobs, body: dict) -> dict:
    post = _post(state, body["post"])
    if not (state.settings.api_key and state.settings.immich_url):
        raise ApiError("Set the Immich URL and API key first", 409)

    def run():
        output = actions.rerun_match(state.settings, post.name)
        with state.lock:
            state.remote.invalidate(post)
            post.load()
        return {"output": output}

    return {"job": jobs.payload(jobs.start(f"rerun:{post.name}", run))}


def get_settings(state) -> dict:
    return state.settings_payload()


def put_settings(state, body: dict) -> dict:
    """An empty key box with `keep` means only the other fields changed."""
    key = (body.get("api_key") or "").strip()
    if not key and body.get("keep"):
        key = state.settings.api_key
    url = (body.get("immich_url") or "").strip() or state.settings.immich_url
    state.set_credentials(key, url, bool(body.get("remember")))
    return state.settings_payload()


def check_connection(state) -> dict:
    """Verify the current key actually works."""
    if not state.settings.immich_url:
        raise ApiError("No Immich URL set", 409)
    if not state.settings.api_key:
        raise ApiError("No API key set", 409)
    try:
        albums = state.remote.albums()
    except Exception as exc:
        raise ApiError(f"{exc}", 502)
    return {"ok": True, "albums": len(albums)}
