import os

# Matches the defaults in infra/docker-compose.yml (Postgres published on host port 5433)
DEFAULT_DATABASE_URL = "postgresql+psycopg://monolyth:monolyth@localhost:5433/monolyth"


def database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
