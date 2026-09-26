"""Stdlib HTTP server. No framework, no new dependencies.

Binds to localhost by default: the API can read any file under the static root
and holds an Immich key, so it is not meant to face a network.
"""

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .. import config
from . import api
from .jobs import JobRegistry
from .state import AppState

STATIC_DIR = Path(__file__).resolve().parent / "static"
CONTENT_TYPES = {".html": "text/html; charset=utf-8",
                 ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8"}


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

            if path == "/api/hikes":
                self._json(api.list_hikes(state)); return True
            m = re.fullmatch(r"/api/hikes/(.+)", path)
            if m:
                self._json(api.hike_detail(state, _unquote(m.group(1)))); return True
            m = re.fullmatch(r"/api/assets/(.+)", path)
            if m:
                self._json(api.candidate_assets(state, _unquote(m.group(1)))); return True
            if path == "/api/media":
                web = (query.get("path") or [""])[0]
                body, ctype = api.local_file(state, web)
                self._send(200, body, ctype); return True
            m = re.fullmatch(r"/api/preview/([0-9a-fA-F-]+)", path)
            if m:
                body, ctype = api.preview_file(state, m.group(1))
                self._send(200, body, ctype); return True
            if path == "/api/settings":
                self._json(api.get_settings(state)); return True
            m = re.fullmatch(r"/api/jobs/([0-9a-f]+)", path)
            if m:
                job = jobs.get(m.group(1))
                if job is None:
                    raise api.ApiError("No such job", 404)
                self._json(jobs.payload(job)); return True
            return False

        if method == "POST":
            body = self._body()
            if path == "/api/refresh":
                state.refresh()
                self._json(api.list_hikes(state)); return True
            if path == "/api/entry/local":
                self._json(api.set_local_path(state, body)); return True
            if path == "/api/entry/remote":
                self._json(api.set_remote_match(state, body)); return True
            if path == "/api/entry/remove":
                self._json(api.remove_entry(state, body)); return True
            if path == "/api/entry/suggest_name":
                self._json(api.suggest_out_name(state, body)); return True
            if path == "/api/add":
                self._json(api.start_add(state, jobs, body)); return True
            if path == "/api/rerun":
                self._json(api.start_rerun(state, jobs, body)); return True
            if path == "/api/settings":
                self._json(api.put_settings(state, body)); return True
            if path == "/api/settings/test":
                self._json(api.check_connection(state)); return True
            return False
        return False

    def _static(self, name: str) -> bool:
        target = (STATIC_DIR / name).resolve()
        if not target.is_relative_to(STATIC_DIR) or not target.is_file():
            raise api.ApiError(f"Not found: {name}", 404)
        ctype = CONTENT_TYPES.get(target.suffix, "application/octet-stream")
        self._send(200, target.read_bytes(), ctype)
        return True


def _unquote(text: str) -> str:
    from urllib.parse import unquote

    return unquote(text)


def serve(settings: config.Settings, host: str = "127.0.0.1",
          port: int = 8765) -> None:
    Handler.state = AppState(settings)
    Handler.jobs = JobRegistry()
    httpd = ThreadingHTTPServer((host, port), Handler)
    posts = len(Handler.state.posts())
    key = "set" if settings.api_key else "NOT set - enter it in Settings"
    print(f"Hike image matcher: http://{host}:{port}")
    print(f"  {posts} posts from {settings.posts_dir}")
    print(f"  reports in {settings.out_dir}")
    print(f"  Immich key: {key}")
    print("  Ctrl-C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        httpd.server_close()
