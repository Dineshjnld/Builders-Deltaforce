CREATE TABLE IF NOT EXISTS evolution_messages (
  case_id TEXT PRIMARY KEY REFERENCES cases(id),
  instance TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  mime_type TEXT,
  attachment BLOB,
  UNIQUE(instance, provider_id)
);
CREATE TABLE IF NOT EXISTS whatsapp_responses (
  case_id TEXT PRIMARY KEY REFERENCES evolution_messages(case_id),
  approver TEXT NOT NULL,
  body TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('sending', 'accepted', 'uncertain')),
  provider_id TEXT
);
CREATE TABLE IF NOT EXISTS whatsapp_audit (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  detail TEXT NOT NULL
);
