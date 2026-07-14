-- Structured report payload alongside the plain-text report, so the web UI can
-- render a clean, styled report (body_text remains the downloadable original).
ALTER TABLE reports ADD COLUMN IF NOT EXISTS body_json JSONB;
