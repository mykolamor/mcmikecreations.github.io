#!/usr/bin/env python3
"""Generate responsive AVIF + LQIP for hike post images with a confirmed
Immich match, from the reports scripts/image_match.py already produced.

Run `scripts/.venv/bin/python scripts/image_optimize.py --help` for options.
Implementation lives in the `matches` package beside this file.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from matches.optimize_cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
