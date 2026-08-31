"""Private dimension-specific test: type and format normalization.

Uses variant-02 dataset.  Focuses exclusively on the types dimension:
StringDtype for string columns, numeric coercion for amount, datetime
conversion for order_date, city alias mapping, and currency symbol removal.
"""

import pandas as pd


def run_case(clean_orders, df):
    result = clean_orders(df)
    for column in ["order_id", "customer_id", "city", "status", "note"]:
        assert str(result[column].dtype) == "string"
    assert pd.api.types.is_numeric_dtype(result["amount"])
    assert pd.api.types.is_datetime64_any_dtype(result["order_date"])
    by_id = result.set_index(result["order_id"].astype("string").str.strip())
    assert float(by_id.loc["W202", "amount"]) == 2000.0
    assert by_id.loc["W202", "city"] == "上海"
    assert by_id.loc["W203", "city"] == "北京"
    assert by_id.loc["W205", "city"] == "广州"
    assert pd.isna(by_id.loc["W204", "order_date"])
    assert pd.isna(by_id.loc["W210", "order_date"])
    return result
