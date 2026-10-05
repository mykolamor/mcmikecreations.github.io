"""Offline tests for place docs across the matcher: discovery, naming,
editing, the web API, and searching Immich for a doc without a date."""

import json
from argparse import Namespace
from pathlib import Path

import pytest

from matches import backfill_terrain, config, placedoc
from matches.backfill_time import post_updates
from matches.cliutil import resolve_posts
from matches.immich import ImmichClient
from matches.markdown import find_media_refs, is_place_doc
from matches.review import actions
from matches.review.model import HikeIndex, site_url_for, web_path_for
from matches.tests.conftest import StubSession, app_state, hike_tree, make_asset
from matches.web import api

POST = """---
title: Test
places: [knorrhuette]
---
![One](/images/projects/data-viz/hikes/stories/demo/2024-08-31-00.jpg)
"""

PLACE = """---
title: Knorrhütte
description: DAV hut below the Zugspitzplatt.
# Kept: a hand comment.
tags: [Hut]
images:
  2026-07-19-00.jpg: {w: 4, h: 3, blur: 'data:image/webp;base64,AA'}
---
The hut.

![Terrace](/images/projects/data-viz/hikes/places/knorrhuette/2026-07-19-00.jpg)
"""


@pytest.fixture
def tree(tmp_path):
    return hike_tree(tmp_path, posts={"2024-08-31-demo.md": POST},
                     places={"knorrhuette.md": PLACE},
                     story_files={"places/knorrhuette/2026-07-19-00.jpg": b"\xff\xd8\xff\xd9"})


def test_places_dir_defaults_next_to_the_posts(tree):
    assert tree.settings.places_root == tree.places.resolve()
    assert config.Settings().places_root.name == "places"
    # Follows posts_dir even when that's changed after construction.
    s = config.Settings()
    s.posts_dir = tree.posts
    assert s.places_root == tree.places.resolve()
    assert config.Settings(places_dir=tree.root).places_root == tree.root.resolve()


def test_place_docs_are_told_apart_by_their_missing_date():
    assert is_place_doc(Path("knorrhuette.md"))
    assert not is_place_doc(Path("2026-07-19-schneefernerkopf.md"))


def test_place_images_are_media_references(tree):
    refs = find_media_refs(tree.places / "knorrhuette.md", tree.settings.static_root)
    assert [r.web_path for r in refs] == ["/images/projects/data-viz/hikes/places/knorrhuette/2026-07-19-00.jpg"]
    assert refs[0].exists and refs[0].kind == "image"


def test_resolve_posts_finds_place_docs_and_lists_them_after_posts(tree):
    every = resolve_posts(Namespace(posts=[]), tree.settings)
    assert [p.name for p in every] == ["2024-08-31-demo.md", "knorrhuette.md"]
    one = resolve_posts(Namespace(posts=["knorrhuette"]), tree.settings)
    assert one == [tree.places.resolve() / "knorrhuette.md"]
    with pytest.raises(SystemExit):
        resolve_posts(Namespace(posts=["nowhere"]), tree.settings)


def test_index_and_naming_know_place_docs(tree):
    docs = HikeIndex(tree.settings).refresh()
    assert [(d.name, d.kind) for d in docs] == [("2024-08-31-demo.md", "post"), ("knorrhuette.md", "place")]
    assert site_url_for("knorrhuette.md") is None
    assert web_path_for("knorrhuette", "a.jpg", "place") == "/images/projects/data-viz/hikes/places/knorrhuette/a.jpg"
    assert web_path_for("demo", "a.jpg") == "/images/projects/data-viz/hikes/stories/demo/a.jpg"
    assert actions.stories_dir(tree.settings, "knorrhuette", "place") == \
        tree.settings.static_root / "images/projects/data-viz/hikes/places/knorrhuette"
    # One past the highest index on disk, in the place's own folder.
    assert actions.next_out_name(tree.settings, "knorrhuette", "2026-07-19", kind="place") == "2026-07-19-01.jpg"


def test_no_time_backfill_for_a_place_doc(tree):
    assert post_updates(tree.places / "knorrhuette.md", tree.settings) == {}


def test_editing_keeps_images_and_comments(tree):
    path = tree.places / "knorrhuette.md"
    doc = placedoc.write_place(path, {"title": "Knorrhütte", "description": "New text.",
                                      "tags": "Hut, DAV", "aliases": ["Knorr hut"]}, "Body.\n")
    assert doc == {"slug": "knorrhuette", "title": "Knorrhütte", "description": "New text.",
                   "tags": ["Hut", "DAV"], "aliases": ["Knorr hut"], "images": 1, "body": "Body.\n"}
    text = path.read_text(encoding="utf-8")
    assert "# Kept: a hand comment." in text
    assert "2026-07-19-00.jpg: {w: 4, h: 3, blur: 'data:image/webp;base64,AA'}" in text
    # The new key goes before `images`, which stays last.
    assert text.index("aliases:") < text.index("images:")
    # Empty lists drop their key.
    placedoc.write_place(path, {"title": "K", "description": "D", "tags": [], "aliases": ""}, "B")
    assert "tags:" not in path.read_text(encoding="utf-8")


def test_creating_a_place_doc(tree):
    path = placedoc.place_path(tree.settings, "zugspitzplatt")
    doc = placedoc.write_place(path, {"title": "Zugspitzplatt", "description": "Karst plateau."},
                               "Text.", create=True)
    assert doc["title"] == "Zugspitzplatt" and doc["body"] == "Text.\n"
    assert path.read_text(encoding="utf-8").startswith("---\ntitle: Zugspitzplatt\n")
    with pytest.raises(ValueError, match="already exists"):
        placedoc.write_place(path, {"title": "x", "description": "y"}, "", create=True)
    for bad in ("Zugspitz", "a b", "../x", "", "-x"):
        with pytest.raises(ValueError, match="Invalid place slug"):
            placedoc.place_path(tree.settings, bad)
    with pytest.raises(ValueError, match="needs a description"):
        placedoc.write_place(path, {"title": "x"}, "")


