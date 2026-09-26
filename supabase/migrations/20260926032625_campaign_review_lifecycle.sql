ALTER TABLE reviewready.campaigns
  ADD COLUMN IF NOT EXISTS feedback_source TEXT,
  ADD COLUMN IF NOT EXISTS content_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_slug TEXT,
  ADD COLUMN IF NOT EXISTS verification_checks JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_public_slug_idx ON reviewready.campaigns(public_slug) WHERE public_slug IS NOT NULL;

ALTER TABLE reviewready.campaign_documents
  ADD COLUMN IF NOT EXISTS content_base64 TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size INTEGER,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'accepted', 'rejected')),
  ADD COLUMN IF NOT EXISTS reviewer_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE reviewready.review_actions DROP CONSTRAINT IF EXISTS review_actions_action_check;
ALTER TABLE reviewready.review_actions ADD CONSTRAINT review_actions_action_check
  CHECK (action IN ('continue_review', 'request_more_information', 'escalate', 'approve_content', 'publish'));
