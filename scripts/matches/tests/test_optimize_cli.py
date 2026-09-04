from matches.optimize_cli import build_parser, settings_from_args


def test_defaults():
    args = build_parser().parse_args([])
    assert args.posts == []
    assert args.force is False
    assert args.dry_run is False


def test_avif_and_lqip_overrides_reach_settings():
    args = build_parser().parse_args(
        ["--avif-quality", "60", "--lqip-quality", "70", "--lqip-long-edge", "32"]
    )
    s = settings_from_args(args)
    assert s.avif_quality == 60
    assert s.lqip_quality == 70
    assert s.lqip_long_edge == 32


def test_posts_argument_reaches_resolve_posts(tmp_path):
    posts = tmp_path / "markdown"
    posts.mkdir()
    (posts / "2024-08-31-aiplspitz.md").write_text("x")
    args = build_parser().parse_args(["2024-08-31-aiplspitz"])
    s = settings_from_args(args)
    s.posts_dir = posts
    from matches.cli import resolve_posts
    assert [p.name for p in resolve_posts(args, s)] == ["2024-08-31-aiplspitz.md"]
