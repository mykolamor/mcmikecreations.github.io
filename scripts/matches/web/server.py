"""Stdlib HTTP server. No framework, no new dependencies.

Binds to localhost by default: the API can read any file under the static root
and holds an Immich key, so it is not meant to face a network.
"""

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .. import config
from . import api
from .jobs import JobRegistry
from .state import AppState

STATIC_DIR = Path(__file__).resolve().parent / "static"
CONTENT_TYPES = {".html": "text/html; charset=utf-8",
                 ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8"}


def _job(jobs: JobRegistry, job_id: str) -> dict:
    job = jobs.get(job_id)
    if job is None:
        raise api.ApiError("No such job", 404)
    return jobs.payload(job)


def _refresh(state: AppState, jobs: JobRegistry, body: dict) -> dict:
    state.refresh()
    return api.list_hikes(state)


# GET routes answered with JSON: (path pattern, handler(state, jobs, match, query)).
GET_ROUTES = [
    (re.compile(p), fn) for p, fn in (
        (r"/api/hikes", lambda s, j, m, q: api.list_hikes(s)),
        (r"/api/hikes/(.+)", lambda s, j, m, q: api.hike_detail(s, unquote(m[1]))),
        (r"/api/assets/(.+)", lambda s, j, m, q: api.candidate_assets(s, unquote(m[1]), q)),
        (r"/api/places/(.+)", lambda s, j, m, q: api.get_place(s, unquote(m[1]))),
        (r"/api/settings", lambda s, j, m, q: api.get_settings(s)),
        (r"/api/jobs/([0-9a-f]+)", lambda s, j, m, q: _job(j, m[1])),
    )
]
# GET routes answered with a file's bytes: handler(...) -> (body, content type).
FILE_ROUTES = [
    (re.compile(p), fn) for p, fn in (
        (r"/api/media", lambda s, j, m, q: api.local_file(s, (q.get("path") or [""])[0])),
        (r"/api/preview/([0-9a-fA-F-]+)", lambda s, j, m, q: api.preview_file(s, m[1])),
    )
]
# POST routes, all JSON: path -> handler(state, jobs, body).
POST_ROUTES = {
    "/api/refresh": _refresh,
    "/api/entry/local": lambda s, j, b: api.set_local_path(s, b),
    "/api/entry/remote": lambda s, j, b: api.set_remote_match(s, b),
    "/api/entry/remove": lambda s, j, b: api.remove_entry(s, b),
    "/api/entry/suggest_name": lambda s, j, b: api.suggest_out_name(s, b),
    "/api/add": api.start_add,
    "/api/places/save": lambda s, j, b: api.save_place(s, b),
    "/api/rerun": api.start_rerun,
    "/api/settings": lambda s, j, b: api.put_settings(s, b),
    "/api/settings/test": lambda s, j, b: api.check_connection(s),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "HikeImageMatch/1.0"
    state: AppState
    jobs: JobRegistry

    # --- plumbing -----------------------------------------------------------

    def log_message(self, fmt, *args):
        if self.path.startswith(("/api/media", "/api/preview")):
            return  # image traffic would drown the log
        super().log_message(fmt, *args)

    def _send(self, status: int, body: bytes, ctype: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, payload, status: int = 200) -> None:
        self._send(status, json.dumps(payload).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            raise api.ApiError("Malformed JSON body")

    # --- routing ------------------------------------------------------------

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def _dispatch(self, method: str) -> None:
        url = urlparse(self.path)
        path = url.path
        query = parse_qs(url.query)
        try:
            handled = self._route(method, path, query)
            if not handled:
                self._json({"error": f"No route for {method} {path}"}, 404)
        except api.ApiError as exc:
            self._json({"error": str(exc)}, exc.status)
        except BrokenPipeError:
            pass
        except Exception as exc:
            import traceback
            traceback.print_exc()
            self._json({"error": f"{exc.__class__.__name__}: {exc}"}, 500)

    def _route(self, method: str, path: str, query: dict) -> bool:
        state, jobs = self.state, self.jobs

        if method == "GET":
            if path in ("/", "/index.html"):
                return self._static("index.html")
            if path.startswith("/static/"):
                return self._static(path[len("/static/"):])
            for pattern, fn in GET_ROUTES:
                m = pattern.fullmatch(path)
                if m:
                    self._json(fn(state, jobs, m, query))
                    return True
            for pattern, fn in FILE_ROUTES:
                m = pattern.fullmatch(path)
                if m:
                    self._send(200, *fn(state, jobs, m, query))
                    return True
            return False

        if method == "POST":
            body = self._body()
            fn = POST_ROUTES.get(path)
            if fn is None:
                return False
            self._json(fn(state, jobs, body))
            return True
        return False

    def _static(self, name: str) -> bool:
        target = (STATIC_DIR / name).resolve()
        if not target.is_relative_to(STATIC_DIR) or not target.is_file():
            raise api.ApiError(f"Not found: {name}", 404)
        ctype = CONTENT_TYPES.get(target.suffix, "application/octet-stream")
        self._send(200, target.read_bytes(), ctype)
        return True


def serve(settings: config.Settings, host: str = "127.0.0.1",
          port: int = 8765) -> None:
    Handler.state = AppState(settings)
    Handler.jobs = JobRegistry()
    httpd = ThreadingHTTPServer((host, port), Handler)
    posts = len(Handler.state.posts())
    key = "set" if settings.api_key else "NOT set - enter it in Settings"
    print(f"Hike image matcher: http://{host}:{port}")
    print(f"  {posts} posts and place docs from {settings.posts_dir} and {settings.places_root}")
    print(f"  reports in {settings.out_dir}")
    print(f"  Immich key: {key}")
    print("  Ctrl-C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        httpd.server_close()
