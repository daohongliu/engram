"""`python -m engram` starts the server."""

import argparse
import os

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Engram.")
    parser.add_argument("--collection", help="path to a collection.anki2 (close Anki desktop first)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    if args.collection:
        os.environ["ENGRAM_COLLECTION"] = args.collection
    uvicorn.run("engram.app:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
