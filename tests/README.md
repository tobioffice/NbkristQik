# NbkristQik Tests

Test suite for the NbkristQik Telegram bot and its Express surfaces.

## Setup

pnpm is the package manager:

```bash
pnpm install
```

Tests need no network access, no Redis server, and no real database. The
global setup in `tests/setup.ts` pins the environment for every suite.

## Running tests

Run the suite once:

```bash
pnpm exec vitest run
```

Run one file:

```bash
pnpm exec vitest run tests/unit/academic.test.ts
```

Watch mode (bare `pnpm test` is watch mode, not a one-shot run):

```bash
pnpm test
```

Coverage:

```bash
pnpm exec vitest run --coverage
```

## Typechecking and verification

The app and the tests have separate TypeScript projects:

```bash
pnpm run typecheck        # src/**/*.ts
pnpm run typecheck:tests  # tests/**/*.ts + vitest.config.ts (tsconfig.test.json)
pnpm run verify           # both typechecks, lint, then the full suite
```

`tsconfig.test.json` inherits the root strict settings. Because module
resolution is `nodenext`, every relative import in a test carries an explicit
`.js` extension, including mocks:

```ts
import { turso } from "../../src/db/db.js";
vi.mock("../../src/bot/bot.js", () => ({ bot: { sendMessage } }));
```

Vitest resolves those `.js` specifiers to the TypeScript sources.

## Test layout

The suite currently has **54 test files (45 unit, 9 integration) and 379
tests**. The tree below names the recurring categories, not every file:

```
tests/
├── setup.ts                     # environment pinning + global mock resets
├── mocks/
│   ├── academic.mock.ts         # attendance/midmarks fixtures
│   └── telegram.mock.ts         # typed sendMessage/onText/on mocks
├── unit/                        # 45 files: modules tested in isolation
│   ├── academic*.test.ts        # portal parsing/orchestration
│   ├── adminPanel*.test.ts      # panel CSP/nonce + embedded JS/CSS syntax
│   ├── student_stats.test.ts    # leaderboard/uptime SQL against libSQL
│   ├── syncdb.test.ts           # scrape/sync orchestration
│   └── ...                      # bot commands, auth, middleware, library,
│                                #   maintenance, monitor, registration, ...
└── integration/                 # 9 files: Express routes via supertest
    ├── adminRoutes.test.ts
    ├── apiRoutes.test.ts
    ├── libraryRoutes.test.ts
    ├── profileRoutes.test.ts
    ├── reportRoutes.test.ts
    ├── staticRoutes.test.ts
    └── ...
```

## What the layers cover

**Unit tests** exercise one module at a time: bot command and callback
handlers, message formatting and parsing, validation, authorization,
middleware, and SQL helpers. External boundaries are replaced: the Telegram
bot module (`src/bot/bot.js`), the Redis client, `axios` calls to the college
portal, and analytics/tracker calls.

**Integration tests** drive the Express app through `supertest` (routing,
auth, cookies, status codes, CSP headers). Most create a real in-memory
libSQL database with `file::memory:` and create the tables they query, so the
SQL and route wiring are exercised end to end. A few replace DB model modules
with mocks when only route behavior is under test.

**Mocked external boundaries** are explicit in the file that needs them:
Telegram sends and handler registration, Redis reads/writes, portal HTTP
requests, and admin membership checks. Tests must not make live Telegram,
Redis, portal, or network calls; if a new dependency escapes a mock, add the
mock at the module boundary instead of reaching for the network.

## Writing new tests

- Add unit tests under `tests/unit/` and route-level tests under
  `tests/integration/`.
- Use the shared typed Telegram helpers rather than loose `vi.fn()` casts:

  ```ts
  import {
    createOnTextMock,
    createSendMessageMock,
    registeredTextHandler,
    sentMessage,
  } from "../mocks/telegram.mock.js";

  const onText = createOnTextMock();
  const sendMessage = createSendMessageMock();
  const handler = registeredTextHandler<(msg: unknown) => void>(onText, "/cmd");
  // ...
  const [, text, options] = sentMessage(sendMessage);
  ```

- Mock modules before dynamically importing the code under test; `vi.mock`
  calls are hoisted, so a `vi.hoisted` block is the place for shared state.
- Clean up database state in `beforeEach`/`beforeAll` when a suite uses the
  real in-memory libSQL client.
- Keep assertions behavior-focused. Do not loosen an assertion only to make a
  test typecheck; fix the mock's type instead.

## Coverage

`vitest.config.ts` enforces a V8 coverage floor:

| Metric     | Threshold | Measured (2026-11-04) |
| ---------- | --------- | --------------------- |
| Statements | 70        | 72.16                 |
| Branches   | 75        | 77.11                 |
| Functions  | 82        | 83.59                 |
| Lines      | 70        | 72.16                 |

The thresholds sit about two points below the measured totals so ordinary
test churn does not flip CI. Raise them when coverage improves. Coverage
excludes tests, `src/web/` (the web app has its own package and config),
scripts, config files, and build output.

## CI

`.github/workflows/test.yml` runs on Node 22.x and 24.x: install, lint,
`typecheck`, `typecheck:tests`, a production dependency audit, then the test
suite with coverage. The separate `web` job runs the web app's own lint,
tests, and builds.

## Troubleshooting

**Tests timing out.** The default timeout is generous; a hang usually means a
real network or Redis connection escaped its mock. Run the single file to
isolate it.

**Redis connection errors.** The root suite mocks the Redis client. A stack
trace mentioning Redis is expected in suites that deliberately test an
outage; otherwise check `vi.mock` paths and the `.js` extension.

**`ERR_MODULE_NOT_FOUND` or a missing `.js` typecheck error.** Add the
explicit `.js` extension to the relative specifier in the test.

**Admin panel tests do nothing.** `tests/setup.ts` leaves
`ADMIN_PANEL_PATH`/`ADMIN_PANEL_PASSWORD` empty so the panel stays unmounted;
the admin suites opt in by setting them before importing the router.
