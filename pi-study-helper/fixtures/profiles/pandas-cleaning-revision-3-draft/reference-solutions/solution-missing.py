"""Private draft reference; build validation and evaluator only."""


def clean_missing(df):
    result = df.copy()
    result["order_id"] = result["order_id"].astype("string").str.strip()
    result = result[result["order_id"].notna() & result["order_id"].ne("")].copy()
    result["note"] = result["note"].astype("string").fillna("").str.strip()
    return result
