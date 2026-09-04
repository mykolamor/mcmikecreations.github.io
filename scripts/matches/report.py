"""Build and write the per-post JSON mapping.

Every referenced media file appears in the output, matched or not, so the
mapping is a complete record of the post rather than only its successes.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from .matcher import Candidate, Decision, PostResult

STATUSES = ("matched", "ambiguous", "unmatched",
            "skipped_video", "skipped_youtube", "missing_local")


def _scores(cand: Candidate) -> dict:
    residual = cand.residual
    return {
        "phash": cand.phash_distance,
        "blockmean": round(cand.bm_distance, 6),
        "mae": round(residual.mae, 4) if residual else None,
        "ncc": round(residual.ncc, 6) if residual else None,
        "inliers": residual.inliers if residual else None,
        "coverage": round(residual.coverage, 4) if residual else None,
    }


def _match_block(cand: Candidate) -> dict:
    a = cand.asset
    return {
        "asset_id": a.id,
        "original_path": a.original_path,
        "original_file_name": a.original_file_name,
        "file_created_at": a.file_created_at,
        "local_date_time": a.local_date_time,
        "width": a.width,
        "height": a.height,
        "latitude": a.latitude,
        "longitude": a.longitude,
        "file_size": a.file_size,
        "scores": _scores(cand),
    }


def _entry(decision: Decision) -> dict:
    ref = decision.ref
    return {
        "index": ref.index,
        "web_path": ref.web_path,
        "local_path": str(ref.local_path) if ref.local_path else None,
        "status": decision.status,
        "confidence": decision.confidence,
        "resolved_by": decision.resolved_by,
        "match": _match_block(decision.best) if decision.best else None,
        "alternatives": [
            {
                "asset_id": c.asset.id,
                "original_file_name": c.asset.original_file_name,
                "original_path": c.asset.original_path,
                "scores": _scores(c),
            }
            for c in decision.alternatives
        ],
    }


def summarize(result: PostResult) -> dict:
    stats = {"total": len(result.decisions)}
    for status in STATUSES:
        stats[status] = sum(1 for d in result.decisions if d.status == status)
    return stats


def build_report(result: PostResult, immich_url: str) -> dict:
    album = result.album_choice.album
    return {
        "post": result.post_name,
        "slug": result.slug,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "immich_url": immich_url,
        "album": {
            "name": album.name if album else None,
            "id": album.id if album else None,
            "source": result.album_choice.source,
        },
        "date_window": {
            "from": result.window_from.date().isoformat(),
            "to": result.window_to.date().isoformat(),
        },
        "candidate_count": result.candidate_count,
        "stats": summarize(result),
        "entries": [_entry(d) for d in result.decisions],
    }


def report_path(out_dir: Path, post_name: str) -> Path:
    return Path(out_dir) / (Path(post_name).stem + ".json")


def read_report(out_dir: Path, post_name: str) -> dict:
    path = report_path(out_dir, post_name)
    if not path.is_file():
        raise FileNotFoundError(
            f"No match report for {post_name!r} at {path} — run image_match.py on it first."
        )
    return json.loads(path.read_text(encoding="utf-8"))


def write_report(report: dict, out_dir: Path, post_name: str) -> Path:
    out = report_path(out_dir, post_name)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n",
                   encoding="utf-8")
    return out
