import pytest

from matches.cli import build_parser, settings_from_args
from matches.cliutil import resolve_posts


def test_zero_posts_and_albums_is_valid():
    args = build_parser().parse_args([])
    assert args.posts == []
    assert args.album == []


def test_multiple_posts_and_albums():
    args = build_parser().parse_args(
        ["2024-08-31-aiplspitz.md", "2025-08-13-omis_fort.md",
         "--album", "Croatia_Omis_Duce", "--album", "Chroatia_Omis"]
    )
    assert len(args.posts) == 2
    assert args.album == ["Croatia_Omis_Duce", "Chroatia_Omis"]


def test_threshold_overrides_reach_settings():
    args = build_parser().parse_args(["--bm-accept", "0.01", "--mae-margin", "2.5",
                                      "--workers", "3", "--date-window-days", "5"])
    s = settings_from_args(args)
    assert s.bm_accept == 0.01
    assert s.mae_margin == 2.5
    assert s.workers == 3
    assert s.date_window_days == 5


def test_no_cache_flag():
    s = settings_from_args(build_parser().parse_args(["--no-cache"]))
    assert s.use_cache is False


def test_resolve_posts_accepts_name_without_extension(tmp_path):
    posts = tmp_path / "markdown"
    posts.mkdir()
    (posts / "2024-08-31-aiplspitz.md").write_text("x")
    (posts / "2024-09-07-simetsberg.md").write_text("x")
    args = build_parser().parse_args(["2024-08-31-aiplspitz"])
    s = settings_from_args(args)
    s.posts_dir = posts
    assert [p.name for p in resolve_posts(args, s)] == ["2024-08-31-aiplspitz.md"]


def test_resolve_posts_empty_means_all(tmp_path):
    posts = tmp_path / "markdown"
    posts.mkdir()
    (posts / "b.md").write_text("x")
    (posts / "a.md").write_text("x")
    args = build_parser().parse_args([])
    s = settings_from_args(args)
    s.posts_dir = posts
    assert [p.name for p in resolve_posts(args, s)] == ["a.md", "b.md"]


def test_resolve_posts_rejects_unknown_name(tmp_path):
    posts = tmp_path / "markdown"
    posts.mkdir()
    args = build_parser().parse_args(["nope.md"])
    s = settings_from_args(args)
    s.posts_dir = posts
    with pytest.raises(SystemExit):
        resolve_posts(args, s)


def test_resolve_posts_rejects_path_separators(tmp_path):
    posts = tmp_path / "markdown"
    posts.mkdir()
    (posts / "a.md").write_text("x")
    args = build_parser().parse_args(["sub/a.md"])
    s = settings_from_args(args)
    s.posts_dir = posts
    with pytest.raises(SystemExit):
        resolve_posts(args, s)
