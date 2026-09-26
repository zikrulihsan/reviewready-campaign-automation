ALTER TABLE reviewready.campaigns
  ADD COLUMN IF NOT EXISTS expedited_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS urgency_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS urgency_deadline DATE,
  ADD COLUMN IF NOT EXISTS priority_status TEXT NOT NULL DEFAULT 'standard'
    CHECK (priority_status IN ('standard', 'requested', 'confirmed')),
  ADD COLUMN IF NOT EXISTS creator_submission_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS review_recommendation TEXT;

-- Earlier processing retries reused the campaign version. Count each version
-- once so historic retries cannot inflate the creator's submission count.
UPDATE reviewready.campaigns c
SET creator_submission_count = history.attempts,
    last_submitted_at = history.last_submitted_at
FROM (
  SELECT campaign_id,
         COUNT(DISTINCT campaign_version)::INTEGER AS attempts,
         MAX(created_at) AS last_submitted_at
  FROM reviewready.submission_events
  WHERE COALESCE(payload->>'force_review', 'false') <> 'true'
  GROUP BY campaign_id
) history
WHERE c.id = history.campaign_id;

UPDATE reviewready.campaigns c
SET last_submitted_at = history.last_submitted_at
FROM (
  SELECT campaign_id, MAX(created_at) AS last_submitted_at
  FROM reviewready.submission_events
  GROUP BY campaign_id
) history
WHERE c.id = history.campaign_id;

CREATE INDEX IF NOT EXISTS campaigns_review_priority_idx
  ON reviewready.campaigns (priority_status, last_submitted_at)
  WHERE status IN ('ready_for_review', 'ready_for_review_with_notes', 'submitted');

CREATE TABLE IF NOT EXISTS reviewready.priority_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES reviewready.campaigns(id) ON DELETE CASCADE,
  priority_status TEXT NOT NULL CHECK (priority_status IN ('standard', 'confirmed')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS priority_events_campaign_idx
  ON reviewready.priority_events (campaign_id, created_at DESC);

REVOKE ALL ON TABLE reviewready.priority_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE reviewready.priority_events TO service_role;
