"""Private non-blocking static engineering checks."""

FORBIDDEN_TOKENS = [
    "open(", "requests.", "urllib.", "socket.", "subprocess.", "os.system(",
    "pip install", "to_csv(", "to_pickle(", "to_parquet(",
]

def run_static_case(source_code):
    lowered = source_code.lower()
    for token in FORBIDDEN_TOKENS:
        assert token.lower() not in lowered
    return {"passed": True, "checked": len(FORBIDDEN_TOKENS)}
