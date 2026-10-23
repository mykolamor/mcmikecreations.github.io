"""Fill in a front-matter `videos` entry for every YouTube video a hike post
embeds, and self-host its poster.

For each `![caption](https://www.youtube.com/watch?v=<id>)` the post gets

    videos:
      <id>: {title: {en: ..., de: ..., uk: ...}, uploadDate: ..., duration: PT36M42S,
             description: {en: ..., de: ..., uk: ...}, w: 1280, h: 720, blur: data:...}

read from YouTube without an API key: date and duration from the public watch
page, the title and description in each of LANGS (the uploader's own
translations) from the endpoint the page loads them with. The best thumbnail YouTube
has is saved as `<VIDEO_POSTERS_SUBDIR>/<id>.jpg` plus AVIF tiers, letterbox
bars trimmed. The site renders that poster instead of YouTube's own and
builds the post's `VideoObject` structured data from the entry.

A video that isn't public (private, removed) gets `{unavailable: true}` and
is retried on every run. Network failures only warn, so a deploy without a
connection still builds. Entries that are already complete are left alone,
hand edits included, unless `--refresh` is given.

Run `scripts/.venv/bin/python scripts/video_meta.py --help` for options.
"""

import argparse
import html
import io
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from PIL import Image, ImageStat

from . import cliutil, config
from .markdown import find_media_refs
from .optimize import encode_avif_tiers, encode_lqip_data_uri
from .postwriter import dump_front_matter, load_front_matter, yaml_rt

WATCH_URL = "https://www.youtube.com/watch?v={id}"
# What the watch page calls for its title block; unlike the page, it honours `hl`.
NEXT_URL = "https://www.youtube.com/youtubei/v1/next?prettyPrint=false"
NEXT_CLIENT = {"clientName": "WEB", "clientVersion": "2.20250101.00.00"}
# Languages the videos have titles and descriptions in. The site shows `en`.
LANGS = ("en", "de", "uk")
CYRILLIC_RE = re.compile(r"[\u0400-\u04FF]")
# Best first. maxresdefault is 404 for videos without an HD thumbnail.
THUMB_URLS = [f"https://i.ytimg.com/vi/{{id}}/{name}.jpg" for name in ("maxresdefault", "sddefault", "hqdefault")]
# English page, and past the EU cookie consent wall.
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)", "Accept-Language": "en"}
COOKIES = {"SOCS": "CAI"}
TIMEOUT = 30
# The description is the first paragraph, at most this long.
DESCRIPTION_MAX = 500
# Rows darker than this (mean luminance) count as letterbox bars.
BAR_LUMA = 16
REQUIRED = ("uploadDate", "duration", "w", "h", "blur")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def youtube_id(url: str) -> str | None:
    """The video id in a watch, youtu.be, shorts or embed URL."""
    try:
        u = urlparse(url)
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    if host.endswith("youtu.be"):
        vid = u.path.strip("/").split("/")[0]
    elif host.endswith("youtube.com"):
        if u.path == "/watch":
            vid = (parse_qs(u.query).get("v") or [""])[0]
        else:
            parts = u.path.strip("/").split("/")
            vid = parts[1] if len(parts) > 1 and parts[0] in ("shorts", "embed", "live") else ""
    else:
        return None
    return vid if ID_RE.match(vid) else None


def _meta(page: str, attr: str, name: str) -> str | None:
    m = re.search(rf'<meta {attr}="{re.escape(name)}" content="([^"]*)"', page)
    return html.unescape(m.group(1)) if m else None


def _json_string(page: str, key: str) -> str | None:
    """A JSON string value `"key":"..."` from the page's embedded player data."""
    m = re.search(rf'"{key}":("(?:[^"\\]|\\.)*")', page)
    return json.loads(m.group(1)) if m else None


def first_paragraph(text: str, limit: int = DESCRIPTION_MAX) -> str:
    para = text.strip().split("\n\n")[0].strip()
    para = re.sub(r"\s*\n\s*", " ", para)
    if len(para) > limit:
        para = para[:limit].rsplit(" ", 1)[0].rstrip(",.;:") + "…"
    return para


def parse_watch_page(page: str) -> dict | None:
    """`{uploadDate, duration}` from a watch page, or None when the video
    isn't playable (private, removed, age-gated)."""
    status = re.search(r'"playabilityStatus":\{"status":"([A-Z_]+)"', page)
    if not status or status.group(1) != "OK":
        return None
    upload = _meta(page, "itemprop", "uploadDate")
    duration = _meta(page, "itemprop", "duration")
    if not (upload and duration):
        return None
    return {"uploadDate": upload, "duration": duration}


