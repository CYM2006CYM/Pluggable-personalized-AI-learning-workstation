"""Private executable boundary for act-inspect-dataframe."""
def run_case(inspect_orders, df):
    result = inspect_orders(df)
    assert list(result.columns) == ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]
    assert len(result) <= len(df)
    return result
