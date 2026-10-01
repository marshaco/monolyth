from fastapi import FastAPI

from routers import filings, health, holdings

app = FastAPI(title="monolyth API", version="0.1.0")

# nginx proxies /api/v1/* here with the /v1 prefix intact (infra/nginx/nginx.conf)
app.include_router(health.router, prefix="/v1")
app.include_router(holdings.router, prefix="/v1")
app.include_router(filings.router, prefix="/v1")
