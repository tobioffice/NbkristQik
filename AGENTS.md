## Design system

Every web-facing surface (leaderboard, register/profile, issue reports, library, status page, admin panel) follows the design system in `DESIGN.md` — "The Class Register, Open on the Desk."

- Before changing any UI: read `DESIGN.md`. Follow its palette, typography, layout, and its Do's and Don'ts.
- The named rules are binding: Red Pen Rule (red is correction ink only), Cloth Band Rule (one green head band per surface), Tabular Register Rule (every comparable figure uses tabular numerals), Printed Form Rule (square corners, drawn brackets not stripes), Hairline First (structure is drawn, not elevated).
- Do not reintroduce rounded cards, glass blur, gradient text, or dark backgrounds — that is the explicit anti-reference.
- Product brief: `PRODUCT.md`.

## Bot & channel voice

Write like the admin on their phone: first person, plain words, short. No em-dash stacks, three-beat structures, bold headlines, emoji bullets, or jargon.
Lead with the reader's action; greeting is one clause. One apology max.
Escape `&<>` in user text sent as Telegram HTML — unescaped names break sending.

## Operations

- Don't commit, push, or deploy without being asked.
- oracle2 is NOT spare (LiteLLM :4000, SearXNG :8080). Never repurpose it.
- Journal queries keyword/count-only — logs contain token-bearing URLs.
- Tests: `pnpm exec vitest run` (bare `pnpm test` watches). Typecheck + lint before any deploy.
- DB is embedded SQLite via `LOCAL_DB_URL` (unset = Turso). Turso reads blocked ~Nov 2026; merge tool ready: `scripts/import-turso-snapshot.mjs`.
