# Post-submission n8n workflow

Import [`workflow.json`](workflow.json) to run the post-submit preparation workflow. Supabase sends an asynchronous Database Webhook after a `submission_events` row is committed. The webhook endpoint acknowledges receipt; the campaigner does not wait for Gemini or the detailed review.

## Processing sequence

```text
Supabase submission_events INSERT
  → validate event and acknowledge receipt
  → claim event and campaign version through Netlify API
  → assess up to two sample documents
  → run campaign clarity assessment
      → ACTION_REQUIRED once when useful
      → continue after creator override or second submission
  → prepare detailed reviewer analysis
  → build reviewer packet
  → save mock email record to Supabase
```

The TypeScript API owns event claims, score thresholds, retry limit, and final campaign state. Event ID and campaign version prevent stale or repeated delivery from creating duplicate work.

## Configure after import

1. In **Validate Event**, set `api_base_url` and `app_base_url` to the deployed Netlify site origin, such as `https://your-site.netlify.app`.
2. Set Header Auth on **Campaign Submitted Webhook**. Configure the same header on the Supabase Database Webhook.
3. Set HTTP Header Auth on the internal request nodes with header `X-Internal-Token`; its value must match Netlify's `INTERNAL_TOKEN`.
4. Activate the workflow, then point the Supabase Database Webhook for `reviewready.submission_events` inserts to its production webhook URL.

Do not commit tokens or API keys to this workflow file. The workflow's default site URLs are placeholders until the Netlify site exists.

## Mock email

**Compose Demo Email** prepares either a clarification message for the creator or a ready-for-review message for the reviewer. **Save Demo Email to Supabase** stores it for `zikrulihsanmd@gmail.com`; the reviewer page displays the record. This is a mock notification only; no email provider is contacted.

## Internal API calls

| Endpoint | Purpose |
| --- | --- |
| `POST /internal/campaigns/{id}/claim-processing` | Validate the campaign revision and atomically claim the event. |
| `POST /internal/campaigns/{id}/analyze-documents` | Analyze up to two unreviewed sample documents. |
| `POST /internal/campaigns/{id}/final-analysis` | Run clarity assessment and decide whether one creator clarification is useful. |
| `POST /internal/campaigns/{id}/reviewer-analysis` | Prepare detailed campaign and completeness notes in its own function invocation. |
| `POST /internal/campaigns/{id}/build-review-packet` | Save the packet, update queue status, and complete the job. |
| `POST /internal/campaigns/{id}/mock-email` | Idempotently save the email mock. |

All internal calls send the event ID and campaign version. HTTP requests use a short timeout and limited retry where safe. If the workflow stops, the app shows a paused state after five minutes and allows one fresh processing event.
