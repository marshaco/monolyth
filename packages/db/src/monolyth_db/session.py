from collections.abc import Iterator
from functools import cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from monolyth_db.config import database_url


@cache
def get_engine() -> Engine:
    return create_engine(database_url(), pool_pre_ping=True)


@cache
def _session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """Yields a session per request; usable directly as a FastAPI dependency."""
    with _session_factory()() as session:
        yield session
