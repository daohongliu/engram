from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .routes import browse, decks, files, notes, review, stats
from .store import get_store, set_store

STATIC = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_store()
    yield
    store = get_store()
    store.close()
    set_store(None)


def create_app() -> FastAPI:
    app = FastAPI(title="Better Anki", lifespan=lifespan)
    for module in (decks, review, browse, notes, stats, files):
        app.include_router(module.router)

    @app.exception_handler(Exception)
    async def unexpected(_request: Request, exc: Exception):  # pragma: no cover
        return JSONResponse({"detail": f"{type(exc).__name__}: {exc}"}, status_code=500)

    if (STATIC / "assets").exists():
        app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Unknown endpoint.")
        candidate = (STATIC / path).resolve()
        if path and STATIC in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        index = STATIC / "index.html"
        if not index.exists():
            return JSONResponse(
                {"detail": "Frontend not built. Run `npm run build` in frontend/, or use `npm run dev`."},
                status_code=503,
            )
        return FileResponse(index)

    return app


app = create_app()
