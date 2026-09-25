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
9. n8n prepares a demo email notification for `zikrulihsanmd@gmail.com` with the relevant creator or reviewer link.
10. The reviewer inspects the packet and records **Continue review**, **Request more information**, or **Escalate**.

Supporting material is optional in this prototype. Material added after submission is checked for relevance and appears on the reviewer page after refresh.

## Routing score and retry limit

The backend assigns an internal score from 0 to 100. Missing or invalid fields, unclear answers, and contradictions reduce the score. The score maps to `strong`, `reviewable`, or `needs_attention`; it is used to route work and never to approve or reject a campaign.

- First submission threshold: 85
- Resubmission threshold: 65
- Maximum checks before queueing: 2
- Maximum times returned to the creator: 1

If the first submission needs substantial clarification, it returns to the creator once. The next submission always enters the reviewer queue. Remaining findings are attached as notes and the campaign is marked `READY_FOR_REVIEW_WITH_NOTES`. A creator can also choose **Submit as it is** after the first return.

## Creator feedback levels

Creator feedback uses one deterministic policy after the model returns structured findings:

| Mode | Used when | Creator response |
| --- | --- | --- |
| `general` | Core answers are very short, contain placeholders, the score is below 65, a critical contradiction exists, or there are three or more findings. | At most two broad next steps covering the campaign purpose, beneficiary, use of funds, delivery, or consistency. |
| `targeted` | The submission has enough context, the score is at least 65, and there are no more than two localized findings. | At most two specific notes tied to the submitted information. |
| `none` | No semantic finding needs a creator response. | The submission continues without feedback. |

Example of a low-information submission:

```text
Story: Need help.
Use of funds: For needs.
Delivery: I will give it.
```

Creator response:

```text
Describe what happened, who needs support, and why help is needed now.
Add a simple breakdown of what the funds will pay for and how the support will reach the beneficiary.
```

Example of an otherwise clear submission with one narrow gap:

```text
The story and budget identify the beneficiary and surgery cost, but do not explain who will receive and pay the clinic invoice.
```

Creator response:

```text
Please explain whether you will pay the clinic directly or transfer the funds to the beneficiary.
```

Reviewers still receive the complete structured findings in both modes.

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
- The email notification node is a mock: its payload is visible in the n8n execution, but no email provider is contacted.
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
