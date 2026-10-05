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

# Round-trip YAML, shared with placedoc so place docs are written the same way.
yaml_rt = YAML(typ="rt")
yaml_rt.width = 100000  # keep each front-matter line (incl. long blur data URIs) on one line
yaml_rt.preserve_quotes = True  # hand-quoted values (e.g. `elapsed` times) stay quoted
yaml_rt.default_flow_style = False
yaml_rt.indent(mapping=2, sequence=4, offset=2)  # preserve existing block-style indentation


def load_front_matter(post_path: Path) -> tuple[dict, str]:
    """Parse `post_path`'s front matter block. Raises ValueError if the post
    has no front matter block at all."""
    text = post_path.read_text(encoding="utf-8")
    m = FRONT_MATTER_RE.match(text)
    if not m:
        raise ValueError(f"{post_path} has no YAML front matter block")
    return yaml_rt.load(m.group(1)), text[m.end():]


def dump_front_matter(post_path: Path, data, body: str) -> None:
    """Write `data` back as `post_path`'s front matter, followed by `body`."""
    out = StringIO()
    yaml_rt.dump(data, out)
    post_path.write_text(f"---\n{out.getvalue()}---\n{body}", encoding="utf-8")


def _image_entry(meta: dict):
    entry = yaml_rt.map()
    entry.update(meta)
    entry.fa.set_flow_style()
    return entry


def merge_images_front_matter(post_path: Path, images: dict[str, dict]) -> None:
    """Rewrite `post_path`'s front matter with an `images` key set to
    `images`, replacing any previous value."""
    data, body = load_front_matter(post_path)
    images_map = yaml_rt.map()
    for filename, meta in images.items():
        images_map[filename] = _image_entry(meta)
    data["images"] = images_map
    dump_front_matter(post_path, data, body)


def upsert_image_front_matter(post_path: Path, filename: str, meta: dict) -> None:
    """Add or replace one file's entry in front matter's `images` map,
    leaving every other entry - and everything else in the front matter -
    untouched. Used when adding a single image rather than reprocessing the
    whole post (see `merge_images_front_matter`)."""
    data, body = load_front_matter(post_path)
    images_map = data.get("images")
    if images_map is None:
        images_map = yaml_rt.map()
        data["images"] = images_map
    images_map[filename] = _image_entry(meta)
    dump_front_matter(post_path, data, body)


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
    data, body = load_front_matter(post_path)
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
    dump_front_matter(post_path, data, "\n".join(kept))
    return removed


def read_images(post_path: Path) -> dict[str, dict]:
    """The post's front-matter `images` map as plain dicts ({} if none)."""
    data, _ = load_front_matter(post_path)
    return {name: dict(meta) for name, meta in (data.get("images") or {}).items()}


def merge_image_fields(post_path: Path, updates: dict[str, dict], dry_run: bool = False) -> int:
    """Set extra fields (e.g. `lat`/`lon`) on files already present in front
    matter's `images` map. New keys go just before `blur`, so the long data
    URI stays last on the line; a value of None removes the key. Files not
    in the map are ignored, never added. Returns how many entries changed; the file is only rewritten if
    at least one did, and never when `dry_run` is set."""
    data, body = load_front_matter(post_path)
    images_map = data.get("images")
    if not images_map:
        return 0
    changed = 0
    for filename, fields in updates.items():
        entry = images_map.get(filename)
        if entry is None:
            continue
        before = dict(entry)
        for key, value in fields.items():
            if value is None:
                entry.pop(key, None)
            elif key in entry:
                entry[key] = value
            elif "blur" in entry:
                entry.insert(list(entry).index("blur"), key, value)
            else:
                entry[key] = value
        if dict(entry) != before:
            changed += 1
    if changed and not dry_run:
        dump_front_matter(post_path, data, body)
    return changed
