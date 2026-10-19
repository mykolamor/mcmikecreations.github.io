#!/usr/bin/env python3
"""Build the home page hero map's per-hike heightmaps.

Run `scripts/.venv/bin/python scripts/hero_heightmaps.py --help` for options.
Implementation lives in the `matches` package beside this file.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from matches.hero_heightmaps import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
