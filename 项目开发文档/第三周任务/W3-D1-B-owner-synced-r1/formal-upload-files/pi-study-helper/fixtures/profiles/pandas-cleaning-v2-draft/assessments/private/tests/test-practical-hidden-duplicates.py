"""Private dimension-specific test: duplicate resolution.

Uses variant-02 dataset.  Focuses exclusively on the duplicates dimension:
priority-based duplicate selection (parseable date, latest date, first original)
and preservation of original relative row order.
"""

EXPECTED_ORDER_IDS = [
    "W201", "W202", "W203", "W204", "W205", "W207", "W208", "W209", "W210", "W211",
    "W212", "W213", "W214", "W215", "W216", "W217", "W218", "W219", "W220", "W221", "W222",
]


def run_case(clean_orders, df):
    result = clean_orders(df)
    assert result["order_id"].is_unique
    by_id = result.set_index(result["order_id"].astype("string").str.strip())
    assert float(by_id.loc["W211", "amount"]) == 12.0
    assert by_id.loc["W211", "note"] == "新"
    assert float(by_id.loc["W212", "amount"]) == 13.0
    assert by_id.loc["W212", "note"] == "平局首条"
    assert list(result["order_id"].astype("string").str.strip()) == EXPECTED_ORDER_IDS
    return result
