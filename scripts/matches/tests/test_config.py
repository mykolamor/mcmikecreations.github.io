from pathlib import Path

from matches import config


def test_defaults_match_spec():
    assert config.DEFAULT_DATE_WINDOW_DAYS == 3
    assert config.DEFAULT_BM_ACCEPT == 0.004
    assert config.DEFAULT_BM_MARGIN == 3.0
    assert config.DEFAULT_MAE_ACCEPT == 2.5
    assert config.DEFAULT_MAE_MARGIN == 1.5
    assert config.DEFAULT_PHASH_TOP_K == 15
    assert config.DEFAULT_RESIDUAL_TOP_K == 5
    assert config.DEFAULT_ALBUM_COVERAGE_MIN == 0.5
    assert config.DEFAULT_RESIDUAL_BLUR == 3.0


def test_repo_root_contains_static():
    assert (config.repo_root() / "static").is_dir()


def test_settings_paths_are_absolute():
    s = config.Settings()
    assert s.posts_dir.is_absolute()
    assert s.out_dir.is_absolute()
    assert s.cache_dir.is_absolute()
    assert s.out_dir.name == "hikes"
    assert s.cache_dir.parent == s.out_dir


def test_settings_override():
    s = config.Settings(bm_accept=0.01, workers=2)
    assert s.bm_accept == 0.01
    assert s.workers == 2


def test_avif_tier_and_quality_defaults():
    s = config.Settings(api_key="k", immich_url="https://x")
    assert s.avif_quality == config.DEFAULT_AVIF_QUALITY
    assert s.lqip_long_edge == config.DEFAULT_LQIP_LONG_EDGE
    assert s.lqip_quality == config.DEFAULT_LQIP_QUALITY
    assert config.AVIF_TIERS == (640, 1280, 2560)


def test_avif_settings_are_overridable():
    s = config.Settings(api_key="k", immich_url="https://x",
                         avif_quality=60, lqip_long_edge=32, lqip_quality=70)
    assert s.avif_quality == 60
    assert s.lqip_long_edge == 32
    assert s.lqip_quality == 70
