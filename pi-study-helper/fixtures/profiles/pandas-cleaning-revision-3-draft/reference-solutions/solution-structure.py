"""Private draft reference; build validation and evaluator only."""

COLUMNS = ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]


def inspect_orders(df):
    return df.loc[:, COLUMNS].copy()
