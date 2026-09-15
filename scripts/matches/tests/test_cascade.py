from pathlib import Path

from matches import config
from matches.immich import Asset
from matches.markdown import MediaRef
from matches.matcher import match_image
from matches.tests.conftest import recompress, synthetic_image


class FakeClient:
    """Serves synthetic images in place of Immich thumbnails and previews."""

    def __init__(self, images):
        self.images = images          # asset_id -> PIL.Image
        self.preview_calls = []

    def thumbnail(self, asset_id):
        return asset_id

    def preview(self, asset_id):
        self.preview_calls.append(asset_id)
        return asset_id

    def prefetch(self, asset_ids, kind="thumbnail"):
        return None

    def open_image(self, key):
        return self.images[key]


def _asset(aid, img):
    return Asset(aid, f"/lib/{aid}.jpg", f"{aid}.jpg", "2024-08-31T09:00:00Z",
                 "2024-08-31T11:00:00Z", img.width, img.height, None, None)


def _ref():
    return MediaRef(0, "/images/x/2024-08-31-00.jpg",
                    Path("/images/x/2024-08-31-00.jpg"), "image", None, True)


def test_obvious_match_resolves_at_stage_two_without_preview():
    a, b, c = synthetic_image(1), synthetic_image(2), synthetic_image(3)
    images = {"a": a, "b": b, "c": c}
    client = FakeClient(images)
    assets = [_asset("a", a), _asset("b", b), _asset("c", c)]
    d = match_image(recompress(a), _ref(), assets, client, config.Settings())
    assert d.status == "matched"
    assert d.confidence == "high"
    assert d.resolved_by == "blockmean"
    assert d.best.asset.id == "a"
    assert client.preview_calls == [], "stage 3 ran on an obvious match"


def test_no_candidate_yields_unmatched():
    a = synthetic_image(1)
    client = FakeClient({})
    d = match_image(recompress(a), _ref(), [], client, config.Settings())
    assert d.status == "unmatched"
    assert d.best is None


def test_video_is_skipped_without_scoring():
    from matches.matcher import decide_non_image
    ref = MediaRef(0, "/x/a.mp4", Path("/x/a.mp4"), "video", None, True)
    d = decide_non_image(ref)
    assert d.status == "skipped_video"
    assert d.best is None


def test_missing_local_file_is_reported():
    from matches.matcher import decide_non_image
    ref = MediaRef(0, "/x/a.jpg", Path("/x/a.jpg"), "image", None, False)
    d = decide_non_image(ref)
    assert d.status == "missing_local"


def test_aspect_ratio_filter_excludes_mismatched_shapes():
    a = synthetic_image(1, size=(1200, 900))       # 4:3
    tall = synthetic_image(1, size=(900, 1600))    # 9:16
    client = FakeClient({"a": a, "tall": tall})
    assets = [_asset("tall", tall), _asset("a", a)]
    d = match_image(recompress(a), _ref(), assets, client, config.Settings())
    assert d.best.asset.id == "a"


def test_ambiguous_pair_records_alternatives():
    """Two near-identical candidates force stage 3 and an alternatives list."""
    a = synthetic_image(1)
    near = a.copy()                                # a near-duplicate of a
    client = FakeClient({"a": a, "near": near})
    assets = [_asset("a", a), _asset("near", near)]
    # mae_accept is raised too: the ambiguous branch is only reached when the
    # best candidate passes the absolute threshold but fails the margin.
    settings = config.Settings(mae_margin=100.0, mae_accept=1000.0)
    d = match_image(recompress(a), _ref(), assets, client, settings)
    assert d.status == "ambiguous"
    assert d.alternatives, "runners-up were not recorded"


def test_prefers_the_full_resolution_original_over_a_compressed_duplicate():
    """A previously-recompressed re-upload of the same photo can score closer
    to the web query than the true full-resolution original does - the query
    is itself a lossy downscale, and a duplicate that already went through a
    similar lossy pipeline lands nearer it than an untouched original does.
    See the seekarkreuz/schneefernerkopf match reports, where the algorithm
    picked a 1024x766 WhatsApp re-export over the 4640x3472 camera original.

    Once a much larger candidate is on the shortlist, stage 2 must defer to
    stage 3 rather than shortcut on thumbnail scores alone."""
    from PIL import Image as PILImage

    a = synthetic_image(1, size=(1200, 900))
    query = recompress(a)                             # the web-published copy
    compressed_dup = recompress(a)                     # a second lossy re-export
    large_original = a.resize((4800, 3600), PILImage.Resampling.LANCZOS)
    client = FakeClient({"small": compressed_dup, "large": large_original})
    small_asset = Asset("small", "/lib/small.jpg", "small.jpg",
                         "2024-08-31T09:00:00Z", "2024-08-31T11:00:00Z",
                         compressed_dup.width, compressed_dup.height, None, None)
    large_asset = Asset("large", "/lib/large.jpg", "large.jpg",
                         "2024-08-31T09:00:00Z", "2024-08-31T11:00:00Z",
                         large_original.width, large_original.height, None, None)
    assets = [small_asset, large_asset]                # small listed first
    d = match_image(query, _ref(), assets, client, config.Settings())
    assert d.status == "matched"
    assert d.best.asset.id == "large"
    assert client.preview_calls, "stage 2 shortcut past the larger candidate"
