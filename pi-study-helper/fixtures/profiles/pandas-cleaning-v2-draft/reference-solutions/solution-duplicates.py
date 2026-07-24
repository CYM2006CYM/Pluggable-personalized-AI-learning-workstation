"""Private draft reference; build validation and evaluator only."""

import pandas as pd


def deduplicate_orders(df):
    result = df.copy()
    result["_position"] = range(len(result))
    result["_parsed_date"] = pd.to_datetime(result["order_date"], format="%Y-%m-%d", errors="coerce")
    result["_parseable"] = result["_parsed_date"].notna()
    chosen = result.sort_values(
        ["order_id", "_parseable", "_parsed_date", "_position"],
        ascending=[True, False, False, True],
        kind="stable",
        na_position="last",
    ).drop_duplicates("order_id", keep="first")
    return chosen.sort_values("_position", kind="stable").drop(columns=["_position", "_parsed_date", "_parseable"])
