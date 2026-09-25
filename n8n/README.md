# Post-submission workflow

Import [`workflow.json`](workflow.json) into n8n. This workflow starts after a creator submits a campaign. It validates the event, claims the processing job, runs the backend checks, and creates the reviewer packet. Final decisions remain with the reviewer.

## Processing sequence

```text
CAMPAIGN_SUBMITTED
  → validate event
  → return HTTP 202
  → claim processing job
  → check new or changed supporting material
  → run campaign clarity check
      → ACTION_REQUIRED at most once when clarification would help
      → continue when clear, explicitly overridden, or checked a second time
  → run detailed reviewer checks
  → build review packet
  → READY_FOR_REVIEW or READY_FOR_REVIEW_WITH_NOTES
```

HTTP `202` confirms receipt. It does not mean the packet is ready. Invalid event payloads return `400`. Failures after receipt remain visible in the n8n execution history and can be retried after the backend claim expires.

## Configuration

1. In **Validate Event**, use `http://fastapi:8000` as `api_base_url` for the supplied Compose stack.
2. On **Campaign Submitted Webhook**, use Header Auth with `X-Workflow-Token` and the value of `N8N_WEBHOOK_TOKEN`.
3. On all four HTTP Request nodes, use Header Auth with `X-Internal-Token` and the value of `INTERNAL_TOKEN`.
4. Test the webhook, then publish the workflow. FastAPI calls the production webhook URL.

Do not put either token directly in `workflow.json`.

## Event contract

FastAPI sends:

```json
{
  "type": "CAMPAIGN_SUBMITTED",
  "event_id": "evt_123",
  "campaign_id": "cmp_123",
  "campaign_version": 4
}
```

`event_id` stays the same when the same event is delivered again. `campaign_version` identifies the submitted revision. Campaign text and documents remain in the backend and are not included in the webhook payload.

## Internal endpoints

| Endpoint | Responsibility |
| --- | --- |
| `POST /internal/campaigns/{id}/claim-processing` | Validate the campaign and version, then claim the event atomically. Duplicate or stale events return `should_process: false`. |
| `POST /internal/campaigns/{id}/analyze-documents` | Check only documents without a current relevance result. |
| `POST /internal/campaigns/{id}/final-analysis` | Run the creator-facing clarity check and the detailed reviewer checks when processing can continue. Model failure never rejects a campaign. |
| `POST /internal/campaigns/{id}/build-review-packet` | Save the packet, preserve any creator override, update the routing status, and complete the processing job. |

Each endpoint receives:

```json
{
  "event_id": "evt_123",
  "campaign_version": 4
}
```

The HTTP Request nodes retry failed requests up to three times. The claim endpoint uses a lease so interrupted work can be retried without duplicate processing.

The backend owns the routing score and retry limit. n8n does not loop back by itself. Once the backend has returned a campaign to its creator once, the next submitted version continues to packet creation with any remaining findings attached.

## Manual checks

1. Submit a valid campaign and confirm that one packet appears in the reviewer queue.
2. Deliver the same `event_id` again and confirm that no duplicate packet or analysis is created.
3. Send an event without `campaign_id` and confirm a `400` response.
4. Send an older campaign version and confirm `should_process: false`.
5. Disable the model service and confirm that the campaign remains available for human review with an unavailable-analysis marker.
