"""Place docs: create them, and read and edit their text and front matter.

A place doc is reference text for one hut, peak, lake or town, written once
and shown in every hike post that lists it under `places:` in its front
matter (see src/lib/hikes/places.server.ts, which reads them for the site).
It looks like a hike post without the hike:

    ---
    title: Knorrhütte
    description: DAV hut below the Zugspitzplatt, on the Gatterl route.
    tags: [Hut]
    aliases: [Knorrhütte, Knorr hut]
    images: {...}          # written by the image tools, as for posts
    ---
    Markdown body, images included.

`images` is never touched here: the matcher and optimiser own it, exactly as
for posts. Edits go through postwriter's round-trip YAML, so hand-written
order, comments and the long blur URIs survive.
"""

import re
from pathlib import Path

from . import config
from .postwriter import dump_front_matter, load_front_matter, yaml_rt

# What the site accepts (place-docs.server.ts), from the file it reads too.
_SCHEMA = config.schema_keys()["placeDoc"]
SLUG_RE = re.compile(_SCHEMA["slug"])
# Keys the site accepts in a place doc's front matter.
KNOWN_KEYS = tuple(_SCHEMA["knownKeys"])
# Keys a place doc can't do without.
REQUIRED_KEYS = tuple(_SCHEMA["requiredKeys"])
# The editable ones, in the order a new file gets them.
TEXT_KEYS = ("title", "description", "tags", "aliases")


def place_path(settings: config.Settings, slug: str) -> Path:
    """`<places_dir>/<slug>.md`, refusing a slug the site couldn't use."""
    if not SLUG_RE.match(slug or ""):
        raise ValueError(
            f"Invalid place slug {slug!r}: lowercase letters and digits, "
            "separated by single '-' or '_', e.g. knorrhuette or zugspitz_platt"
        )
    return settings.places_root / f"{slug}.md"


def _clean_list(value, field: str) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        value = [v for v in value.split(",")]
    if not isinstance(value, (list, tuple)):
        raise ValueError(f"{field}: expected a list of strings")
    out = [str(v).strip() for v in value]
    return [v for v in out if v]


def validate_fields(fields: dict) -> dict:
    """Normalised title/description/tags/aliases, or ValueError naming the problem."""
    for key in REQUIRED_KEYS:
        if not str(fields.get(key) or "").strip():
            raise ValueError(f"A place needs a {key}")
    return {
        "title": (fields.get("title") or "").strip(),
        "description": (fields.get("description") or "").strip(),
        "tags": _clean_list(fields.get("tags"), "tags"),
        "aliases": _clean_list(fields.get("aliases"), "aliases"),
    }


def read_place(path: Path) -> dict:
    """The doc's editable fields and body, plus how many images its front matter maps."""
    data, body = load_front_matter(path)
    return {
        "slug": path.stem,
        "title": str(data.get("title") or ""),
        "description": str(data.get("description") or ""),
        "tags": [str(t) for t in (data.get("tags") or [])],
        "aliases": [str(a) for a in (data.get("aliases") or [])],
        "images": len(data.get("images") or {}),
        "body": body,
    }


def write_place(path: Path, fields: dict, body: str, create: bool = False) -> dict:
    """Write a place doc's text. `create` makes a new file and refuses to
    overwrite one; otherwise the file must exist and only title, description,
    tags, aliases and the body change - `images` and anything else stay as
    they are. Returns the doc as `read_place` sees it afterwards."""
    clean = validate_fields(fields)
    if not body.endswith("\n"):
        body += "\n"
    if create:
        if path.exists():
            raise ValueError(f"A place doc already exists at {path.name}")
        path.parent.mkdir(parents=True, exist_ok=True)
        data = yaml_rt.map()
    else:
        if not path.is_file():
            raise ValueError(f"No place doc at {path}")
        data, _ = load_front_matter(path)

    for key in TEXT_KEYS:
        value = clean[key]
        if isinstance(value, list):
            if not value:
                data.pop(key, None)
                continue
            seq = yaml_rt.seq(value)
            seq.fa.set_flow_style()
            value = seq
        if key in data:
            data[key] = value
        else:
            # A new key lands before `images`, so the long map stays last.
            keys = list(data)
            at = keys.index("images") if "images" in keys else len(keys)
            data.insert(at, key, value)

    dump_front_matter(path, data, body)
    return read_place(path)
