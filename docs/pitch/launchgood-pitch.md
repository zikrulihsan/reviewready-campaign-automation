# ReviewReady — LaunchGood Applied AI challenge pitch

Slide deck and ≤5-minute video script. Structured with the Pyramid Principle: the answer first, then three supporting pillars (MECE), each backed by evidence from this repository.

## The pyramid

```text
GOVERNING THOUGHT
Put AI in front of the review queue as a preparer, never as the judge.
│
├── 1. Automate the flow, not the decision
│   ├── AI runs asynchronously after submit, never inside the request
│   ├── Campaign + event written in one transaction (outbox) → DB webhook → n8n
│   ├── API owns rules; n8n only sequences calls
│   ├── Claim by event ID + campaign version (idempotent)
│   └── Notification outbox retried every minute
│
├── 2. Rules decide, AI advises
│   ├── Document policy = lookup table (profile × category), not a prompt
│   ├── Readiness score 30 (code) / 50 clarity (AI) / 20 consistency (AI)
│   ├── AI unavailable → no score, still reviewable (never a fake 100)
│   ├── Routing capped: max two returns; third submission always reaches a person
│   ├── Expedited = a request a reviewer confirms, not a queue jump
│   └── Creator feedback: ≤2 suggestions, warm, non-accusatory
│
└── 3. Draw the human line explicitly
    ├── AI never approves/rejects, predicts fraud, or judges authenticity
    ├── ID and bank documents are stored without extracted text → manual review
    ├── Humans open files, request changes, approve, verify, publish
    └── Every failure mode falls back to human review
```

Intro (SCQ): **Situation** — LaunchGood's public vetting guidance lists documents, beneficiary and funds path, sanctions/risk and guidelines, checked by people. **Complication** (hypothesis from public material, not internal data) — much reviewer time goes to chasing missing or unclear information before judgment starts, and it scales with volume and Ramadan peaks. **Question** — how can a small team review more, faster, without lowering trust?

## Why A over B

| Decision | Chose A | Over B | Why | Code |
| --- | --- | --- | --- | --- |
| When AI runs | After submit, async | Inside the submit request | Creator never waits on a model; a failing model can't lose a submission | `netlify/functions/api.mts`, `n8n/workflow.json` |
| How work starts | Event row + Supabase DB webhook | API calls n8n directly | Event commits with the campaign: no "saved but never processed" | `supabase/migrations/*n8n_submission_webhook.sql` |
| Who owns rules | TypeScript API | Logic in n8n nodes | Versioned, testable thresholds; n8n is replaceable | `netlify/functions/lib/requirements.mts` |
| Duplicates | Claim by event ID + version | Trust single delivery | Webhooks retry; no duplicate packets | `claim-processing` route |
| Notifications | Outbox + 1-minute retry | Send inline | An outage never rolls back a decision | `lib/notifications.mts`, `deliver-notifications.mts` |
| Known policy | Lookup table | Prompt | Auditable, cheap to change, deterministic | `requirementSpec()` |
| AI output | high/medium/low ratings + JSON schema | Model-generated 0–100 score | Categorical judgments are steadier; schema + zod validation | `lib/gemini.mts` |
| Score weights | Clarity 50 highest | Equal weights | Unclear stories, not empty fields, cause most back-and-forth | `scoreReadiness()` |
| AI failure | No score, still routed to a human | Default score or block | A missing score is honest; a fake one misleads | `scoreReadiness()` |
| Routing | Max two returns | Loop until "ready" | An AI that can bounce forever is a gatekeeper | `decideSubmissionRoute()` |
| Urgency | Request confirmed by reviewer | Automatic queue jump | Urgency is easy to claim; priority is a human call | expedited review flow |
| Feedback | ≤2 suggestions, warm tone | Full list of findings | Long critiques make creators in crisis give up | `creatorFeedbackPolicy()` |

## Video script (≈5 minutes)

Slides marked *(optional)* can be skipped to stay within the time limit.

1. **Cover (0:00)** — Instead of a resume, I built ReviewReady, a working prototype of a crowdfunding campaign review pipeline. My answer to the challenge: AI should do the preparation work of review so reviewers spend their time on judgment.
2. **The answer (0:20)** — Put AI in front of the queue as a preparer, never as the judge. Three reasons: automate the flow, not the decision; rules decide, AI advises; the human line is explicit.
3. **Why this problem (0:50)** — From public vetting guidance: every campaign is checked by people. My hypothesis: much of that time is spent chasing missing or unclear information, and it spikes in Ramadan. How does a small team review more without lowering trust?
4. **How I found it (1:15)** — Read the public rules and turned them into checks, walked the creator journey myself, and marked every place where one person waits on another.
5. **The flow (1:35)** — Submit writes campaign + event in one transaction; a DB webhook starts n8n; the event is claimed once; documents checked for relevance; score and route; reviewer brief; Slack and email. Everything that affects trust — review, change requests, verification, publishing — is human.
6. **Why this flow (2:10)** — Protect the submission first: async AI, outbox event, rules in code not n8n, idempotent claims, notification outbox with retries.
7. **The score (2:40)** — 30 completeness by code, 50 clarity and 20 consistency by AI using high/medium/low ratings. If AI is unavailable there's no score, never a fake 100.
8. **Bounded routing (3:10)** — At most two returns; the third submission always reaches a person. "Submit as it is" for mild gaps. Urgent campaigns skip the loop.
9. *(optional)* **Policy as data** — document requirements are a lookup table; AI only judges relevance.
10. *(optional)* **Two smaller rules** — expedited is a request; feedback is ≤2 kind suggestions.
11. **The human line (3:40)** — AI reduces the reviewer's uncertainty; it never resolves it. AI never approves, rejects, predicts fraud, sees ID or bank documents, or reorders the queue.
12. **Failure modes (4:05)** — Gemini down, n8n stalls, duplicate webhooks, prompt injection, wrong files, notification outages: each falls back to a person.
13. **What I tested (4:25)** — Testing the live site found "100/100 Strong" shown while AI was unavailable, the exact failure my rules forbid; fixed in code, redeploy pending.
14. *(optional)* **Next** — shadow mode, calibrate thresholds against reviewer decisions, then turn on routing per category. Measure time to first review, messages per campaign, and how many AI-returned campaigns are later approved.
15. **Close (4:45)** — AI prepares, rules route, people decide.

## Honest limits

- The complication is a hypothesis from public material; no LaunchGood internal data was used.
- Document requirements are modelled on public help-centre guidance, not LaunchGood's internal policy.
- The demo has no authentication, OCR, sanctions screening or payments. Use synthetic data only.
- Notification end-to-end paths have not yet been run on staging (see `docs/e2e-test-scenarios.md`).
