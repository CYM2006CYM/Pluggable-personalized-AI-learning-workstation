"""Private draft reference; exact dtype names remain pending the C environment lock."""

import pandas as pd

COLUMNS = ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]
CITY_MAP = {"上海市": "上海", "沪": "上海", "北京市": "北京", "京": "北京", "广州市": "广州", "穗": "广州"}
VALID_STATUS = {"completed", "pending", "cancelled"}


def clean_orders(df):
    result = df.loc[:, COLUMNS].copy()
    result["_position"] = range(len(result))
    for column in ["order_id", "customer_id", "city", "status", "note"]:
        result[column] = result[column].astype("string").str.strip()
    result = result[result["order_id"].notna() & result["order_id"].ne("")].copy()
    amount_text = result["amount"].astype("string").str.replace(r"[¥￥,\s]", "", regex=True)
    result["amount"] = pd.to_numeric(amount_text, errors="coerce").replace([float("inf"), float("-inf")], pd.NA)
    result["city"] = result["city"].replace(CITY_MAP)
    result["order_date"] = pd.to_datetime(result["order_date"], format="%Y-%m-%d", errors="coerce")
    result["status"] = result["status"].str.lower().where(result["status"].str.lower().isin(VALID_STATUS), pd.NA)
    result["note"] = result["note"].fillna("")
    result["_parseable"] = result["order_date"].notna()
    chosen = result.sort_values(
        ["order_id", "_parseable", "order_date", "_position"],
        ascending=[True, False, False, True],
        kind="stable",
        na_position="last",
    ).drop_duplicates("order_id", keep="first")
    chosen = chosen.sort_values("_position", kind="stable").drop(columns=["_position", "_parseable"])
    for column in ["order_id", "customer_id", "city", "status", "note"]:
        chosen[column] = chosen[column].astype("string")
    return chosen.reset_index(drop=True)
