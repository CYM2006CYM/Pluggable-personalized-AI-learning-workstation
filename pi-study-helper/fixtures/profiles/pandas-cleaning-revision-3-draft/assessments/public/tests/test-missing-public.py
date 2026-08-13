"""Public executable contract for act-missing."""
def run_case(clean_missing, df):
    result = clean_missing(df)
    assert result["order_id"].notna().all()
    assert result["customer_id"].isna().any()
    assert (result["note"].fillna("") == result["note"]).all()
    return result
