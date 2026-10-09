"""Shared helpers for the one-time bootstrap scripts (service-role REST access)."""
import os
import re

import requests


def load_env(path=".env.local"):
    env = {}
    with open(path) as f:
        for line in f:
            m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
            if m:
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env


ENV = load_env()
URL = ENV["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + "/rest/v1"
KEY = ENV.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not KEY:
    raise SystemExit("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local")
HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def delete(table, filters):
    r = requests.delete(f"{URL}/{table}", headers=HEADERS, params=filters, timeout=120)
    r.raise_for_status()


def insert(table, rows, upsert=False, chunk=1000):
    headers = dict(HEADERS, Prefer="resolution=merge-duplicates" if upsert else "return=minimal")
    for i in range(0, len(rows), chunk):
        r = requests.post(f"{URL}/{table}", headers=headers, json=rows[i : i + chunk], timeout=120)
        if not r.ok:
            raise SystemExit(f"{table} insert failed at row {i}: {r.status_code} {r.text[:500]}")
        print(f"  {table}: {min(i + chunk, len(rows))}/{len(rows)}", flush=True)


def vendsoft_code_to_market():
    """VendSoft machineCode -> HaHa marketId, read from sales rows' telemetryId."""
    base = "https://secure.vendsoft.com/api/v2"
    auth = (ENV["VENDSOFT_API_KEY"], ENV["VENDSOFT_CUSTOMER_ID"])
    out = {}
    for m in requests.get(f"{base}/machines", auth=auth, timeout=60).json():
        r = requests.get(f"{base}/machines/{m['machineCode']}/sales", auth=auth, timeout=60)
        ids = {row.get("telemetryId") for row in (r.json() if r.ok else []) if row.get("telemetryId")}
        if len(ids) == 1:
            out[str(m["machineCode"])] = ids.pop()
    return out


def haha_markets():
    base = ENV.get("HAHA_API_BASE_URL") or "https://thor-openapi.hahavending.com"
    tok = requests.post(
        f"{base}/open/auth/token",
        json={"appkey": ENV["HAHA_APP_KEY"], "appsecret": ENV["HAHA_APP_SECRET"]},
        timeout=30,
    ).json()["data"]["token"]
    r = requests.get(
        f"{base}/open/api/v1/markets",
        headers={"Authorization": f"Bearer {tok}"},
        params={"page": 1, "page_size": 100},
        timeout=30,
    )
    return r.json()["data"]["list"]
