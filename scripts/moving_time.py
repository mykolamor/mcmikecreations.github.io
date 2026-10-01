#!/usr/bin/env python3
"""Write each recorded hike's moving time, computed from its GPX, into the
post's front matter as `duration`.

Run `scripts/.venv/bin/python scripts/moving_time.py --help` for options.
Implementation lives in the `matches` package beside this file.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from matches.moving_time import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
