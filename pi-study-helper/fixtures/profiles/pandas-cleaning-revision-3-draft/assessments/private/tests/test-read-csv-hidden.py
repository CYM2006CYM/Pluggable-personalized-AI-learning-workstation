"""Private variant contract for act-load-csv."""
import pandas as pd

EXPECTED_COLUMNS = ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]


def run_case(load_orders, csv_path):
    result = load_orders(csv_path)
    expected = pd.read_csv(csv_path, dtype="string")
    assert isinstance(result, pd.DataFrame)
    assert list(result.columns) == EXPECTED_COLUMNS
    assert all(str(dtype) == "string" for dtype in result.dtypes)
    pd.testing.assert_frame_equal(result.reset_index(drop=True), expected.reset_index(drop=True))
    return result
