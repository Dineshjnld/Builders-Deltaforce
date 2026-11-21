CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  org TEXT NOT NULL REFERENCES organizations(id),
  department TEXT NOT NULL,
  whatsapp_message_id TEXT NOT NULL UNIQUE,
  sender TEXT NOT NULL,
  message_type TEXT NOT NULL,
  message_text TEXT,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cases_scope_received ON cases(org,department,received_at DESC);
