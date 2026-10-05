"""JSON endpoints. Each returns (status, payload) and raises ApiError to fail."""

import mimetypes
from contextlib import contextmanager
from pathlib import Path

from ..backfill_time import refresh_post
from .. import placedoc
from ..markdown import on_disk
from ..review import actions
from ..review.model import match_from_asset, site_url_for, status_color
from ..review.remote import RemoteUnavailable


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _post(state, name: str):
    """The post, freshly re-read from disk.

    A CLI run (`image_match.py --force`) can rewrite a post's report while
    this server keeps running - reloading here means every handler acts on
    what's actually on disk, not a snapshot cached since server startup or
    the last refresh.
    """
    try:
        post = state.post(name)
    except KeyError:
        raise ApiError(f"No such post: {name}", 404)
    return post.load()


def _save(state, post) -> None:
    """Write the post's report, then bring its front matter's `taken` (and
    track locations) up to date with the matches in it."""
    post.save()
    refresh_post(post.path, state.settings)


@contextmanager
def _remote():
    """Answer a missing or unreachable Immich with a 409, for the UI to show."""
    try:
        yield
    except RemoteUnavailable as exc:
        raise ApiError(str(exc), 409)


def _find_asset(state, post, text: str):
    """The asset `text` names among the post's candidates, else a 404."""
    with _remote():
        asset = state.remote.find_asset(post, text)
    if asset is None:
        raise ApiError(f"No asset named {text!r} among this hike's candidates", 404)
    return asset


def _entry(post, web_path: str) -> dict:
    for e in (post.report or {}).get("entries", []):
        if e["web_path"] == web_path:
            return e
    raise ApiError(f"No entry for {web_path}", 404)


# --- reads ------------------------------------------------------------------

def _summary(p) -> dict:
    """What both the hike list and a hike's detail say about it."""
    return {"name": p.name, "slug": p.slug, "kind": p.kind, "stats": p.stats, "counts": p.counts}


def list_hikes(state) -> dict:
    return {"hikes": [
        {**_summary(p), "has_report": p.report is not None}
        for p in state.posts()
    ]}


def _media_row(m) -> dict:
    local_path = Path(m.local_path) if m.local_path else None
    found = on_disk(local_path)
    return {
        "order": m.order,
        "label": m.label,
        "web_path": m.web_path,
        "kind": m.kind,
        "status": m.status,
        "color": status_color(m.status),
        "matched_name": m.matched_name,
        "has_local": found is not None,
        "local_size": found.stat().st_size if found else None,
        "match": (m.entry or {}).get("match"),
        "confidence": (m.entry or {}).get("confidence"),
        "resolved_by": (m.entry or {}).get("resolved_by"),
        "alternatives": (m.entry or {}).get("alternatives", []),
        "in_report": m.entry is not None,
    }


def hike_detail(state, name: str) -> dict:
    post = _post(state, name)
    report = post.report or {}
    return {
        **_summary(post),
        "site_url": site_url_for(post.name, state.settings.site_url),
        "album": report.get("album"),
        "date_window": report.get("date_window"),
        "candidate_count": report.get("candidate_count", 0),
        "media": [_media_row(m) for m in post.media],
    }


def candidate_assets(state, name: str, query: dict | None = None) -> dict:
    """The asset picker's list. For a place doc, `q` (text) and/or `from`/`to`
    (dates) run a new search first, which then stays its candidates."""
    post = _post(state, name)
    query = query or {}
    first = lambda key: ((query.get(key) or [""])[0] or "").strip()  # noqa: E731
    with _remote():
        if post.kind == "place" and (first("q") or first("from") or first("to")):
            try:
                assets = state.remote.search_place(post, first("q"), first("from"), first("to"))
            except ValueError as exc:
                raise ApiError(str(exc))
        else:
            assets = state.remote.candidates_for(post)
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
    found = on_disk(target)
    if found is None:
        raise ApiError(f"Not found: {web_path}", 404)
    ctype = mimetypes.guess_type(found.name)[0] or "application/octet-stream"
    return found.read_bytes(), ctype


def preview_file(state, asset_id: str) -> tuple[bytes, str]:
    with _remote():
        path = state.remote.preview_path(asset_id)
    ctype = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    return Path(path).read_bytes(), ctype


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
    _save(state, post)
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
        entry["match"] = match_from_asset(_find_asset(state, post, text))
        entry["status"] = "matched"
        entry["confidence"] = "manual"
        entry["resolved_by"] = "manual"
    post.recount()
    _save(state, post)
    return {"ok": True, "detail": hike_detail(state, post.name)}


def remove_entry(state, body: dict) -> dict:
    """Remove a media item from the report, the post, and the disk."""
    post = _post(state, body["post"])
    web_path = body.get("web_path") or ""
    if not any(m.web_path == web_path for m in post.media):
        raise ApiError(f"No media item {web_path}", 404)
    try:
        with state.lock:
            removed = actions.remove_media(state.settings, post, web_path)
            post.load()
    except ValueError as exc:
        raise ApiError(str(exc))
    return {"ok": True, "removed": removed, "detail": hike_detail(state, post.name)}


def suggest_out_name(state, body: dict) -> dict:
    """Suggest `<capture-date>-<NN>.jpg`, following this hike's existing naming."""
    post = _post(state, body["post"])
    text = (body.get("asset") or "").strip()
    if not text:
        raise ApiError("No asset given")
    asset = _find_asset(state, post, text)
    date = (asset.local_date_time or asset.file_created_at or "")[:10]
    if not date:
        raise ApiError("Asset has no capture date")
    return {"name": actions.next_out_name(state.settings, post.slug, date, kind=post.kind)}


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
            _save(state, post)
            post.load()
        return {"web_path": entry["web_path"], "status": entry["status"]}

    return {"job": jobs.payload(jobs.start(f"add:{spec.mode}", run))}


def start_rerun(state, jobs, body: dict) -> dict:
    post = _post(state, body["post"])
    if not state.remote.available:
        raise ApiError("Set the Immich URL and API key first", 409)

    def run():
        output = actions.rerun_match(state.settings, post.name)
        with state.lock:
            state.remote.invalidate(post)
            post.load()
        return {"output": output}

    return {"job": jobs.payload(jobs.start(f"rerun:{post.name}", run))}


# --- place docs ---------------------------------------------------------------

def _place(state, name: str):
    post = _post(state, name)
    if post.kind != "place":
        raise ApiError(f"{name} is a hike post, not a place doc")
    return post


def get_place(state, name: str) -> dict:
    """A place doc's text and front matter, for the editor."""
    return placedoc.read_place(_place(state, name).path)


def save_place(state, body: dict) -> dict:
    """Create a place doc (`create`: true, from `slug`) or edit one (`name`)."""
    fields = {k: body.get(k) for k in placedoc.TEXT_KEYS}
    text = body.get("body") or ""
    try:
        with state.lock:
            if body.get("create"):
                path = placedoc.place_path(state.settings, (body.get("slug") or "").strip())
                place = placedoc.write_place(path, fields, text, create=True)
                state.refresh()
            else:
                post = _place(state, body.get("name") or "")
                place = placedoc.write_place(post.path, fields, text)
                post.load()
    except ValueError as exc:
        raise ApiError(str(exc))
    name = f"{place['slug']}.md"
    return {"ok": True, "place": place, "detail": hike_detail(state, name),
            "hikes": list_hikes(state)["hikes"]}


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
