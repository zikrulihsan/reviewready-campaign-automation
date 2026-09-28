-- Read the n8n webhook URL from Vault instead of hardcoding a deployment's
-- hostname in version control. The token already came from Vault; the URL
-- names private infrastructure, so it belongs beside it rather than in a
-- migration that ships in a public repository.
--
-- Configure both secrets once per environment:
--   SELECT vault.create_secret('https://YOUR.app.n8n.cloud/webhook/campaign-submitted',
--                              'reviewready_n8n_webhook_url');
--   SELECT vault.create_secret('YOUR-LONG-RANDOM-TOKEN',
--                              'reviewready_n8n_webhook_token');
--
-- With either secret missing the trigger warns and returns, so a submission
-- still commits and stays reviewable without the asynchronous workflow.

CREATE OR REPLACE FUNCTION reviewready.notify_n8n_submission_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  webhook_url TEXT;
  webhook_token TEXT;
BEGIN
  SELECT decrypted_secret
    INTO webhook_url
    FROM vault.decrypted_secrets
   WHERE name = 'reviewready_n8n_webhook_url'
   ORDER BY updated_at DESC
   LIMIT 1;

  SELECT decrypted_secret
    INTO webhook_token
    FROM vault.decrypted_secrets
   WHERE name = 'reviewready_n8n_webhook_token'
   ORDER BY updated_at DESC
   LIMIT 1;

  IF webhook_url IS NULL OR webhook_token IS NULL THEN
    RAISE WARNING 'ReviewReady n8n webhook URL or token is not configured in Vault';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := webhook_url,
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
