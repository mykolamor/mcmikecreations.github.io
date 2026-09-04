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


def merge_images_front_matter(post_path: Path, images: dict[str, dict]) -> None:
    """Rewrite `post_path`'s front matter with an `images` key set to
    `images`, replacing any previous value. Raises ValueError if the post
    has no front matter block at all."""
    text = post_path.read_text(encoding="utf-8")
    m = FRONT_MATTER_RE.match(text)
    if not m:
        raise ValueError(f"{post_path} has no YAML front matter block")
    yaml_text = m.group(1)
    body = text[m.end():]

    data = _yaml.load(yaml_text)

    images_map = _yaml.map()
    for filename, meta in images.items():
        entry = _yaml.map()
        entry.update(meta)
        entry.fa.set_flow_style()
        images_map[filename] = entry
    data["images"] = images_map

    out = StringIO()
    _yaml.dump(data, out)
    post_path.write_text(f"---\n{out.getvalue()}---\n{body}", encoding="utf-8")
