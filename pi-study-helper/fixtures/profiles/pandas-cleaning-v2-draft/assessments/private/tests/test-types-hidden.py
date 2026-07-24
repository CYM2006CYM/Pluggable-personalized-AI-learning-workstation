"""Private executable boundary for act-types."""
def run_case(normalize_types, df):
    import pandas as pd
    before = df.copy(deep=True)
    result = normalize_types(df)
    assert df.equals(before)
    assert result["amount"].dtype.kind in "fiu"
    assert getattr(result["order_date"].dtype, "tz", None) is None
    raw_amount = df["amount"].astype("string").str.replace(r"[¥￥,\s]", "", regex=True)
    expected_invalid_amount = pd.to_numeric(raw_amount, errors="coerce").replace([float("inf"), float("-inf")], pd.NA).isna()
    assert result.loc[expected_invalid_amount, "amount"].isna().all()
    raw_date = pd.to_datetime(df["order_date"], format="%Y-%m-%d", errors="coerce")
    assert result.loc[raw_date.isna(), "order_date"].isna().all()
    city_map = {"上海市":"上海", "沪":"上海", "北京市":"北京", "京":"北京", "广州市":"广州", "穗":"广州"}
    for original, normalized in city_map.items():
        mask = df["city"].astype("string").str.strip() == original
        if mask.any(): assert (result.loc[mask, "city"] == normalized).all()
    for column in ["order_id", "customer_id", "city", "status", "note"]:
        assert str(result[column].dtype) == "string"
    return result
