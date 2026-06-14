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
   - **activation gate** diagnostics (locked-rules vs valid key, mocked fetch);
   - **App Lock (PIN)**: PBKDF2 set/verify, boot-gate, unlock;
   - **dashboard**: 13 per-card widgets + single-card reorder;
   - **welcome tour**: all 6 steps position on-screen (guards the NaN bug);
   - **recurring invoices**: generate / idempotent / 3-month catch-up;
   - **getting-started checklist** shows for a new account.

CI runs the same thing on every push and PR (`.github/workflows/ci.yml`).

These tests are intentionally kept in this subfolder with their own
`package.json` so the repository root stays a pure static site (no build
step) for Cloudflare Pages.
