# ReviewReady

ReviewReady is a campaign submission and human review demo. The creator workspace collects campaign details; deterministic checks and Gemini prepare friendly clarification notes and a structured reviewer packet. A human reviewer makes the final decision.

## Hosted architecture

- **Netlify:** Vite frontend and TypeScript API Functions in one deploy.
- **Supabase:** private PostgreSQL schema for campaigns, analysis, processing events, and mock notification records.
- **n8n Cloud:** asynchronous workflow triggered by a Supabase Database Webhook after a submission is committed.
- **Gemini API:** optional semantic analysis. When unavailable, the submission remains reviewable and model findings are marked unavailable.

The browser calls the same relative API paths it uses today. Supabase credentials, Gemini key, and internal API token are server-side environment variables only.

## Deploy setup

### 1. Supabase

1. Create a Supabase project and link this repository with the Supabase CLI.
2. Apply the migration in `supabase/migrations` with `supabase db push`.
3. In **Database → Webhooks**, create an `INSERT` webhook for `reviewready.submission_events`.
4. Set its URL to the production URL of the n8n webhook `campaign-submitted` and add the header required by the n8n Webhook Header Auth credential.
5. Copy the **Transaction pooler** connection string from Supabase **Connect**. Do not use the browser Data API for application tables.

### 2. Netlify

1. Import this repository as a Netlify site. Use the repository root as the base directory; `netlify.toml` sets the Vite output and Functions directory.
2. Add these environment variables in Netlify site settings:
   - `DATABASE_URL`: Supabase Transaction pooler URL.
   - `INTERNAL_TOKEN`: long random value shared with n8n's Header Auth credential.
   - `GEMINI_API_KEY`: optional model key; keep it out of the Vite environment.
   - `GEMINI_MODEL`: optional, defaults to `gemini-2.5-flash`.
3. Deploy. The root build command installs the Vite app dependencies and builds `web/dist`.

### 3. n8n Cloud

1. Import `n8n/workflow.json`.
2. In **Validate Event**, set both `api_base_url` and `app_base_url` to the deployed Netlify origin.
3. Configure Webhook Header Auth on **Campaign Submitted Webhook**. Use the same header name and value configured on the Supabase Database Webhook.
4. Configure HTTP Header Auth with `X-Internal-Token` and the same `INTERNAL_TOKEN` used by Netlify on the internal API nodes.
5. Activate the workflow and ensure the Supabase Database Webhook points to the active production webhook URL.

The trial is temporary. n8n Cloud requires a paid plan after the trial; if it ends, post-submit automation will stop until it is available again. Supabase Free projects may pause after a week of low activity. Use synthetic campaign content and sample document text only: the public demo has no login.

## Local development

Install the Netlify CLI and Supabase CLI for local development. Use the Supabase project Transaction pooler URL and server-only environment variables in a local `.env`. Keep `DATABASE_SSL=require` for Supabase. For a local PostgreSQL test instance only, set `DATABASE_SSL=disable`. Then run:

```sh
pnpm install
npm --prefix web ci
pnpm dev
```

Open the local Netlify Dev URL, normally `http://localhost:8888`. The Vite app and Functions run together through Netlify Dev; local campaign data is separate from any previous PostgreSQL demo database.

## Submission lifecycle

1. The API saves the campaign and a `CAMPAIGN_SUBMITTED` event in one database transaction. Missing campaign details become review notes rather than blocking submission.
2. The API immediately responds to the creator. A Supabase Database Webhook asynchronously starts n8n.
3. n8n claims the event, requests deterministic and AI checks from the TypeScript API, then requests API persistence of the reviewer packet.
4. A reviewability assessment scores completeness (30 points), clarity (50), and consistency (20). If one clarification would materially help, the creator sees a recommendation and can update the campaign or use **Submit as it is**. A second creator submission enters the queue with remaining findings attached. System retries do not count as creator submissions; unavailable AI analysis does not create a misleading quality score.
5. The **Urgent? Submit for an expedited review** toggle sends a time-sensitive submission directly to human review with any gaps attached. It records a priority request, not an automatic queue jump. Reviewers confirm expedited priority or keep the campaign in the standard queue. The reason and deadline are optional and review timing is not guaranteed.
6. n8n prepares a mock email record. It is visible on the reviewer campaign page, but no email is sent.
7. Reviewers can continue, request more information, or escalate. The system never approves or rejects a campaign automatically.

## Operational behavior

- Events are idempotent by event ID and campaign version. The processing lease prevents duplicate packets.
- Gemini calls are split across Functions and have a short timeout. A model or quota error produces an unavailable finding and does not block human review.
- The demo accepts up to two sample supporting materials for each campaign.
- If automation stays in progress for five minutes, the creator/reviewer view reports preparation as paused. The creator can retry once; a retry creates a new event and packet processing remains idempotent.
- Public endpoints have per-IP hourly limits for campaign creation, submission, and AI review. This is a demo safeguard, not account-level access control.
- Reviewer actions and mock email records are internal demo data and do not contact the campaigner.

## Repository layout

```text
web/                         Vite + React creator/reviewer interface
netlify/functions/api.mts    TypeScript API routes
netlify/functions/lib/       Database, Gemini, validation, and scoring logic
supabase/migrations/         Private schema and demo operations tables
n8n/workflow.json            Asynchronous post-submit workflow
```

## Demo limitations

There is no authentication. Anyone with the public site URL can view or change demo campaigns, so use synthetic data only. Document handling stores a filename and sample text; it does not upload files, perform OCR, or authenticate documents. Human reviewers retain all final decisions.
