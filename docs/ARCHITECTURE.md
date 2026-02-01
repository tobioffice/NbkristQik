# NbkristQik Architecture Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Technology Stack](#technology-stack)
4. [Directory Structure](#directory-structure)
5. [Core Components](#core-components)
6. [Data Flow](#data-flow)
7. [Database Schema](#database-schema)
8. [Caching Strategy](#caching-strategy)
9. [Error Handling](#error-handling)
10. [Design Patterns](#design-patterns)

---

## Project Overview

**NbkristQik** is a Telegram bot that allows college students to check their attendance and mid-term marks by scraping data from their college portal. The system provides:

- 📊 Real-time attendance tracking
- 📝 Mid-term marks retrieval
- 🏆 Live leaderboard (Telegram Web App)
- ⚡ Redis-based caching for performance
- 🔄 Automatic session management
- 🌐 REST API for web interface

### Key Features
- **Telegram Bot Interface**: Interactive command-based system
- **Web Scraping**: Automated data extraction from college portal
- **Caching Layer**: Redis for performance optimization
- **Database**: Turso (SQLite) for persistent storage
- **Web Dashboard**: React-based leaderboard
- **Error Recovery**: Fallback mechanisms for reliability

---

## System Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        TG[Telegram User]
        WEB[Web Browser]
    end

    subgraph "Application Layer"
        BOT[Telegram Bot]
        API[REST API Server]
    end

    subgraph "Business Logic"
        CMD[Command Handlers]
        SVC[Services Layer]
        SCRAPER[Web Scraper]
    end

    subgraph "Data Layer"
        REDIS[(Redis Cache)]
        TURSO[(Turso DB)]
        COLLEGE[College Portal]
    end

    TG -->|Commands| BOT
    WEB -->|HTTP| API
    BOT --> CMD
    CMD --> SVC
    API --> TURSO
    SVC --> SCRAPER
    SVC --> REDIS
    SVC --> TURSO
    SCRAPER -->|HTTP POST| COLLEGE
    REDIS -.->|Cache Miss| SCRAPER
    COLLEGE -.->|HTML Response| SCRAPER
    
    style TG fill:#0088cc
    style BOT fill:#229954
    style API fill:#D68910
    style REDIS fill:#E74C3C
    style TURSO fill:#8E44AD
    style COLLEGE fill:#566573
```

### Component Layers

1. **Client Layer**: End-user interfaces (Telegram chat, web browser)
2. **Application Layer**: Bot and API servers
3. **Business Logic**: Command processing and data retrieval
4. **Data Layer**: Caching, database, and external services

---

## Technology Stack

### Backend
- **Runtime**: Node.js v20.x
- **Language**: TypeScript
- **Framework**: Express.js
- **Bot Library**: node-telegram-bot-api

### Data Storage
- **Database**: Turso (libSQL/SQLite)
- **Cache**: Redis v5.x
- **Session**: In-memory (with Redis failover)

### Web Scraping
- **HTTP Client**: Axios
- **HTML Parser**: Cheerio
- **Session Management**: Cookie-based authentication

### Frontend (Leaderboard)
- **Framework**: React
- **Build Tool**: Vite
- **Styling**: Tailwind CSS

### DevOps
- **Package Manager**: pnpm
- **Testing**: Vitest
- **Linting**: ESLint + Prettier
- **CI/CD**: GitHub Actions

---

## Directory Structure

```
nbkristqik/
├── src/
│   ├── api/                    # REST API endpoints
│   │   └── server.ts          # Express server, leaderboard API
│   │
│   ├── bot/                    # Telegram bot core
│   │   ├── index.ts           # Bot entry point
│   │   ├── bot.ts             # Bot instance creation
│   │   ├── setup.ts           # Bot configuration
│   │   ├── commands/          # Command handlers
│   │   │   ├── start.ts       # /start command
│   │   │   ├── help.ts        # /help command
│   │   │   ├── report.ts      # /report command
│   │   │   └── leaderboard.ts # /leaderboard command
│   │   └── academics/         # Academic feature handlers
│   │       ├── academicHandler.ts    # Main handler
│   │       └── studentActions.ts     # User interactions
│   │
│   ├── config/                 # Configuration
│   │   └── environmentals.ts  # Environment variables
│   │
│   ├── constants/              # Static values
│   │   └── index.ts           # URLs, headers, messages
│   │
│   ├── db/                     # Database layer
│   │   ├── db.ts              # Turso client
│   │   ├── student.model.ts   # Student CRUD
│   │   ├── student_stats.model.ts # Statistics queries
│   │   ├── temp.ts            # Temporary data
│   │   └── fallback/          # Fallback responses
│   │       └── response.model.ts
│   │
│   ├── services/               # Business logic
│   │   ├── student.service.ts # Student operations
│   │   ├── student.utils/     # Utility modules
│   │   │   ├── Academic.ts    # Core scraper logic
│   │   │   ├── AcademicTG.ts  # Telegram formatting
│   │   │   └── checkMembership.ts
│   │   └── redis/             # Redis operations
│   │       ├── getRedisClient.ts
│   │       ├── storeAttOrMidToRedis.ts
│   │       └── utils.ts
│   │
│   ├── types/                  # TypeScript types
│   │   └── index.ts           # Shared interfaces
│   │
│   └── web/                    # Frontend (Leaderboard)
│       └── vite.config.ts     # Build configuration
│
├── tests/                      # Test suites
│   ├── unit/                  # Unit tests
│   ├── integration/           # Integration tests
│   ├── mocks/                 # Test mocks
│   └── setup.ts               # Test configuration
│
├── docs/                       # Documentation
│   └── ARCHITECTURE.md        # This file
│
├── .github/
│   └── workflows/             # CI/CD pipelines
│       └── test.yml           # Test automation
│
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
├── vitest.config.ts           # Test config
└── .env.example               # Environment template
```

---

## Core Components

### 1. Bot Module (`src/bot/`)

#### Bot Initialization Flow
```typescript
// src/bot/index.ts
startBot() 
  → setupBot()              // Configure bot commands
  → import commands         // Load command handlers
  → import features         // Load academic handlers
  → startServer()           // Start API server
```

#### Command Handlers
- `/start` - Bot initialization, welcome message
- `/help` - Usage instructions
- `/report` - Report issues to admin
- `/leaderboard` - Display leaderboard link

#### Academic Handler
Processes roll numbers sent by users:
```typescript
// Message flow
User sends: "21B81A05E9"
  → academicHandler validates format
  → Shows inline keyboard: [Attendance] [Midmarks]
  → User clicks button
  → studentActions.handleAction()
  → Academic.getAttendanceJSON() / getMidmarksJSON()
  → AcademicTG formats response
  → Send to user
```

---

### 2. Services Layer (`src/services/`)

#### Academic Service (`student.utils/Academic.ts`)

**Core Scraper Class**

```typescript
class Academic implements IAcademic {
  rollnumber: string;
  
  // Main methods
  async getResponse(command: "mid" | "att"): Promise<string>
  async getAttendanceJSON(): Promise<Attendance>
  async getMidmarksJSON(): Promise<Midmarks>
  
  // Helper methods
  private async renewSession(): Promise<void>
  private buildRequestData(command, student): object
  private parseAttendance(html: string): Attendance
  private parseMidmarks(html: string): Midmarks
}
```

**Key Features:**
- Session management with cookie persistence
- Retry logic (max 2 attempts)
- Error classification (ServerDown, NoData, Blocked)
- HTML parsing with Cheerio
- Cache integration

**Error Hierarchy:**
```
AcademicError (base)
├── ServerDownError       // Portal unreachable
├── BlockedReportError    // Admin blocked access
├── NoDataFoundError      // Roll number has no data
└── InvalidCredentialsError // Login failed
```

#### AcademicTG Service (`student.utils/AcademicTG.ts`)

Telegram-specific formatting wrapper:
```typescript
class AcademicTG extends Academic {
  async getAttendanceMessage(): Promise<string>
  async getMidmarksMessage(): Promise<string>
  
  // Formatting utilities
  private static formatAttendanceMessage(data): string
  private static formatMidmarksMessage(data): string
  private static buildProgressBar(percentage): string
  private static getStatusEmoji(percentage): string
}
```

**Output Format:**
```
🧑‍🎓 ROLL: 21B81A05E9
🏫 Branch: III-CSE-A
📚 Attended: 85/100

📈 Percentage: 85.50%
🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜

SUBJ     │ ST │ATT/TOT│LAST
────────────────────────────
Data Str │ 🟢 │20/25  │25-01
Compil.. │ 🟡 │18/25  │24-01
────────────────────────────

💡 Tip: Maintain 75%+ for good attendance
```

---

### 3. Database Module (`src/db/`)

#### Student Model (`student.model.ts`)

```typescript
interface Student {
  roll_no: string;  // Primary key
  name: string;
  section: string;
  branch: string;
  year: number;
}

// CRUD operations
async function getStudent(rollno: string): Promise<Student>
```

#### Student Stats Model (`student_stats.model.ts`)

```typescript
interface StudentStats {
  roll_no: string;
  student_name: string;
  year: number;
  branch: number;
  section: string;
  attendance_percentage: number | null;
  midmarks_average: number | null;
  last_updated: string;
}

// Leaderboard query
async function getLeaderboard(
  sortBy: "attendance" | "midmarks",
  limit: number,
  offset: number,
  filters: { year?, branch?, section? }
): Promise<StudentStats[]>
```

**Database Schema:**

```mermaid
erDiagram
    STUDENTSNEW {
        string roll_no PK
        string name
        string section
        string branch
        integer year
    }
    
    STUDENT_STATS {
        string roll_no PK
        string student_name
        integer year
        integer branch
        string section
        float attendance_percentage
        float midmarks_average
        string last_updated
    }
    
    FALLBACK_RESPONSES {
        string roll_no PK
        string type
        text response_html
        integer cached_at
    }
    
    STUDENTSNEW ||--o{ STUDENT_STATS : "has stats"
    STUDENTSNEW ||--o{ FALLBACK_RESPONSES : "has fallback"
```

---

### 4. Redis Caching (`src/services/redis/`)

#### Cache Strategy

**Two-tier caching:**
1. **Student Info Cache**: Roll number → student details (name, branch, year, section)
2. **Response Cache**: Roll number + type → HTML response

#### Cache Flow

```mermaid
sequenceDiagram
    participant User
    participant Bot
    participant Cache
    participant Scraper
    participant Portal

    User->>Bot: Send roll number
    Bot->>Cache: Check cache (student info)
    alt Cache Hit
        Cache-->>Bot: Return cached data
    else Cache Miss
        Bot->>Scraper: Fetch from portal
        Scraper->>Portal: POST request
        Portal-->>Scraper: HTML response
        Scraper->>Cache: Store in cache (TTL: 30min)
        Scraper-->>Bot: Return data
    end
    Bot-->>User: Formatted message
```

#### Redis Keys

```typescript
// Student cache key
`student:${rollno}` → JSON string of Student object
TTL: 1800 seconds (30 minutes)

// Attendance cache key
`attendance:${rollno}` → HTML response string
TTL: 1800 seconds

// Midmarks cache key
`midmarks:${rollno}` → HTML response string
TTL: 1800 seconds
```

#### Fallback Strategy

If Redis is unavailable:
1. Try to fetch from Turso DB (fallback_responses table)
2. If not in DB, fetch fresh from portal
3. Store in DB for next time

---

### 5. API Module (`src/api/`)

#### Leaderboard API

**Endpoint:** `GET /api/leaderboard`

**Query Parameters:**
```typescript
{
  page?: number;         // Default: 1
  limit?: number;        // Default: 50
  sort?: "attendance" | "midmarks";  // Default: "attendance"
  year?: string | "all"; // Filter by year
  branch?: string | "all"; // Filter by branch
  section?: string | "all"; // Filter by section
}
```

**Response:**
```json
{
  "success": true,
  "page": 1,
  "limit": 50,
  "data": [
    {
      "roll_no": "21B81A05E9",
      "student_name": "John Doe",
      "year": 3,
      "branch": 5,
      "section": "A",
      "attendance_percentage": 95.50,
      "midmarks_average": 18.5,
      "last_updated": "2026-02-01T06:00:00Z"
    }
    // ... more students
  ]
}
```

---

## Data Flow

### Attendance Fetch Flow

```mermaid
sequenceDiagram
    participant U as User
    participant TG as Telegram Bot
    participant AH as AcademicHandler
    participant AC as Academic Service
    participant R as Redis Cache
    participant P as College Portal
    participant TU as Turso DB

    U->>TG: Send "21B81A05E9"
    TG->>AH: Process roll number
    AH->>TG: Show [Attendance] [Midmarks] buttons
    U->>TG: Click [Attendance]
    TG->>AC: getAttendanceJSON()
    
    AC->>R: Check cache
    alt Cache Hit
        R-->>AC: Return cached HTML
    else Cache Miss
        AC->>TU: Get student info
        TU-->>AC: {name, branch, year, section}
        AC->>P: POST login + fetch attendance
        P-->>AC: HTML response
        AC->>R: Store in cache (30min TTL)
    end
    
    AC->>AC: Parse HTML with Cheerio
    AC->>AC: Format for Telegram
    AC-->>TG: Formatted message
    TG-->>U: Display attendance
```

### Session Management Flow

```mermaid
sequenceDiagram
    participant AC as Academic Service
    participant P as College Portal
    
    AC->>P: POST request with cookie
    alt Session Valid
        P-->>AC: Data response
    else Session Expired
        P-->>AC: Login page HTML
        AC->>AC: Detect login page
        AC->>P: POST /Login with credentials
        P-->>AC: Set-Cookie header
        AC->>AC: Store new cookie
        AC->>P: Retry original request
        P-->>AC: Data response
    end
```

---

## Database Schema

### Tables

#### 1. `studentsnew`
Stores basic student information.

```sql
CREATE TABLE studentsnew (
    roll_no TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    section TEXT NOT NULL,
    branch TEXT NOT NULL,
    year INTEGER NOT NULL
);
```

#### 2. `student_stats`
Stores aggregated statistics for leaderboard.

```sql
CREATE TABLE student_stats (
    roll_no TEXT PRIMARY KEY,
    student_name TEXT NOT NULL,
    year INTEGER NOT NULL,
    branch INTEGER NOT NULL,
    section TEXT NOT NULL,
    attendance_percentage REAL,
    midmarks_average REAL,
    last_updated TEXT NOT NULL,
    FOREIGN KEY (roll_no) REFERENCES studentsnew(roll_no)
);

CREATE INDEX idx_attendance ON student_stats(attendance_percentage DESC);
CREATE INDEX idx_midmarks ON student_stats(midmarks_average DESC);
CREATE INDEX idx_filters ON student_stats(year, branch, section);
```

#### 3. `fallback_responses`
Stores HTML responses when Redis is unavailable.

```sql
CREATE TABLE fallback_responses (
    roll_no TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'attendance' or 'midmarks'
    response_html TEXT NOT NULL,
    cached_at INTEGER NOT NULL,
    PRIMARY KEY (roll_no, type)
);
```

---

## Caching Strategy

### Multi-Level Cache Architecture

```
┌─────────────────────────────────────────┐
│         Request Layer                    │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│      L1: Redis Cache (Hot Data)         │
│      TTL: 30 minutes                     │
│      ✓ Fast access (<5ms)                │
└────────────────┬────────────────────────┘
                 │ Cache Miss
                 ▼
┌─────────────────────────────────────────┐
│    L2: Turso DB (Warm Data)              │
│    Fallback responses table              │
│    ✓ Reliable (<100ms)                   │
└────────────────┬────────────────────────┘
                 │ Not Found
                 ▼
┌─────────────────────────────────────────┐
│    L3: College Portal (Cold Data)        │
│    Web scraping                          │
│    ✓ Authoritative but slow (2-5s)       │
└─────────────────────────────────────────┘
```

### Cache Invalidation

**Time-based invalidation:**
- Student info: 30 minutes TTL
- Attendance: 30 minutes TTL
- Midmarks: 30 minutes TTL

**Manual invalidation:** Not implemented (future feature)

### Cache Keys Design

```typescript
// Namespace pattern
`${entity}:${identifier}:${optional_suffix}`

// Examples
"student:21B81A05E9"                    // Student info
"attendance:21B81A05E9"                 // Attendance HTML
"midmarks:21B81A05E9"                   // Midmarks HTML
"session:cookie"                        // Session cookie
```

---

## Error Handling

### Error Classification

```typescript
class AcademicError extends Error {
  constructor(message: string, public code: string)
}

// Specific error types
ServerDownError       → code: "SERVER_DOWN"
BlockedReportError    → code: "REPORT_BLOCKED"
NoDataFoundError      → code: "NO_DATA"
InvalidCredentialsError → code: "INVALID_CREDENTIALS"
```

### Error Handling Strategy

```mermaid
graph TD
    A[Request] --> B{Try Operation}
    B -->|Success| C[Return Data]
    B -->|Error| D{Error Type?}
    
    D -->|ServerDown| E[Retry with backoff]
    D -->|NoData| F[Return user-friendly message]
    D -->|Blocked| G[Notify user]
    D -->|Invalid Creds| H[Alert admin]
    D -->|Unknown| I[Log & fallback]
    
    E --> J{Retry Count < 2?}
    J -->|Yes| B
    J -->|No| K[Return cached data or error]
    
    F --> L[Send formatted error to user]
    G --> L
    H --> L
    I --> L
    K --> L
    
    style A fill:#3498db
    style C fill:#27ae60
    style L fill:#e74c3c
```

### User-Facing Error Messages

```typescript
// Instead of technical errors, show user-friendly messages:

// Before
throw new Error("ECONNREFUSED");

// After
throw new ServerDownError();
// → "⚠️ College Server Temporarily Down
//    🔄 Status: Server not responding
//    ⏰ Time: 11:15 AM
//    💡 What you can do:
//    • Wait 5-10 minutes and try again"
```

---

## Design Patterns

### 1. **Singleton Pattern**
Used for Redis client and Turso DB connection.

```typescript
// src/services/redis/getRedisClient.ts
let client: RedisClientType | null = null;

export async function getClient(): Promise<RedisClientType> {
  if (!client) {
    client = await createClient(/* ... */);
  }
  return client;
}
```

### 2. **Factory Pattern**
Used for creating Academic instances.

```typescript
// Different formatters for different platforms
class Academic { /* core logic */ }
class AcademicTG extends Academic { /* Telegram formatting */ }
class AcademicWeb extends Academic { /* Web formatting */ }
```

### 3. **Strategy Pattern**
Used for different sorting strategies in leaderboard.

```typescript
async function getLeaderboard(
  sortBy: "attendance" | "midmarks",
  // ...
) {
  const orderColumn = sortBy === "attendance" 
    ? "attendance_percentage" 
    : "midmarks_average";
  // ...
}
```

### 4. **Decorator Pattern**
Used for adding caching behavior.

```typescript
async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number
): Promise<T> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
  
  const fresh = await fetcher();
  await redis.setex(key, ttl, JSON.stringify(fresh));
  return fresh;
}
```

### 5. **Command Pattern**
Used for bot command handlers.

```typescript
// Each command is encapsulated
bot.onText(/\/start/, async (msg) => { /* ... */ });
bot.onText(/\/help/, async (msg) => { /* ... */ });
bot.onText(/\/report/, async (msg) => { /* ... */ });
```

### 6. **Observer Pattern**
Used for callback query handling.

```typescript
bot.on("callback_query", async (callbackQuery) => {
  const action = callbackQuery.data;
  // Notify appropriate handler
  await handleAction(action, callbackQuery);
});
```

---

## Deployment Architecture

### Production Environment

```mermaid
graph LR
    subgraph "Cloud Infrastructure"
        APP[Node.js App<br/>Port 3000]
        BOT[Telegram Bot<br/>Webhook/Polling]
    end
    
    subgraph "External Services"
        TG_API[Telegram API]
        TURSO[Turso Cloud DB]
        REDIS[Redis Cloud]
        PORTAL[College Portal]
    end
    
    subgraph "Frontend"
        PAGES[GitHub Pages]
    end
    
    BOT <-->|HTTPS| TG_API
    APP <-->|libSQL| TURSO
    APP <-->|TCP| REDIS
    BOT --> APP
    APP <-->|Scraping| PORTAL
    PAGES -->|API Calls| APP
    
    style APP fill:#27ae60
    style BOT fill:#3498db
    style TURSO fill:#9b59b6
    style REDIS fill:#e74c3c
```

### Environment Variables

```bash
# Application
ENV=production
PORT=3000

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_ID=your_telegram_user_id

# Database
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your_auth_token

# College Portal Credentials
N_USERNAME=your_username
N_PASSWORD=your_password

# Redis (optional)
REDIS_URL=redis://default:password@host:port
```

---

## Performance Considerations

### Bottlenecks

1. **College Portal Response Time**: 2-5 seconds per request
   - **Solution**: Aggressive caching (30min TTL)

2. **Database Query Performance**: Leaderboard with filters
   - **Solution**: Indexed columns, pagination

3. **Redis Connection**: Single connection pool
   - **Solution**: Connection reuse, fallback to DB

### Optimization Strategies

```typescript
// 1. Parallel requests when possible
const [attendance, midmarks] = await Promise.all([
  getAttendanceJSON(rollno),
  getMidmarksJSON(rollno)
]);

// 2. Early return on cache hit
const cached = await redis.get(key);
if (cached) return JSON.parse(cached);

// 3. Batch database operations
const students = await turso.execute({
  sql: "SELECT * FROM studentsnew WHERE roll_no IN (?, ?, ?)",
  args: [rollno1, rollno2, rollno3]
});
```

---

## Security Considerations

### 1. **Credential Management**
- Portal credentials stored in environment variables
- Never logged or exposed to users

### 2. **Input Validation**
```typescript
// Roll number format validation
const ROLL_NO_PATTERN = /^[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{2}$/;

if (!ROLL_NO_PATTERN.test(rollno)) {
  throw new Error("Invalid roll number format");
}
```

### 3. **Rate Limiting**
- Telegram bot: Built-in rate limiting by Telegram
- API: No rate limiting (future enhancement needed)

### 4. **CORS Policy**
```typescript
app.use(cors({
  origin: ["https://tobioffice.github.io"]
}));
```

---

## Future Enhancements

### Planned Features

1. **Notification System**
   - Attendance drop alerts
   - New marks notifications
   - Configurable thresholds

2. **AI Chat Integration**
   - Answer questions about attendance
   - Provide study recommendations
   - Natural language queries

3. **Enhanced Leaderboard**
   - Department-wise rankings
   - Subject-wise performance
   - Historical trends

4. **Admin Dashboard**
   - Monitor system health
   - Manage users
   - View analytics

### Architecture Evolution

```mermaid
graph TB
    subgraph "Current (v1.0)"
        B1[Bot + API]
        C1[Redis]
        D1[Turso]
    end
    
    subgraph "Planned (v2.0)"
        B2[Microservices]
        C2[Redis Cluster]
        D2[PostgreSQL]
        Q2[Message Queue]
        N2[Notification Service]
    end
    
    B1 -.->|Migration| B2
    C1 -.->|Scale| C2
    D1 -.->|Migrate| D2
    B2 --> Q2
    Q2 --> N2
    
    style B2 fill:#2ecc71
    style N2 fill:#e67e22
```

---

## Conclusion

NbkristQik is built with a modular, scalable architecture that balances performance with maintainability. The system leverages caching aggressively to minimize load on the college portal while providing fast responses to users. The use of TypeScript, comprehensive error handling, and design patterns ensures code quality and developer productivity.

For developers joining the project, start by:
1. Setting up the development environment (see README.md)
2. Understanding the data flow (Telegram → Bot → Services → Portal)
3. Reading the Academic service code (`src/services/student.utils/Academic.ts`)
4. Testing with sample roll numbers

**Questions?** Open an issue on GitHub or contact the maintainers.

---

*Last Updated: February 1, 2026*
*Version: 1.0.0*
*Maintainer: @tobioffice*
