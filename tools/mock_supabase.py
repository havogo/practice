#!/usr/bin/env python3
"""A stand-in for the slice of Supabase that app/sync.js talks to.

Not a Supabase emulator — it implements exactly the endpoints and semantics the
sync client depends on, so the client can be tested end to end without an
account, and so failure modes that are awkward to trigger against the real
service (an expired token, a chunked first push) can be forced deliberately.

Implemented:
  POST /auth/v1/token?grant_type=password
  POST /auth/v1/token?grant_type=refresh_token
  GET  /rest/v1/records?select=*&order=updated_at.asc[&updated_at=gt.<iso>]
  POST /rest/v1/records?on_conflict=id      (Prefer: resolution=merge-duplicates)

Deliberate fidelity:
  - rows are scoped to the signed-in user, the way row-level security scopes them
  - an unknown or expired access token gets 401, so the refresh path is exercised
  - the anon apikey header is required, as PostgREST requires it

Test controls (not part of Supabase):
  POST /__test/expire      force the current access token to be expired
  GET  /__test/state       row counts and issued tokens
  POST /__test/reset       drop all rows and sessions

Usage: python3 tools/mock_supabase.py [port]
"""

import json
import re
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ANON_KEY = "test-anon-key"
USERS = {"doctor@example.com": "correct-horse"}

ACCESS_TTL = 3600

lock = threading.Lock()
rows = {}       # id -> row dict
sessions = {}   # access_token -> {"user": {...}, "expires_at": epoch}
refresh = {}    # refresh_token -> access_token
users = {}      # email -> user id


