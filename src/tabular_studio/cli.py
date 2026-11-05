import sys
import webbrowser
from argparse import ArgumentParser
from ipaddress import IPv4Address
from urllib.parse import urlencode

import uvicorn

from tabular_studio.api.security import SessionSecurity
from tabular_studio.app import create_app, local_teacher
from tabular_studio.core.errors import UserError


def main() -> None:
    """Parse local demo launch options and bind to loopback by default."""
    parser = ArgumentParser(
        prog="tabular-studio",
        description="Tabular Studio (working title): local tabular labelling and rule export.",
    )
    subparsers = parser.add_subparsers(dest="command")
    demo = subparsers.add_parser("demo", help="Launch the local labelling app")
    demo.add_argument("--host", default="127.0.0.1")
    demo.add_argument("--port", type=int, default=8787)
    demo.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if args.command is None:
        parser.print_help()
        return
    try:
        security = SessionSecurity.for_host(args.host)
    except ValueError as error:
        parser.error(str(error))
    try:
        app = create_app(teacher=local_teacher(), security=security)
    except UserError as error:
        sys.stderr.write(f"error: {error.what}\nNext: {error.next_step}\n")
        raise SystemExit(1) from error
    browser_host = "127.0.0.1" if args.host == str(IPv4Address(0)) else args.host
    url = f"http://{browser_host}:{args.port}/?{urlencode({'token': security.token})}"
    sys.stdout.write(f"Open {url}\n")
    if not args.no_browser:
        webbrowser.open(url)
    uvicorn.run(app, host=args.host, port=args.port, access_log=False)
