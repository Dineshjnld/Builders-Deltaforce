CREATE TABLE IF NOT EXISTS workflow_versions(
  id INTEGER PRIMARY KEY,
  org TEXT NOT NULL REFERENCES organizations(id),
  department TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  required TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending_verification','published','superseded')),
  created TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS single_published_workflow ON workflow_versions(org,department) WHERE status='published';