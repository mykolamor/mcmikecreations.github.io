#!/usr/bin/env python3
"""Fill in front-matter `videos` (upload date, duration, self-hosted poster) for embedded YouTube videos.

Run `scripts/.venv/bin/python scripts/video_meta.py --help` for options.
Implementation lives in the `matches` package beside this file.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from matches.video_meta import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
