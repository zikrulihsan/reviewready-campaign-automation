CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION reviewready.notify_n8n_submission_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  webhook_token TEXT;
BEGIN
  SELECT decrypted_secret
    INTO webhook_token
    FROM vault.decrypted_secrets
   WHERE name = 'reviewready_n8n_webhook_token'
   ORDER BY updated_at DESC
   LIMIT 1;

  IF webhook_token IS NULL THEN
    RAISE WARNING 'ReviewReady n8n webhook token is not configured in Vault';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://ahsanproject.app.n8n.cloud/webhook/campaign-submitted',
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(NEW),
      'old_record', NULL
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Workflow-Token', webhook_token
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviewready_submission_events_n8n
  ON reviewready.submission_events;

CREATE TRIGGER reviewready_submission_events_n8n
AFTER INSERT ON reviewready.submission_events
FOR EACH ROW
EXECUTE FUNCTION reviewready.notify_n8n_submission_event();
