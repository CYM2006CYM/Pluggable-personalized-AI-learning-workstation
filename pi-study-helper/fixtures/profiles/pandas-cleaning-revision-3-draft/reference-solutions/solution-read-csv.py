import pandas as pd


def load_orders(csv_path):
    return pd.read_csv(csv_path, dtype="string")
