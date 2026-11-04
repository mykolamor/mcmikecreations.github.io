#!/usr/bin/env python3
"""Build the region outlines (GeoJSON) the hike hub pages and the Web map draw.

Run `scripts/.venv/bin/python scripts/region_shapes.py --help` for options.
Implementation lives in `hikegeo`, under scripts/geo.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "geo"))

from hikegeo.regions import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
