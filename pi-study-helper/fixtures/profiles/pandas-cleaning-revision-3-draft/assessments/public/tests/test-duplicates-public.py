"""Public executable contract for act-duplicates."""
def run_case(deduplicate_orders, df):
    before = df.copy(deep=True)
    result = deduplicate_orders(df)
    assert df.equals(before)
    assert result["order_id"].is_unique
    by_id = result.assign(_id=result["order_id"].astype("string").str.strip()).set_index("_id")
    assert str(by_id.loc["O011", "amount"]).strip() == "55"
    assert str(by_id.loc["O012", "amount"]).strip() == "60"
    assert str(by_id.loc["O013", "amount"]).strip() == "70"
    selected_positions = [int(df.index[df["order_id"].astype("string").str.strip() == str(value).strip()][0]) for value in result["order_id"] if str(value) != "<NA>"]
    assert selected_positions == sorted(selected_positions)
    return result
