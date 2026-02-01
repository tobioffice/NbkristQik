# Deployment Guide

## Overview

This guide covers deploying NbkristQik to production. The system consists of:
- **Telegram Bot** (long-polling or webhook)
- **REST API Server** (Express.js)
- **Database** (Turso Cloud)
- **Cache** (Redis Cloud or self-hosted)
- **Frontend** (GitHub Pages)

---

## Prerequisites

### Required Accounts

1. **Hosting Platform** (choose one):
   - Railway (recommended)
   - Render
   - DigitalOcean App Platform
   - AWS EC2
   - Self-hosted VPS

2. **Turso Database**
   - Sign up: https://turso.tech
   - Free tier: 9GB storage, unlimited reads

3. **Redis** (optional but recommended):
   - Upstash (free tier: 10K commands/day)
   - Redis Cloud (free tier: 30MB)

4. **Telegram Bot**
   - Create bot via @BotFather
   - Get bot token

---

## Environment Variables

Create a `.env` file with the following:

```bash
# Application
NODE_ENV=production
PORT=3000

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
ADMIN_ID=your_telegram_user_id

# Database (Turso)
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your_turso_auth_token

# College Portal Credentials
N_USERNAME=your_college_portal_username
N_PASSWORD=your_college_portal_password

# Redis (optional)
REDIS_URL=redis://default:password@host:port
# OR individual settings:
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# API
API_PORT=3000
CORS_ORIGINS=https://tobioffice.github.io,https://yourdomain.com
```

### Getting Environment Values

**TURSO_DATABASE_URL & TURSO_AUTH_TOKEN:**
```bash
turso db create nbkristqik
turso db show nbkristqik
turso db tokens create nbkristqik
```

**ADMIN_ID (your Telegram user ID):**
- Message @userinfobot on Telegram
- Or use: https://t.me/userinfobot

**REDIS_URL (Upstash example):**
1. Create database at https://upstash.com
2. Copy connection URL from dashboard
3. Format: `redis://default:PASSWORD@HOST:PORT`

---

## Deployment Options

### Option 1: Railway (Recommended)

**Why Railway:**
- Zero-config deployment
- Automatic HTTPS
- Generous free tier
- Built-in environment variable management

**Steps:**

1. **Install Railway CLI:**
```bash
npm install -g @railway/cli
railway login
```

2. **Create new project:**
```bash
cd nbkristqik
railway init
```

3. **Add environment variables:**
```bash
railway variables set TELEGRAM_BOT_TOKEN=xxx
railway variables set TURSO_DATABASE_URL=xxx
railway variables set TURSO_AUTH_TOKEN=xxx
railway variables set N_USERNAME=xxx
railway variables set N_PASSWORD=xxx
railway variables set REDIS_URL=xxx
railway variables set ADMIN_ID=xxx
```

4. **Deploy:**
```bash
railway up
```

5. **Get deployment URL:**
```bash
railway domain
# Example: nbkristqik-production.up.railway.app
```

6. **Set webhook (optional):**
```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://your-railway-domain.railway.app/webhook"
```

---

### Option 2: Render

1. **Create account:** https://render.com

2. **New Web Service:**
   - Connect your GitHub repository
   - Build command: `pnpm install && pnpm build`
   - Start command: `pnpm start`

3. **Environment variables:**
   - Add all required variables in Render dashboard
   - Environment → Add Environment Variable

4. **Deploy:**
   - Render auto-deploys on git push
   - Monitor logs in dashboard

---

### Option 3: DigitalOcean App Platform

1. **Create app:**
```bash
doctl apps create --spec .do/app.yaml
```

2. **App spec (`.do/app.yaml`):**
```yaml
name: nbkristqik
region: nyc
services:
  - name: bot
    github:
      repo: tobioffice/NbkristQik
      branch: main
    build_command: pnpm install && pnpm build
    run_command: pnpm start
    envs:
      - key: NODE_ENV
        value: production
      - key: TELEGRAM_BOT_TOKEN
        value: ${TELEGRAM_BOT_TOKEN}
      - key: TURSO_DATABASE_URL
        value: ${TURSO_DATABASE_URL}
      - key: TURSO_AUTH_TOKEN
        value: ${TURSO_AUTH_TOKEN}
    http_port: 3000
    instance_count: 1
    instance_size_slug: basic-xxs
```

3. **Deploy:**
```bash
doctl apps update YOUR_APP_ID --spec .do/app.yaml
```

---

### Option 4: Self-Hosted VPS

**Requirements:**
- Ubuntu 22.04 LTS
- Node.js v20.x
- pnpm
- PM2 (process manager)
- Nginx (reverse proxy)

**Setup:**

1. **Install dependencies:**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm
npm install -g pnpm

