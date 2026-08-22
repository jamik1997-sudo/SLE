"""
Best-effort legacy visit goal/comment backfill.
Safe to run multiple times. It only fills empty current fields when a known legacy alias exists.
If old records never stored these values, they remain empty and reports show "—".
"""
from app.database import SessionLocal
from app import models
import json

GOAL_KEYS = ("goal","visit_goal","purpose","visit_purpose","goal_text","purpose_text","target","visit_target")
COMMENT_KEYS = ("comment","visit_comment","goal_comment","purpose_comment","comment_text","visit_notes","notes")
CONTAINERS = ("data","payload","draft","draft_data","meta","metadata","visit_data","extra")

def pick(obj, keys):
    if obj is None:
        return None
    for k in keys:
        v = obj.get(k) if isinstance(obj, dict) else getattr(obj, k, None)
        if v is not None and str(v).strip():
            return str(v).strip()
    return None

def containers(obj):
    for name in CONTAINERS:
        v = getattr(obj, name, None)
        if isinstance(v, str):
            try: v = json.loads(v)
            except Exception: v = None
        if isinstance(v, dict):
            yield v
            if isinstance(v.get("visit"), dict):
                yield v["visit"]

def main():
    db = SessionLocal()
    changed = 0
    try:
        Visit = getattr(models, "Visit", None)
        if Visit is None:
            print("Visit model not found; nothing to backfill.")
            return
        rows = db.query(Visit).all()
        for row in rows:
            goal_attr = next((k for k in ("goal","visit_goal","purpose","visit_purpose") if hasattr(row, k)), None)
            comment_attr = next((k for k in ("comment","visit_comment","goal_comment","purpose_comment") if hasattr(row, k)), None)
            if not goal_attr and not comment_attr:
                continue
            goal = pick(row, GOAL_KEYS)
            comment = pick(row, COMMENT_KEYS)
            if not goal or not comment:
                for c in containers(row):
                    goal = goal or pick(c, GOAL_KEYS)
                    comment = comment or pick(c, COMMENT_KEYS)
            local_changed = False
            if goal_attr and not getattr(row, goal_attr, None) and goal:
                setattr(row, goal_attr, goal); local_changed = True
            if comment_attr and not getattr(row, comment_attr, None) and comment:
                setattr(row, comment_attr, comment); local_changed = True
            if local_changed:
                changed += 1
        db.commit()
        print(f"Backfill complete. Updated visits: {changed}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
