def clean_orders(df):
    return df.sort_values("order_id")
