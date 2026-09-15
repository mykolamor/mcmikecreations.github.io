"""Candidate selection and the matching cascade."""

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path

from PIL import Image

from . import config
from . import signatures as sig
from .immich import Album, Asset
from .markdown import MediaRef

TOKEN_RE = re.compile(r"[^a-z0-9]+")


def tokenize(text: str) -> set[str]:
    """Lowercase alphanumeric tokens."""
    return {t for t in TOKEN_RE.sub(" ", text.lower()).split() if t}


def coverage(slug: str, album_name: str) -> float:
    """Fraction of the slug's tokens that appear in the album name.

    Coverage rather than Jaccard: album names carry a location prefix the slug
    does not have, which would unfairly penalise a correct match.
    """
    slug_tokens = tokenize(slug)
    if not slug_tokens:
        return 0.0
    return len(slug_tokens & tokenize(album_name)) / len(slug_tokens)


def guess_albums(
    slug: str, albums: list[Album], minimum: float
) -> list[tuple[float, Album]]:
    """Albums scoring at or above `minimum`, best first. Ties are preserved."""
    scored = [(coverage(slug, a.name), a) for a in albums]
    keep = [(s, a) for s, a in scored if s >= minimum and s > 0]
    keep.sort(key=lambda pair: (-pair[0], pair[1].name))
    return keep


@dataclass
class AlbumChoice:
    album: Album | None
    source: str  # "explicit" | "guessed" | "none"


def date_window(
    refs: list[MediaRef], post_date: date | None, days: int
) -> tuple[datetime, datetime]:
    """Window spanning the capture dates encoded in the web filenames.

    Using the filenames rather than the post date alone covers posts that
    include photos taken on adjacent days.
    """
    dates = [r.capture_date for r in refs if r.capture_date]
    if not dates:
        dates = [post_date] if post_date else [date.today()]
    lo = min(dates) - timedelta(days=days)
    hi = max(dates) + timedelta(days=days)
    return datetime.combine(lo, time.min), datetime.combine(hi, time(23, 59, 59))


@dataclass
class Candidate:
    asset: Asset
    phash_distance: int
    bm_distance: float
    residual: "sig.ResidualScore | None" = None


def _area(asset: Asset) -> int:
    return asset.width * asset.height


def _prefer_original(pool: list[Candidate], best: Candidate, accept: float,
                      distance) -> Candidate:
    """Among candidates that independently clear `accept`, take the
    highest-resolution asset rather than the merely closest-scoring one.

    A previously-recompressed re-upload of the same photo can score a hair
    closer to a recompressed web query than the true full-resolution
    original does. Once a candidate is good enough to count as "the same
    photo" on its own, resolution should decide, not a fractional distance
    edge.
    """
    good = [c for c in pool if distance(c) < accept]
    if len(good) <= 1:
        return best
    return max(good, key=lambda c: _area(c.asset))


@dataclass
class Decision:
    ref: MediaRef
    status: str                      # matched|ambiguous|unmatched|skipped_video|missing_local
    confidence: str | None           # high|medium|None
    resolved_by: str | None          # blockmean|residual|None
    best: Candidate | None
    alternatives: list[Candidate]


@dataclass
class PostResult:
    post_name: str
    slug: str
    album_choice: AlbumChoice
    window_from: datetime
    window_to: datetime
    candidate_count: int
    decisions: list[Decision]


def decide_non_image(ref: MediaRef) -> Decision:
    """Decision for a reference that is never scored.

    A YouTube embed, a local video, or an image whose file is missing. YouTube
    is distinguished from a local video because there is nothing on disk to
    match even in principle.
    """
    if ref.kind == "youtube":
        status = "skipped_youtube"
    elif ref.kind == "video":
        status = "skipped_video"
    elif not ref.exists:
        status = "missing_local"
    else:
        status = "unmatched"
    return Decision(ref=ref, status=status, confidence=None,
                    resolved_by=None, best=None, alternatives=[])