def now_iso():
    """Postgres spelling, deliberately.

    PostgREST renders timestamptz as "2026-08-06T15:04:05.123+00:00", not the
    "…Z" a browser produces. Echoing back the client's own spelling would hide
    bugs in any code that compares the two as strings.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "+00:00"


def to_pg_timestamp(value):
    """Normalise a client-supplied ISO timestamp the way Postgres would store it."""
    if not isinstance(value, str):
        return value
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    parsed = parsed.astimezone(timezone.utc)
    return parsed.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "+00:00"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # -- plumbing ---------------------------------------------------------

    def log_message(self, fmt, *args):
        sys.stderr.write("[mock] %s\n" % (fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "authorization,apikey,content-type,prefer")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "content-range")

    def reply(self, status, payload=None):
        body = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return None
        return json.loads(self.rfile.read(length) or b"null")

    # -- auth -------------------------------------------------------------

    def require_apikey(self):
        if self.headers.get("apikey") != ANON_KEY:
            self.reply(401, {"message": "Invalid API key"})
            return False
        return True

    def current_user(self):
        """Mirrors PostgREST: a missing or stale JWT is a 401, not a 403."""
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            self.reply(401, {"message": "No authorization header"})
            return None
        token = auth[7:]
        session = sessions.get(token)
        if not session:
            self.reply(401, {"message": "invalid claim: bad_jwt"})
            return None
        if session["expires_at"] < time.time():
            self.reply(401, {"code": "PGRST301", "message": "JWT expired"})
            return None
        return session["user"]

    def issue(self, user):
        access = "acc_" + uuid.uuid4().hex
        refresh_token = "ref_" + uuid.uuid4().hex
        sessions[access] = {"user": user, "expires_at": time.time() + ACCESS_TTL}
        refresh[refresh_token] = access
        return {
            "access_token": access,
            "refresh_token": refresh_token,
            "expires_in": ACCESS_TTL,
            "token_type": "bearer",
            "user": user,
        }

    def handle_token(self, query):
        grant = (query.get("grant_type") or ["password"])[0]
        payload = self.body() or {}

        if grant == "password":
            email = (payload.get("email") or "").lower()
            if USERS.get(email) != payload.get("password"):
                return self.reply(400, {
                    "error": "invalid_grant",
                    "error_description": "Invalid login credentials",
                })
            user = {"id": users.setdefault(email, str(uuid.uuid4())), "email": email}
            return self.reply(200, self.issue(user))

        if grant == "refresh_token":
            token = payload.get("refresh_token")
            previous = refresh.get(token)
            if not previous or previous not in sessions:
                return self.reply(400, {"error": "invalid_grant"})
            user = sessions[previous]["user"]
            del refresh[token]
            return self.reply(200, self.issue(user))

        return self.reply(400, {"error": "unsupported_grant_type"})

    # -- records ----------------------------------------------------------

    def handle_get_records(self, query, user):
        # The client pages on synced_at; anything else means the client and the
        # table have drifted apart, so say so loudly rather than guessing.
        column = "synced_at" if "synced_at" in query else "updated_at" if "updated_at" in query else None
        since = None
        if column:
            m = re.match(r"^gt\.(.+)$", query[column][0])
            if not m:
                return self.reply(400, {"message": "unsupported operator"})
            since = m.group(1)

        order = (query.get("order") or ["synced_at.asc"])[0].split(".")[0]
        if order not in ("synced_at", "updated_at"):
            return self.reply(400, {"message": f"cannot order by {order}"})

        with lock:
            mine = [r for r in rows.values() if r["owner"] == user["id"]]
        if since:
            mine = [r for r in mine if r[column] > since]
        mine.sort(key=lambda r: r[order])
        return self.reply(200, mine)

    def handle_post_records(self, user):
        payload = self.body()
        if payload is None:
            return self.reply(400, {"message": "empty body"})
        incoming = payload if isinstance(payload, list) else [payload]

        prefer = self.headers.get("Prefer", "")
        if "merge-duplicates" not in prefer:
            with lock:
                clash = [r["id"] for r in incoming if r.get("id") in rows]
            if clash:
                return self.reply(409, {"code": "23505", "message": "duplicate key value"})

        stored = []
        with lock:
            for row in incoming:
                required = {"id", "owner", "store", "record_id", "updated_at", "payload"}
                if not required.issubset(row):
                    return self.reply(400, {"message": f"missing columns: {sorted(required - set(row))}"})
                # Row-level security: you may only write rows you own.
                if row["owner"] != user["id"]:
                    return self.reply(403, {
                        "code": "42501",
                        "message": 'new row violates row-level security policy for table "records"',
                    })
                # Stands in for the records_touch_synced_at trigger: the server
                # stamps arrival time, and the client never supplies it.
                stamped = dict(row)
                stamped["synced_at"] = now_iso()
                stamped["updated_at"] = to_pg_timestamp(row["updated_at"])
                stamped.setdefault("deleted", False)
                rows[row["id"]] = stamped
                stored.append(row["id"])
                # Distinct timestamps keep the paging cursor unambiguous.
                time.sleep(0.001)

        if "return=minimal" in prefer:
            return self.reply(201, None)
        with lock:
            return self.reply(201, [rows[i] for i in stored])

    # -- routing ----------------------------------------------------------

    def route(self, method):
        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)

        if path.startswith("/__test/"):
            return self.handle_test(path, method)
        if not self.require_apikey():
            return None
        if path == "/auth/v1/token" and method == "POST":
            return self.handle_token(query)

        if path == "/rest/v1/records":
            user = self.current_user()
            if not user:
                return None
            if method == "GET":
                return self.handle_get_records(query, user)
            if method == "POST":
                return self.handle_post_records(user)

        return self.reply(404, {"message": f"no route for {method} {path}"})

    def handle_test(self, path, method):
        if path == "/__test/state":
            with lock:
                by_store = {}
                for r in rows.values():
                    by_store[r["store"]] = by_store.get(r["store"], 0) + 1
            return self.reply(200, {
                "rowCount": len(rows), "byStore": by_store,
                "sessions": len(sessions),
                "rows": sorted(
                    ({"id": r["id"], "updated_at": r["updated_at"], "deleted": r.get("deleted")}
                     for r in rows.values()),
                    key=lambda r: r["updated_at"],
                ),
            })
        if path == "/__test/expire" and method == "POST":
            with lock:
                for session in sessions.values():
                    session["expires_at"] = 0
            return self.reply(200, {"expired": len(sessions)})
        if path == "/__test/reset" and method == "POST":
            with lock:
                rows.clear()
                sessions.clear()
                refresh.clear()
            return self.reply(200, {"reset": True})
        return self.reply(404, {"message": "unknown test hook"})

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"mock supabase on http://127.0.0.1:{port}  (anon key: {ANON_KEY})")
    print(f"  user: {list(USERS)[0]} / {list(USERS.values())[0]}")
    server.serve_forever()


if __name__ == "__main__":
    main()
