from pathlib import Path

from scripts.export_openapi import OUT, schema_json


def test_committed_openapi_schema_is_current():
    """packages/types is generated from this; regenerate it if the API changed."""
    assert Path(OUT).read_text() == schema_json(), (
        "packages/types/openapi.json is stale. Run: uv run python apps/api/scripts/export_openapi.py "
        "&& (cd packages/types && npm run generate)"
    )
