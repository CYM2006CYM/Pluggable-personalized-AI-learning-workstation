"""Private dimension-specific test: missing value handling.

Uses variant-02 dataset.  Focuses exclusively on the missing dimension:
order_id-null row deletion, amount coercion to NaN, invalid status to NaN,
and empty-note to empty-string policy.
"""

import pandas as pd


def run_case(clean_orders, df):
    result = clean_orders(df)
    assert result["order_id"].notna().all()
    assert (result["order_id"].astype("string").str.strip() != "").all()
    by_id = result.set_index(result["order_id"].astype("string").str.strip())
    assert "W206" not in by_id.index
    assert pd.isna(by_id.loc["W207", "amount"])
    assert pd.isna(by_id.loc["W207", "status"])
    assert pd.isna(by_id.loc["W214", "status"])
    assert by_id.loc["W209", "note"] == ""
    return result
