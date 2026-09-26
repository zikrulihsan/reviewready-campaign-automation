ALTER TABLE reviewready.campaigns
  ADD COLUMN IF NOT EXISTS creator_email TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS reviewready.notification_deliveries (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  campaign_id TEXT NOT NULL REFERENCES reviewready.campaigns(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'slack')),
  notification_kind TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_deliveries_due_idx
  ON reviewready.notification_deliveries (next_attempt_at, created_at)
  WHERE delivery_status IN ('pending', 'processing', 'failed');

REVOKE ALL ON reviewready.notification_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON reviewready.notification_deliveries TO service_role;
