QUESTIONS = [
    # One-time before visits
    {"key":"day_prepare_1","section":"Подготовка к рабочему дню","step":0,"weight":5.0,"allow_na":False,"text":"Подготовлен к рабочему дню в соответствии с элементами схемы ГИАЦИНТ"},
    {"key":"day_prepare_2","section":"Подготовка к рабочему дню","step":0,"weight":5.0,"allow_na":False,"text":"Знает текущий статус выполнения ключевых задач периода на основании выгрузок из систем"},
    {"key":"day_prepare_3","section":"Подготовка к рабочему дню","step":0,"weight":5.0,"allow_na":False,"text":"С учетом целей и задач периода корректно распределяет приоритеты на текущий день"},
    {"key":"visit_prepare_1","section":"Подготовка к визиту","step":1,"weight":5.0,"allow_na":False,"text":"Проанализировал соответствующую отчетность по торговой точке"},
    {"key":"visit_prepare_2","section":"Подготовка к визиту","step":1,"weight":5.0,"allow_na":False,"text":"Ставит цели, основываясь на приоритетах периода, условиях соглашения и Execution Standards"},
    {"key":"intro_1","section":"Вступление","step":2,"weight":5.0,"allow_na":False,"text":"Использует ступени представления: кто, откуда, с кем, цель, фраза о выгоде, время"},
    {"key":"inspection_1","section":"Осмотр","step":3,"weight":4.0,"allow_na":False,"text":"Проводит осмотр торговой точки снаружи и внутри и проверяет знания продавца"},
    {"key":"inspection_2","section":"Осмотр","step":3,"weight":4.0,"allow_na":False,"text":"Уточняет причины проблем и принимает меры либо корректирует цель визита"},
    {"key":"presentation_1","section":"Презентация","step":4,"weight":5.0,"allow_na":True,"text":"Выявляет потребность, задавая открытые и закрытые вопросы"},
    {"key":"presentation_2","section":"Презентация","step":4,"weight":5.0,"allow_na":True,"text":"Считает выгоду"},
    {"key":"presentation_3","section":"Презентация","step":4,"weight":5.0,"allow_na":True,"text":"Формирует предложение"},
    {"key":"objection_1","section":"Работа с возражениями","step":4,"weight":3.0,"allow_na":True,"text":"Выясняет, в чем суть возражения — конкретизация"},
    {"key":"objection_2","section":"Работа с возражениями","step":4,"weight":3.0,"allow_na":True,"text":"Частично соглашается с утверждением клиента — присоединение"},
    {"key":"objection_3","section":"Работа с возражениями","step":4,"weight":3.0,"allow_na":True,"text":"Повторяет или озвучивает дополнительные выгоды — аргументация"},
    {"key":"point_1","section":"Работа в точке","step":5,"weight":2.5,"allow_na":True,"text":"Проверяет рабочее состояние оборудования, освещение и наличие формы"},
    {"key":"point_2","section":"Работа в точке","step":5,"weight":2.5,"allow_na":True,"text":"Заполняет KO-карту в системе SMARTUP"},
    {"key":"point_3","section":"Работа в точке","step":5,"weight":2.5,"allow_na":True,"text":"Проверяет наличие и запас SIM-карт и при необходимости составляет заказ"},
    {"key":"point_4","section":"Работа в точке","step":5,"weight":2.5,"allow_na":True,"text":"Оценивает расположение плакатов и текущую планограмму"},
    {"key":"training_1","section":"Обучение персонала","step":5,"weight":3.0,"allow_na":False,"text":"Рассказывает и показывает, как нужно делать — показал"},
    {"key":"training_2","section":"Обучение персонала","step":5,"weight":3.0,"allow_na":False,"text":"Оператор самостоятельно воспроизвел знания или навык — повторил"},
    {"key":"training_3","section":"Обучение персонала","step":5,"weight":3.0,"allow_na":False,"text":"Указал на сильные стороны, ошибки и рекомендации — дал обратную связь"},
    {"key":"finish_visit_1","section":"Завершение визита","step":6,"weight":5.0,"allow_na":True,"text":"Использует правило 5П"},
    {"key":"analysis_1","section":"Анализ визита","step":7,"weight":3.0,"allow_na":False,"text":"Анализирует, что было достигнуто, а что нет — бизнес-задачи"},
    {"key":"analysis_2","section":"Анализ визита","step":7,"weight":3.0,"allow_na":False,"text":"Определяет, что помогло и что помешало достижению целей — навыки"},
    {"key":"analysis_3","section":"Анализ визита","step":7,"weight":3.0,"allow_na":False,"text":"Определяет бизнес-приоритет на следующий визит — планы"},
    # One-time after 5 visits
    {"key":"day_finish_1","section":"Завершение дня","step":8,"weight":2.5,"allow_na":False,"text":"Сопоставляет результаты дня с поставленными целями"},
    {"key":"day_finish_2","section":"Завершение дня","step":8,"weight":2.5,"allow_na":False,"text":"Корректирует план по достижению целей месяца исходя из результатов дня"},
]

QUESTION_MAP = {q["key"]: q for q in QUESTIONS}
