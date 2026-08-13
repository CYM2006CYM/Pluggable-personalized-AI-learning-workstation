"""Private executable boundary for practical variant 01."""
def run_case(clean_orders, df):
    before = df.copy(deep=True)
    result = clean_orders(df)
    assert df.equals(before)
    assert result["order_id"].notna().all()
    assert result["order_id"].is_unique
    assert list(result.columns) == ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]
    assert set(result["status"].dropna().astype(str)).issubset({"completed", "pending", "cancelled"})
    for column in ["order_id", "customer_id", "city", "status", "note"]:
        assert str(result[column].dtype) == "string"
    return result
