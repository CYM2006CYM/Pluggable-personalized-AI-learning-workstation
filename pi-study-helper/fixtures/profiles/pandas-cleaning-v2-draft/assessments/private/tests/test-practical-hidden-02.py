"""Private executable boundary for practical variant 02."""

import pandas as pd


EXPECTED_COLUMNS = ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]
EXPECTED_ORDER_IDS = [
    "W201", "W202", "W203", "W204", "W205", "W207", "W208", "W209", "W210", "W211",
    "W212", "W213", "W214", "W215", "W216", "W217", "W218", "W219", "W220", "W221", "W222",
]


def run_case(clean_orders, df):
    before = df.copy(deep=True)
    result = clean_orders(df)

    assert df.equals(before)
    assert list(result.columns) == EXPECTED_COLUMNS
    assert result.index.equals(pd.RangeIndex(len(result)))
    assert list(result["order_id"].astype("string")) == EXPECTED_ORDER_IDS
    assert result["order_id"].notna().all()
    assert result["order_id"].is_unique
    assert len(result) == len(EXPECTED_ORDER_IDS)

    for column in ["order_id", "customer_id", "city", "status", "note"]:
        assert str(result[column].dtype) == "string"
    assert pd.api.types.is_numeric_dtype(result["amount"])
    assert pd.api.types.is_datetime64_any_dtype(result["order_date"])

    by_id = result.set_index(result["order_id"])
    assert float(by_id.loc["W202", "amount"]) == 2000.0
    assert by_id.loc["W211", "note"] == "新"
    assert float(by_id.loc["W211", "amount"]) == 12.0
    assert by_id.loc["W212", "note"] == "平局首条"
    assert float(by_id.loc["W212", "amount"]) == 13.0
    assert by_id.loc["W202", "city"] == "上海"
    assert by_id.loc["W203", "city"] == "北京"
    assert by_id.loc["W205", "city"] == "广州"
    assert by_id.loc["W209", "note"] == ""
    assert pd.isna(by_id.loc["W204", "order_date"])
    assert pd.isna(by_id.loc["W210", "order_date"])
    assert pd.isna(by_id.loc["W207", "amount"])
    assert pd.isna(by_id.loc["W207", "status"])
    assert pd.isna(by_id.loc["W214", "status"])
    return result
