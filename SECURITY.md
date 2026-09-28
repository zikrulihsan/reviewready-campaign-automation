# Security Policy

ReviewReady is a demonstration prototype. It has no authentication, so the hosted demo must only ever hold synthetic data.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub's
[private vulnerability reporting](https://github.com/zikrulihsan/reviewready-campaign-automation/security/advisories/new).
Include steps to reproduce and the potential impact. You can expect an acknowledgement within a few days.

## Handling secrets

- Never commit `.env` files, database URLs, API keys, SMTP credentials, or Slack webhook URLs. `.gitignore` excludes `.env*` except `.env.example`.
- All credentials are read from server-side environment variables in Netlify Functions; nothing secret is exposed to the Vite bundle.
- Internal API routes require the `X-Internal-Token` header, compared in constant time.
- If a secret is ever exposed, rotate it at the provider immediately; removing it from git history is not sufficient.
