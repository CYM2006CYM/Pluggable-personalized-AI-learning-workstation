"""Public executable contract for act-types."""
def run_case(normalize_types, df):
    before = df.copy(deep=True)
    result = normalize_types(df)
    assert df.equals(before)
    assert result["amount"].dtype.kind in "fiu"
    assert getattr(result["order_date"].dtype, "tz", None) is None
    assert set(result["status"].dropna().astype(str)).issubset({"completed", "pending", "cancelled"})
    by_id = result.assign(_id=result["order_id"].astype("string").str.strip()).set_index("_id")
    for order_id in ["O004", "O009", "O015"]:
        assert bool(__import__("pandas").isna(by_id.loc[order_id, "amount"]))
    for order_id in ["O004", "O010", "O017"]:
        assert __import__("pandas").isna(by_id.loc[order_id, "order_date"])
    expected_cities = {"O001":"上海", "O002":"上海", "O003":"北京", "O004":"北京", "O005":"广州", "O007":"深圳"}
    for order_id, city in expected_cities.items():
        assert str(by_id.loc[order_id, "city"]) == city
    for column in ["order_id", "customer_id", "city", "status", "note"]:
        assert str(result[column].dtype) == "string"
    return result
