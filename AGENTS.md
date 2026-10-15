<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Do not enumerate, preload, or search wikis at task start. Use retrieval when the user asks for it, when unfamiliar architecture or dependency behavior materially affects the task, or when source inspection leaves an important uncertainty. Stop once the question is grounded.
- When those conditions apply and OpenWiki retrieval tools are available, use `openwiki_search` for just-in-time context and `openwiki_read` for the relevant complete sections. If search returns `workspace_required`, ask which listed workspace to use and retry with its ID.
- Use `openwiki_list_workspaces` or `openwiki_list_wikis` when workspace membership itself needs to be discovered.
- If the retrieval tools are unavailable, read `openwiki/quickstart.md` and follow its links to the relevant pages.
- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

## Design system

Every web-facing surface (leaderboard, register/profile, issue reports, status page, admin panel) follows the design system in `DESIGN.md` — "The Class Register, Open on the Desk."

- Before changing any UI: read `DESIGN.md`. Follow its palette, typography, layout, and its Do's and Don'ts.
- The named rules are binding: Red Pen Rule (red is correction ink only), Cloth Band Rule (one green head band per surface), Tabular Register Rule (every comparable figure uses tabular numerals), Printed Form Rule (square corners, drawn brackets not stripes), Hairline First (structure is drawn, not elevated).
- Do not reintroduce rounded cards, glass blur, gradient text, or dark backgrounds — that is the explicit anti-reference.
- Machine-readable tokens: `.impeccable/design.json`. Direction contract and per-surface notes: `.impeccable/surfaces/`. Review renders (synthetic data): `.impeccable/review/`.
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
