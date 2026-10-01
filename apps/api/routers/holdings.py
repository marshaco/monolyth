import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, BeforeValidator, ConfigDict, StringConstraints
from sqlalchemy import select

from auth import CurrentUser, DbSession
from monolyth_db import Holding

router = APIRouter(prefix="/holdings", tags=["holdings"])

# Letters, digits, dot and dash cover US tickers (BRK.B) and LSE suffixes (VOD.L)
# (normalised before the pattern check, which pydantic otherwise runs on the raw input)
Ticker = Annotated[
    str,
    BeforeValidator(lambda v: v.strip().upper() if isinstance(v, str) else v),
    StringConstraints(pattern=r"^[A-Z0-9.\-]{1,16}$"),
]


class HoldingIn(BaseModel):
    ticker: Ticker
    name: str | None = None
    quantity: Decimal | None = None
    avg_cost: Decimal | None = None


class HoldingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticker: str
    name: str | None
    quantity: Decimal | None
    avg_cost: Decimal | None
    brokerage: str


@router.get("")
def list_holdings(user: CurrentUser, session: DbSession) -> list[HoldingOut]:
    rows = session.scalars(
        select(Holding).where(Holding.user_id == user.id).order_by(Holding.created_at)
    )
    return [HoldingOut.model_validate(h) for h in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def add_holding(body: HoldingIn, user: CurrentUser, session: DbSession) -> HoldingOut:
    exists = session.scalar(
        select(Holding.id).where(
            Holding.user_id == user.id, Holding.ticker == body.ticker, Holding.brokerage == "manual"
        )
    )
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{body.ticker} is already in your holdings")

    holding = Holding(user_id=user.id, brokerage="manual", **body.model_dump())
    session.add(holding)
    session.commit()
    return HoldingOut.model_validate(holding)


@router.delete("/{ticker}", status_code=status.HTTP_204_NO_CONTENT)
def remove_holding(ticker: Ticker, user: CurrentUser, session: DbSession) -> None:
    # Only manual holdings can be removed here; synced ones come back on the next sync
    holding = session.scalar(
        select(Holding).where(
            Holding.user_id == user.id, Holding.ticker == ticker, Holding.brokerage == "manual"
        )
    )
    if holding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{ticker} is not in your holdings")
    session.delete(holding)
    session.commit()
