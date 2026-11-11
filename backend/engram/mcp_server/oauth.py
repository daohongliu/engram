"""A single-user OAuth 2.1 authorization server for the Engram MCP server.

The MCP SDK provides the protocol endpoints (metadata, /register, /authorize,
/token, /revoke) and checks PKCE and redirect URIs; this module supplies the
storage behind them and the login page where the one user enters a password.

Tokens and codes are stored only as SHA-256 hashes, in SQLite, so restarting
the service does not sign Claude out.
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
from urllib.parse import urlparse

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

ACCESS_TTL = 60 * 60  # 1 hour
REFRESH_TTL = 60 * 60 * 24 * 60  # 60 days, rotated on every use
CODE_TTL = 5 * 60
LOGIN_TTL = 10 * 60
MAX_FAILURES = 8  # wrong passwords per window, across all clients
FAILURE_WINDOW = 15 * 60

# Where an authorization code may be sent: Claude's hosted apps, and Claude
# Code's loopback redirect (any port). Registrations asking for anything else
# are refused, so the login page can only ever hand a code to Claude.
HOSTED_CALLBACKS = {
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
}


def redirect_allowed(uri: str) -> bool:
    if uri in HOSTED_CALLBACKS:
        return True
    p = urlparse(uri)
    return p.scheme == "http" and p.hostname in ("localhost", "127.0.0.1") and not p.username


# ---------------------------------------------------------------- passwords


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    n, r, p = 2**15, 8, 1
    dk = hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, maxmem=64 * 1024 * 1024)
    return f"scrypt${n}${r}${p}${salt.hex()}${dk.hex()}"


def check_password(password: str, stored: str) -> bool:
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


def _h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---------------------------------------------------------------- provider


class SingleUserProvider:
    """OAuthAuthorizationServerProvider backed by SQLite, for exactly one user."""

    def __init__(self, db_path: str | Path, issuer_url: str, resource_url: str, password_hash: str):
        self.issuer = issuer_url.rstrip("/")
        self.resource = resource_url
        self.password_hash = password_hash
        self._lock = threading.Lock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path), check_same_thread=False, isolation_level=None)
        self.db.execute("pragma journal_mode=wal")
        self.db.executescript(
            """
            create table if not exists clients (client_id text primary key, info text, created real, used real);
            create table if not exists pending (id text primary key, client_id text, params text, created real);
            create table if not exists codes (hash text primary key, data text, expires real);
            create table if not exists tokens (hash text primary key, kind text, client_id text,
                                               family text, data text, expires real);
            create table if not exists failures (ts real);
            """
        )
        try:
            os.chmod(db_path, 0o600)
        except OSError:
            pass

    def _q(self, sql: str, *args):
        with self._lock:
            return self.db.execute(sql, args).fetchall()

    def _x(self, sql: str, *args) -> int:
        """Execute a write and return how many rows it touched."""
        with self._lock:
            return self.db.execute(sql, args).rowcount

    def _cleanup(self) -> None:
        now = time.time()
        self._q("delete from pending where created < ?", now - LOGIN_TTL)
        self._q("delete from codes where expires < ?", now)
        self._q("delete from tokens where expires < ?", now)
        self._q("delete from failures where ts < ?", now - FAILURE_WINDOW)
        # Registrations that never completed a sign-in within a day.
        self._q("delete from clients where used is null and created < ?", now - 86400)

    # -- clients

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        rows = self._q("select info from clients where client_id = ?", client_id)
        return OAuthClientInformationFull.model_validate_json(rows[0][0]) if rows else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        uris = [str(u) for u in (client_info.redirect_uris or [])]
        if not uris or not all(redirect_allowed(u) for u in uris):
            raise RegistrationError(
                "invalid_redirect_uri",
                "This server only signs in Claude (claude.ai callback or a localhost redirect).",
            )
        self._cleanup()
        if self._q("select count(*) from clients")[0][0] >= 500:
            raise RegistrationError("invalid_client_metadata", "Too many registered clients.")
        self._q(
            "insert or replace into clients values (?, ?, ?, null)",
            client_info.client_id,
            client_info.model_dump_json(),
            time.time(),
        )

    # -- authorization

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        self._cleanup()
        request_id = secrets.token_urlsafe(24)
        self._q(
            "insert into pending values (?, ?, ?, ?)",
            request_id,
            client.client_id,
            params.model_dump_json(),
            time.time(),
        )
        return f"{self.issuer}/oauth/login?request={request_id}"

    async def load_authorization_code(self, client: OAuthClientInformationFull, authorization_code: str):
        rows = self._q("select data, expires from codes where hash = ?", _h(authorization_code))
        if not rows:
            return None
        code = AuthorizationCode.model_validate_json(rows[0][0])
        return code if code.client_id == client.client_id else None

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        if not self._x("delete from codes where hash = ?", _h(authorization_code.code)):
            raise TokenError("invalid_grant", "Authorization code already used.")
        self._q("update clients set used = ? where client_id = ?", time.time(), client.client_id)
        return self._issue(client.client_id, authorization_code.scopes, authorization_code.resource)

    # -- tokens

    def _issue(self, client_id: str, scopes: list[str], resource: str | None, family: str | None = None) -> OAuthToken:
        now = int(time.time())
        family = family or secrets.token_hex(8)
        access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        a = AccessToken(token="", client_id=client_id, scopes=scopes, expires_at=now + ACCESS_TTL,
                        resource=resource, subject="owner")
        r = RefreshToken(token="", client_id=client_id, scopes=scopes, expires_at=now + REFRESH_TTL,
                         resource=resource, subject="owner")
        self._q("insert into tokens values (?, 'access', ?, ?, ?, ?)", _h(access), client_id, family,
                a.model_dump_json(), a.expires_at)
        self._q("insert into tokens values (?, 'refresh', ?, ?, ?, ?)", _h(refresh), client_id, family,
                r.model_dump_json(), r.expires_at)
        return OAuthToken(
            access_token=access,
            token_type="Bearer",
            expires_in=ACCESS_TTL,
            refresh_token=refresh,
            scope=" ".join(scopes) if scopes else None,
        )

    def _load(self, token: str, kind: str):
        rows = self._q("select data, expires, family from tokens where hash = ? and kind = ?", _h(token), kind)
        if not rows or rows[0][1] < time.time():
            return None, None
        model = AccessToken if kind == "access" else RefreshToken
        return model.model_validate_json(rows[0][0]).model_copy(update={"token": token}), rows[0][2]

    async def load_refresh_token(self, client: OAuthClientInformationFull, refresh_token: str):
        tok, _ = self._load(refresh_token, "refresh")
        return tok if tok and tok.client_id == client.client_id else None

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        if scopes and not set(scopes) <= set(refresh_token.scopes):
            raise TokenError("invalid_scope", "Cannot widen scopes on refresh.")
        rows = self._q("select family from tokens where hash = ? and kind = 'refresh'", _h(refresh_token.token))
        if not rows:
            raise TokenError("invalid_grant", "Refresh token is no longer valid.")
        family = rows[0][0]
        # Rotation: the old refresh token and the access tokens it produced end here.
        self._q("delete from tokens where family = ?", family)
        return self._issue(client.client_id, scopes or refresh_token.scopes, refresh_token.resource)

    async def load_access_token(self, token: str) -> AccessToken | None:
        tok, _ = self._load(token, "access")
        if tok and tok.resource and tok.resource.rstrip("/") != self.resource.rstrip("/"):
            return None  # issued for some other resource
        return tok

    async def revoke_token(self, token) -> None:
        rows = self._q("select family from tokens where hash = ?", _h(token.token))
        if rows:
            self._q("delete from tokens where family = ?", rows[0][0])

    # -- the login page

    def _failures(self) -> int:
        return self._q("select count(*) from failures where ts > ?", time.time() - FAILURE_WINDOW)[0][0]

    async def login_page(self, request: Request) -> Response:
        if request.method == "GET":
            request_id = request.query_params.get("request", "")
            pending = self._pending(request_id)
            if not pending:
                return _page("This sign-in link has expired. Go back to Claude and connect again.", status=400)
            client, params = pending
            return _login_form(request_id, client, params)

        form = await request.form()
        request_id = str(form.get("request", ""))
        pending = self._pending(request_id)
        if not pending:
            return _page("This sign-in link has expired. Go back to Claude and connect again.", status=400)
        client, params = pending
        redirect = str(params.redirect_uri)

        if form.get("action") == "deny":
            self._q("delete from pending where id = ?", request_id)
            return RedirectResponse(
                construct_redirect_uri(redirect, error="access_denied", state=params.state), status_code=302
            )

        if self._failures() >= MAX_FAILURES:
            return _page("Too many wrong passwords. Try again in 15 minutes.", status=429)
        if not check_password(str(form.get("password", "")), self.password_hash):
            self._q("insert into failures values (?)", time.time())
            return _login_form(request_id, client, params, error="Wrong password.")

        self._q("delete from pending where id = ?", request_id)
        code = secrets.token_urlsafe(32)
        ac = AuthorizationCode(
            code="",
            scopes=params.scopes or [],
            expires_at=time.time() + CODE_TTL,
            client_id=client.client_id,
            code_challenge=params.code_challenge,
            redirect_uri=params.redirect_uri,
            redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            resource=params.resource,
            subject="owner",
        )
        self._q("insert into codes values (?, ?, ?)", _h(code), ac.model_copy(update={"code": code}).model_dump_json(),
                ac.expires_at)
        return RedirectResponse(
            construct_redirect_uri(redirect, code=code, state=params.state, iss=self.issuer), status_code=302
        )

    def _pending(self, request_id: str):
        if not request_id:
            return None
        rows = self._q("select client_id, params, created from pending where id = ?", request_id)
        if not rows or rows[0][2] < time.time() - LOGIN_TTL:
            return None
        info = self._q("select info from clients where client_id = ?", rows[0][0])
        if not info:
            return None
        client = OAuthClientInformationFull.model_validate_json(info[0][0])
        return client, AuthorizationParams.model_validate_json(rows[0][1])


# ---------------------------------------------------------------- HTML

_STYLE = """
:root { color-scheme: light dark; --bg:#f7f4ee; --fg:#26241f; --muted:#6d685d; --card:#fffdf8; --line:#e2dccf; --accent:#7a4e2d; }
@media (prefers-color-scheme: dark) { :root { --bg:#1c1b18; --fg:#ece7dc; --muted:#a39d90; --card:#252420; --line:#3a3832; --accent:#d9a77a; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
       font: 16px/1.5 Georgia, "Iowan Old Style", serif; padding:16px; }
main { width:100%; max-width:380px; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:28px; }
h1 { font-size:1.3rem; margin:0 0 6px; }
p { color:var(--muted); margin:0 0 18px; font-size:.95rem; }
label { display:block; font-size:.9rem; margin-bottom:6px; }
input[type=password] { width:100%; font:inherit; padding:10px 12px; border:1px solid var(--line); border-radius:8px;
       background:var(--bg); color:var(--fg); }
.row { display:flex; gap:10px; margin-top:16px; }
button { flex:1; font:inherit; padding:10px; border-radius:8px; border:1px solid var(--line); background:transparent;
         color:var(--fg); cursor:pointer; }
button.primary { background:var(--accent); border-color:var(--accent); color:var(--card); }
.err { color:#b3412e; font-size:.9rem; margin:10px 0 0; }
code { font-size:.85rem; }
"""


def _page(body: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(
        f"<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>Engram</title><style>{_STYLE}</style><main><h1>Engram</h1><p>{html.escape(body)}</p></main></html>",
        status_code=status,
        headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY"},
    )


def _login_form(request_id: str, client: OAuthClientInformationFull, params: AuthorizationParams,
                error: str | None = None) -> HTMLResponse:
    name = client.client_name or "An MCP client"
    dest = urlparse(str(params.redirect_uri))
    where = dest.hostname if dest.scheme == "https" else f"{dest.hostname} (an app on your own computer)"
    err = f"<div class=err>{html.escape(error)}</div>" if error else ""
    body = f"""<!doctype html><html lang=en><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Connect to Engram</title>
<style>{_STYLE}</style>
<main>
  <h1>Connect to Engram</h1>
  <p><strong>{html.escape(name)}</strong> wants to read your decks and add cards.
     After you sign in, it is sent back to <code>{html.escape(where or "?")}</code>.</p>
  <form method=post action="/oauth/login">
    <input type=hidden name=request value="{html.escape(request_id)}">
    <label for=pw>Password</label>
    <input id=pw type=password name=password autocomplete=current-password autofocus>
    {err}
    <div class=row>
      <button type=submit name=action value=deny formnovalidate>Cancel</button>
      <button type=submit name=action value=allow class=primary>Allow</button>
    </div>
  </form>
</main></html>"""
    return HTMLResponse(body, status_code=200,
                        headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY"})
