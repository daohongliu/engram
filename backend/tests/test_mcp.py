"""Start Engram with its MCP server on spare ports and run mcp_flow.py against it."""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

pytest.importorskip("mcp")

HERE = Path(__file__).parent
PASSWORD = "correct horse"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_mcp_end_to_end(tmp_path):
    port, mcp_port = free_port(), free_port()
    hashed = subprocess.run(
        [sys.executable, "-m", "engram", "hash-password"], input=PASSWORD + "\n",
        capture_output=True, text=True, check=True, cwd=HERE.parent,
    ).stdout.strip()
    env = {
        **os.environ,
        "ENGRAM_COLLECTION": str(tmp_path / "collection.anki2"),
        "ENGRAM_MCP_PASSWORD_HASH": hashed,
        "NO_PROXY": "127.0.0.1,localhost",
    }
    log = open(tmp_path / "server.log", "w")
    server = subprocess.Popen(
        [sys.executable, "-m", "engram", "--port", str(port), "--mcp-port", str(mcp_port)],
        env=env, cwd=HERE.parent, stdout=log, stderr=subprocess.STDOUT,
    )
    try:
        base = f"http://127.0.0.1:{mcp_port}"
        for _ in range(60):
            try:
                if httpx.get(f"{base}/healthz", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.25)
        else:
            pytest.fail("MCP server did not start:\n" + (tmp_path / "server.log").read_text())

        # Engram's own API is not reachable through the MCP port.
        assert httpx.get(f"{base}/api/decks").status_code == 404
        assert mcp_port != port and httpx.get(f"http://127.0.0.1:{port}/api/decks").status_code == 200
        # The sign-in database sits next to the collection.
        assert (tmp_path / "mcp.db").exists()

        flow = subprocess.run(
            [sys.executable, str(HERE / "mcp_flow.py")],
            env={**env, "ENGRAM_MCP_URL": base, "ENGRAM_MCP_TEST_PASSWORD": PASSWORD},
            capture_output=True, text=True, timeout=120,
        )
        assert flow.returncode == 0, flow.stdout[-3000:] + flow.stderr[-3000:]
        assert "checks passed" in flow.stdout
    finally:
        server.terminate()
        server.wait(timeout=10)
        log.close()
