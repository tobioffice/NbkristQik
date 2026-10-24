# Files

- [Caching and Leaderboard Stats](caching-and-stats.md) - Redis client lifecycle and cache keys with TTLs — student caches, membership, report and check-in gates, library sessions and the page-burst counter — plus background section caching into student_stats and the RANK() design behind the leaderboard.
- [Database Schema and Models](database.md) - Complete libSQL/SQLite schema reference for NbkristQik — fourteen tables created by src/db/init.ts (including the library registry and its read audit) over an embedded database (LOCAL_DB_URL) or Turso Cloud, their indexes, key conventions, backups, and the model modules that query each.
