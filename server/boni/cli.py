"""Command line: run the server and manage accounts.

  boni serve [--host 0.0.0.0] [--port 8100]
  boni user add NAME          asks for the password twice (at least 12 characters); devices log in with it
  boni user list
  boni user passwd NAME       a new password; every session of that user ends
  boni user remove NAME
  boni device list|remove     the old device tokens (before accounts): remove them once every device has logged in
"""

from __future__ import annotations

import argparse
import getpass
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
    u = sub.add_parser("user")
    usub = u.add_subparsers(dest="ucmd", required=True)
    usub.add_parser("add").add_argument("name")
    usub.add_parser("list")
    usub.add_parser("passwd").add_argument("name")
    usub.add_parser("remove").add_argument("name")
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
        # One line per MCP HTTP request (the warm-up makes ~15 every 2 minutes) is noise: only warnings from clients.
        for noisy in ("httpx", "httpx2", "mcp", "mcp.client"):
            logging.getLogger(noisy).setLevel(logging.WARNING)
        if not settings.vault_mcp_url:
            logging.warning("BONI_VAULT_MCP_URL not set: the vault source is disabled")
        uvicorn.run(create_app(settings), host=a.host, port=a.port, proxy_headers=True)
        return 0

    store = Store(settings.db_path)
    if a.cmd == "user":
        return user_command(store, a)
    if a.dcmd == "add":
        token = store.add_device(a.name)
        print(f"Device '{a.name}' created. Token (shown only once, save it in Vaultwarden):\n{token}")
    elif a.dcmd == "list":
        for dev in store.devices():
            print(f"{dev['name']}\tcreated {dev['created']}\tlast seen {dev['last_seen'] or '-'}")
    elif a.dcmd == "remove":
        print("removed" if store.remove_device(a.name) else "no such device")
    return 0


def ask_password() -> str:
    first = getpass.getpass("Password (at least 12 characters): ")
    if first != getpass.getpass("Again: "):
        raise SystemExit("The passwords do not match")
    return first


def user_command(store: Store, a: argparse.Namespace) -> int:
    try:
        if a.ucmd == "add":
            store.add_user(a.name, ask_password())
            print(f"User '{a.name}' created. Log in from Boni: Settings > Account.")
        elif a.ucmd == "list":
            for u in store.users():
                print(f"{u['name']}\tcreated {u['created']}\tsessions {u['sessions']}")
        elif a.ucmd == "passwd":
            changed = store.set_password(a.name, ask_password())
            print("password changed; its sessions ended" if changed else "no such user")
        elif a.ucmd == "remove":
            print("removed" if store.remove_user(a.name) else "no such user")
    except ValueError as e:
        raise SystemExit(str(e)) from e
    return 0


if __name__ == "__main__":
    sys.exit(main())
