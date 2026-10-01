import os


class ConfigError(RuntimeError):
    pass


def sec_user_agent() -> str:
    """SEC requires every request to identify the caller with a contact email, e.g.
    "monolyth admin@yourdomain.com" (https://www.sec.gov/os/accessing-edgar-data).
    Requests without one are rejected, so there's deliberately no default."""
    ua = os.environ.get("SEC_USER_AGENT", "").strip()
    if "@" not in ua:
        raise ConfigError(
            'Set SEC_USER_AGENT to "<app name> <contact email>", e.g. "monolyth admin@example.org". '
            "The SEC rejects requests that don't include a contact email."
        )
    return ua
