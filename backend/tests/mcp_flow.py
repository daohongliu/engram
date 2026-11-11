"""End-to-end check of the MCP server: OAuth exactly as Claude does it, then every tool.

Run by test_mcp.py against a throwaway Engram, or by hand against a running one:

    ENGRAM_MCP_URL=http://127.0.0.1:8001 ENGRAM_MCP_TEST_PASSWORD=... python tests/mcp_flow.py
"""

import asyncio
import base64
import hashlib
import json
import os
import re
import secrets
import sys
from urllib.parse import parse_qs, urlparse

import httpx
from mcp import ClientSession
import httpx2
from mcp.client.streamable_http import streamable_http_client

BASE = os.environ.get("ENGRAM_MCP_URL", "http://127.0.0.1:8001")
PASSWORD = os.environ["ENGRAM_MCP_TEST_PASSWORD"]
CALLBACK = "https://claude.ai/api/mcp/auth_callback"
ok = 0


def check(cond, what):
    global ok
    if not cond:
        sys.exit(f"FAIL: {what}")
    ok += 1
    print(f"  ok  {what}")


def pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


def login(c, client_id, password, verifier_challenge, state="st4te"):
    _, challenge = verifier_challenge
    r = c.get("/authorize", params={
        "response_type": "code", "client_id": client_id, "redirect_uri": CALLBACK,
        "code_challenge": challenge, "code_challenge_method": "S256", "state": state,
        "scope": "engram", "resource": f"{BASE}/mcp",
    })
    check(r.status_code == 302 and "/oauth/login?request=" in r.headers["location"], "authorize -> login page")
    login_url = r.headers["location"]
    page = c.get(login_url.replace(BASE, ""))
    check(page.status_code == 200 and "Connect to Engram" in page.text and "claude.ai" in page.text,
          "login page names the client destination")
    request_id = parse_qs(urlparse(login_url).query)["request"][0]
    return c.post("/oauth/login", data={"request": request_id, "password": password, "action": "allow"}), request_id


def main():
    c = httpx.Client(base_url=BASE, follow_redirects=False)

    print("discovery")
    r = c.post("/mcp", json={})
    check(r.status_code == 401, "unauthenticated /mcp -> 401")
    m = re.search(r'resource_metadata="([^"]+)"', r.headers.get("www-authenticate", ""))
    check(m is not None, "401 carries resource_metadata pointer")
    prm = httpx.get(m.group(1)).json()
    check(prm["resource"] == f"{BASE}/mcp", "protected resource metadata names /mcp")
    asm = c.get("/.well-known/oauth-authorization-server").json()
    check("S256" in asm["code_challenge_methods_supported"], "AS metadata advertises S256")
    check(asm.get("registration_endpoint"), "AS metadata has registration endpoint")

    print("registration")
    bad = c.post("/register", json={"redirect_uris": ["https://evil.example/cb"], "client_name": "x"})
    check(bad.status_code == 400, "foreign redirect URI refused")
    reg = c.post("/register", json={
        "redirect_uris": [CALLBACK], "client_name": "Claude", "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
    })
    check(reg.status_code == 201, f"claude.ai client registered ({reg.status_code} {reg.text[:120]})")
    client_id = reg.json()["client_id"]
    cc = c.post("/register", json={"redirect_uris": ["http://localhost:51234/callback"], "client_name": "Claude Code",
                                   "token_endpoint_auth_method": "none"})
    check(cc.status_code == 201, "Claude Code loopback client registered")

    print("sign-in")
    vc = pkce()
    r, _ = login(c, client_id, "wrong password", vc)
    check(r.status_code == 200 and "Wrong password" in r.text, "wrong password rejected, no code")
    vc = pkce()
    r, rid = login(c, client_id, PASSWORD, vc)
    check(r.status_code == 302 and r.headers["location"].startswith(CALLBACK), "right password -> redirect to Claude")
    q = parse_qs(urlparse(r.headers["location"]).query)
    check(q.get("state") == ["st4te"] and "code" in q, "redirect carries code and state")
    replay = c.post("/oauth/login", data={"request": rid, "password": PASSWORD, "action": "allow"})
    check(replay.status_code == 400, "login request cannot be reused")

    print("token exchange")
    bad = c.post("/token", data={"grant_type": "authorization_code", "code": q["code"][0], "client_id": client_id,
                                 "redirect_uri": CALLBACK, "code_verifier": "x" * 50})
    check(bad.status_code == 400, "wrong PKCE verifier refused")
    tok = c.post("/token", data={"grant_type": "authorization_code", "code": q["code"][0], "client_id": client_id,
                                 "redirect_uri": CALLBACK, "code_verifier": vc[0], "resource": f"{BASE}/mcp"})
    check(tok.status_code == 200, f"code exchanged for tokens ({tok.text[:120]})")
    tok = tok.json()
    again = c.post("/token", data={"grant_type": "authorization_code", "code": q["code"][0], "client_id": client_id,
                                   "redirect_uri": CALLBACK, "code_verifier": vc[0]})
    check(again.status_code == 400, "code is single-use")

    print("refresh rotation")
    ref = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"],
                                 "client_id": client_id})
    check(ref.status_code == 200, "refresh works")
    old = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"],
                                 "client_id": client_id})
    check(old.status_code == 400 and "invalid_grant" in old.text, "old refresh token is dead (invalid_grant)")
    r = c.post("/mcp", json={}, headers={"Authorization": f"Bearer {tok['access_token']}"})
    check(r.status_code == 401, "access token from the rotated family is dead")
    access = ref.json()["access_token"]

    print("tools")
    asyncio.run(tools(access))

    print("revocation")
    rv = c.post("/revoke", data={"token": access, "client_id": client_id, "client_secret": ""})
    check(rv.status_code == 200, "revoke accepted")
    r = c.post("/mcp", json={}, headers={"Authorization": f"Bearer {access}"})
    check(r.status_code == 401, "revoked token refused")
    print(f"\nall {ok} checks passed")


