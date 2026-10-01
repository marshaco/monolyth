import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from main import app
from monolyth_db import get_engine


@pytest.fixture(autouse=True)
def clean_tables():
    yield
    with get_engine().begin() as conn:
        conn.execute(text("TRUNCATE filings, holdings, users CASCADE"))


@pytest.fixture
def client():
    return TestClient(app)
