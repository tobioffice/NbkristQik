# NbkristQik Bot

A Telegram bot for students to check attendance and mid-term marks.

## Features

### ✅ Already Implemented
- Check attendance details
- View mid-term examination marks  
- **🏆 Live Leaderboard (Telegram Web App)**
- Admin controls

### 🚀 Upcoming Features
- 🔔 Automatic Notifications
- AI-powered chat capabilities


## Technology Stack

- **Backend**: Node.js, Express, TypeScript
- **Database**: Turso (SQLite), Redis
- **Frontend**: React, Vite, TailwindCSS
- **Integration**: Telegram Bot API
- **Scraping**: Cheerio, Axios

## Project Structure

```
src/
├── api/               # Express API server (leaderboard, status)
├── bot/
│   ├── academics/     # Roll-number + callback flows
│   ├── commands/      # Bot command handlers
│   └── setup.ts       # Bot initialization
├── config/            # Configuration files
├── constants/         # Constant values
├── db/                # Database models + schema init
├── middleware/        # API security middleware
├── services/          # Business logic services (scraping, redis, uptime)
├── types/             # TypeScript type definitions
└── web/               # Leaderboard React app (Telegram Web App)
```

## Setup

1. Clone the repository
```bash
git clone https://github.com/yourusername/NbkristQik.git
cd NbkristQik
```

2. Install dependencies
```bash
pnpm install
```

3. Configure environment variables
- Copy `.env.example` to `.env`
- Fill in the required values:
  - Telegram bot tokens
  - Turso database credentials
  - Authentication details
  - Admin configuration

4. Build and run
```bash
# Development
pnpm dev

# Production
pnpm build
pnpm start
```

## Available Commands

- `/start` - Initialize the bot
- `/help` - Get usage instructions
- `/report [message]` - Report an issue to the admin
- `/leaderboard` - Open the live leaderboard
- Check attendance and marks by sending your roll number

## Environment Variables

```env
ENV=development|production
TELEGRAM_BOT_TOKEN_DEV=your_dev_bot_token
TELEGRAM_BOT_TOKEN=your_production_bot_token
TURSO_DATABASE_URL=your_database_url
TURSO_AUTH_TOKEN=your_auth_token
REDIS_URL=your_redis_url
N_USERNAME=your_username
N_PASSWORD=your_password
ADMIN_ID=your_admin_id
PROD_CHANNEL=your_prod_channel
TEST_CHANNEL=your_test_channel
# Optional: override the college portal base (portal is plain HTTP by default)
PORTAL_BASE_URL=http://103.203.175.91
```

## Development

```bash
# Run in development mode
pnpm dev

# Build TypeScript
pnpm build

# Start production server
pnpm start
```

## License

See [LICENSE.md](LICENSE.md) for details.