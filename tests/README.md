# Trakora tests

Automated regression suite that boots the **real** `../index.html` inside
[jsdom](https://github.com/jsdom/jsdom) and exercises the critical surface —
so changes to the single-file app can't silently break things.

## Run locally

```bash
cd tests
npm install   # first time only
npm test
```

`npm test` runs:

1. **`check-syntax.js`** — parses the inline `<script>` of `index.html` (fails on any syntax error) without executing it.
2. **`app.test.js`** — loads the app in jsdom and asserts:
   - the app boots and **all 18 views render** without error;
   - **security**: no unescaped image `src`, CSP present, `safeColor` rejects injection, malicious logo is escaped;
   - **Smart CSV import**: entity detection + money/date normalization;
   - **the retired licence gate**: every gate symbol is gone, the app opens with no wall, and a forged `bizpilot.activation` in `localStorage` grants nothing;
   - **no licence artefact** survives anywhere in the repo: no keygen, no licence page, no signing key, no embedded public key;
   - **App Lock (PIN)**: PBKDF2 set/verify, boot-gate, unlock;
   - **workspaces and invites**: create, invite, claim, single use, expiry, email mismatch, an unverified address, and a removed member refused by the database rather than by the UI — against a stub that enforces the same rules the app ships;
   - **the rules themselves**: the workspace rules parse as JSON, deny by default, carry no blanket workspace-level write, and enforce single use and expiry on the server;
   - **honest copy**: the privacy page and the consent notice say one thing with sharing off and another with it on, and neither claims there is no account while there is one;
   - **dashboard**: 13 per-card widgets + single-card reorder;
   - **onboarding carousel**: all 6 slides render with mockups + dots, advancing reuses the same card (no blink rebuild) and applies a directional slide;
   - **Advisor page + floating bubble**: narrative read, prioritized actions, and the bubble that cycles 3–5 typed prompts off the Advisor page;
   - **recurring invoices**: generate / idempotent / 3-month catch-up;
   - **getting-started checklist** shows for a new account.

CI runs the same thing on every push and PR (`.github/workflows/ci.yml`).

These tests are intentionally kept in this subfolder with their own
`package.json` so the repository root stays a pure static site (no build
step) for Cloudflare Pages.
