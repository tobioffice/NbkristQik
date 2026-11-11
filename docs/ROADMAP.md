# Roadmap

Work that is decided but not built. One entry, one reason, and what it must do
before it ships. `docs/ACTION-PLAN.md` holds the dated critique and its
sequence; this file holds what comes after it.

## Shipped: college-email verification

Schema v5 adds `roll_claims` and `email_verifications`. A student asks the
profile form to verify their saved roll; a six-digit code goes to
`<roll>@nbkrist.org` through the project's Gmail SMTP account, hashed and
single-use for ten minutes. Confirming it:

- makes that Telegram account the roll's verified owner,
- deletes every other registration for the roll,
- sets the caller's registration to it,
- unlocks the owner's "hide my roll" switch.

Ownership always blocks other accounts from registering the roll. The switch
additionally removes the roll from the leaderboard and its coverage counts, and
refuses `/attendance`, `/midmarks` and `/bunk` lookups from anyone but the owner
(or `ADMIN_ID`). Unverified registrations keep working exactly as before.

## Other open work

- The in-process uptime probe still runs alongside the external monitor. Remove
  it once the external history is trusted; see `docs/DEPLOYMENT.md`.
- The deferred items in `docs/ACTION-PLAN.md` (parser fixture capture, reader
  page-list rebuild, embedded-database timings).
