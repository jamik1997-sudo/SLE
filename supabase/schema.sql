-- Backend создаёт таблицы автоматически через SQLAlchemy.
-- Этот файл включает полезные индексы для Supabase PostgreSQL после первого запуска backend.
CREATE INDEX IF NOT EXISTS idx_audits_auditor_status ON audits(auditor_id, status);
CREATE INDEX IF NOT EXISTS idx_audits_region_date ON audits(region_id, audit_date);
CREATE INDEX IF NOT EXISTS idx_answers_audit_question ON answers(audit_id, question_key);
CREATE INDEX IF NOT EXISTS idx_visits_audit_number ON visits(audit_id, visit_number);

-- Примеры регионов (выполнять после создания таблиц):
-- INSERT INTO regions (id, name, is_active) VALUES
-- (gen_random_uuid()::text, 'Кокандский регион', true),
-- (gen_random_uuid()::text, 'Ферганский регион', true),
-- (gen_random_uuid()::text, 'Андижанский регион', true),
-- (gen_random_uuid()::text, 'Наманганский регион', true);
