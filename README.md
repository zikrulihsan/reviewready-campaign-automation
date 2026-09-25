# ReviewReady

ReviewReady is a local campaign submission and review prototype. Campaign creators enter the facts of a fundraiser, submit it, and receive clarification notes only when the submission is difficult to understand. Reviewers receive a structured packet with the original campaign, completeness checks, supporting material, and any creator override.

The system never approves or rejects a campaign automatically. A reviewer chooses the next action.

## What is included

- A Vite and React interface for campaign creators and reviewers
- A FastAPI JSON API
- PostgreSQL for campaigns, review packets, events, and reviewer actions
- An n8n workflow for post-submission processing
- Optional Gemini analysis for clarity, consistency, and completeness checks

The browser only shows product language. n8n and Gemini remain implementation details documented here for developers.

## Run locally

1. Start Docker Desktop.
2. Copy `.env.example` to `.env`.
3. Set different values for `INTERNAL_TOKEN` and `N8N_WEBHOOK_TOKEN`. Add `GEMINI_API_KEY` to enable model-assisted checks. Keep `.env` private.
4. Run `docker compose up --build -d` from this directory.
5. Open the [creator workspace](http://localhost:5173/creator), [reviewer workspace](http://localhost:5173/reviewer), [API documentation](http://localhost:8000/docs), and [workflow editor](http://localhost:5678).

For frontend development outside Docker:

```bash
cd web
npm install
npm run dev
```

## Configure the workflow

Import [`n8n/workflow.json`](n8n/workflow.json), then configure:

1. Header Auth on **Campaign Submitted Webhook**: header `X-Workflow-Token`, using the value of `N8N_WEBHOOK_TOKEN`.
2. Header Auth on the four HTTP Request nodes: header `X-Internal-Token`, using the value of `INTERNAL_TOKEN`.
3. `api_base_url` in **Validate Event**: `http://fastapi:8000` when using this Compose stack.
4. Publish the workflow so FastAPI can call its production webhook.

Events remain in PostgreSQL if the workflow is temporarily unavailable. See [`n8n/README.md`](n8n/README.md) for the event contract and retry behavior.

## Submission flow

1. The creator completes the campaign form and selects **Submit campaign**.
2. FastAPI validates required fields and basic formats.
3. FastAPI stores the submission and records a `CAMPAIGN_SUBMITTED` event.
4. The workflow claims the event and asks FastAPI to run the clarity check.
5. Clear submissions continue to packet preparation.
6. A submission that needs context returns to the creator as `ACTION_REQUIRED`.
7. The creator can edit and resubmit or select **Submit as it is**.
8. An unchanged submission continues as `READY_FOR_REVIEW_WITH_NOTES`. The packet records the notes and the creator's choice.
9. The reviewer inspects the packet and records **Continue review**, **Request more information**, or **Escalate**.

Supporting material is optional in this prototype. Material added after submission is checked for relevance and appears on the reviewer page after refresh.

## Main API endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /campaigns` | List creator campaigns. |
| `POST /campaigns` | Create a draft. |
| `PATCH /campaigns/{id}` | Update a draft. |
| `POST /campaigns/{id}/submit` | Validate and submit a campaign. |
| `POST /campaigns/{id}/submit-as-is` | Continue after clarification notes while preserving them for review. |
| `GET /campaigns/{id}/readiness` | Return creator-facing clarification notes. |
| `POST /campaigns/{id}/documents` | Add sample supporting material. |
| `GET /ops/reviews` | List submitted campaigns. |
| `GET /ops/reviews/{id}` | Return the review packet and reviewer actions. |
| `POST /ops/reviews/{id}/refresh-ai` | Refresh detailed campaign and completeness checks. |
| `POST /ops/reviews/{id}/actions` | Record a reviewer action and internal note. |

The `/internal/campaigns/{id}/...` endpoints require `X-Internal-Token`. They support event claiming, document analysis, detailed analysis, and packet creation. Claims use a lease so interrupted work can be retried without processing the same event twice.

## Example campaign

```json
{
  "profile_type": "behalf_of_other",
  "category": "education",
  "title": "Help my daughter continue her studies",
  "story": "My daughter has been accepted to university. We need help with tuition and books.",
  "goal_amount": 8000,
  "beneficiary": "My daughter",
  "beneficiary_relationship": "Parent",
  "fund_usage": "$6,500 for tuition and $1,500 for books and accommodation",
  "fund_delivery": "I will pay the university directly."
}
```

## Prototype limits

- There is no login or role-based authorization.
- Document input stores metadata and sample text. It does not upload files or run OCR.
- The category rules are prototype rules, not a copy of any platform's policy.
- Model output supplies review notes. It does not determine eligibility, fraud, authenticity, approval, or rejection.
- Reviewer actions are stored internally. They do not message the creator.
- Campaign and document text is sent to Gemini when `GEMINI_API_KEY` is configured. Use sample data for local demonstrations.

## Repository layout

```text
web/                    Vite and React interface
app.py                  FastAPI routes and processing logic
ai_service.py           Gemini requests and structured response schemas
requirements_engine.py  deterministic field and category checks
schema.sql              PostgreSQL schema
n8n/workflow.json       post-submission workflow
compose.yaml            local services
```