# Install PM2
npm install -g pm2
```

2. **Clone repository:**
```bash
cd /var/www
sudo git clone https://github.com/tobioffice/NbkristQik.git
cd NbkristQik
sudo chown -R $USER:$USER .
```

3. **Install dependencies:**
```bash
pnpm install
pnpm build
```

4. **Create `.env` file:**
```bash
nano .env
# Paste environment variables
```

5. **Start with PM2:**
```bash
pm2 start dist/bot/index.js --name nbkristqik
pm2 save
pm2 startup
```

6. **Configure Nginx:**
```nginx
# /etc/nginx/sites-available/nbkristqik
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/nbkristqik /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

7. **SSL with Let's Encrypt:**
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

8. **Monitor logs:**
```bash
pm2 logs nbkristqik
pm2 monit
```

---

## Database Setup

### 1. Create Turso Database

```bash
# Install Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# Login
turso auth login

# Create database
turso db create nbkristqik

# Get connection details
turso db show nbkristqik

# Create auth token
turso db tokens create nbkristqik
```

### 2. Run Migrations

```bash
# Execute schema
turso db shell nbkristqik < migrations/001_initial_schema.sql

# Or via Node.js
pnpm tsx scripts/migrate.ts
```

### 3. Import Student Data

```bash
# Prepare CSV file
# Format: roll_no,name,section,branch,year

pnpm tsx scripts/import-students.ts data/students.csv
```

---

## Redis Setup

### Upstash (Recommended)

1. **Create database:**
   - Visit https://upstash.com
   - Create new Redis database
   - Select region closest to your server

2. **Get connection URL:**
   - Copy from dashboard
   - Format: `redis://default:PASSWORD@HOST:PORT`

3. **Set environment variable:**
```bash
REDIS_URL=redis://default:AbC123...@eu1-example.upstash.io:6379
```

### Self-Hosted Redis

```bash
# Install Redis
sudo apt install redis-server

# Configure
sudo nano /etc/redis/redis.conf
# Set password: requirepass your_password

# Restart
sudo systemctl restart redis

# Set env var
REDIS_URL=redis://default:your_password@localhost:6379
```

---

## Frontend Deployment (GitHub Pages)

1. **Build frontend:**
```bash
cd src/web
pnpm install
pnpm build
```

2. **Deploy to GitHub Pages:**
```bash
# Using gh-pages package
pnpm add -D gh-pages

# Add to package.json:
"scripts": {
  "deploy": "gh-pages -d dist"
}

# Deploy
pnpm deploy
```

3. **Configure API endpoint:**
```typescript
// src/web/src/config.ts
export const API_BASE_URL = 
  import.meta.env.MODE === 'production'
    ? 'https://your-api-domain.com'
    : 'http://localhost:3000';
```

4. **Enable CORS in API:**
```typescript
// src/api/server.ts
const allowedOrigins = [
  'https://tobioffice.github.io',
  'https://your-custom-domain.com'
];
```

---

## Telegram Bot Configuration

### Webhook vs. Polling

**Polling (Default):**
- Simpler setup
- No SSL required
- Higher latency
- More API calls

**Webhook (Recommended for Production):**
- Lower latency
- Fewer API calls
- Requires HTTPS
- More complex setup

### Set Webhook

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://your-domain.com/webhook" \
  -d "max_connections=100" \
  -d "drop_pending_updates=true"
```

### Verify Webhook

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

### Remove Webhook (Use Polling)

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"
```

---

## Health Checks

### Add Health Endpoint

```typescript
// src/api/server.ts
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    redis: redisClient.isReady ? 'connected' : 'disconnected',
    database: 'connected', // Add actual DB check
  });
});
```

### Monitor with UptimeRobot

1. Create free account: https://uptimerobot.com
2. Add HTTP(s) monitor
3. URL: `https://your-domain.com/health`
4. Interval: 5 minutes
5. Alert contacts: Your email/Telegram

---

## Logging

### Production Logging

```typescript
// src/utils/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}
```

### Log Aggregation

**Option 1: Logtail (Recommended)**
```bash
npm install @logtail/node

# Add to logger
import { Logtail } from "@logtail/node";
const logtail = new Logtail(process.env.LOGTAIL_TOKEN);
```

**Option 2: Better Stack**
- Sign up: https://betterstack.com
- Create log source
- Install agent

**Option 3: Self-hosted Loki**
```bash
docker run -d --name=loki -p 3100:3100 grafana/loki
```

---

## Monitoring

### Application Metrics

```typescript
// src/utils/metrics.ts
export const metrics = {
  requestCount: 0,
  errorCount: 0,
  cacheHits: 0,
  cacheMisses: 0,
  
  record(metric: string, value: number = 1) {
    this[metric] += value;
  },
  
  getAll() {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      cacheHitRate: this.cacheHits / (this.cacheHits + this.cacheMisses),
    };
  },
};

// Expose metrics endpoint
app.get('/metrics', (req, res) => {
  res.json(metrics.getAll());
});
```

### Error Tracking with Sentry

