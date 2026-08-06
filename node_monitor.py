#!/usr/bin/env python3
"""node_monitor.py - pings every node in the Wings Panel every N seconds.

Usage:
    python3 node_monitor.py [--interval 5]
                            [--panel-url http://localhost:8000]
                            [--username admin]
                            [--password admin12345]

Credentials are read from .env (PANEL_URL / ADMIN_USER / ADMIN_PASSWORD) when
present. Re-logs-in automatically if the token expires. Press Ctrl+C to stop.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_INTERVAL = 5


def env_vars(path=".env"):
    vals = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                vals[k.strip()] = v.strip()
    return vals


def api(url, token=None, body=None, timeout=8):
    req = urllib.request.Request(url, method="POST" if body is not None else "GET")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code}
    except Exception as e:
        return {"_error": str(e)}


def login(base, username, password):
    r = api(base + "/api/auth/login", body={"username": username, "password": password})
    token = r.get("token") if isinstance(r, dict) else None
    if not token:
        raise SystemExit(f"login failed: {r}")
    return token


def fetch_nodes(base, token):
    nodes = api(base + "/api/nodes", token=token)
    if isinstance(nodes, dict) and nodes.get("_http_error") == 401:
        return None
    if not isinstance(nodes, list):
        print(f"  WARN: unexpected /api/nodes response: {nodes}")
        return []
    return nodes


def ping_node(base, token, node):
    r = api(f"{base}/api/nodes/{node['id']}/ping", token=token, timeout=8)
    if isinstance(r, dict) and r.get("_http_error") == 401:
        return None
    return r.get("status") if isinstance(r, dict) else "error"


def main():
    env = env_vars()
    ap = argparse.ArgumentParser(description="Ping all Wings Panel nodes periodically")
    ap.add_argument("--interval", type=int,
                    default=int(os.environ.get("INTERVAL", DEFAULT_INTERVAL)),
                    help=f"seconds between pings (default {DEFAULT_INTERVAL})")
    ap.add_argument("--panel-url",
                    default=os.environ.get("PANEL_URL") or env.get("PANEL_URL", "http://localhost:8000"))
    ap.add_argument("--username",
                    default=os.environ.get("ADMIN_USER") or env.get("ADMIN_USER", "admin"))
    ap.add_argument("--password",
                    default=os.environ.get("ADMIN_PASSWORD") or env.get("ADMIN_PASSWORD", "admin12345"))
    args = ap.parse_args()

    base = args.panel_url.rstrip("/")
    token = login(base, args.username, args.password)
    print(f"monitoring {base} every {args.interval}s — Ctrl+C to stop\n", flush=True)

    last = {}
    try:
        while True:
            nodes = fetch_nodes(base, token)
            if nodes is None:
                token = login(base, args.username, args.password)
                nodes = fetch_nodes(base, token)
            row = []
            for n in nodes:
                status = ping_node(base, token, n)
                if status is None:
                    token = login(base, args.username, args.password)
                    status = ping_node(base, token, n)
                name = (n.get("name") or "").strip() or str(n.get("id"))
                row.append(f"{name}={status}")
                prev = last.get(n["id"])
                if prev is not None and prev != status:
                    print(f"[{time.strftime('%H:%M:%S')}] {name} went {prev} -> {status}", flush=True)
                last[n["id"]] = status
            print(f"[{time.strftime('%H:%M:%S')}] " + "  ".join(row), flush=True)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nstopped", flush=True)


if __name__ == "__main__":
    sys.exit(main())
