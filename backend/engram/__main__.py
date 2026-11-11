"""`python -m engram` starts the server.

`--mcp-port` also starts the MCP server (needs `pip install -e "backend[mcp]"`).
It gets its own port so that it can be put on the internet without Engram's
own API: requests to that port only reach the MCP endpoints and its sign-in.
`python -m engram hash-password` makes the password hash it needs.
"""

import argparse
import asyncio
import contextlib
import getpass
import os
import sys

import uvicorn


def main() -> None:
    if sys.argv[1:2] == ["hash-password"]:
        return hash_password()

    parser = argparse.ArgumentParser(description="Run Engram.")
    parser.add_argument("--collection", help="path to a collection.anki2 (close Anki desktop first)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--mcp-port", type=int, help="also run the MCP server on this port")
    args = parser.parse_args()
    if args.collection:
        os.environ["ENGRAM_COLLECTION"] = args.collection
    if args.mcp_port is None:
        uvicorn.run("engram.app:app", host=args.host, port=args.port, reload=args.reload)
        return
    if args.reload:
        parser.error("--reload can't be combined with --mcp-port")
    os.environ.setdefault("ENGRAM_MCP_PUBLIC_URL", f"http://127.0.0.1:{args.mcp_port}")
    asyncio.run(run_with_mcp(args.host, args.port, args.mcp_port))


async def run_with_mcp(host: str, port: int, mcp_port: int) -> None:
    try:
        from .mcp_server.server import create_app as create_mcp_app
    except ImportError as exc:
        sys.exit(f"The MCP server needs extra packages: pip install -e \"backend[mcp]\" ({exc})")
    from .app import app

    main_server = uvicorn.Server(uvicorn.Config(app, host=host, port=port))
    # Behind a reverse proxy on the same machine, trust its forwarded headers.
    mcp_server = _QuietServer(
        uvicorn.Config(create_mcp_app(), host=host, port=mcp_port, proxy_headers=True, forwarded_allow_ips="127.0.0.1")
    )

    async def serve_mcp() -> bool:
        try:
            await mcp_server.serve()
            return True
        except SystemExit:  # uvicorn exits like this when it can't bind its port
            return False
        finally:
            # If the MCP server stops (its port was taken, say), stop Engram too.
            main_server.should_exit = True

    mcp_task = asyncio.create_task(serve_mcp())
    try:
        await main_server.serve()
    finally:
        mcp_server.should_exit = True
        mcp_ok = await mcp_task
    if not mcp_ok:
        sys.exit(1)


class _QuietServer(uvicorn.Server):
    """A second server that leaves Ctrl-C to the main one, and stops with it."""

    @contextlib.contextmanager
    def capture_signals(self):
        yield


def hash_password() -> None:
    try:
        from .mcp_server.oauth import hash_password as make_hash
    except ImportError as exc:
        sys.exit(f"The MCP server needs extra packages: pip install -e \"backend[mcp]\" ({exc})")

    if sys.stdin.isatty():
        pw = getpass.getpass("New password: ")
        if pw != getpass.getpass("Again: "):
            sys.exit("Passwords did not match.")
    else:
        pw = sys.stdin.readline().rstrip("\n")
    print(make_hash(pw))


if __name__ == "__main__":
    main()
