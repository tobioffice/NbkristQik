# Files

- [Academic Data Flow](academic-flow.md) - End-to-end trace of a roll-number lookup — validation, rate limiting, authorization, inline keyboard callbacks, the placeholder-then-edit reply pattern, and the student.service to AcademicTG to Academic chain that formats attendance, mid-marks, and bunk plans.
- [Semester Sync](checkin-and-syncdb.md) - The admin-only /setsem and /syncdb semester rollover — one shared runSyncDb engine that logs into the college portal, detects the academic year and sessions, scrapes every class section, extracts rolls, fetches names, upserts studentsnew, flushes caches, and can be re-run from the CLI.
- [Bot Commands and Authorization](commands-and-authorization.md) - Every Telegram bot command and its access rules, the shared channel-membership gate, the 2-answer group-use funnel with its DM redirect, report filing, and the special handling of the protected and chit-chat groups.
