# Roadmap

Work that is decided but not built. One entry, one reason, and what it must do
before it ships. `docs/ACTION-PLAN.md` holds the dated critique and its
sequence; this file holds what comes after it.

## Verify a roll with the college email OTP

**Status:** planned. Blocked on an SMTP server, which the maintainer will set
up separately. Nothing is coded yet.

**Why.** Saving a roll is unverified. Anyone who knows a roll number can save
it and read that student's attendance, and several accounts can share one roll
because schema v4 dropped the unique index. That was deliberate: the old block
refused the second account but could not tell a squatter from a sibling, so it
only punished honest people. The answer is to prove ownership, not to count
claimants.

**What it must do.**

1. A student saves a roll. The bot or the app looks up the college email for
   that roll and mails a six-digit code; the code is hashed, single-use, and
   dies after ten minutes.
2. The student types the code in the chat. Only then does the registration
   become verified, and only verified registrations answer `/attendance`,
   `/midmarks`, `/bunk` and the web lookups.
3. A verified roll is held by that account until it moves to another account
   through the same code, which is the case the old 409 got wrong.
4. The register keeps working: unverified or expired registrations show as
   unverified, not as an error.

**Open questions.**

- Where the college email comes from. The portal does not obviously publish
  one; it may need to be derived from the roll pattern or asked for once and
  checked against a list. Do not guess at the mapping.
- What happens to the rows that exist now. The cheapest answer is to mark all
  of them unverified and let a code upgrade them, with a grace period so
  nobody is locked out mid-semester.
- Who can resend, and how often. One code a minute per account, a handful per
  hour, and the same copy for a wrong code and an unknown roll so the endpoint
  cannot be used to test which rolls exist.
- Cost and abuse. A public endpoint that sends mail is an amplifier; it needs
  a per-account limit, a per-IP backstop, and a cap on codes per roll.

**What it must not do.**

- No password, no second factor on every open. The code proves a roll once.
- No delivery of the code to a Telegram account that is not the one saving the
  roll.
- No change to the bot's answer format. If the roll is verified, the card looks
  the same as today.

## Other open work

- The in-process uptime probe still runs alongside the external monitor. Remove
  it once the external history is trusted; see `docs/DEPLOYMENT.md`.
- The deferred items in `docs/ACTION-PLAN.md` (parser fixture capture, reader
  page-list rebuild, embedded-database timings).
