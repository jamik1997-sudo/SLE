from collections import defaultdict
from app.models import Audit
from app.questionnaire import QUESTIONS

def calculate(audit: Audit, questions=None, confident_min=65.0, master_min=85.0):
    questions=questions or QUESTIONS
    by_key=defaultdict(list)
    for answer in audit.answers: by_key[answer.question_key].append(answer.answer_value)
    section_scores=defaultdict(float); total=0.0; maximum=0.0
    for q in questions:
        if not q.get("is_active",True): continue
        values=by_key.get(q["key"],[]); applicable=[v for v in values if v in ("1","0")]
        if values and not applicable and all(v == "NA" for v in values):
            continue
        maximum += float(q["weight"])
        score=0.0 if not applicable else (sum(1 for v in applicable if v=="1")/len(applicable))*float(q["weight"])
        section_scores[q["section"]]+=score; total+=score
    percent=round((total/maximum)*100,2) if maximum else 0.0
    level="Базовый" if percent<confident_min else "Уверенный" if percent<master_min else "Мастер"
    return round(total,2),percent,level,dict(section_scores)
