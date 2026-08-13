def normalize_types(df):
    result = df.copy()
    result["amount"] = result["amount"].fillna(0)
    return result
