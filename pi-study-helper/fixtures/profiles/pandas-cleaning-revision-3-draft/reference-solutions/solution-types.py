"""Private draft reference; build validation and evaluator only."""

import pandas as pd

CITY_MAP = {"上海市": "上海", "沪": "上海", "北京市": "北京", "京": "北京", "广州市": "广州", "穗": "广州"}
VALID_STATUS = {"completed", "pending", "cancelled"}


def normalize_types(df):
    result = df.copy()
    for column in ["order_id", "customer_id", "city", "status", "note"]:
        result[column] = result[column].astype("string").str.strip()
    amount_text = result["amount"].astype("string").str.replace(r"[¥￥,\s]", "", regex=True)
    result["amount"] = pd.to_numeric(amount_text, errors="coerce").replace([float("inf"), float("-inf")], pd.NA)
    result["city"] = result["city"].replace(CITY_MAP)
    result["order_date"] = pd.to_datetime(result["order_date"], format="%Y-%m-%d", errors="coerce")
    result["status"] = result["status"].str.lower().where(result["status"].str.lower().isin(VALID_STATUS), pd.NA)
    result["note"] = result["note"].fillna("")
    return result
