# Files

- [Admin Panel](admin-panel.md) - Private password-protected admin dashboard for bot activity tracking and service health, served by the Express API under a secret path with HMAC session auth and IST-bucketed SQL aggregations.
- [REST API and Security](server.md) - Express API endpoints for the leaderboard, per-user rank lookup, profile registration, health, and status pages, with query validation, Redis response caching, Telegram initData verification, rate limiting, and configurable CORS.
