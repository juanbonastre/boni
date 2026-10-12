"""Command line: run the server and manage devices.

  boni serve [--host 0.0.0.0] [--port 8100]
  boni device add NAME        prints the device token ONCE (only its hash is stored)
  boni device list
  boni device remove NAME
"""

from __future__ import annotations

import argparse
import logging
import sys

from boni.config import Settings
from boni.store import Store


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="boni")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--host", default="0.0.0.0")
    s.add_argument("--port", type=int, default=8100)
    d = sub.add_parser("device")
    dsub = d.add_subparsers(dest="dcmd", required=True)
    dsub.add_parser("add").add_argument("name")
    dsub.add_parser("list")
    dsub.add_parser("remove").add_argument("name")
    a = p.parse_args(argv)
    settings = Settings.from_env()

    if a.cmd == "serve":
        import uvicorn

        from boni.app import create_app

        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
        if not settings.vault_mcp_url:
            logging.warning("BONI_VAULT_MCP_URL not set: the vault source is disabled")
        uvicorn.run(create_app(settings), host=a.host, port=a.port, proxy_headers=True)
        return 0

    store = Store(settings.db_path)
    if a.dcmd == "add":
        token = store.add_device(a.name)
        print(f"Device '{a.name}' created. Token (shown only once, save it in Vaultwarden):\n{token}")
    elif a.dcmd == "list":
        for dev in store.devices():
            print(f"{dev['name']}\tcreated {dev['created']}\tlast seen {dev['last_seen'] or '-'}")
    elif a.dcmd == "remove":
        print("removed" if store.remove_device(a.name) else "no such device")
    return 0


if __name__ == "__main__":
    sys.exit(main())
