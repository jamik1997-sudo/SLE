from collections import defaultdict
from app.models import Audit
from app.questionnaire import QUESTIONS


def calculate(audit: Audit) -> tuple[float, float, str, dict[str, float]]:
    by_key = defaultdict(list)
    for answer in audit.answers:
        by_key[answer.question_key].append(answer.answer_value)

    section_scores = defaultdict(float)
    total = 0.0
    maximum = sum(q["weight"] for q in QUESTIONS)

    for q in QUESTIONS:
        values = by_key.get(q["key"], [])
        # Questions before/after visits are answered once; visit questions are averaged across 5 visits.
        applicable = [v for v in values if v in ("1", "0")]
        score = 0.0 if not applicable else (sum(1 for v in applicable if v == "1") / len(applicable)) * q["weight"]
        section_scores[q["section"]] += score
        total += score

    percent = round((total / maximum) * 100, 2) if maximum else 0.0
    level = "Базовый" if percent < 65 else "Уверенный" if percent < 85 else "Мастер"
    return round(total, 2), percent, level, dict(section_scores)
