# ReviewReady: Local Vite, FastAPI, and n8n stack

This demo runs one Vite/React user interface, a separate FastAPI data API, PostgreSQL, and n8n on your computer. The Vite-built interface is served separately on port 5173; FastAPI serves JSON only on port 8000. Creators submit campaigns directly. FastAPI records the submission, then n8n coordinates the initial AI review, routing, detailed reviewer analysis, and review packet. Gemini analysis runs when `GEMINI_API_KEY` is configured. If it is unavailable, submissions still proceed to human review.

## Start the stack

1. Start Docker Desktop.
2. Copy `.env.example` to `.env`. Replace the two tokens with different random values and optionally set `GEMINI_API_KEY`. The tested model is `gemini-2.5-flash`. Keep `.env` private.
3. From this folder, run `docker compose up --build -d`. After a frontend change, run `cd web && npm run build && cd .. && docker compose up --build -d web`. The Docker web service serves the Vite build separately from FastAPI. For Vite development outside Docker, run `cd web && npm install && npm run dev`.
4. Open the [creator workspace](http://localhost:5173/creator), [reviewer workspace](http://localhost:5173/reviewer), [API documentation](http://localhost:8000/docs), and [n8n editor](http://localhost:5678).
5. Import [`n8n/workflow.json`](n8n/workflow.json) into n8n.
6. In the Webhook node, select a **Header Auth** credential with header `X-Workflow-Token` and the same value as `N8N_WEBHOOK_TOKEN`.
7. In all four HTTP Request nodes, select a **Header Auth** credential with header `X-Internal-Token` and the same value as `INTERNAL_TOKEN`.
8. Confirm that the **Validate Event** node has `api_base_url` set to `http://fastapi:8000`, then publish the workflow. FastAPI will send new submissions to its production webhook. Events remain in PostgreSQL for retry if the workflow is temporarily unavailable.

Use `docker compose logs -f fastapi n8n` to watch processing. Docker volumes retain the database and n8n configuration across restarts. The FastAPI and n8n ports bind only to `127.0.0.1`.

## Current flow

1. The creator enters the campaign details and story in the Vite frontend, then clicks **Submit campaign**. There is no separate readiness button.
2. FastAPI checks required fields, title length, and the funding goal. Invalid forms remain editable and do not start automation.
3. FastAPI saves the submission as `INITIAL_REVIEW`, records `CAMPAIGN_SUBMITTED`, and returns immediately. The creator page displays the automation timeline.
4. n8n calls FastAPI to run Gemini's initial clarity review. A clear campaign continues automatically. A campaign with semantic suggestions becomes `ACTION_REQUIRED` and returns to the creator.
5. The creator can edit and resubmit, or select **Submit as it is**. The override continues through n8n and becomes `READY_FOR_REVIEW_WITH_NOTES`; the packet records the suggestions and the creator's choice.
6. n8n analyzes material already present, runs the detailed campaign and completeness review, builds the packet, and changes the campaign to `READY_FOR_REVIEW` or `READY_FOR_REVIEW_WITH_NOTES`.
7. The reviewer sees two structured AI sections, evidence, the routing status, and a neutral creator override note. Reviewers can record **Continue review**, **Request more information**, or **Escalate**. The final decision remains human.
8. After submission, the creator may add sample supporting material. FastAPI analyzes these later additions immediately; the review page shows them and their relevance findings on refresh.

## Try the simulation

- **Creator** (`/creator`): manage drafts, submit directly into automation, follow its progress, and respond to automated suggestions when needed.
- **Reviewer** (`/reviewer`): view the queue, inspect each review packet, and record internal human review actions.
- Supporting material consists of a type, filename, and sample text. Real file uploads and payment details are not implemented.
- A human reviewer makes the final decision. The three action buttons record workflow steps; they are not approval or rejection controls.
- Frontend source is in `web/src`. The Vite React frontend owns the pages at `http://localhost:5173` and proxies API calls to FastAPI. FastAPI exposes API documentation at `http://localhost:8000/docs`.

## API flow

| Endpoint | Purpose |
| --- | --- |
| `GET /campaigns` | List campaigns for the creator workspace. |
| `POST /campaigns` | Create a draft. |
| `PATCH /campaigns/{id}` | Update a draft and increment its version. |
| `POST /campaigns/{id}/documents` | Add optional sample supporting material before or after submission. |
| `POST /campaigns/{id}/check-readiness` | Legacy/manual readiness endpoint retained for diagnostics; the creator UI no longer calls it. |
| `POST /campaigns/{id}/submit` | Validate required fields, set `INITIAL_REVIEW`, and record an outbox event without waiting for AI. |
| `POST /campaigns/{id}/submit-as-is` | Continue an `ACTION_REQUIRED` campaign to human review while preserving automated notes and the creator override. |
| `GET /campaigns/{id}/readiness` | Return feedback to the creator. Document mismatches are described generally. |
| `GET /ops/reviews` | List submitted campaigns. |
| `GET /ops/reviews/{id}` | Return a review packet with detailed campaign and completeness analysis, current documents, and human review actions. |
| `POST /ops/reviews/{id}/refresh-ai` | Run or reuse the detailed Ops analysis for the current campaign and material. Also backfills older demo submissions. |
| `POST /ops/reviews/{id}/actions` | Record an internal reviewer action and note. |

The four `/internal/campaigns/{id}/...` endpoints require `X-Internal-Token` and are called by n8n. `claim-processing` prevents concurrent processing of the same event. A stopped job can be retried after its lease expires. `build-review-packet` saves the packet and marks the job complete in one database transaction.

### Example campaign

```json
{
  "profile_type": "behalf_of_other",
  "category": "education",
  "title": "Help my daughter continue her studies",
  "story": "My daughter has been accepted to university. We need help with tuition and books.",
  "goal_amount": 8000,
  "beneficiary": "My daughter",
  "beneficiary_relationship": "Parent",
  "fund_usage": "6500 for tuition and 1500 for books and accommodation",
  "fund_delivery": "I will pay the university directly."
}
```

After submission, a reviewer may request supporting material such as `organizer_id`, `beneficiary_id`, `recent_bank_statement`, or an education document. These are illustrative review prompts, not submission prerequisites. Example document request:

```json
{
  "document_type": "acceptance_letter",
  "filename": "acceptance-letter.pdf",
  "extracted_text": "University admission letter for the beneficiary..."
}
```

## Demo limitations

- Document endpoints accept metadata and extracted text. File storage, OCR, and document access controls are needed before real use.
- The rules in `requirements_engine.py` are sample MVP rules from the brief, not verified LaunchGood policy for every category. Review the rules before using them with real campaigns.
- Creator and reviewer endpoints have no login or user level authorization. This stack is intended for local demonstration.
- If AI is unavailable, readiness uses structural rules and the packet records `semantic.status = unavailable`.
- When Gemini is enabled, campaign fields and analyzed document text are sent to the Gemini API. Use sample data if real data must stay private.
- The reviewer page saves internal workflow actions. It does not send information requests to the creator or save final approval/rejection decisions.
- AI completeness findings are review prompts based on supplied information, not a document policy or eligibility decision.

## Verification

The Vite build, API syntax, and rule functions were checked locally. A sample browser flow covered draft creation, field validation, AI readiness, submission through n8n, post-submit material, the reviewer queue, and internal review actions. A later end-to-end submission confirmed that n8n created a packet containing separate Gemini campaign and completeness findings. Post-submit material was analyzed by FastAPI. The local API key stays in the private `.env` file.
