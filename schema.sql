CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  profile_type TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  story TEXT NOT NULL,
  goal_amount NUMERIC(14, 2) NOT NULL,
  beneficiary TEXT NOT NULL,
  beneficiary_relationship TEXT NOT NULL,
  fund_usage TEXT NOT NULL,
  fund_delivery TEXT NOT NULL,
  travel_purpose TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  submitted_with_warning BOOLEAN NOT NULL DEFAULT FALSE,
  creator_override_at TIMESTAMPTZ,
  readiness_state TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS creator_override_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS campaign_documents (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  extracted_text TEXT NOT NULL DEFAULT '',
  analysis JSONB,
  analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_documents_campaign_id_idx
  ON campaign_documents(campaign_id);

CREATE TABLE IF NOT EXISTS readiness_analyses (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_version INTEGER NOT NULL,
  input_hash TEXT NOT NULL,
  requirements_result JSONB NOT NULL,
  semantic_result JSONB NOT NULL,
  overall_state TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, input_hash, prompt_version)
);

CREATE TABLE IF NOT EXISTS review_packets (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  packet JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_review_analyses (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, input_hash, prompt_version)
);

CREATE TABLE IF NOT EXISTS submission_events (
  event_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  delivered_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS processing_jobs (
  event_id TEXT PRIMARY KEY REFERENCES submission_events(event_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_actions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('continue_review', 'request_more_information', 'escalate')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_actions_campaign_idx
  ON review_actions(campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_automation_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_automation_events_campaign_idx
  ON campaign_automation_events(campaign_id, created_at, id);
