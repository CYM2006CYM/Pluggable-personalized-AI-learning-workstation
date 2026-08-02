"""Public executable contract for act-inspect-dataframe."""
EXPECTED_COLUMNS = ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]

def run_case(inspect_orders, df):
    probe = df.assign(_unexpected=1)
    before = list(probe.columns)
    result = inspect_orders(probe)
    assert list(result.columns) == EXPECTED_COLUMNS
    assert list(probe.columns) == before
    return result
