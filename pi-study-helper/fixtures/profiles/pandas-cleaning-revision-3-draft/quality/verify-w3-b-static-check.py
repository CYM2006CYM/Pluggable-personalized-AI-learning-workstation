"""Author-level deterministic checks for the engineering static boundary."""

import importlib.util
import tempfile
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
STATIC_PATH = ROOT / "assessments/private/tests/test-practical-engineering-static.py"


def load(path):
    spec = importlib.util.spec_from_file_location("w3_static_check", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check_source(static, source, expected_pass):
    with tempfile.TemporaryDirectory(prefix="w3-static-") as directory:
        path = Path(directory) / "candidate.py"
        path.write_text(source, encoding="utf-8")
        candidate = load(path).clean_orders
        try:
            static.run_case(candidate, pd.DataFrame())
        except AssertionError as error:
            if expected_pass or str(error) != "static_check_failed":
                raise
        else:
            if not expected_pass:
                raise AssertionError("negative static case unexpectedly passed")


def main():
    static = load(STATIC_PATH)
    reference = load(ROOT / "reference-solutions/solution-practical.py").clean_orders
    static.run_case(reference, pd.DataFrame())
    check_source(static, "def clean_orders(df):\n    import pandas as pd\n    return df.copy()\n", True)
    check_source(static, "def clean_orders(df):\n    import os as operating_system\n    return operating_system.getcwd()\n", False)
    check_source(static, "def clean_orders(df):\n    from subprocess import run as execute\n    return execute([])\n", False)
    check_source(static, "def clean_orders(df):\n    import socket as net\n    return net.create_connection(('localhost', 1))\n", False)
    check_source(static, "def clean_orders(df):\n    import requests as http\n    return http.get('https://example.com')\n", False)
    check_source(static, "def clean_orders(df):\n    import urllib.request as web\n    return web.urlopen('https://example.com')\n", False)
    check_source(static, "def clean_orders(df):\n    import pathlib as paths\n    return paths.Path('.')\n", False)
    check_source(static, "def clean_orders(df):\n    import shutil as files\n    return files.copy('a', 'b')\n", False)
    check_source(static, "def clean_orders(df):\n    return eval('1')\n", False)
    check_source(static, "def clean_orders(df):\n    return exec('pass')\n", False)
    check_source(static, "def clean_orders(df):\n    return open('x')\n", False)
    original_getsource = static.inspect.getsource
    static.inspect.getsource = lambda _: "def clean_orders(:\n    pass\n"
    try:
        try:
            static.run_case(reference, pd.DataFrame())
        except AssertionError as error:
            assert str(error) == "static_check_failed"
        else:
            raise AssertionError("syntax failure unexpectedly passed")
    finally:
        static.inspect.getsource = original_getsource
    print("STATIC AUTHOR CHECK PASSED")


if __name__ == "__main__":
    main()
