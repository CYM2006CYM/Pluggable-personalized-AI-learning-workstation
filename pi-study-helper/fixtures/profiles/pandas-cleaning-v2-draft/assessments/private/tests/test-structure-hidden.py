"""Private executable boundary for act-structure."""
def run_case(clean_orders, df):
    result = clean_orders(df)
    assert list(result.columns) == ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]
    assert len(result) <= len(df)
    return result
