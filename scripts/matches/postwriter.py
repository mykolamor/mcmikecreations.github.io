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