def parse_next(payload: str) -> tuple[str | None, str | None]:
    """(title, description's first paragraph) from a `next` response."""
    title = re.search(r'"videoPrimaryInfoRenderer":\{"title":\{"runs":\[\{"text":("(?:[^"\\]|\\.)*")', payload)
    description = re.search(r'"attributedDescription":\{"content":("(?:[^"\\]|\\.)*")', payload)
    return (
        json.loads(title.group(1)) if title else None,
        first_paragraph(json.loads(description.group(1))) or None if description else None,
    )


def in_language(text: str, lang: str) -> bool:
    """Whether `text` can be in `lang`. Without a translation YouTube sends
    the original, so a Ukrainian original asked for in English comes back
    in Cyrillic; this drops it."""
    return bool(CYRILLIC_RE.search(text)) == (lang == "uk")


def localized(fetcher, vid: str) -> dict[str, dict[str, str]]:
    """`{"title": {lang: ...}, "description": {lang: ...}}` for the LANGS
    YouTube has a translation in. A language that comes back the same as
    English (no German translation: the English original) is left out."""
    out: dict[str, dict[str, str]] = {"title": {}, "description": {}}
    for lang in LANGS:
        title, description = parse_next(fetcher.localized(vid, lang))
        for key, text in (("title", title), ("description", description)):
            if not text or not in_language(text, lang):
                continue
            if lang != "en" and text == out[key].get("en"):
                continue
            out[key][lang] = text
    return {k: v for k, v in out.items() if v}


def trim_letterbox(img: Image.Image) -> Image.Image:
    """Crop black bars off the top and bottom (sd/hq thumbnails of a 16:9
    video are 4:3 with bars)."""
    gray = img.convert("L")
    w, h = gray.size

    def dark(y: int) -> bool:
        return ImageStat.Stat(gray.crop((0, y, w, y + 1))).mean[0] < BAR_LUMA

    top, bottom = 0, h
    while top < h // 3 and dark(top):
        top += 1
    while bottom > h - h // 3 and dark(bottom - 1):
        bottom -= 1
    return img if (top, bottom) == (0, h) else img.crop((0, top, w, bottom))


class Fetcher:
    """HTTP access, separate so tests can replace it."""

    def __init__(self):
        import requests
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self.session.cookies.update(COOKIES)

    def page(self, vid: str) -> str:
        r = self.session.get(WATCH_URL.format(id=vid), timeout=TIMEOUT)
        r.raise_for_status()
        return r.text

    def localized(self, vid: str, lang: str) -> str:
        body = {"context": {"client": {**NEXT_CLIENT, "hl": lang}}, "videoId": vid}
        r = self.session.post(NEXT_URL, json=body, timeout=TIMEOUT)
        r.raise_for_status()
        return r.text

    def thumbnail(self, vid: str) -> bytes | None:
        for url in THUMB_URLS:
            r = self.session.get(url.format(id=vid), timeout=TIMEOUT)
            # A missing size is a 404, or a 120x90 grey placeholder.
            if r.ok and len(r.content) > 2000:
                return r.content
        return None


def poster_path(static_root: Path, vid: str) -> Path:
    return Path(static_root) / config.VIDEO_POSTERS_SUBDIR / f"{vid}.jpg"


def ensure_poster(vid: str, settings: config.Settings, fetcher, refresh: bool, dry_run: bool) -> dict | None:
    """`{w, h, blur}` of the video's poster, downloading and encoding it if
    it isn't on disk yet (or `refresh`). None when no thumbnail exists."""
    path = poster_path(settings.static_root, vid)
    if refresh or not path.is_file():
        data = fetcher.thumbnail(vid)
        if data is None:
            return None
        original = Image.open(io.BytesIO(data)).convert("RGB")
        img = trim_letterbox(original)
        if not dry_run:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Untrimmed, YouTube's own JPEG is smaller than a re-encode.
            if img is original:
                path.write_bytes(data)
            else:
                img.save(path, "JPEG", quality=90)
            encode_avif_tiers(img, path.with_suffix(""), config.AVIF_TIERS, settings.avif_quality)
    else:
        img = Image.open(path).convert("RGB")
    return {
        "w": img.width,
        "h": img.height,
        "blur": encode_lqip_data_uri(img, settings.lqip_long_edge, settings.lqip_quality),
    }


