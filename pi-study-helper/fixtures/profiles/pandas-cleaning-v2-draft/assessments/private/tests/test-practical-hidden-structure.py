"""Private dimension-specific test: structure (column selection and order).

Uses variant-02 dataset.  Focuses exclusively on the structure dimension:
fixed seven-column selection, column order, and rejection of undeclared columns.
Business semantics (missing/duplicates/types/invariants) are tested by sibling
dimension files; this test must not duplicate those assertions.
"""

EXPECTED_COLUMNS = ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]


def run_case(clean_orders, df):
    probe = df.assign(_unexpected_col=1)
    before_cols = list(probe.columns)
    result = clean_orders(probe)
    assert list(result.columns) == EXPECTED_COLUMNS
    assert len(result.columns) == 7
    assert list(probe.columns) == before_cols
    return result
