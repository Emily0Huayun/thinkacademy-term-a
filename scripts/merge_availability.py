#!/usr/bin/env python3
"""Merge a filter-scoped BMS snapshot into the published feed."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--partial", required=True, type=Path)
    parser.add_argument("--feed", type=Path, default=ROOT / "availability.json")
    args = parser.parse_args()
    feed = json.loads(args.feed.read_text(encoding="utf-8"))
    value = json.loads(args.partial.read_text(encoding="utf-8"))
    partial = value.get("records", value)
    if not isinstance(partial, list) or not partial:
        raise ValueError("partial snapshot must contain at least one record")

    now = datetime.now().astimezone().isoformat(timespec="seconds")
    current = {str(r["skuId"]): r for r in feed["records"]}
    for patch in partial:
        sku = str(patch["skuId"])
        if sku not in current:
            raise ValueError(f"skuId {sku} is not present in the official schedule")
        current[sku] = {**current[sku], **patch, "checkedAt": patch.get("checkedAt") or now}

    feed["records"] = sorted(current.values(), key=lambda r: (r["course"], r["timePT"], r["skuId"]))
    feed["updatedAt"] = now
    args.feed.write_text(json.dumps(feed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"merged": len(partial), "records": len(current), "updatedAt": now}, ensure_ascii=False))


if __name__ == "__main__":
    main()
