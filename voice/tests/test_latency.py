from scripts.check_latency import percentile


def test_nearest_rank_percentile() -> None:
    assert percentile([0.1, 0.2, 0.3, 0.4], 0.5) == 0.2
    assert percentile([0.1, 0.2, 0.3, 0.4], 0.95) == 0.4
