"""Offline tests for the YouTube video metadata and poster script."""

import io

from PIL import Image

from matches import video_meta as vm
from matches.postwriter import load_front_matter
from matches.tests.conftest import hike_tree, synthetic_image

VID = "B5yRsnelCsw"
PAGE = (
    '<meta property="og:title" content="Stuck in a gorge &amp; more">'
    '<meta itemprop="uploadDate" content="2025-08-03T07:30:07-07:00">'
    '<meta itemprop="duration" content="PT36M42S">'
    '"playabilityStatus":{"status":"OK","playableInEmbed":true}'
    '"shortDescription":"March 6, 2025. We test our gear.\\nOn Brünnstein.\\n\\nSubscribe!"'
)
PRIVATE = '"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"This video is private"}'


def next_payload(title: str, description: str) -> str:
    import json
    return ('{"videoPrimaryInfoRenderer":{"title":{"runs":[{"text":' + json.dumps(title) + '}]}},'
            '"attributedDescription":{"content":' + json.dumps(description) + '}}')


# English and Ukrainian translations; German falls back to the English original.
NEXT = {
    "en": next_payload("Stuck in a gorge", "March 6, 2025. We test our gear.\nOn Brünnstein.\n\nSubscribe!"),
    "de": next_payload("Stuck in a gorge", "March 6, 2025. We test our gear.\nOn Brünnstein.\n\nSubscribe!"),
    "uk": next_payload("Застрягли в ущелині", "6 березня 2025."),
}
POST = f"---\ntitle: Demo\n---\nText.\n\n![The climb](https://www.youtube.com/watch?v={VID})\n"


def jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


class FakeFetcher:
    def __init__(self, pages: dict, thumb: bytes | None = None, fail: bool = False, nxt: dict = NEXT):
        self.pages, self.thumb, self.fail, self.nxt = pages, thumb, fail, nxt
        self.calls = []

    def localized(self, vid, lang):
        self.calls.append(("next", vid, lang))
        return self.nxt[lang]

    def page(self, vid):
        self.calls.append(("page", vid))
        if self.fail:
            raise OSError("offline")
        return self.pages[vid]

    def thumbnail(self, vid):
        self.calls.append(("thumb", vid))
        return self.thumb


def test_youtube_id_reads_every_url_form():
    assert vm.youtube_id(f"https://www.youtube.com/watch?v={VID}&t=10") == VID
    assert vm.youtube_id(f"https://youtu.be/{VID}") == VID
    assert vm.youtube_id(f"https://www.youtube.com/shorts/{VID}") == VID
    assert vm.youtube_id("https://www.youtube.com/results?search_query=x") is None
    assert vm.youtube_id("https://example.com/watch?v=" + VID) is None


def test_parse_watch_page():
    info = vm.parse_watch_page(PAGE)
    assert info == {"uploadDate": "2025-08-03T07:30:07-07:00", "duration": "PT36M42S"}
    assert vm.parse_watch_page(PRIVATE) is None


def test_localized_keeps_real_translations_only():
    texts = vm.localized(FakeFetcher({}), VID)
    # German was the English original, so it's left out.
    assert texts == {
        "title": {"en": "Stuck in a gorge", "uk": "Застрягли в ущелині"},
        "description": {"en": "March 6, 2025. We test our gear. On Brünnstein.", "uk": "6 березня 2025."},
    }
    # A Ukrainian original sent back for `en` is no English title.
    cyrillic = {lang: NEXT["uk"] for lang in vm.LANGS}
    assert vm.localized(FakeFetcher({}, nxt=cyrillic), VID) == {
        "title": {"uk": "Застрягли в ущелині"}, "description": {"uk": "6 березня 2025."},
    }


def test_first_paragraph_is_cut_at_a_word():
    assert vm.first_paragraph("one two three four", limit=10) == "one two…"


def test_trim_letterbox_crops_black_bars():
    img = Image.new("RGB", (480, 360), (0, 0, 0))
    img.paste(synthetic_image(1, (480, 270)), (0, 45))
    assert vm.trim_letterbox(img).size == (480, 270)
    plain = synthetic_image(2, (480, 270))
    assert vm.trim_letterbox(plain) is plain