```bash
npm install @sentry/node

# Initialize
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

---

## Backup Strategy

### Automated Backups

**Database (Turso):**
- Automatic daily backups (built-in)
- Configure retention: `turso db update nbkristqik --backup-retention-days 30`

**Manual Backup Script:**
```bash
#!/bin/bash
# scripts/backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/nbkristqik"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
turso db dump nbkristqik > "$BACKUP_DIR/db_$DATE.sql"

# Compress
gzip "$BACKUP_DIR/db_$DATE.sql"

# Upload to S3 (optional)
# aws s3 cp "$BACKUP_DIR/db_$DATE.sql.gz" s3://your-bucket/backups/

# Keep only last 7 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete

echo "Backup completed: db_$DATE.sql.gz"
```

**Schedule with cron:**
```bash
crontab -e

# Daily backup at 2 AM
0 2 * * * /path/to/scripts/backup.sh >> /var/log/backup.log 2>&1
```

---

## Security Checklist

- [ ] Environment variables secured (never commit `.env`)
- [ ] Bot token kept secret (never log or expose)
- [ ] Database credentials secure
- [ ] HTTPS enabled (SSL certificate)
- [ ] CORS configured properly
- [ ] Rate limiting enabled (API)
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (parameterized queries)
- [ ] Regular dependency updates (`pnpm update`)
- [ ] Firewall configured (only ports 80, 443 open)
- [ ] SSH key authentication (disable password login)
- [ ] Fail2ban installed (brute force protection)
- [ ] Regular backups scheduled
- [ ] Monitoring and alerts configured

---

## Performance Optimization

### 1. Enable Compression

```typescript
import compression from 'compression';
app.use(compression());
```

### 2. Cache Static Assets

```typescript
app.use(express.static('public', {
  maxAge: '1d',
  etag: true,
}));
```

### 3. Database Connection Pooling

```typescript
// Turso handles this automatically
// For high traffic, consider read replicas
```

### 4. Redis Pipeline

```typescript
const pipeline = redis.pipeline();
pipeline.get('key1');
pipeline.get('key2');
const results = await pipeline.exec();
```

### 5. Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

app.use('/api/', limiter);
```

---

## Troubleshooting

### Bot Not Responding

1. **Check bot is running:**
```bash
pm2 status
pm2 logs nbkristqik
```

2. **Verify webhook/polling:**
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

3. **Check environment variables:**
```bash
pm2 env 0
```

### Database Connection Errors

1. **Test connection:**
```bash
turso db shell nbkristqik
```

2. **Verify credentials:**
```bash
echo $TURSO_DATABASE_URL
echo $TURSO_AUTH_TOKEN
```

3. **Check logs:**
```bash
pm2 logs nbkristqik --lines 100
```

### Redis Connection Issues

1. **Test connection:**
```bash
redis-cli -h host -p port -a password ping
```

2. **Check logs:**
```bash
tail -f /var/log/redis/redis-server.log
```

### High Memory Usage

1. **Monitor:**
```bash
pm2 monit
```

2. **Restart if needed:**
```bash
pm2 restart nbkristqik
```

3. **Increase memory limit:**
```bash
pm2 start dist/bot/index.js --name nbkristqik --max-memory-restart 500M
```

---

## Scaling

### Horizontal Scaling

**Multiple bot instances:**
- Use webhook mode
- Each instance handles different updates
- Load balancer distributes traffic

**API scaling:**
- Deploy multiple API instances
- Use load balancer (Nginx, CloudFlare)
- Shared Redis for caching

### Vertical Scaling

**Upgrade server:**
- More CPU cores
- More RAM
- Faster disk (SSD)

**Database:**
- Turso scales automatically
- Consider read replicas for heavy load

---

## Post-Deployment Checklist

- [ ] Bot responding to commands
- [ ] Leaderboard API working
- [ ] Frontend loading correctly
- [ ] Redis caching working
- [ ] Database queries fast (<100ms)
- [ ] Logs being written
- [ ] Health endpoint returning 200
- [ ] Monitoring alerts configured
- [ ] Backups scheduled
- [ ] SSL certificate valid
- [ ] Domain DNS configured
- [ ] Admin commands working
- [ ] Error handling working
- [ ] Webhook/polling configured

---

## Maintenance

### Weekly Tasks
- [ ] Check logs for errors
- [ ] Monitor uptime
- [ ] Review performance metrics

### Monthly Tasks
- [ ] Update dependencies (`pnpm update`)
- [ ] Review backups
- [ ] Check disk space
- [ ] Security updates

### Quarterly Tasks
- [ ] Review and optimize queries
- [ ] Update documentation
- [ ] Review error logs
- [ ] Cleanup old data

---

## Support

**Issues:** https://github.com/tobioffice/NbkristQik/issues  
**Telegram:** @tobioffice  
**Bot:** @nbkristqik

---

*Last Updated: February 1, 2026*
