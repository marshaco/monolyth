from decimal import Decimal


def test_health(client):
    res = client.get("/v1/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_holdings_start_empty(client):
    assert client.get("/v1/holdings").json() == []


def test_add_list_remove_holding(client):
    res = client.post("/v1/holdings", json={"ticker": " aapl ", "quantity": "10.5"})
    assert res.status_code == 201
    body = res.json()
    assert body["ticker"] == "AAPL"
    assert body["brokerage"] == "manual"
    assert Decimal(body["quantity"]) == Decimal("10.5")

    client.post("/v1/holdings", json={"ticker": "VOD.L"})
    assert [h["ticker"] for h in client.get("/v1/holdings").json()] == ["AAPL", "VOD.L"]

    assert client.delete("/v1/holdings/aapl").status_code == 204
    assert [h["ticker"] for h in client.get("/v1/holdings").json()] == ["VOD.L"]


def test_duplicate_holding_conflicts(client):
    client.post("/v1/holdings", json={"ticker": "MSFT"})
    res = client.post("/v1/holdings", json={"ticker": "msft"})
    assert res.status_code == 409


def test_invalid_ticker_rejected(client):
    for bad in ["", "AAPL;DROP", "WAYTOOLONGTICKER1", "a b"]:
        assert client.post("/v1/holdings", json={"ticker": bad}).status_code == 422


def test_remove_missing_holding_404s(client):
    assert client.delete("/v1/holdings/NOPE").status_code == 404
