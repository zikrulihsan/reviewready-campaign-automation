# ReviewReady

ReviewReady is an end-to-end campaign review prototype. A creator submits a story, receives AI clarity notes, revises if needed, and enters a human review queue. Reviewers can inspect uploaded documents, request specific changes, approve the story, complete manual verification, and publish a campaign page.

The manual review checklist follows the themes in [LaunchGood's campaign verification guidance](https://support.launchgood.com/support/solutions/articles/35000016132-how-does-launchgood-vet-campaigns-): supporting documentation, beneficiary and funds path, sanctions/risk review, and campaign guidelines. This prototype records reviewer decisions; it does not run external verification services.

## Hosted architecture

- **Netlify:** Vite frontend and TypeScript API Functions in one deploy.
- **Supabase:** private PostgreSQL schema for campaigns, analysis, processing events, and notification delivery records.
- **n8n Cloud:** asynchronous workflow triggered by a Supabase Database Webhook after a submission is committed.
- **Gemini API:** optional semantic analysis. When unavailable, the submission remains reviewable and model findings are marked unavailable.

The browser calls the same relative API paths it uses today. Supabase credentials, Gemini key, and internal API token are server-side environment variables only.

## Deploy setup

### 1. Supabase

1. Use the existing Supabase project linked to this repository.
2. Apply pending migrations in `supabase/migrations` with `supabase db push`.
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
   - `PUBLIC_APP_URL`: public site origin for links in notifications.
   - `SLACK_REVIEWER_WEBHOOK_URL`: incoming webhook for the reviewer channel.
   - `SMTP_HOST=smtp.sumopod.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASSWORD`: Sumopod's documented SMTP settings and your account credentials.
   - `NOTIFICATION_FROM_EMAIL`: sender on a verified domain, such as `ReviewReady <updates@example.com>`.
3. Deploy. The root build command installs the Vite app dependencies and builds `web/dist`.

Create the Slack webhook in your Slack app settings: enable **Incoming Webhooks**, choose **Add New Webhook to Workspace**, select the reviewer channel, and authorize it. Copy the generated URL into Netlify as `SLACK_REVIEWER_WEBHOOK_URL`. Treat that URL as a password; Slack can revoke leaked webhook URLs.

### 3. n8n Cloud

1. Import `n8n/workflow.json`.
2. In **Validate Event**, set both `api_base_url` and `app_base_url` to the deployed Netlify origin.
3. Configure Webhook Header Auth on **Campaign Submitted Webhook**. Use the same header name and value configured on the Supabase Database Webhook.
4. Configure HTTP Header Auth with `X-Internal-Token` and the same `INTERNAL_TOKEN` used by Netlify on the internal API nodes.
5. Activate the workflow and ensure the Supabase Database Webhook points to the active production webhook URL.

The trial is temporary. n8n Cloud requires a paid plan after the trial; if it ends, post-submit automation will stop until it is available again. Supabase Free projects may pause after a week of low activity. Use synthetic campaign content and sample files only: the public prototype has no login.

## Local development

Install the Netlify CLI and Supabase CLI for local development. Use the Supabase project Transaction pooler URL and server-only environment variables in a local `.env`. Keep `DATABASE_SSL=require` for Supabase. For a local PostgreSQL test instance only, set `DATABASE_SSL=disable`. Then run:

```sh
pnpm install
npm --prefix web ci
pnpm dev
```

Open the Vite URL shown by Netlify Dev, normally `http://localhost:5173`. Vite proxies API requests to the local Netlify Functions server on port 8888. Both use the configured Supabase project; only use synthetic prototype content.

## End-to-end testing

See [the end-to-end scenario matrix and latest run results](docs/e2e-test-scenarios.md). Notification-specific checks are in [the delivery test plan](docs/notification-e2e-test-plan.md).

## Submission lifecycle

1. The API saves the campaign and a `CAMPAIGN_SUBMITTED` event in one database transaction. Missing campaign details become review notes rather than blocking submission.
2. The API immediately responds to the creator. A Supabase Database Webhook asynchronously starts n8n.
3. n8n claims the event, requests deterministic and AI checks from the TypeScript API, then requests API persistence of the reviewer packet.
4. An internal reviewability assessment scores completeness (30 points), clarity (50), and consistency (20) for routing. The creator sees only material, actionable tips; their count follows the gaps found rather than a fixed quota. The reviewer sees classified findings with evidence and a neutral follow-up question, not a numeric quality grade. The first submission may be returned for clarification. On the second submission, mild gaps enter the human review queue, while a strong correction finding or a supporting document with low relevance may be returned once more. The third creator submission enters the queue with remaining findings attached. **Submit as it is** is offered for mild gaps and counts as a creator submission. Expedited submissions go to human review with findings attached. System retries do not count as creator submissions; unavailable AI analysis does not create a misleading quality score. See [the review audit and test cases](docs/review-audit.md).
5. The **Urgent? Submit for an expedited review** toggle sends a time-sensitive submission directly to human review with any gaps attached. It records a priority request, not an automatic queue jump. Reviewers confirm expedited priority or keep the campaign in the standard queue. The reason and deadline are optional and review timing is not guaranteed.
6. The creator enters an email address before submission. The API queues status emails for that address and a Slack alert for the reviewer channel when the packet is ready. A scheduled Netlify function retries failed deliveries.
7. The reviewer reads the full story, opens actual uploaded PDF/image files, and accepts or rejects each document with a note. They can request changes; the creator sees the note, updates the story or files, and resubmits. Human feedback can repeat as needed.
8. The reviewer approves campaign content. The creator then uploads a **sample personal ID** and other required supporting files. The reviewer confirms identity, beneficiary, funds path, sanctions/risk screening, and campaign guidelines manually. All required documents must have accepted uploaded files before publishing.
9. Publishing creates a public `/campaign/:slug` story page. The public API returns only live campaign fields; document files and internal review notes are not included. Donation processing is not connected in this prototype.

## Operational behavior

- Events are idempotent by event ID and campaign version. The processing lease prevents duplicate packets.
- Gemini calls are split across Functions and have a short timeout. A model or quota error produces an unavailable finding and does not block human review.
- The prototype accepts up to 12 sample PDF, PNG, or JPEG files (2 MB each) per campaign. Identity and bank document contents are excluded from AI prompts; a reviewer must inspect them manually.
- If automation stays in progress for five minutes, the creator/reviewer view reports preparation as paused. The creator can retry once; a retry creates a new event and packet processing remains idempotent.
- Public endpoints have per-IP hourly limits for campaign creation, submission, and AI review. This is a demo safeguard, not account-level access control.
- Reviewer change requests, content approval, and publication queue creator emails after the action is saved.

## Repository layout

```text
web/                         Vite + React creator/reviewer interface
netlify/functions/api.mts    TypeScript API routes
netlify/functions/lib/       Database, Gemini, validation, and scoring logic
supabase/migrations/         Private schema and demo operations tables
n8n/workflow.json            Asynchronous post-submit workflow
```

## Demo limitations

There is no authentication. Anyone with the site URL can view or change prototype campaigns and access uploaded files, so **never upload a real personal ID, bank statement, or other sensitive data**. Use synthetic sample files only and a test creator email address. Uploaded files can be viewed by the reviewer, but the system does not perform OCR, identity verification, sanctions screening, bank validation, or payment processing. The final checklist records simulated human checks for demonstration. Human reviewers retain all final decisions.