async def tools(access):
    headers = {"Authorization": f"Bearer {access}"}
    async with httpx2.AsyncClient(headers=headers, timeout=30) as http, \
            streamable_http_client(f"{BASE}/mcp", http_client=http) as (read, write):
        async with ClientSession(read, write) as s:
            await s.initialize()
            names = {t.name for t in (await s.list_tools()).tools}
            check({"add_notes", "search_cards", "list_decks", "get_card_conventions", "get_note", "update_note",
                   "delete_notes", "modify_cards", "manage_deck", "undo", "add_image", "engram_api",
                   "engram_api_reference"} <= names, f"tools listed: {sorted(names)}")

            async def call(name, **args):
                res = await s.call_tool(name, args)
                sc = res.structured_content
                if sc is not None:
                    return res, (sc["result"] if set(sc) == {"result"} else sc)
                text = res.content[0].text if res.content else ""
                return res, (json.loads(text) if text[:1] in "[{" else text)

            _, conv = await call("get_card_conventions")
            check("{{c1::" in conv, "conventions returned")
            _, decks = await call("list_decks")
            check(len(decks) > 0 and "name" in decks[0], f"list_decks: {[d['name'] for d in decks][:4]}")
            _, found = await call("search_cards", text="", limit=3)
            check(found["total"] > 0 and found["notes"][0]["front"], "search_cards returns readable text")

            notes = [
                {"kind": "cloze", "text": r"A random variable $X$ has $\mathbb{E}[X] = {{c1::\sum_x x\,\mathbb{P}(X=x)}}$."},
                {"kind": "basic", "front": "What does Markov's inequality bound?", "back": r"$\mathbb{P}(X \ge a) \le \mathbb{E}[X]/a$ for $X \ge 0$"},
                {"kind": "cloze", "text": "no deletion here"},
                {"kind": "basic", "front": "only a front"},
            ]
            _, res = await call("add_notes", notes=notes)
            check(len(res["created"]) == 2 and len(res["rejected"]) == 2, f"add_notes: 2 created, 2 rejected ({res['rejected']})")
            _, dup = await call("add_notes", notes=notes[:1])
            check(len(dup["skipped"]) == 1 and not dup["created"], "duplicate skipped")
            _, inbox = await call("search_cards", deck="AI inbox")
            check(inbox["total"] == 2, "both notes are in the AI inbox")
            _, susp = await call("search_cards", deck="AI inbox", state="suspended")
            check(susp["total"] == 0, "and not suspended")
            check(all(n["tags"] == ["ai"] for n in inbox["notes"]), f"only tag is ai: {[n['tags'] for n in inbox['notes']]}")
            _, other = await call("add_notes", notes=[{"kind": "basic", "front": "Q elsewhere", "back": "A", "tags": ["analysis"]}],
                                  deck="Maths::New subdeck")
            check(other["created"][0]["deck"] == "Maths::New subdeck", "add_notes can target any deck (created on demand)")

            nid = res["created"][1]["noteId"]
            _, note = await call("get_note", note_id=nid)
            check(note["fields"]["Front"] == "What does Markov's inequality bound?", "get_note returns Markdown source")
            await call("update_note", note_id=nid, fields={"Back": r"$\mathbb{P}(X \ge a) \le \frac{\mathbb{E}[X]}{a}$"})
            _, note = await call("get_note", note_id=nid)
            check(r"\frac" in note["fields"]["Back"], "update_note changed one field")
            err, _ = await call("update_note", note_id=nid, fields={"Nope": "x"})
            check(err.is_error and "Unknown field" in err.content[0].text, "unknown field is a tool error the model can read")
            await call("update_note", note_id=nid, deck="Maths", tags=["ai", "probability", "mcp-test"])
            _, moved = await call("search_cards", deck="Maths", tag="mcp-test")
            check(moved["total"] == 1 and moved["notes"][0]["deck"] == "Maths", "update_note moves deck and sets tags")

            first = res["created"][0]["noteId"]
            _, m = await call("modify_cards", action="move", note_ids=[first], deck="General")
            _, g = await call("search_cards", deck="General")
            check(g["total"] == 1, "modify_cards move (deck created on demand)")
            await call("modify_cards", action="suspend", note_ids=[first])
            _, s1 = await call("search_cards", deck="General", state="suspended")
            await call("modify_cards", action="unsuspend", note_ids=[first])
            _, s2 = await call("search_cards", deck="General", state="suspended")
            check(s1["total"] == 1 and s2["total"] == 0, "suspend / unsuspend")
            await call("modify_cards", action="flag", note_ids=[first], flag=1)
            _, f = await call("search_cards", state="flagged")
            check(f["total"] == 1, "flag")

            _, d = await call("manage_deck", action="create", deck="Scratch")
            _, r = await call("manage_deck", action="rename", deck="Scratch", new_name="Scratch2")
            _, o = await call("manage_deck", action="set_options", deck="Scratch2", new_per_day=7)
            check(o["newPerDay"] == 7, "deck create / rename / set_options")
            await call("manage_deck", action="delete", deck="Scratch2")
            _, decks = await call("list_decks")
            check("Scratch2" not in [x["name"] for x in decks], "deck delete")

            maths = next(x["id"] for x in decks if x["name"] == "Maths")
            _, nxt = await call("engram_api", method="GET", path=f"/api/review/{maths}/next")
            check("done" in nxt, "engram_api: review next card")
            await call("delete_notes", note_ids=[first])
            _, gone = await call("search_cards", deck="General")
            _, u = await call("undo")
            _, back = await call("search_cards", deck="General")
            check(gone["total"] == 0 and back["total"] == 1, f"delete_notes then undo brings it back ({u})")

            _, ref = await call("engram_api_reference")
            check("POST /api/review/{decks}/answer" in ref and "GET /api/stats" in ref, "API reference lists every endpoint")
            _, st = await call("engram_api", method="GET", path="/api/stats", params={"days": 7})
            check(isinstance(st, dict), "engram_api: stats")
            err, _ = await call("engram_api", method="GET", path="/openapi.json")
            check(err.is_error, "engram_api only reaches /api/")
            _, img = await call("add_image", filename="tri", svg='<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', caption="t")
            check(img["markdown"].startswith("![t](") and img["filename"].endswith(".svg"), f"add_image -> {img['markdown']}")

if __name__ == "__main__":
    main()