@pytest.fixture
def app(tree, monkeypatch):
    return app_state(tree, monkeypatch)


def test_api_lists_and_details_place_docs(app):
    hikes = api.list_hikes(app)["hikes"]
    assert [(h["name"], h["kind"]) for h in hikes] == [("2024-08-31-demo.md", "post"), ("knorrhuette.md", "place")]
    d = api.hike_detail(app, "knorrhuette.md")
    assert d["kind"] == "place" and d["site_url"] is None
    assert [m["label"] for m in d["media"]] == ["2026-07-19-00.jpg"]
    assert api.get_place(app, "knorrhuette.md")["title"] == "Knorrhütte"
    with pytest.raises(api.ApiError, match="not a place doc"):
        api.get_place(app, "2024-08-31-demo.md")


def test_api_creates_and_edits_place_docs(app, tree):
    r = api.save_place(app, {"create": True, "slug": "sonnalpin", "title": "Sonnalpin",
                             "description": "Restaurant on the Platt.", "body": "Hi"})
    assert r["place"]["slug"] == "sonnalpin"
    assert "sonnalpin.md" in [h["name"] for h in r["hikes"]]
    r = api.save_place(app, {"name": "sonnalpin.md", "title": "Sonnalpin", "description": "Changed.",
                             "tags": ["Restaurant"], "body": "Hi again"})
    assert r["place"]["description"] == "Changed." and r["place"]["body"] == "Hi again\n"
    with pytest.raises(api.ApiError, match="already exists"):
        api.save_place(app, {"create": True, "slug": "sonnalpin", "title": "x", "description": "y"})
    with pytest.raises(api.ApiError, match="Invalid place slug"):
        api.save_place(app, {"create": True, "slug": "Bad Slug", "title": "x", "description": "y"})


def _asset(i: int, day: str):
    return make_asset(id=f"id-{i}", original_path=f"/lib/IMG_{i}.jpg", original_file_name=f"IMG_{i}.jpg",
                      file_created_at=f"{day}T10:00:00Z", local_date_time=f"{day}T12:00:00")


def test_place_search_becomes_the_candidates(app, monkeypatch):
    class FakeClient:
        def smart_search(self, query):
            assert query == "Knorrhütte"
            return [_asset(1, "2026-07-19"), _asset(2, "2025-06-21")]

        def search_assets(self, **kw):
            return [_asset(3, "2026-07-01")]

    remote = app.remote
    monkeypatch.setattr(type(remote), "client", property(lambda self: FakeClient()))
    name = "knorrhuette.md"
    found = api.candidate_assets(app, name, {"q": ["Knorrhütte"], "from": ["2026-01-01"], "to": [""]})
    assert [a["name"] for a in found["assets"]] == ["IMG_1.jpg"]
    # Without new search terms the picker shows the last search again.
    assert [a["name"] for a in api.candidate_assets(app, name)["assets"]] == ["IMG_1.jpg"]
    # Dates alone search that window.
    found = api.candidate_assets(app, name, {"from": ["2026-07-01"], "to": ["2026-07-02"]})
    assert [a["name"] for a in found["assets"]] == ["IMG_3.jpg"]
    with pytest.raises(api.ApiError, match="both dates"):
        api.candidate_assets(app, name, {"from": ["2026-07-01"]})


def test_smart_search_pages_up_to_the_limit(tree):
    # Every page claims another follows: paging must stop at the limit.
    session = StubSession([
        {"assets": {"items": [{"id": f"{page}-{i}", "originalFileName": f"{page}-{i}.jpg"}
                              for i in range(2)],
                    "nextPage": str(page + 1)}}
        for page in (1, 2, 3)
    ])
    settings = config.Settings(posts_dir=tree.posts, immich_url="http://immich", api_key="k")
    client = ImmichClient(settings, session=session)
    assets = client.smart_search("hut", limit=3)
    assert [a.id for a in assets] == ["1-0", "1-1", "2-0"]
    assert len(session.posted) == 2
    assert session.urls[0] == "http://immich/api/search/smart"
    posted = session.posted[0]
    assert posted["query"] == "hut" and posted["type"] == "IMAGE" and posted["size"] == 3
    assert session.posted[1]["page"] == 2


def test_place_doc_and_facts_keys_come_from_the_shared_schema_file():
    """schema-keys.json is what the site's TypeScript readers use too, so the
    scripts must read their keys from it rather than keep copies."""
    schema = json.loads((config.repo_root() / config.SCHEMA_KEYS_FILE).read_text(encoding="utf-8"))
    assert config.schema_keys() == schema
    doc = schema["placeDoc"]
    assert placedoc.SLUG_RE.pattern == doc["slug"]
    assert placedoc.KNOWN_KEYS == tuple(doc["knownKeys"])
    assert placedoc.REQUIRED_KEYS == tuple(doc["requiredKeys"])
    assert set(placedoc.TEXT_KEYS) <= set(placedoc.KNOWN_KEYS)
    for key in doc["requiredKeys"]:
        fields = {k: "x" for k in doc["requiredKeys"] if k != key}
        with pytest.raises(ValueError, match=f"needs a {key}"):
            placedoc.validate_fields(fields)
    assert backfill_terrain.FACTS_PLACE_KEYS == frozenset(schema["factsPlaceKeys"])
