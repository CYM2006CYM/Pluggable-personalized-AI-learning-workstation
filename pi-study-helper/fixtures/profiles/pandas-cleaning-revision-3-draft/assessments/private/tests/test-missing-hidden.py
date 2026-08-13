"""Private executable boundary for act-missing."""
def run_case(clean_missing, df):
    result = clean_missing(df)
    assert result["order_id"].notna().all()
    return result
