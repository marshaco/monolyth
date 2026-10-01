"""Resolves the requesting user.

Clerk isn't wired up yet, so every request is treated as a single local dev user.
Replace `current_user` with Clerk session-token verification when auth lands; route
handlers only depend on getting a `User` back, so they won't need to change.
"""

from typing import Annotated

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from monolyth_db import User, get_session

DEV_CLERK_USER_ID = "dev_local_user"


def current_user(session: Annotated[Session, Depends(get_session)]) -> User:
    user = session.scalar(select(User).where(User.clerk_user_id == DEV_CLERK_USER_ID))
    if user is None:
        user = User(clerk_user_id=DEV_CLERK_USER_ID)
        session.add(user)
        session.commit()
    return user


CurrentUser = Annotated[User, Depends(current_user)]
DbSession = Annotated[Session, Depends(get_session)]
