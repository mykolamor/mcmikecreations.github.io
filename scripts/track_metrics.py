#!/usr/bin/env python3
"""Write each recorded hike's distance, ascent, descent and moving time,
computed from its GPX, into the post's front matter.

Run `scripts/.venv/bin/python scripts/track_metrics.py --help` for options.
Implementation lives in the `matches` package beside this file.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from matches.track_metrics import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
