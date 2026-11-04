from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter

from ..store import collection

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats")
def stats(days: int = 371) -> dict[str, Any]:
    with collection() as col:
        cutoff = col.sched.day_cutoff  # end of "today" in Anki's sense
        today = col.sched.today
        start_ms = (cutoff - days * 86400) * 1000

        # Daily review counts for the calendar.
        rows = col.db.all(
            "select (? - id / 1000) / 86400, count(), sum(time), sum(ease = 1) "
            "from revlog where id > ? and type != 4 and ease > 0 group by 1",
            cutoff,
            start_ms,
        )
        last_day = datetime.fromtimestamp(cutoff - 1).date()
        by_day = {int(r[0]): (r[1], r[2] or 0, r[3] or 0) for r in rows}
        calendar = []
        for ago in range(days - 1, -1, -1):
            d: date = last_day - timedelta(days=ago)
            n, ms, again = by_day.get(ago, (0, 0, 0))
            calendar.append({"date": d.isoformat(), "count": n, "seconds": ms // 1000})

        # Streak: consecutive days with at least one review, ending today
        # (or yesterday, so that a streak does not look broken at breakfast).
        streak = 0
        for i, ago in enumerate(range(0, days)):
            if by_day.get(ago):
                streak += 1
            elif i == 0:
                continue
            else:
                break

        # Due forecast for the next month.
        due_rows = col.db.all(
            "select (case when queue in (1, 4) then 0 else max(0, due - ?) end), count() "
            "from cards where queue in (1, 2, 3, 4) "
            "and (queue in (1, 4) or due - ? < 31) group by 1",
            today,
            today,
        )
        due_map = Counter({int(r[0]): r[1] for r in due_rows})
        forecast = [{"day": i, "count": due_map.get(i, 0)} for i in range(31)]

        # Collection make-up.
        counts = dict(
            col.db.all(
                """select (case
                    when queue < -1 then 'buried'
                    when queue = -1 then 'suspended'
                    when type = 0 then 'new'
                    when type in (1, 3) then 'learning'
                    when ivl >= 21 then 'mature'
                    else 'young' end), count()
                   from cards group by 1"""
            )
        )

        # True retention over the last 30 days: share of review-card answers
        # that were not "Again".
        month_ms = (cutoff - 30 * 86400) * 1000
        ret = col.db.first(
            "select count(), sum(ease > 1) from revlog where id > ? and type = 1 and ease > 0",
            month_ms,
        )
        retention = (ret[1] / ret[0]) if ret and ret[0] else None

        # When in the day do you study? (hour-of-day histogram, last 90 days)
        hours_rows = col.db.all(
            "select strftime('%H', id / 1000, 'unixepoch', 'localtime'), count() "
            "from revlog where id > ? group by 1",
            (cutoff - 90 * 86400) * 1000,
        )
        hours = [0] * 24
        for h, n in hours_rows:
            hours[int(h)] = n

        # Typical seconds per card, used to turn "23 due" into "about 4 minutes".
        avg = col.db.first(
            "select count(), sum(min(time, 60000)) from revlog where id > ? and ease > 0",
            month_ms,
        )
        secs_per_card = (avg[1] / avg[0] / 1000) if avg and avg[0] >= 20 else 10.0

        today_row = by_day.get(0, (0, 0, 0))
        return {
            "calendar": calendar,
            "streak": streak,
            "forecast": forecast,
            "counts": {
                k: counts.get(k, 0)
                for k in ("new", "learning", "young", "mature", "suspended", "buried")
            },
            "totalCards": sum(counts.values()),
            "totalNotes": col.note_count(),
            "retention": retention,
            "retentionSample": ret[0] if ret else 0,
            "hours": hours,
            "secsPerCard": round(secs_per_card, 1),
            "today": {"cards": today_row[0], "seconds": today_row[1] // 1000, "again": today_row[2]},
        }
