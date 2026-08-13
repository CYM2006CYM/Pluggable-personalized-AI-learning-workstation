def deduplicate_orders(df):
    return df.drop_duplicates("order_id", keep="last")
