# Files

- [Academic Data Flow](academic-flow.md) - End-to-end trace of a roll-number lookup — validation, rate limiting, authorization, inline keyboard callbacks, the placeholder-then-edit reply pattern, and the student.service to AcademicTG to Academic chain that formats attendance, mid-marks, and bunk plans.
- [Daily Check-in and Semester Sync](checkin-and-syncdb.md) - Two admin-driven operational flows — the /postcheckin daily attention gate with Redis unlocks expiring at IST midnight, and /setsem plus /syncdb semester rollover that scrapes the college portal into studentsnew.
- [Bot Commands and Authorization](commands-and-authorization.md) - Every Telegram bot command and its access rules, the shared authorization gate combining channel membership and the daily check-in unlock, and the special handling of the protected and chit-chat groups.
