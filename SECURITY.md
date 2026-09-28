# Security Policy

## Status of this project

ReviewReady is a prototype built for a hiring challenge. It is not production
software and is not connected to any real crowdfunding platform. The hosted
demo has **no authentication**: anyone with the URL can read and modify sample
campaigns. Treat everything in it as public, and never upload a real identity
document, bank statement, or other sensitive file.

## Reporting a vulnerability

Report privately through GitHub's
[security advisory form](../../security/advisories/new) rather than opening a
public issue.

Useful things to include: what you did, what happened, and what you expected.
A proof of concept helps but is not required.

This is a personal project maintained in spare time, so expect a first reply
within about a week rather than the same day.

## Scope

In scope:

- Secrets or credentials committed to this repository
- Authentication or authorisation flaws in the `/internal/*` API
- SQL injection, prompt injection that changes system behaviour, or bypass of
  the deterministic routing logic in `lib/requirements.mts`
- Anything that lets the language model reach a decision the design reserves
  for a human

Out of scope:

- The absence of end-user authentication in the demo, which is a known and
  documented limitation
- Rate limits on public endpoints, which are a demo safeguard rather than
  access control
- Findings in Netlify, Supabase, n8n, or Google infrastructure — report those
  to the respective vendor

## Handling of secrets

No credentials belong in this repository. Runtime secrets are environment
variables on the host, and the Supabase trigger reads its webhook URL and token
from Supabase Vault. `.env` is git-ignored; `.env.example` documents the
variable names with placeholder values only.

GitHub secret scanning and push protection are enabled on this repository. If
you believe a secret was committed, report it privately using the link above
rather than in a public issue.
