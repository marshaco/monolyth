"""Writes the API's OpenAPI schema to packages/types/openapi.json.

Run from the repo root: uv run python apps/api/scripts/export_openapi.py
Then regenerate the TypeScript types: cd packages/types && npm run generate
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "apps/api"))

from main import app  # noqa: E402

OUT = ROOT / "packages/types/openapi.json"


def schema_json() -> str:
    return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT.write_text(schema_json())
    print(f"Wrote {OUT.relative_to(ROOT)}")