def complete(entry) -> bool:
    """All REQUIRED fields, and an English title (a plain-string title is
    the old single-language format)."""
    return (entry is not None and all(entry.get(k) is not None for k in REQUIRED)
            and isinstance(entry.get("title"), dict) and "en" in entry["title"])


def video_entry(vid: str, old: dict | None, settings, fetcher, refresh: bool, dry_run: bool) -> dict | None:
    """The new front-matter entry for `vid`, or None to leave `old` as is."""
    try:
        info = parse_watch_page(fetcher.page(vid))
        if info is None:
            print(f"    warning: {vid} isn't public (private or removed)", file=sys.stderr)
            return {"unavailable": True}
        texts = localized(fetcher, vid)
        poster = ensure_poster(vid, settings, fetcher, refresh, dry_run)
    except Exception as exc:  # network trouble must not stop a deploy
        print(f"    warning: could not fetch {vid}: {exc}", file=sys.stderr)
        return None
    if poster is None:
        print(f"    warning: {vid} has no thumbnail", file=sys.stderr)
    entry = dict(old or {}) if not refresh else {}
    entry.pop("unavailable", None)
    entry.update(info)
    if "en" not in texts.get("title", {}):
        print(f"    warning: {vid} has no English title", file=sys.stderr)
    # Per language, hand edits (a rewritten description) win unless refreshing.
    # A plain string is the old single-language format, replaced.
    for key, by_lang in texts.items():
        old_text = entry.get(key)
        entry[key] = {**by_lang, **(dict(old_text) if isinstance(old_text, dict) else {})}
    entry.update({k: v for k, v in (poster or {}).items() if k != "blur"})
    if poster:
        entry.pop("blur", None)
        entry["blur"] = poster["blur"]  # the long data URI stays last on the line
    return entry


def update_post(post_path: Path, settings, fetcher, refresh: bool = False, dry_run: bool = False) -> int:
    """Fill in the post's `videos` map; returns how many entries changed."""
    ids = []
    for ref in find_media_refs(post_path, settings.static_root):
        vid = youtube_id(ref.web_path) if ref.kind == "youtube" else None
        if vid and vid not in ids:
            ids.append(vid)
    data, body = load_front_matter(post_path)
    videos = data.get("videos")
    stale = [v for v in (videos or {}) if v not in ids]
    todo = [v for v in ids if refresh or not complete((videos or {}).get(v))
            or not poster_path(settings.static_root, v).is_file()]
    if not todo and not stale:
        return 0

    changed = 0
    if videos is None:
        videos = yaml_rt.map()
    for vid in stale:
        del videos[vid]
        changed += 1
    for vid in todo:
        old = videos.get(vid)
        new = video_entry(vid, dict(old) if old else None, settings, fetcher, refresh, dry_run)
        if new is None or (old is not None and dict(old) == new):
            continue
        entry = yaml_rt.map()
        entry.update(new)
        entry.fa.set_flow_style()
        videos[vid] = entry
        changed += 1
    if changed and not dry_run:
        if videos:
            data["videos"] = videos
        else:
            data.pop("videos", None)
        dump_front_matter(post_path, data, body)
    return changed


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="video_meta.py",
        description="Fill in front-matter `videos` (upload date, duration, poster) for embedded YouTube videos.",
    )
    cliutil.add_posts(p)
    cliutil.add_posts_dir(p)
    p.add_argument("--static-root", default=None, help="The site's static folder.")
    p.add_argument("--refresh", action="store_true",
                   help="Re-fetch every video and re-download its poster, overwriting hand edits.")
    cliutil.add_dry_run(p)
    return p


def main(argv=None, fetcher=None) -> int:
    args = build_parser().parse_args(argv)
    settings = cliutil.settings_from_dirs(args)
    try:
        fetcher = fetcher or Fetcher()
    except ImportError as exc:
        print(f"    warning: {exc}; skipping video metadata", file=sys.stderr)
        return 0
    posts = cliutil.resolve_posts(args, settings)
    total = 0
    for path in posts:
        changed = update_post(path, settings, fetcher, refresh=args.refresh, dry_run=args.dry_run)
        if changed:
            total += changed
            print(f"{path.name}: updated {changed} video(s)")
    cliutil.print_summary("\ntotal", f"{total} video(s) updated", len(posts), "post(s)", args.dry_run)
    return 0
