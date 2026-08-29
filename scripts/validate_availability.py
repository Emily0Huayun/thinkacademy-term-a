#!/usr/bin/env python3
"""Validate the public BMS availability feed before it is published."""

import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FEED = ROOT / "availability.json"
PRIVATE_KEYS = {
    "student", "studentid", "studentname", "studentlist", "userid",
    "phone", "email", "guardian", "parent", "address",
}


def fail(message: str) -> None:
    raise ValueError(message)


def validate(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    records = data.get("records")
    if not isinstance(records, list) or not records:
        fail("records must be a non-empty list")

    updated_at = data.get("updatedAt")
    if not updated_at:
        fail("updatedAt is required")
    datetime.fromisoformat(updated_at.replace("Z", "+00:00"))

    official_skus = {
        int(sku) for sku in re.findall(
            r'data-sku="(\d+)"',
            (ROOT / "index.html").read_text(encoding="utf-8"),
        )
    }
    class_ids = set()
    sku_ids = set()
    course_counts = Counter()
    required = {
        "course", "classId", "skuId", "teacher", "timePT", "capacity",
        "registered", "registrationRemaining", "registrationExploded",
        "currentLesson", "inClass", "trialRemaining", "trialFull",
        "availabilityStatus",
    }

    for index, record in enumerate(records):
        missing = required - set(record)
        if missing:
            fail(f"record {index} is missing fields: {sorted(missing)}")

        private = PRIVATE_KEYS.intersection(key.lower() for key in record)
        if private:
            fail(f"record {index} contains private fields: {sorted(private)}")

        class_id = record["classId"]
        sku_id = record["skuId"]
        if class_id is not None and class_id in class_ids:
            fail(f"duplicate classId: {class_id}")
        if sku_id in sku_ids:
            fail(f"duplicate skuId: {sku_id}")
        if class_id is not None:
            class_ids.add(class_id)
        sku_ids.add(sku_id)
        course_counts[record["course"]] += 1

        capacity = record["capacity"]
        registered = record["registered"]
        reg_remaining = max(0, capacity + 2 - registered)
        if record["registrationRemaining"] != reg_remaining:
            fail(f"class {class_id}: registrationRemaining formula mismatch")
        if record["registrationExploded"] != (registered >= capacity + 2):
            fail(f"class {class_id}: registrationExploded formula mismatch")

        in_class = record["inClass"]
        if in_class is None:
            if record["trialRemaining"] is not None or record["trialFull"] is not None:
                fail(f"class {class_id}: no lesson must use null trial fields")
        else:
            trial_remaining = max(0, capacity + 3 - in_class)
            if record["trialRemaining"] != trial_remaining:
                fail(f"class {class_id}: trialRemaining formula mismatch")
            if record["trialFull"] != (in_class >= capacity + 3):
                fail(f"class {class_id}: trialFull formula mismatch")

    if sku_ids != official_skus:
        missing = sorted(official_skus - sku_ids)
        extra = sorted(sku_ids - official_skus)
        fail(f"feed/index sku mismatch; missing={missing[:10]} extra={extra[:10]}")

    return {
        "records": len(records),
        "courses": dict(course_counts),
        "updatedAt": updated_at,
    }


if __name__ == "__main__":
    feed = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_FEED
    summary = validate(feed)
    print(json.dumps(summary, ensure_ascii=False))
