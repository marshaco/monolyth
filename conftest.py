import os

import psycopg
import pytest
from alembic import command
from alembic.config import Config

# Tests run against a separate database on the docker-compose Postgres, never the dev one
ADMIN_URL = "postgresql://monolyth:monolyth@localhost:5433/monolyth"
TEST_DB = "monolyth_test"
os.environ["DATABASE_URL"] = f"postgresql+psycopg://monolyth:monolyth@localhost:5433/{TEST_DB}"

ALEMBIC_INI = os.path.join(os.path.dirname(__file__), "packages/db/alembic.ini")


@pytest.fixture(scope="session", autouse=True)
def database():
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        conn.execute(f"CREATE DATABASE {TEST_DB}")
    command.upgrade(Config(ALEMBIC_INI), "head")
    yield