def test_update_post_writes_entry_and_poster(tmp_path):
    tree = hike_tree(tmp_path, posts={"2025-07-06-demo.md": POST})
    fetcher = FakeFetcher({VID: PAGE}, jpeg(synthetic_image(3, (1280, 720))))
    post = tree.posts / "2025-07-06-demo.md"

    assert vm.update_post(post, tree.settings, fetcher) == 1
    data, body = load_front_matter(post)
    entry = dict(data["videos"][VID])
    assert entry["uploadDate"] == "2025-08-03T07:30:07-07:00"
    assert dict(entry["title"]) == {"en": "Stuck in a gorge", "uk": "Застрягли в ущелині"}
    assert (entry["w"], entry["h"]) == (1280, 720)
    assert list(entry)[-1] == "blur" and entry["blur"].startswith("data:image/webp")
    poster = tree.static / "images/projects/data-viz/hikes/videos" / f"{VID}.jpg"
    assert poster.is_file()
    assert (poster.parent / f"{VID}-640.avif").is_file()
    assert body.endswith(f"({'https://www.youtube.com/watch?v=' + VID})\n")

    # Complete: nothing fetched again.
    fetcher.calls.clear()
    assert vm.update_post(post, tree.settings, fetcher) == 0
    assert fetcher.calls == []


def test_hand_edits_survive_and_refresh_overwrites(tmp_path):
    tree = hike_tree(tmp_path, posts={"2025-07-06-demo.md": POST})
    fetcher = FakeFetcher({VID: PAGE}, jpeg(synthetic_image(3, (1280, 720))))
    post = tree.posts / "2025-07-06-demo.md"
    vm.update_post(post, tree.settings, fetcher)
    text = post.read_text(encoding="utf-8").replace("March 6, 2025. We test our gear. On Brünnstein.", "Mine.")
    post.write_text(text, encoding="utf-8")
    (tree.static / "images/projects/data-viz/hikes/videos" / f"{VID}.jpg").unlink()

    vm.update_post(post, tree.settings, fetcher)
    description = load_front_matter(post)[0]["videos"][VID]["description"]
    assert (description["en"], description["uk"]) == ("Mine.", "6 березня 2025.")
    vm.update_post(post, tree.settings, fetcher, refresh=True)
    assert load_front_matter(post)[0]["videos"][VID]["description"]["en"].startswith("March 6")


def test_old_single_language_entries_are_replaced(tmp_path):
    post_text = POST.replace("title: Demo\n", f"title: Demo\nvideos:\n  {VID}: {{title: Застрягли, description: x}}\n")
    tree = hike_tree(tmp_path, posts={"2025-07-06-demo.md": post_text})
    post = tree.posts / "2025-07-06-demo.md"
    fetcher = FakeFetcher({VID: PAGE}, jpeg(synthetic_image(3, (1280, 720))))
    assert vm.update_post(post, tree.settings, fetcher) == 1
    assert load_front_matter(post)[0]["videos"][VID]["title"]["en"] == "Stuck in a gorge"


def test_private_video_is_marked_and_stale_entries_go(tmp_path):
    post_text = POST.replace("title: Demo\n", "title: Demo\nvideos:\n  oldoldold01: {title: x}\n")
    tree = hike_tree(tmp_path, posts={"2025-07-06-demo.md": post_text})
    post = tree.posts / "2025-07-06-demo.md"
    assert vm.update_post(post, tree.settings, FakeFetcher({VID: PRIVATE})) == 2
    videos = load_front_matter(post)[0]["videos"]
    assert dict(videos) == {VID: {"unavailable": True}}


def test_network_failure_leaves_the_post_alone(tmp_path):
    tree = hike_tree(tmp_path, posts={"2025-07-06-demo.md": POST})
    post = tree.posts / "2025-07-06-demo.md"
    assert vm.update_post(post, tree.settings, FakeFetcher({}, fail=True)) == 0
    assert post.read_text(encoding="utf-8") == POST


def test_main_dry_run_writes_nothing(tmp_path):
    tree = hike_tree(tmp_path, posts={"2025-07-06-demo.md": POST})
    fetcher = FakeFetcher({VID: PAGE}, jpeg(synthetic_image(3, (1280, 720))))
    code = vm.main(["--posts-dir", str(tree.posts), "--static-root", str(tree.static), "--dry-run"], fetcher=fetcher)
    assert code == 0
    assert (tree.posts / "2025-07-06-demo.md").read_text(encoding="utf-8") == POST
    assert not (tree.static / "images/projects/data-viz/hikes/videos").exists()
