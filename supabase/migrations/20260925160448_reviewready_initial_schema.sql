CREATE SCHEMA IF NOT EXISTS reviewready;

CREATE TABLE IF NOT EXISTS reviewready.campaigns (
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
  clarification_rounds INTEGER NOT NULL DEFAULT 0,
  review_score INTEGER,
  review_level TEXT,
  review_routing_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reviewready.campaigns ADD COLUMN IF NOT EXISTS creator_override_at TIMESTAMPTZ;
ALTER TABLE reviewready.campaigns ADD COLUMN IF NOT EXISTS clarification_rounds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reviewready.campaigns ADD COLUMN IF NOT EXISTS review_score INTEGER;
ALTER TABLE reviewready.campaigns ADD COLUMN IF NOT EXISTS review_level TEXT;
ALTER TABLE reviewready.campaigns ADD COLUMN IF NOT EXISTS review_routing_reason TEXT;

CREATE TABLE IF NOT EXISTS reviewready.campaign_documents (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES reviewready.campaigns(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  extracted_text TEXT NOT NULL DEFAULT '',
  analysis JSONB,
  analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_documents_campaign_id_idx
  ON reviewready.campaign_documents(campaign_id);

CREATE TABLE IF NOT EXISTS reviewready.readiness_analyses (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES reviewready.campaigns(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS reviewready.review_packets (
  campaign_id TEXT PRIMARY KEY REFERENCES reviewready.campaigns(id) ON DELETE CASCADE,
  campaign_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  packet JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviewready.ops_review_analyses (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES reviewready.campaigns(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, input_hash, prompt_version)
);

CREATE TABLE IF NOT EXISTS reviewready.submission_events (
  event_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES reviewready.campaigns(id) ON DELETE CASCADE,
  campaign_version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  delivered_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviewready.processing_jobs (
  event_id TEXT PRIMARY KEY REFERENCES reviewready.submission_events(event_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviewready.review_actions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES reviewready.campaigns(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('continue_review', 'request_more_information', 'escalate')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_actions_campaign_idx
  ON reviewready.review_actions(campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviewready.campaign_automation_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES reviewready.campaigns(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_automation_events_campaign_idx
  ON reviewready.campaign_automation_events(campaign_id, created_at, id);


ALTER TABLE reviewready.campaigns
  ADD COLUMN IF NOT EXISTS retry_attempts INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS reviewready.mock_email_notifications (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES reviewready.submission_events(event_id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES reviewready.campaigns(id) ON DELETE CASCADE,
  notification_kind TEXT NOT NULL CHECK (notification_kind IN ('needs_clarification', 'ready_for_review')),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'mock_sent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, notification_kind)
);

CREATE INDEX IF NOT EXISTS mock_email_notifications_campaign_idx
  ON reviewready.mock_email_notifications(campaign_id, created_at DESC);

REVOKE ALL ON SCHEMA reviewready FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA reviewready TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA reviewready TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA reviewready
  GRANT ALL ON TABLES TO service_role;

CREATE TABLE IF NOT EXISTS reviewready.public_request_limits (
  request_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count INTEGER NOT NULL DEFAULT 0
);
REVOKE ALL ON TABLE reviewready.public_request_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE reviewready.public_request_limits TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA reviewready
  GRANT ALL ON TABLES TO service_role;
