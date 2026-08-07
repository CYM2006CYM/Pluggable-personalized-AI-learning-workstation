"""Deterministic AST safety boundary for act-practical engineering."""

import ast
import inspect
import textwrap


FORBIDDEN_MODULES = {
    "os", "subprocess", "socket", "requests", "urllib", "pathlib", "shutil",
}
FORBIDDEN_CALLS = {"eval", "exec", "open"}


def _fail():
    raise AssertionError("static_check_failed")


def _root_name(node):
    while isinstance(node, ast.Attribute):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def run_case(clean_orders, df):
    # Input immutability is owned by the runtime invariant tests; return it so
    # the common candidate harness can enforce its DataFrame output contract.
    try:
        source = textwrap.dedent(inspect.getsource(clean_orders))
        tree = ast.parse(source)
    except (OSError, TypeError, IndentationError, SyntaxError):
        _fail()

    aliases = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for imported in node.names:
                module_root = imported.name.split(".")[0]
                bound_name = imported.asname or module_root
                aliases[bound_name] = imported.name
                if module_root in FORBIDDEN_MODULES:
                    _fail()
        elif isinstance(node, ast.ImportFrom):
            module_root = (node.module or "").split(".")[0]
            if module_root in FORBIDDEN_MODULES:
                _fail()
            for imported in node.names:
                bound_name = imported.asname or imported.name
                aliases[bound_name] = f"{node.module or ''}.{imported.name}"
                if imported.name in FORBIDDEN_CALLS:
                    _fail()
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                bound = aliases.get(node.func.id, node.func.id)
                if node.func.id in FORBIDDEN_CALLS or bound.split(".")[-1] in FORBIDDEN_CALLS:
                    _fail()
            elif isinstance(node.func, ast.Attribute):
                root = _root_name(node.func)
                bound = aliases.get(root, root or "")
                if bound.split(".")[0] in FORBIDDEN_MODULES or node.func.attr in FORBIDDEN_CALLS:
                    _fail()
    return df