def match_image(
    query_img: Image.Image,
    ref: MediaRef,
    assets: list[Asset],
    client,
    settings: config.Settings,
) -> Decision:
    """Run the cost-ordered cascade for one web image."""
    empty = Decision(ref, "unmatched", None, None, None, [])

    # Stage 1 - aspect ratio, free: metadata is already in hand.
    q_ar = sig.aspect_ratio(query_img.width, query_img.height)
    pool = [a for a in assets if sig.ar_compatible(q_ar, a.aspect, settings.ar_tolerance)]
    if not pool:
        pool = list(assets)          # never let the filter empty the field
    if not pool:
        return empty

    # Stage 2 - one thumbnail per candidate; both signatures come from it.
    client.prefetch([a.id for a in pool], kind="thumbnail")
    q_hash, q_block = sig.phash(query_img), sig.block_mean(query_img)
    scored: list[Candidate] = []
    for asset in pool:
        try:
            thumb = client.open_image(client.thumbnail(asset.id))
        except Exception:
            continue
        scored.append(
            Candidate(
                asset=asset,
                phash_distance=sig.hamming(q_hash, sig.phash(thumb)),
                bm_distance=sig.block_mean_distance(q_block, sig.block_mean(thumb)),
            )
        )
    if not scored:
        return empty

    # pHash only shortlists; block-mean ranks.
    scored.sort(key=lambda c: c.phash_distance)
    shortlist = scored[: max(settings.phash_top_k, 1)]
    shortlist.sort(key=lambda c: c.bm_distance)

    best = shortlist[0]
    runner = shortlist[1] if len(shortlist) > 1 else None
    margin = (runner.bm_distance / best.bm_distance) if runner and best.bm_distance > 0 else float("inf")
    # A much larger candidate on the shortlist might be the true original of
    # a compressed duplicate that happens to score closer on raw thumbnail
    # colour - defer to stage 3's exposure-normalised comparison instead of
    # shortcutting past it. See `_prefer_original`.
    outliers = [c for c in shortlist if _area(c.asset) >= _area(best.asset) * settings.original_area_factor]
    if best.bm_distance < settings.bm_accept and margin >= settings.bm_margin and not outliers:
        return Decision(ref, "matched", "high", "blockmean", best,
                        shortlist[1:3])

    # Stage 3 - previews only for what stage 2 could not settle.
    finalists = shortlist[: max(settings.residual_top_k, 1)]
    finalist_ids = {c.asset.id for c in finalists}
    for c in outliers:
        if c.asset.id not in finalist_ids:
            finalists.append(c)
            finalist_ids.add(c.asset.id)
    client.prefetch([c.asset.id for c in finalists], kind="preview")
    for cand in finalists:
        try:
            preview = client.open_image(client.preview(cand.asset.id))
        except Exception:
            continue
        cand.residual = sig.aligned_residual(
            query_img, preview, settings.sift_max_edge, settings.residual_blur
        )

    resolved = [c for c in finalists if c.residual is not None]
    if not resolved:
        return Decision(ref, "unmatched", None, None, None, finalists[:3])

    resolved.sort(key=lambda c: c.residual.mae)
    best = resolved[0]
    runner = resolved[1] if len(resolved) > 1 else None
    ratio = (runner.residual.mae / best.residual.mae) if runner and best.residual.mae > 0 else float("inf")

    if best.residual.mae >= settings.mae_accept:
        return Decision(ref, "unmatched", None, None, None, resolved[:3])
    if ratio < settings.mae_margin:
        return Decision(ref, "ambiguous", "low", "residual", best, resolved[1:3])
    chosen = _prefer_original(resolved, best, settings.mae_accept,
                              lambda c: c.residual.mae)
    alternatives = [c for c in resolved if c.asset.id != chosen.asset.id][:2]
    return Decision(ref, "matched", "medium", "residual", chosen, alternatives)


def choose_album(
    slug: str,
    albums: list[Album],
    explicit_names: list[str] | None,
    client,
    window: tuple[datetime, datetime],
    settings: config.Settings,
) -> AlbumChoice:
    """Explicit album wins; otherwise guess, breaking ties by in-window count."""
    if explicit_names:
        wanted = {n.lower() for n in explicit_names}
        for album in albums:
            if album.name.lower() in wanted:
                return AlbumChoice(album, "explicit")
        return AlbumChoice(None, "none")

    ranked = guess_albums(slug, albums, settings.album_coverage_min)
    if not ranked:
        return AlbumChoice(None, "none")
    top = ranked[0][0]
    tied = [a for score, a in ranked if score == top]
    if len(tied) == 1:
        return AlbumChoice(tied[0], "guessed")

    # Break the tie by which album actually holds assets in this date window.
    best_album, best_count = None, -1
    for album in tied:
        count = len(client.search_assets(album_ids=[album.id],
                                         taken_after=window[0], taken_before=window[1]))
        if count > best_count:
            best_album, best_count = album, count
    return AlbumChoice(best_album, "guessed") if best_count > 0 else AlbumChoice(None, "none")


def candidate_assets(client, choice: AlbumChoice, window, settings) -> list[Asset]:
    """The pool to search for one post.

    With a resolved album the date window is skipped: album membership is the
    stronger signal, and windowing it discards assets whose timestamp is wrong
    (an unset camera clock, or a mis-stamped import). Without an album the
    window is all there is.
    """
    if choice.album is not None and settings.trust_album:
        return client.search_assets(album_ids=[choice.album.id])
    album_ids = [choice.album.id] if choice.album else None
    return client.search_assets(album_ids=album_ids,
                                taken_after=window[0], taken_before=window[1])


def match_post(
    post_path: Path,
    client,
    settings: config.Settings,
    albums: list[Album],
    explicit_albums: list[str] | None = None,
) -> PostResult:
    """Match every media reference in one post."""
    from .markdown import find_media_refs, parse_capture_date, post_slug, _on_disk

    refs = find_media_refs(post_path, settings.static_root)
    slug = post_slug(post_path)
    post_date = parse_capture_date(Path(post_path).stem)
    window = date_window(refs, post_date, settings.date_window_days)

    choice = choose_album(slug, albums, explicit_albums, client, window, settings)
    assets = candidate_assets(client, choice, window, settings)

    decisions: list[Decision] = []
    for ref in refs:
        if ref.kind != "image" or not ref.exists:
            decisions.append(decide_non_image(ref))
            continue
        local_path = _on_disk(ref.local_path)
        try:
            query = Image.open(local_path)
            query.load()
        except Exception:
            decisions.append(Decision(ref, "missing_local", None, None, None, []))
            continue
        decisions.append(match_image(query, ref, assets, client, settings))

    return PostResult(
        post_name=Path(post_path).name,
        slug=slug,
        album_choice=choice,
        window_from=window[0],
        window_to=window[1],
        candidate_count=len(assets),
        decisions=decisions,
    )
