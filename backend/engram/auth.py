"""Signing in to the web app.

One user, one password. Signing in sets a cookie that keeps the browser
signed in for 30 days after it was last used ("remember this browser", on
by default), so a browser you use regularly never asks again. Signing out
forgets that browser; "sign out other browsers" forgets every other one.

Configuration (environment variables):

* ``ENGRAM_PASSWORD_HASH``: the password hash. Either the scrypt format that
  ``python -m engram hash-password`` prints, or a bcrypt hash (``$2a$…``),
  such as the one Caddy's ``basic_auth`` uses, so an existing password keeps
  working. If unset, ``ENGRAM_MCP_PASSWORD_HASH`` is used, so the web app and
  the MCP sign-in share one password.
* With neither set, sign-in is off (local development).

Requests made directly on the server, to 127.0.0.1 without a proxy's
``X-Forwarded-For`` header, are trusted: the deploy health check, the MCP
server's in-process calls, and local tools. Anything arriving through the
reverse proxy needs a session.

Session tokens are stored only as SHA-256 hashes, in SQLite next to the
collection, so restarting the service does not sign anyone out.
"""

from __future__ import annotations

import hashlib
import hmac
import html
import os
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

COOKIE = "engram_session"
REMEMBER_TTL = 30 * 24 * 3600  # signed in for 30 days after last use
BROWSER_SESSION_TTL = 24 * 3600  # "remember" unticked: until the browser closes, at most a day idle
REFRESH_AFTER = 6 * 3600  # extend a remembered session at most every few hours
MAX_FAILURES = 8
FAILURE_WINDOW = 15 * 60

# Files the browser fetches before anyone signs in (installing the app to a
# home screen asks for these without cookies).
PUBLIC_PATHS = {
    "/login",
    "/manifest.webmanifest",
    "/icon.svg",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-maskable.svg",
    "/icon-maskable-192.png",
    "/icon-maskable-512.png",
    "/apple-touch-icon.png",
    "/favicon.ico",
}
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}


# ------------------------------------------------------------------ passwords


def password_hash_from_env() -> str:
    return (os.environ.get("ENGRAM_PASSWORD_HASH") or os.environ.get("ENGRAM_MCP_PASSWORD_HASH") or "").strip()


def check_password(password: str, stored: str) -> bool:
    if not password or not stored:
        return False
    if stored.startswith(("$2a$", "$2b$", "$2y$")):
        import bcrypt

        try:
            return bcrypt.checkpw(password.encode(), stored.replace("$2y$", "$2b$", 1).encode())
        except ValueError:
            return False
    try:
        algo, n, r, p, salt, want = stored.split("$")
        if algo != "scrypt":
            return False
        dk = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), maxmem=64 * 1024 * 1024
        )
        return hmac.compare_digest(dk.hex(), want)
    except (ValueError, TypeError):
        return False


