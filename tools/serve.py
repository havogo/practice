#!/usr/bin/env python3
"""Static file server for local development.

`python3 -m http.server` sends no cache headers, so browsers apply heuristic
caching and keep serving a module you just edited. This sends no-store on
everything, which makes a reload actually mean reload.

It also sets the few content types that matter here: .mjs and .webmanifest are
not in Python's default map, and a wrong type stops a module from executing.

Usage: python3 tools/serve.py [port]
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXTRA_TYPES = {
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        # The service worker is only allowed to claim the whole origin if it is
        # served from the root, which it is — this just makes that explicit.
        if self.path.endswith("sw.js"):
            self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        return EXTRA_TYPES.get(ext) or super().guess_type(path)

    def log_message(self, fmt, *args):
        # Quiet down the successful requests; only surface problems.
        if args and str(args[1]).startswith(("4", "5")):
            sys.stderr.write("[serve] %s\n" % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"serving {ROOT} on http://localhost:{port}  (no-store)")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
