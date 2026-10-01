#!/usr/bin/env python3
"""Backfill photo timestamps into hike post front matter, placing photos without GPS on the recorded track.

Run `scripts/.venv/bin/python scripts/backfill_time.py --help` for options.
Implementation lives in the `matches` package beside this file.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from matches.backfill_time import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
