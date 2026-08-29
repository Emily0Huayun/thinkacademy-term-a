#!/usr/bin/env python3
"""Build the public feed from official cards and privacy-safe BMS snapshots."""

from __future__ import annotations

import argparse
import html
import json
import re
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CARD_RE = re.compile(
    r'<div class="r [^>]*data-sku="(?P<sku>\d+)"[^>]*'
    r'data-sub="(?P<subject>[^"]+)"[^>]*data-lv="(?P<level>[^"]+)"[^>]*'
    r'data-tea="(?P<teacher>[^"]+)"[^>]*>(?P<body>.*?)</div>\s*', re.S
)


def clean(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()


def official_cards(index_path: Path) -> dict[str, dict]:
    cards: dict[str, dict] = {}
    for match in CARD_RE.finditer(index_path.read_text(encoding="utf-8")):
        body = match.group("body")
        sku = match.group("sku")
        time_match = re.search(r'<div class="ln"><i>PT</i><b>(.*?)</b>', body, re.S)
        cap_match = re.search(r'<span class="cap">(\d+)/(\d+) enrolled(?: · ([^<]+))?', body)
        cards[sku] = {
            "skuId": int(sku),
            "course": f'{match.group("subject")} {match.group("level")}',
            "teacher": html.unescape(match.group("teacher")),
            "timePT": clean(time_match.group(1)) if time_match else "",
            "registered": int(cap_match.group(1)) if cap_match else 0,
            "capacity": int(cap_match.group(2)) if cap_match else 0,
            "dateRangeDisplay": clean(cap_match.group(3)) if cap_match and cap_match.group(3) else "",
        }
    return cards


def load_records(path: Path | None) -> list[dict]:
    if path is None or not path.exists():
        return []
    value = json.loads(path.read_text(encoding="utf-8"))
    return value.get("records", []) if isinstance(value, dict) else value


def finish(record: dict) -> dict:
    capacity = int(record.get("capacity") or 0)
    registered = int(record.get("registered") or 0)
    in_class = record.get("inClass")
    record["registrationRemaining"] = max(0, capacity + 2 - registered)
    record["registrationExploded"] = registered >= capacity + 2
    if in_class is None:
        record["trialRemaining"] = None
        record["trialFull"] = None
    else:
        in_class = int(in_class)
        record["inClass"] = in_class
        record["trialRemaining"] = max(0, capacity + 3 - in_class)
        record["trialFull"] = in_class >= capacity + 3
    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", type=Path, default=ROOT / "index.html")
    parser.add_argument("--bms-index", type=Path)
    parser.add_argument("--checked", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "availability.json")
    args = parser.parse_args()

    cards = official_cards(args.index)
    bms = {str(r["skuId"]): r for r in load_records(args.bms_index)}
    checked = {str(r["skuId"]): r for r in load_records(args.checked)}
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    records = []

    for sku, card in cards.items():
        if sku in checked:
            record = dict(checked[sku])
        elif sku in bms:
            record = dict(bms[sku])
            record.update({"inClass": None, "availabilityStatus": "pending_current_lesson", "checkedAt": None})
        else:
            record = {
                **card,
                "classId": None,
                "courseId": None,
                "dateRange": card.get("dateRangeDisplay", ""),
                "currentLesson": 12,
                "inClass": None,
                "availabilityStatus": "pending_bms_match",
                "checkedAt": None,
            }
        record.pop("dateRangeDisplay", None)
        record["course"] = card["course"]
        records.append(finish(record))

    feed = {
        "asOfDate": "2026-08-28",
        "currentWeek": "2026-08-24～2026-08-30",
        "updatedAt": now,
        "sourceTimezone": "America/Los_Angeles",
        "rules": {
            "registrationRemaining": "max(0, capacity + 2 - registered)",
            "registrationExploded": "registered >= capacity + 2",
            "trialRemaining": "max(0, capacity + 3 - inClass)",
            "trialFull": "inClass >= capacity + 3",
            "boundLessonCountsTowardQuota": True,
            "authoritativeTrialCount": "Use the numerator shown by In-class / Capacity; it already includes bound lessons",
        },
        "records": sorted(records, key=lambda r: (r["course"], r["timePT"], r["skuId"])),
    }
    args.output.write_text(json.dumps(feed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"records": len(records), "checked": sum(r.get("inClass") is not None for r in records), "pending": sum(r.get("inClass") is None for r in records)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
