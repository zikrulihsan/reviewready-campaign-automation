# ReviewReady

**AI prepares. People decide.**

ReviewReady is a working prototype of a campaign review pipeline for a crowdfunding platform. A creator submits a campaign, automated checks and a language model prepare it, and a human reviewer receives a case that is ready to judge. The model never approves, rejects, or rates trustworthiness.

Built as a submission for LaunchGood's Applied AI Engineer challenge, which asked for a deployed prototype rather than a resume.

---

## The problem this solves

Reviewing a campaign is rarely blocked on judgement. It is blocked on preparation.

A reviewer opens a campaign and finds no beneficiary relationship, no supporting document, and a funding goal with no breakdown. They cannot decide yet, so they send an email and wait two days. The document that comes back is the wrong one. Meanwhile the campaign waits, the reviewer does administrative work, and some creators give up.

That is a preparation problem, and preparation is the part a machine can take.

## Where the line sits

The line between model and human is enforced in code, not stated in a prompt and hoped for.

| Decision | Made by | Why |
| --- | --- | --- |
| Are the required fields present and valid | Code | Must be identical every time and auditable |
| How clearly the story explains itself | Model | A language judgement, which is where models are useful |
| Whether a document relates to the campaign | Model describes, code acts | The model reads; code decides what follows |
| Which state the campaign moves to | Code | Fixed thresholds, not probabilities |
| How often a creator may be asked to clarify | Code | Capped at two rounds — a product decision, not a model one |
| Approve, reject, or request changes | Human | Money and trust are at stake |
| Identity and sanctions verification | Human | Requires sources outside this system |
| Publishing the campaign | Human | The final act stays with a person |

Three mechanisms enforce it:

- **The system instruction forbids the judgement.** `lib/gemini.mts` instructs the model to *"not approve, reject, predict fraud, or infer truthfulness"* and to assess only whether a human reviewer can understand the submission.
- **Routing is a pure function.** `decideReadiness()` and `decideSubmissionRoute()` in `lib/requirements.mts` take the model's description as input and decide the outcome with fixed thresholds. No model call sits in that path.
- **Model output is untrusted until validated.** Every response is constrained by a JSON schema and parsed with zod. Anything outside the expected shape is discarded rather than used.

Creator text is also treated as data, never as instructions — a prompt-injection defence for a system whose input is prose written by strangers.

## How a submission flows

1. Creator submits a campaign, no documents yet.
2. Deterministic checks run first. `requirementSpec()` varies the required evidence by `profile_type` and `category` — a medical campaign for a relative demands different fields than travel funding for oneself.
3. The model rates clarity across purpose, beneficiary, fund usage, fund delivery, and internal consistency.
4. `decideSubmissionRoute()` either returns the campaign to the creator with at most two tips, or forwards it to a reviewer with findings attached.
5. The reviewer reads a prepared case: score breakdown, prior clarity notes, a summary, evidence quoted from the submission, and a neutral question they could ask. They approve, request changes, continue, or escalate.
6. Documents are requested, checked, and the reviewer publishes.

A Supabase trigger fires on insert into `submission_events`, which drives an n8n workflow that calls back into the API. Each step is a separate function invocation, so no single request carries the whole pipeline.

## The score

100 points, split so each contributor is accountable for its own part:

| Component | Points | Computed by |
| --- | --- | --- |
| Completeness | 30 | Code — proportion of required fields present and valid |
| Clarity | 50 | Model — four dimensions, capped at 25 when the submission is thin |
| Consistency | 20 | Model — internal contradictions |

When the model is unavailable the score is `null`, not a partial number. A missing input produces a missing score rather than a confident-looking one.

## When things fail

Failure paths are designed rather than discovered:

- **Model unavailable or key missing.** Every call site falls back to `status: 'unavailable'` and the review continues; the packet reports that the notes are missing. Cached `unavailable` results are re-run once a key becomes available.
- **Duplicate webhook delivery.** Every internal call carries an `event_id` and a `campaign_version`. The API claims the event atomically, so a replay does nothing.
- **Workflow dies mid-run.** The job reports itself paused after five minutes and permits exactly one fresh processing event.
- **Notification delivery fails.** Deliveries are queued with `attempts`, `next_attempt_at`, and `last_error`, claimed with `FOR UPDATE SKIP LOCKED`, and retried with backoff.
- **Unauthorised internal calls.** `/internal/*` requires a shared token compared in constant time.
- **Abuse of public endpoints.** Campaign creation, submission, and AI review carry per-IP hourly limits. This is a demo safeguard, not account-level access control.

## Assumptions and scope

This prototype was built without access to LaunchGood's internal systems, from their [public campaign verification guidance](https://support.launchgood.com/support/solutions/articles/35000016132-how-does-launchgood-vet-campaigns-). It assumes a small review team, more campaigns than reviewers, and preparation rather than judgement as the bottleneck.

It records reviewer decisions. It does **not** perform OCR, identity verification, sanctions screening, bank validation, or payment processing, and it is not connected to any real platform. The final checklist records simulated human checks for demonstration. All sample data is fictional.

> **This demo has no authentication.** Anyone with the site URL can view or change prototype campaigns and read uploaded files. Never upload a real ID, bank statement, or other sensitive document. Use synthetic files and a test email address only.

## Architecture

| Component | Role |
| --- | --- |
| Netlify | Vite frontend and TypeScript API Functions in one deploy |
| Supabase | Private PostgreSQL schema for campaigns, analyses, processing events, and deliveries |
| n8n | Asynchronous workflow triggered by a Supabase trigger after a submission commits |
| Gemini | Optional semantic analysis; the system stays usable without it |

Credentials are server-side environment variables only. The browser calls relative API paths and never holds a key.

```text
netlify/functions/
  api.mts                   HTTP API (Hono) — routes, event claiming, state transitions
  deliver-notifications.mts Scheduled delivery of queued notifications
  lib/requirements.mts      Deterministic checks, scoring, routing — no model calls
  lib/gemini.mts            Schema-constrained model calls
  lib/notifications.mts     Slack and SMTP delivery with retry
  lib/review-quality.mts    Reviewer feedback quality checks
supabase/migrations/        Private schema, triggers, delivery tables
n8n/workflow.json           Importable post-submission workflow
web/                        Vite + React creator and reviewer interface
tests/                      Unit tests for the pure decision logic
```

## Running the tests

The decision logic is pure and tested without network or database access:

```bash
npm install
node --test tests/
```

## Deploying your own

**Supabase.** Apply `supabase/migrations` with `supabase db push`. Store two secrets in Vault so the submission trigger can reach your workflow:

```sql
SELECT vault.create_secret('https://YOUR.app.n8n.cloud/webhook/campaign-submitted',
                           'reviewready_n8n_webhook_url');
SELECT vault.create_secret('YOUR-LONG-RANDOM-TOKEN',
                           'reviewready_n8n_webhook_token');
```

Copy the **Transaction pooler** connection string from **Connect** — transaction mode suits serverless, and `lib/db.mts` sets `prepare: false` accordingly.

**Netlify.** Import the repository; `netlify.toml` sets the build command, publish directory, and functions directory. Configure the variables documented in [`.env.example`](.env.example). `DATABASE_URL` and `INTERNAL_TOKEN` are required; the Gemini, Slack, and SMTP values are optional and degrade cleanly when absent.

**n8n.** Import `n8n/workflow.json`, set `api_base_url` to your deployed origin, add Header Auth with `X-Internal-Token` matching `INTERNAL_TOKEN`, and activate it. See [`n8n/README.md`](n8n/README.md).

## Security

Secrets live in environment variables and Supabase Vault, never in this repository. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE)
