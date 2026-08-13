"""Public executable contract for act-practical."""
EXPECTED_COLUMNS = ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]

def run_case(clean_orders, df):
    before = df.copy(deep=True)
    result = clean_orders(df)
    assert df.equals(before)
    assert list(result.columns) == EXPECTED_COLUMNS
    assert result["order_id"].notna().all()
    assert result["order_id"].is_unique
    assert len(result) == 26
    by_id = result.set_index(result["order_id"].astype("string").str.strip())
    assert float(by_id.loc["O011", "amount"]) == 55.0
    assert float(by_id.loc["O012", "amount"]) == 60.0
    assert float(by_id.loc["O013", "amount"]) == 70.0
    assert set(result["status"].dropna().astype(str)).issubset({"completed", "pending", "cancelled"})
    for column in ["order_id", "customer_id", "city", "status", "note"]:
        assert str(result[column].dtype) == "string"
    return result
