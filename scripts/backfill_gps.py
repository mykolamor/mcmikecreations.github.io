#!/usr/bin/env python3
"""One-time backfill of photo GPS into hike post front matter.

Run `scripts/.venv/bin/python scripts/backfill_gps.py --help` for options.
Implementation lives in the `matches` package beside this file.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from matches.backfill_gps import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
