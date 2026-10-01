import os

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

ALEMBIC_INI = os.path.join(os.path.dirname(__file__), "../alembic.ini")


def test_migrations_round_trip():
    """Upgrade creates the schema and pgvector; downgrade to base and back works cleanly."""
    cfg = Config(ALEMBIC_INI)
    engine = create_engine(os.environ["DATABASE_URL"])

    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        assert {"users", "holdings"} <= set(inspect(conn).get_table_names())
        assert conn.scalar(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")) == 1

    command.downgrade(cfg, "base")
    with engine.connect() as conn:
        assert not {"users", "holdings"} & set(inspect(conn).get_table_names())

    command.upgrade(cfg, "head")
