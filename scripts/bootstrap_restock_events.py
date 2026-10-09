"""
One-time load of the haha-dashboard prototype's placement cache (full fleet
restock history) into restock_events + restock_scan_state, so the daily cron
only has to scan forward from the prototype's last watermark.

Run from the repo root: python3 scripts/bootstrap_restock_events.py <path-to-placement-cache.json>
"""
import json
import sys

from _supabase import insert

path = sys.argv[1] if len(sys.argv) > 1 else "../haha-dashboard/data/placement-cache.json"
cache = json.load(open(path))

events = {}
for entry in cache["products"].values():
    for e in entry.get("events", []):
        key = (entry["marketId"], entry["productId"], str(e["restockOpLogId"]))
        events[key] = {
            "market_id": entry["marketId"],
            "product_id": entry["productId"],
            "product_name": entry["productName"],
            "occurred_at": e["occurredAt"],
            "restock_op_log_id": str(e["restockOpLogId"]),
            "change_num": e["changeNum"],
            "after_num": e["afterNum"],
        }

states = [
    {
        "market_id": market_id,
        "last_scanned_created_at": m["lastScannedCreatedAt"],
        "last_scanned_restock_op_log_id": str(m["lastScannedRestockOpLogId"]),
        "last_scanned_at": m["lastScannedAt"],
        "records_scanned": m["recordsScanned"],
    }
    for market_id, m in cache["markets"].items()
]

print(f"{len(events)} events across {len(states)} markets")
insert("restock_events", list(events.values()), upsert=True)
insert("restock_scan_state", states, upsert=True)
print("done")
