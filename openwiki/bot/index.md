# Files

- [Academic Data Flow](academic-flow.md) - A roll-number lookup end to end — validation, the shared authorization gate, the table-driven callback dispatch, and the reply formatters that draw the attendance, mid-marks and bunk tables.
- [Semester Sync and Daily Check-in](checkin-and-syncdb.md) - The admin-only /setsem and /syncdb semester rollover through one shared runSyncDb engine, plus the daily check-in gate that /postcheckin turns on for the channel.
- [Bot Commands and Authorization](commands-and-authorization.md) - Every Telegram command and its access rules, the one shared authorization gate in bot/authorization.ts, the shared reply copy, the library entry, and the channel and chit-chat special cases.
