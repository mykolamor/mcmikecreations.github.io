#!/usr/bin/env python3
"""Backfill 3D-map terrain heights (`demEle`) onto hike photos and nodes.

Run `scripts/.venv/bin/python scripts/backfill_terrain.py --help` for options.
Implementation lives in the `matches` package beside this file.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from matches.backfill_terrain import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
