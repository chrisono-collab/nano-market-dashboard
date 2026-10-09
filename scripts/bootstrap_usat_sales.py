"""
One-time (re-runnable) load of the USAT sales export into sales_line_items.
Replaces every source='usat' row, so re-run it with a newer export to extend
history. USAT "Machine" labels ("[9] The Bowen") resolve to HaHa marketIds
via the bracket number, which equals VendSoft's machineCode, whose sales rows
carry the HaHa marketId as telemetryId. Falls back to HaHa name match, plus
overrides for retired terminal labels.

Run from the repo root: python3 scripts/bootstrap_usat_sales.py <path-to-usat-transaction-log.xlsx>
"""
import re
import sys
from collections import Counter

import pandas as pd

from _supabase import delete, haha_markets, insert, vendsoft_code_to_market

# Retired terminal label: The Met moved from [6] to [26] in June 2026.
LABEL_OVERRIDES = {"[6] The Met": "B147418"}

path = sys.argv[1] if len(sys.argv) > 1 else "usat-transaction-log.xlsx"
raw = pd.read_excel(path, sheet_name="usat-transaction-log", header=None)
cols = raw.iloc[2].tolist()
cols[3], cols[4] = "Product", "Slot"
df = raw.iloc[3:].copy()
df.columns = cols
df["Timestamp"] = pd.to_datetime(df["Timestamp"])
df["Quantity"] = pd.to_numeric(df["Quantity"], errors="coerce").fillna(0)
df["Price"] = pd.to_numeric(df["Price"], errors="coerce")

by_code = vendsoft_code_to_market()
by_name = {m["marketName"]: m["marketId"] for m in haha_markets()}


def resolve(label):
    if label in LABEL_OVERRIDES:
        return LABEL_OVERRIDES[label]
    m = re.match(r"^\[(\d+)\]\s*(.*)$", str(label))
    if not m:
        return None
    return by_code.get(m.group(1)) or by_name.get(m.group(2))


df["market_id"] = df["Machine"].map(resolve)
unresolved = Counter(df.loc[df["market_id"].isna(), "Machine"])
df = df[df["market_id"].notna() & df["Product"].notna()]

rows = [
    {
        "source": "usat",
        "market_id": r.market_id,
        "machine_label": str(r.Machine),
        "product_name": str(r.Product),
        "quantity": float(r.Quantity),
        "price": None if pd.isna(r.Price) else float(r.Price),
        "sold_at": r.Timestamp.strftime("%Y-%m-%d %H:%M:%S") + " America/Chicago",
        "sale_day": r.Timestamp.strftime("%Y-%m-%d"),
    }
    for r in df.itertuples()
]

print(f"USAT range {df['Timestamp'].min()} -> {df['Timestamp'].max()}, {len(rows)} rows across {df['market_id'].nunique()} HaHa machines")
if unresolved:
    print("Skipped labels with no HaHa machine (expected for non-HaHa machines):")
    for label, n in unresolved.most_common():
        print(f"  {label}: {n} rows")

delete("sales_line_items", {"source": "eq.usat"})
insert("sales_line_items", rows)
print("done")
