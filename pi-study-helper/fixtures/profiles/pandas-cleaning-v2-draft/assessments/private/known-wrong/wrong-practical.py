def clean_orders(df):
    return df.dropna().drop_duplicates("order_id", keep="last").sort_values("order_id")
