"""Read side of the shared OSM element store, `static/_projects/data-viz/hikes/osm.json`.

Keyed by typed id (`node/123`, `way/456`, `relation/789`). The hike CRM
(`pnpm crm`) owns writing it.
"""

import json
from pathlib import Path

STORE_RELPATH = "_projects/data-viz/hikes/osm.json"


def load_store(path: Path) -> dict[str, dict]:
    """The store at `path`, or an empty one when the file doesn't exist yet."""
    path = Path(path)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))
