import bcrypt
import pytest
from fastapi.testclient import TestClient

from engram import auth
from engram.app import create_app
from engram.store import Store, set_store

PASSWORD = "correct horse battery staple"


@pytest.fixture()
def make_client(tmp_path, monkeypatch):
    store = Store(tmp_path / "collection.anki2", seed_demo=False)
    set_store(store)
    clients = []

    def make(hash_value: str, **kw):
        monkeypatch.setenv("ENGRAM_PASSWORD_HASH", hash_value)
        monkeypatch.setenv("ENGRAM_AUTH_DB", str(tmp_path / "auth.db"))
        c = TestClient(create_app(), follow_redirects=False, **kw)
        c.__enter__()
        clients.append(c)
        return c

    yield make
    for c in clients:
        c.__exit__(None, None, None)
    set_store(None)


def bcrypt_hash(pw: str) -> str:
    # Caddy writes $2a$ hashes; make sure those are accepted.
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(4)).decode().replace("$2b$", "$2a$", 1)


def sign_in(c, remember=True, next_="/"):
    data = {"password": PASSWORD, "next": next_}
    if remember:
        data["remember"] = "on"
    return c.post("/login", data=data)


def test_requests_through_a_proxy_need_a_session(make_client):
    c = make_client(bcrypt_hash(PASSWORD))
    assert c.get("/api/decks").status_code == 401
    page = c.get("/browse?deck=Maths")
    assert page.status_code == 303
    assert page.headers["location"] == "/login?next=%2Fbrowse%3Fdeck%3DMaths"
    # The login page and the files an installed app needs stay public.
    assert c.get("/login").status_code == 200
    assert c.get("/manifest.webmanifest").status_code != 401


def test_wrong_password(make_client):
    c = make_client(bcrypt_hash(PASSWORD))
    r = c.post("/login", data={"password": "nope", "remember": "on"})
    assert r.status_code == 401
    assert "not right" in r.text
    assert auth.COOKIE not in r.cookies


def test_sign_in_remembers_for_30_days_then_sign_out(make_client):
    c = make_client(bcrypt_hash(PASSWORD))
    r = sign_in(c, next_="/browse")
    assert r.status_code == 303 and r.headers["location"] == "/browse"
    cookie = r.headers["set-cookie"]
    assert "Max-Age=2592000" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert c.get("/api/decks").status_code == 200
    status = c.get("/api/auth/status").json()
    assert status["signedIn"] and status["remember"] and status["browsers"] == 1

    assert c.post("/api/auth/logout").status_code == 200
    assert c.get("/api/decks").status_code == 401


def test_without_remember_the_cookie_lasts_for_the_browser_session(make_client):
    c = make_client(bcrypt_hash(PASSWORD))
    r = sign_in(c, remember=False)
    assert "Max-Age" not in r.headers["set-cookie"]
    assert c.get("/api/decks").status_code == 200


def test_scrypt_hashes_work_too(make_client):
    from engram.mcp_server.oauth import hash_password

    c = make_client(hash_password(PASSWORD))
    assert sign_in(c).status_code == 303
    assert c.get("/api/decks").status_code == 200


def test_sign_out_other_browsers(make_client):
    h = bcrypt_hash(PASSWORD)
    laptop = make_client(h)
    phone = make_client(h)
    sign_in(laptop)
    sign_in(phone)
    assert laptop.get("/api/auth/status").json()["browsers"] == 2
    assert laptop.post("/api/auth/logout-others").json()["removed"] == 1
    assert laptop.get("/api/decks").status_code == 200
    assert phone.get("/api/decks").status_code == 401


def test_too_many_wrong_passwords_are_refused(make_client):
    c = make_client(bcrypt_hash(PASSWORD))
    for _ in range(auth.MAX_FAILURES):
        c.post("/login", data={"password": "nope"})
    assert sign_in(c).status_code == 429


def test_next_cannot_leave_the_site(make_client):
    c = make_client(bcrypt_hash(PASSWORD))
    for evil in ("//evil.example/x", "https://evil.example", "evil"):
        assert sign_in(c, next_=evil).headers["location"] == "/"


def test_local_requests_are_trusted_but_proxied_ones_are_not(make_client):
    # The deploy health check and the MCP server call 127.0.0.1 directly.
    local = make_client(bcrypt_hash(PASSWORD), client=("127.0.0.1", 50000))
    assert local.get("/api/decks").status_code == 200
    # Caddy also connects from 127.0.0.1, but adds X-Forwarded-For.
    proxied = local.get("/api/decks", headers={"X-Forwarded-For": "203.0.113.9"})
    assert proxied.status_code == 401


def test_off_without_a_password(tmp_path, monkeypatch):
    monkeypatch.delenv("ENGRAM_PASSWORD_HASH", raising=False)
    monkeypatch.delenv("ENGRAM_MCP_PASSWORD_HASH", raising=False)
    set_store(Store(tmp_path / "c.anki2", seed_demo=False))
    with TestClient(create_app()) as c:
        assert c.get("/api/decks").status_code == 200
        assert c.get("/api/auth/status").json() == {"enabled": False}
    set_store(None)
