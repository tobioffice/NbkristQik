# Files

- [Caching and Leaderboard Stats](caching-and-stats.md) - Redis client lifecycle and cache keys with TTLs, background full-section attendance and midmarks caching into student_stats, and the libSQL/Turso RANK() ranking design behind the leaderboard and per-student rank lookup.
- [Database Schema and Models](database.md) - Complete libSQL/SQLite schema reference for NbkristQik — twelve tables created by src/db/init.ts over an embedded database (LOCAL_DB_URL) or Turso Cloud, their indexes, composite key conventions, the report-thread tables, backups, and the model modules that query each.