# ------------------------------------------------------------------- sessions


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Sessions:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        with self._db() as db:
            db.execute(
                """create table if not exists sessions (
                    token_hash text primary key,
                    created integer not null,
                    refreshed integer not null,
                    expires integer not null,
                    remember integer not null,
                    user_agent text not null default ''
                )"""
            )

    def _db(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def create(self, remember: bool, user_agent: str) -> str:
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        ttl = REMEMBER_TTL if remember else BROWSER_SESSION_TTL
        with self.lock, self._db() as db:
            db.execute("delete from sessions where expires < ?", (now,))
            db.execute(
                "insert into sessions values (?, ?, ?, ?, ?, ?)",
                (_digest(token), now, now, now + ttl, int(remember), user_agent[:300]),
            )
        return token

    def get(self, token: str | None) -> sqlite3.Row | None:
        if not token:
            return None
        with self.lock, self._db() as db:
            row = db.execute("select * from sessions where token_hash = ?", (_digest(token),)).fetchone()
            if row and row["expires"] < time.time():
                db.execute("delete from sessions where token_hash = ?", (row["token_hash"],))
                return None
            return row

    def refresh(self, token: str, remember: bool) -> None:
        now = int(time.time())
        ttl = REMEMBER_TTL if remember else BROWSER_SESSION_TTL
        with self.lock, self._db() as db:
            db.execute(
                "update sessions set refreshed = ?, expires = ? where token_hash = ?", (now, now + ttl, _digest(token))
            )

    def delete(self, token: str | None) -> None:
        if token:
            with self.lock, self._db() as db:
                db.execute("delete from sessions where token_hash = ?", (_digest(token),))

    def delete_others(self, token: str) -> int:
        with self.lock, self._db() as db:
            return db.execute("delete from sessions where token_hash != ?", (_digest(token),)).rowcount

    def count(self) -> int:
        with self.lock, self._db() as db:
            return db.execute("select count() from sessions where expires >= ?", (int(time.time()),)).fetchone()[0]


class Failures:
    """Wrong passwords in the last 15 minutes, across all browsers."""

    def __init__(self):
        self.times: list[float] = []
        self.lock = threading.Lock()

    def blocked(self) -> bool:
        with self.lock:
            cutoff = time.time() - FAILURE_WINDOW
            self.times = [t for t in self.times if t > cutoff]
            return len(self.times) >= MAX_FAILURES

    def add(self) -> None:
        with self.lock:
            self.times.append(time.time())


# ------------------------------------------------------------------ the gate


def _is_local(request: Request) -> bool:
    host = request.client.host if request.client else ""
    forwarded = request.headers.get("x-forwarded-for") or request.headers.get("forwarded")
    return host in LOCAL_HOSTS and not forwarded


def _is_https(request: Request) -> bool:
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


def _set_cookie(response: Response, request: Request, token: str, remember: bool) -> None:
    response.set_cookie(
        COOKIE,
        token,
        max_age=REMEMBER_TTL if remember else None,
        httponly=True,
        secure=_is_https(request),
        samesite="lax",
        path="/",
    )


def _safe_next(target: str | None) -> str:
    # Only same-site paths, never "//evil.example" or a full URL.
    if not target or not target.startswith("/") or target.startswith("//") or target.startswith("/login"):
        return "/"
    return target


def install(app: FastAPI, sessions_path: Path | None = None) -> None:
    """Add sign-in to the app. Does nothing when no password is configured."""
    password_hash = password_hash_from_env()
    app.state.auth_enabled = bool(password_hash)
    router = APIRouter()
    failures = Failures()
    state: dict[str, Sessions] = {}

    def sessions() -> Sessions:
        if "s" not in state:
            path = sessions_path
            if path is None:
                from .store import get_store

                path = Path(os.environ.get("ENGRAM_AUTH_DB") or get_store().path.parent / "auth.db")
            state["s"] = Sessions(path)
        return state["s"]

    @router.get("/api/auth/status")
    def status(request: Request) -> dict:
        if not password_hash:
            return {"enabled": False}
        row = sessions().get(request.cookies.get(COOKIE))
        return {
            "enabled": True,
            "signedIn": row is not None or _is_local(request),
            "remember": bool(row["remember"]) if row else None,
            "since": row["created"] if row else None,
            "expires": row["expires"] if row else None,
            "browsers": sessions().count(),
        }

    @router.post("/api/auth/logout")
    def logout(request: Request) -> Response:
        if password_hash:
            sessions().delete(request.cookies.get(COOKIE))
        response = JSONResponse({"ok": True})
        response.delete_cookie(COOKIE, path="/")
        return response

    @router.post("/api/auth/logout-others")
    def logout_others(request: Request) -> dict:
        token = request.cookies.get(COOKIE)
        if not password_hash or not token:
            return {"removed": 0}
        return {"removed": sessions().delete_others(token)}

    @router.get("/login", include_in_schema=False)
    def login_page(request: Request, next: str = "/") -> Response:
        if not password_hash or sessions().get(request.cookies.get(COOKIE)):
            return RedirectResponse(_safe_next(next), status_code=303)
        return _login_html(_safe_next(next))

    @router.post("/login", include_in_schema=False)
    async def login(request: Request) -> Response:
        form = await request.form()
        target = _safe_next(str(form.get("next", "/")))
        if not password_hash:
            return RedirectResponse(target, status_code=303)
        if failures.blocked():
            return _login_html(target, "Too many wrong passwords. Try again in 15 minutes.", status=429)
        if not check_password(str(form.get("password", "")), password_hash):
            failures.add()
            return _login_html(target, "That password is not right.", status=401)
        remember = form.get("remember") is not None
        token = sessions().create(remember, request.headers.get("user-agent", ""))
        response = RedirectResponse(target, status_code=303)
        _set_cookie(response, request, token, remember)
        return response

    app.include_router(router)

    if not password_hash:
        return

    @app.middleware("http")
    async def require_sign_in(request: Request, call_next):
        path = request.url.path
        if path in PUBLIC_PATHS or _is_local(request):
            return await call_next(request)
        token = request.cookies.get(COOKIE)
        row = sessions().get(token)
        if row is None:
            if path.startswith("/api/"):
                return JSONResponse({"detail": "Not signed in."}, status_code=401)
            target = path + (f"?{request.url.query}" if request.url.query else "")
            return RedirectResponse(f"/login?next={quote(target, safe='')}", status_code=303)
        response = await call_next(request)
        # Using a browser keeps it signed in: push the expiry forward now and then.
        if time.time() - row["refreshed"] > REFRESH_AFTER:
            remember = bool(row["remember"])
            sessions().refresh(token, remember)
            _set_cookie(response, request, token, remember)
        return response


# ------------------------------------------------------------------ the page


def _login_html(target: str, error: str = "", status: int = 200) -> HTMLResponse:
    err = f'<p class="err" role="alert">{html.escape(error)}</p>' if error else ""
    page = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign in · Engram</title>
<link rel="icon" href="/icon.svg"><link rel="manifest" href="/manifest.webmanifest">
<style>
:root {{ --bg:#f7f4ee; --card:#fffdf9; --line:#e6dfd2; --text:#2a2824; --muted:#8d8678; --accent:#8a3434; --accent-hover:#722828; --err:#b2492c; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#1c1b18; --card:#23221f; --line:#34322d; --text:#e9e5dc; --muted:#8a8477; --accent:#dc9a96; --accent-hover:#e8b1ad; --err:#e08a6c; }} }}
* {{ box-sizing:border-box; }}
body {{ margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; background:var(--bg); color:var(--text);
  font:15px/1.5 "Source Sans 3", "Gill Sans", "Segoe UI", system-ui, sans-serif; }}
main {{ width:100%; max-width:360px; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:28px 28px 24px; }}
h1 {{ margin:0 0 4px; font:500 30px/1.2 "Newsreader", "Iowan Old Style", Georgia, serif; }}
p.lede {{ margin:0 0 20px; color:var(--muted); }}
label.pw {{ display:block; font-size:13px; color:var(--muted); margin-bottom:6px; }}
input[type=password] {{ width:100%; font:inherit; padding:9px 11px; border:1px solid var(--line); border-radius:4px; background:var(--bg); color:var(--text); }}
input[type=password]:focus {{ outline:2px solid var(--accent); outline-offset:1px; }}
label.rm {{ display:flex; gap:8px; align-items:center; margin:14px 0 18px; font-size:14px; }}
input[type=checkbox] {{ accent-color:var(--accent); width:15px; height:15px; margin:0; }}
button {{ width:100%; font:inherit; font-weight:600; padding:9px; border:0; border-radius:4px; background:var(--accent); color:#fff; cursor:pointer; }}
button:hover {{ background:var(--accent-hover); }}
@media (prefers-color-scheme: dark) {{ button {{ color:#2a1414; }} }}
.err {{ color:var(--err); margin:0 0 14px; }}
</style></head>
<body><main>
<h1>Engram</h1>
<p class="lede">Sign in to your flashcards.</p>
{err}
<form method="post" action="/login">
  <input type="hidden" name="next" value="{html.escape(target, quote=True)}">
  <input type="text" name="username" value="engram" autocomplete="username" hidden>
  <label class="pw" for="pw">Password</label>
  <input id="pw" type="password" name="password" autocomplete="current-password" required autofocus>
  <label class="rm"><input type="checkbox" name="remember" checked> Remember this browser for 30 days</label>
  <button type="submit">Sign in</button>
</form>
</main></body></html>"""
    return HTMLResponse(page, status_code=status, headers={"Cache-Control": "no-store"})
