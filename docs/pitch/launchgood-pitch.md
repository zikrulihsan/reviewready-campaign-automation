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

## Video script (≈4:45 at 140 words per minute)

668 words across 11 slides. Timestamps assume a steady 140 words per minute; slides A1–A4 are an appendix for readers and are not narrated.

1. **Cover (0:00)** — Hi, I'm [your name]. Instead of a resume, I built ReviewReady: a working prototype of campaign review for a platform like LaunchGood. My answer to the challenge: let AI do the preparation work of review, so people spend their time on judgment.
2. **The answer (0:18)** — Here is the whole pitch on one slide. Put AI in front of the review queue as a preparer, never as the judge. Three reasons. One: automate the flow, not the decision. Two: rules decide, AI advises. Three: the line between AI and human is explicit, and every failure falls back to a person. The rest of this video is the evidence.
3. **Why this problem (0:45)** — I don't know LaunchGood's internal systems, so I started from public material. The vetting guidance says people check documents, beneficiary, funds path, sanctions and guidelines. I turned those rules into checks, then walked the creator journey myself. My hypothesis: much reviewer time goes to chasing missing or unclear information before any judgment starts, and that grows with volume, especially in Ramadan. So how does a small team review more without lowering trust?
4. **The flow (1:15)** — Here is the flow. The top row is automated. The creator submits and gets an immediate response. A database webhook starts n8n, which claims the event once, checks documents for relevance, scores the campaign and decides the route. If it goes forward, the reviewer gets a brief with a summary and neutral questions, plus a Slack alert, and the creator gets an email. The bottom row is all human: review, request changes or approve, verify, publish. Only step four can send a campaign back.
5. **Why this flow (1:51)** — Each flow decision was A versus B, and my rule was: protect the submission first. AI runs after submit, not inside the request, so a slow model never loses a campaign. The event is saved in the same transaction as the campaign, so nothing is saved but never processed. Rules live in tested code; n8n only sequences the calls. Events are claimed by ID and version, because webhooks retry. And notifications go through an outbox, so an email outage never undoes a decision.
6. **The readiness score (2:27)** — Pillar two: rules decide, AI advises. Completeness, 30 points, is plain code; no model needed. Clarity, 50 points, is where AI actually helps, so it weighs most: unclear stories cause more back-and-forth than empty fields. Consistency is 20. I ask the model for high, medium or low, not a number, because that is more stable. And if AI is unavailable, there is no score, and the campaign still reaches a reviewer. A fake 100 is worse than no score.
7. **Bounded routing (3:01)** — Routing is bounded on purpose. The first submission can go back to the creator with at most two tips. The second goes back only for severe problems. The third always reaches a person, and urgent campaigns skip the loop. Why cap it? An AI that can bounce someone forever becomes a gatekeeper, and a person in crisis simply gives up.
8. **The human line (3:27)** — Pillar three is the human line. AI reduces the reviewer's uncertainty; it never resolves it. AI checks, rates, summarises and drafts questions. A person opens the real files, approves, verifies identity and funds path, and publishes. AI never approves or rejects, never judges fraud, and never sees ID or bank documents. That is enforced in code.
9. **Failure modes (3:51)** — Every failure falls back to a person. Model down: no score, still reviewed. Workflow stalls: shown as paused after five minutes, with one retry. Duplicate webhooks are ignored. Submitted text is treated as untrusted data, and model output is validated against a schema.
10. **What I tested (4:09)** — I also tested against the rules, not just the happy path. On the live site, the deployed build showed 100 out of 100 while AI was unavailable, exactly the failure my rules forbid. The code is fixed; the deploy needs to catch up.
11. **Close (4:27)** — So: AI prepares, rules route, people decide. That is how I think AI makes a small team more capable: not another chatbot, but less waiting around human judgment. The demo is live, and the appendix covers more rules and my rollout plan. Thank you.

Appendix (not narrated): A1 How I found it · A2 Policy as data · A3 Two smaller rules · A4 What I would do next.

## Honest limits

- The complication is a hypothesis from public material; no LaunchGood internal data was used.
- Document requirements are modelled on public help-centre guidance, not LaunchGood's internal policy.
- The demo has no authentication, OCR, sanctions screening or payments. Use synthetic data only.
- Notification end-to-end paths have not yet been run on staging (see `docs/e2e-test-scenarios.md`).
