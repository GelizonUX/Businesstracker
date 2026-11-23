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
   - **accounts, sharing and cloud sync are gone**: no sign-in route or screen, none of the removed identifiers left in the file, the CSP allows only the exchange-rate host, the files that existed for Google sign-in are deleted, and books or backups written by an older build (carrying `settings.share`, `settings.sync`, `settings.localIn`, the sync ledger and a stored `bizpilot.auth` session) boot and restore with those stripped and every record intact;
   - **the profile menu**: the top-bar chip offers the profile, Settings and Privacy, and nothing about logging in or out;
   - **honest copy**: the privacy page, the consent notice and Settings describe one product, with no account and nothing leaving the device but the rate lookup and the receipt scanner;
   - **dashboard**: 13 per-card widgets + single-card reorder;
   - **onboarding carousel**: all 6 slides render with mockups + dots, advancing reuses the same card (no blink rebuild) and applies a directional slide;
   - **Advisor page + floating bubble**: narrative read, prioritized actions, and the bubble that cycles 3–5 typed prompts off the Advisor page;
   - **recurring invoices**: generate / idempotent / 3-month catch-up;
   - **getting-started checklist** shows for a new account.

CI runs the same thing on every push and PR (`.github/workflows/ci.yml`).

These tests are intentionally kept in this subfolder with their own
`package.json` so the repository root stays a pure static site (no build
step) for Cloudflare Pages.
