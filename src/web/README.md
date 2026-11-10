# NbkristQik web

The Telegram mini app: one Vite entry in this package.

`app.html` → `src/app-main.tsx` → `src/AppShell.tsx`

It holds the surfaces the bot links to: the roll form (the first screen), the
attendance register, the library and the issue desk. Attendance itself is
answered in the chat, not here, so the app never becomes a second place to
read a student's own numbers.

`vite.library.config.ts` sets the `/library/` base, builds into
`dist-library/`, and renames the emitted `app.html` to `index.html` so the
Express host can serve it at `/library/`.

## Scripts

Run these from `src/web`:

- `pnpm dev` — Vite dev server with the library config. The app is at
  `/library/app.html`; `/api` is proxied to `http://localhost:3000`.
- `pnpm build` — typecheck (`tsc -b`) and build the app into `dist-library/`.
- `pnpm build:library` — the same build, kept for the deploy script and CI.
- `pnpm preview` — serve the built `dist-library/` bundle at `/library/`.
- `pnpm test` — Vitest unit tests under `tests/`.
- `pnpm lint` — ESLint.
- `pnpm deploy:site` — publish only `public/site/` to GitHub Pages (it stages
  the site under `dist-site/site/` and pushes that branch). The app itself is
  deployed with the backend at `/library/`, not by this script.

## Marketing site

`public/site/` is static HTML, CSS and JS. It is not part of the Vite build and
is published by `pnpm deploy:site`. Edit those files directly; don't move them
behind the app.

There is no GitHub Pages app build any more. The old `index.html`,
`register.html` and `report.html` entries, their React roots and the Pages
deploy scripts are gone, and this is the only web build.
