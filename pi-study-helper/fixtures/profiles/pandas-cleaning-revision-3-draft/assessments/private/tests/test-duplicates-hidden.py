"""Private executable boundary for act-duplicates."""
def run_case(deduplicate_orders, df):
    import pandas as pd
    result = deduplicate_orders(df)
    assert result["order_id"].is_unique
    expected = df.copy()
    expected["_position"] = range(len(expected))
    expected["_date"] = pd.to_datetime(expected["order_date"], format="%Y-%m-%d", errors="coerce")
    expected["_parseable"] = expected["_date"].notna()
    expected = expected.sort_values(["order_id", "_parseable", "_date", "_position"], ascending=[True, False, False, True], kind="stable", na_position="last").drop_duplicates("order_id", keep="first").sort_values("_position", kind="stable")
    assert result["amount"].astype("string").tolist() == expected["amount"].astype("string").tolist()
    return result
