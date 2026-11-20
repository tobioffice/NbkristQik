## Design system

The Telegram Mini App (leaderboard, profile, issue reports, library, reader) follows the design system in `DESIGN.md` — "The Telegram Utility, Open on the Phone": fullscreen dark ground, grouped rows, sentence case, two blues.

The server-rendered admin panel and the public status and stats pages follow the same system, so every public surface — Mini App, admin, status and stats — uses `DESIGN.md`. The marketing site has its own editorial identity, documented in `docs/SITE.md`.

- Before changing UI on any surface: read `DESIGN.md`. Follow its palette, typography, layout, safe-area contract, and Do's and Don'ts.
- The named rules are binding: Fullscreen Rule (phones get the whole screen with safe-area padding), Safe-Area Rule, One-Band Rule, Two-Blue Rule (`#4cb2ff` pointer, `#248bda` action), Grouped Row Rule (1px ground gaps inside an 8px group), Sentence Case Rule, Tabular Register Rule (every comparable figure uses tabular numerals), Flat Chrome Rule (no shadows except the reader page), Danger Rule (red is text and rules, never a filled field).
- Do not reintroduce paper texture, serif display type, tracked uppercase labels, floating desk sheets, glass blur, gradient text, or red stamp backgrounds into the Mini App.
- Product brief: `PRODUCT.md`.

## Bot & channel voice

Write like the admin on their phone: first person, plain words, short. No em-dash stacks, three-beat structures, bold headlines, emoji bullets, or jargon.
Lead with the reader's action; greeting is one clause. One apology max.
Escape `&<>` in user text sent as Telegram HTML — unescaped names break sending.

## Operations

- Don't do anything critical without asking. No destructive data changes, production migrations, deploys, or irreversible file operations without explicit approval.
- Don't commit, push, or deploy without being asked.
- The uptime monitor host is not spare. Never repurpose it for app work.
- Journal queries keyword/count-only — logs contain token-bearing URLs.
- CI logs are public. Never print student identifiers, portal response bodies, tokens or secrets in tests or scripts; use synthetic fixtures. Debug logs are off in CI and tests.
- Tests: `pnpm exec vitest run` (bare `pnpm test` watches). Typecheck + lint before any deploy.
- DB is embedded SQLite via `LOCAL_DB_URL` (unset = Turso). Turso reads blocked ~Nov 2026; merge tool ready: `scripts/import-turso-snapshot.mjs`.
