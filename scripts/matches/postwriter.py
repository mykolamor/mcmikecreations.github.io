"""Merge a generated `images` map into a hike post's YAML front matter,
in place, without disturbing anything else in the file.

Uses ruamel.yaml's round-trip mode so hand-written key order, block/flow
list styles, and comments in the rest of the front matter survive
untouched. This is Python-side and intentionally separate from the
TypeScript front-matter readers in src/lib/hikes/ — those only ever read.
"""

import re
from io import StringIO
from pathlib import Path

from ruamel.yaml import YAML

FRONT_MATTER_RE = re.compile(r"^---\r?\n(.*?\r?\n)---\r?\n?", re.DOTALL)

_yaml = YAML(typ="rt")
_yaml.width = 100000  # keep each front-matter line (incl. long blur data URIs) on one line
_yaml.default_flow_style = False
_yaml.indent(mapping=2, sequence=4, offset=2)  # preserve existing block-style indentation


def _load_front_matter(post_path: Path) -> tuple[dict, str]:
    """Parse `post_path`'s front matter block. Raises ValueError if the post
    has no front matter block at all."""
    text = post_path.read_text(encoding="utf-8")
    m = FRONT_MATTER_RE.match(text)
    if not m:
        raise ValueError(f"{post_path} has no YAML front matter block")
    return _yaml.load(m.group(1)), text[m.end():]


def _dump_front_matter(post_path: Path, data, body: str) -> None:
    out = StringIO()
    _yaml.dump(data, out)
    post_path.write_text(f"---\n{out.getvalue()}---\n{body}", encoding="utf-8")


def _image_entry(meta: dict):
    entry = _yaml.map()
    entry.update(meta)
    entry.fa.set_flow_style()
    return entry


def merge_images_front_matter(post_path: Path, images: dict[str, dict]) -> None:
    """Rewrite `post_path`'s front matter with an `images` key set to
    `images`, replacing any previous value."""
    data, body = _load_front_matter(post_path)
    images_map = _yaml.map()
    for filename, meta in images.items():
        images_map[filename] = _image_entry(meta)
    data["images"] = images_map
    _dump_front_matter(post_path, data, body)


def upsert_image_front_matter(post_path: Path, filename: str, meta: dict) -> None:
    """Add or replace one file's entry in front matter's `images` map,
    leaving every other entry - and everything else in the front matter -
    untouched. Used when adding a single image rather than reprocessing the
    whole post (see `merge_images_front_matter`)."""
    data, body = _load_front_matter(post_path)
    images_map = data.get("images")
    if images_map is None:
        images_map = _yaml.map()
        data["images"] = images_map
    images_map[filename] = _image_entry(meta)
    _dump_front_matter(post_path, data, body)


def _is_ref_line(line: str, web_path: str) -> bool:
    """True for a line holding just the `![alt](web_path)` reference, with or
    without a `"title"`. Every media reference in this corpus sits on a line
    of its own (see `markdown.find_media_refs`)."""
    s = line.strip()
    return s.startswith("![") and (
        s.endswith(f"]({web_path})") or f"]({web_path} \"" in s
    )


def remove_media_from_post(post_path: Path, web_path: str) -> int:
    """Drop every line referencing `web_path` from the post body, and that
    file's entry from front matter's `images` map. Returns how many body
    lines were removed.

    A reference that stood between two blank lines takes one of them with it,
    so removing a lone image doesn't leave a double gap in the text.
    """
    data, body = _load_front_matter(post_path)
    lines = body.split("\n")
    kept: list[str] = []
    removed = 0
    for i, line in enumerate(lines):
        if not _is_ref_line(line, web_path):
            kept.append(line)
            continue
        removed += 1
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if kept and not kept[-1].strip() and not nxt.strip():
            kept.pop()

    images_map = data.get("images")
    filename = web_path.rsplit("/", 1)[-1]
    if images_map is not None and filename in images_map:
        del images_map[filename]
        if not images_map:
            del data["images"]
    elif not removed:
        return 0  # nothing to change: leave the file byte-for-byte alone
    _dump_front_matter(post_path, data, "\n".join(kept))
    return removed
