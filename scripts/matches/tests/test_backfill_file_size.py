"""Offline tests for the one-time file_size backfill script."""

import json

from matches import backfill_file_size as bf
from matches.tests.conftest import make_asset


class FakeClient:
    def __init__(self, sizes):
        self.sizes = sizes
        self.calls = []

    def get_asset(self, asset_id):
        self.calls.append(asset_id)
        return make_asset(id=asset_id, file_size=self.sizes[asset_id])


def _entry(match=None):
    return {"index": 0, "web_path": "/w", "status": "matched", "match": match}


def test_fills_in_a_missing_file_size():
    report = {"entries": [_entry({"asset_id": "a1", "file_size": 0})]}
    client = FakeClient({"a1": 555})
    updated = bf.backfill_report(report, client, {})
    assert updated == 1
    assert report["entries"][0]["match"]["file_size"] == 555


def test_skips_entries_that_already_have_a_size():
    report = {"entries": [_entry({"asset_id": "a1", "file_size": 999})]}
    client = FakeClient({"a1": 555})
    updated = bf.backfill_report(report, client, {})
    assert updated == 0
    assert client.calls == []
    assert report["entries"][0]["match"]["file_size"] == 999


def test_skips_unmatched_entries():
    report = {"entries": [_entry(None)]}
    client = FakeClient({})
    updated = bf.backfill_report(report, client, {})
    assert updated == 0


def test_reuses_the_cache_across_entries_sharing_an_asset():
    report = {"entries": [
        _entry({"asset_id": "a1", "file_size": 0}),
        _entry({"asset_id": "a1", "file_size": 0}),
    ]}
    client = FakeClient({"a1": 555})
    cache = {}
    updated = bf.backfill_report(report, client, cache)
    assert updated == 2
    assert client.calls == ["a1"]


def test_backfill_report_leaves_the_size_unset_when_immich_returns_zero():
    report = {"entries": [_entry({"asset_id": "a1", "file_size": 0})]}
    client = FakeClient({"a1": 0})
    updated = bf.backfill_report(report, client, {})
    assert updated == 0
    assert report["entries"][0]["match"]["file_size"] == 0


def test_main_writes_updated_reports(tmp_path, monkeypatch):
    out_dir = tmp_path / "hikes"
    out_dir.mkdir()
    report = {"entries": [_entry({"asset_id": "a1", "file_size": 0})]}
    (out_dir / "post.json").write_text(json.dumps(report), encoding="utf-8")

    monkeypatch.setattr(bf, "ImmichClient", lambda settings: FakeClient({"a1": 42}))
    code = bf.main(["--out-dir", str(out_dir), "--immich-url", "https://x",
                    "--api-key", "k"])
    assert code == 0
    saved = json.loads((out_dir / "post.json").read_text(encoding="utf-8"))
    assert saved["entries"][0]["match"]["file_size"] == 42


def test_settings_fall_back_to_the_gui_remembered_credentials(monkeypatch):
    monkeypatch.setattr(bf, "load_saved",
                        lambda: {"api_key": "remembered", "immich_url": "https://remembered"})
    monkeypatch.delenv(bf.config.API_KEY_ENV, raising=False)
    monkeypatch.delenv(bf.config.IMMICH_URL_ENV, raising=False)
    args = bf.build_parser().parse_args([])
    settings = bf.settings_from_args(args)
    assert settings.api_key == "remembered"
    assert settings.immich_url == "https://remembered"


def test_explicit_flags_win_over_remembered_credentials(monkeypatch):
    monkeypatch.setattr(bf, "load_saved",
                        lambda: {"api_key": "remembered", "immich_url": "https://remembered"})
    args = bf.build_parser().parse_args(["--api-key", "explicit", "--immich-url", "https://explicit"])
    settings = bf.settings_from_args(args)
    assert settings.api_key == "explicit"
    assert settings.immich_url == "https://explicit"


def test_main_dry_run_does_not_write(tmp_path, monkeypatch):
    out_dir = tmp_path / "hikes"
    out_dir.mkdir()
    report = {"entries": [_entry({"asset_id": "a1", "file_size": 0})]}
    path = out_dir / "post.json"
    path.write_text(json.dumps(report), encoding="utf-8")

    monkeypatch.setattr(bf, "ImmichClient", lambda settings: FakeClient({"a1": 42}))
    bf.main(["--out-dir", str(out_dir), "--immich-url", "https://x",
            "--api-key", "k", "--dry-run"])
    assert json.loads(path.read_text(encoding="utf-8")) == report
