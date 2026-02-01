# API Documentation

## Overview

NbkristQik provides a REST API for accessing leaderboard data. The API is built with Express.js and serves data from the Turso database.

**Base URL:** `http://localhost:3000` (development)  
**Production URL:** Your deployed URL

---

## Endpoints

### 1. Get Leaderboard

Retrieve paginated student statistics with optional filtering.

**Endpoint:** `GET /api/leaderboard`

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | number | No | 1 | Page number (1-based) |
| `limit` | number | No | 50 | Results per page (max 100) |
| `sort` | string | No | "attendance" | Sort by: `attendance` or `midmarks` |
| `year` | string | No | "all" | Filter by year: `1`, `2`, `3`, `4`, or `all` |
| `branch` | string | No | "all" | Filter by branch code or `all` |
| `section` | string | No | "all" | Filter by section: `A`, `B`, `C`, etc., or `all` |

#### Request Example

```bash
# Get first page, sorted by attendance
curl "http://localhost:3000/api/leaderboard"

# Get page 2 with 20 results
curl "http://localhost:3000/api/leaderboard?page=2&limit=20"

# Filter by year 3, CSE branch, section A
curl "http://localhost:3000/api/leaderboard?year=3&branch=5&section=A"

# Sort by midmarks average
curl "http://localhost:3000/api/leaderboard?sort=midmarks"

# Combined filters
curl "http://localhost:3000/api/leaderboard?year=3&branch=5&section=A&sort=attendance&page=1&limit=50"
```

#### Response Format

**Success Response (200 OK):**

```json
{
  "success": true,
  "page": 1,
  "limit": 50,
  "total": 245,
  "data": [
    {
      "roll_no": "21B81A05E9",
      "student_name": "JOHN DOE",
      "year": 3,
      "branch": 5,
      "section": "A",
      "attendance_percentage": 95.50,
      "midmarks_average": 18.75,
      "last_updated": "2026-02-01T06:30:00.000Z"
    },
    {
      "roll_no": "21B81A05F1",
      "student_name": "JANE SMITH",
      "year": 3,
      "branch": 5,
      "section": "A",
      "attendance_percentage": 94.20,
      "midmarks_average": 19.00,
      "last_updated": "2026-02-01T06:25:00.000Z"
    }
    // ... more students
  ]
}
```

**Error Response (400 Bad Request):**

```json
{
  "success": false,
  "error": "Invalid page number"
}
```

**Error Response (500 Internal Server Error):**

```json
{
  "success": false,
  "error": "Failed to fetch leaderboard data"
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Request success status |
| `page` | number | Current page number |
| `limit` | number | Results per page |
| `total` | number | Total number of matching records |
| `data` | array | Array of student statistics |
| `roll_no` | string | Student roll number |
| `student_name` | string | Student full name |
| `year` | number | Academic year (1-4) |
| `branch` | number | Branch code (see Branch Codes) |
| `section` | string | Section letter |
| `attendance_percentage` | number \| null | Attendance % (0-100) |
| `midmarks_average` | number \| null | Average midmarks (0-20) |
| `last_updated` | string | ISO 8601 timestamp |

#### Branch Codes

| Code | Branch |
|------|--------|
| 1 | Civil Engineering |
| 2 | Mechanical Engineering |
| 3 | Electrical & Electronics Engineering |
| 4 | Electronics & Communication Engineering |
| 5 | Computer Science & Engineering |
| 6 | Information Technology |

#### Pagination

The API uses offset-based pagination:

- **First page:** `?page=1`
- **Second page:** `?page=2`
- **Offset calculation:** `offset = (page - 1) × limit`

**Example:**
- Page 1, limit 50: rows 0-49
- Page 2, limit 50: rows 50-99
- Page 3, limit 50: rows 100-149

#### Sorting

Results are sorted in **descending order** by the specified field:

- `sort=attendance` → Highest attendance percentage first
- `sort=midmarks` → Highest midmarks average first

Null values are sorted to the end.

#### Filtering

Filters are applied with **AND** logic:

```sql
WHERE year = ? AND branch = ? AND section = ?
```

Use `"all"` to skip a filter:

```bash
# Only filter by year 3
curl "http://localhost:3000/api/leaderboard?year=3&branch=all&section=all"
```

---

## CORS Configuration

The API has CORS enabled for the following origins:

```javascript
const allowedOrigins = [
  'https://tobioffice.github.io',
  'http://localhost:5173'  // Vite dev server
];
```

To add more origins, update the CORS configuration in `src/api/server.ts`.

---

## Rate Limiting

**Current Status:** ❌ Not implemented

**Recommendation:** Implement rate limiting for production:

```bash
npm install express-rate-limit
```

```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests, please try again later.'
});

app.use('/api/', limiter);
```

---

## Authentication

**Current Status:** ❌ Not implemented

The API is currently **public** and does not require authentication.

**Future Enhancement:** Consider adding API key authentication:

```javascript
app.use('/api/', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized' 
    });
  }
  next();
});
```

---

## Error Handling

### Error Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 400 | Bad Request (invalid parameters) |
| 401 | Unauthorized (future) |
| 429 | Too Many Requests (future) |
| 500 | Internal Server Error |

### Common Errors

**Invalid page number:**
```json
{
  "success": false,
  "error": "Invalid page number"
}
```

**Invalid limit:**
```json
{
  "success": false,
  "error": "Limit must be between 1 and 100"
}
```

**Database error:**
```json
{
  "success": false,
  "error": "Failed to fetch leaderboard data"
}
```

---

## Client Integration

### JavaScript (Fetch API)

```javascript
async function getLeaderboard(options = {}) {
  const {
    page = 1,
    limit = 50,
    sort = 'attendance',
    year = 'all',
    branch = 'all',
    section = 'all'
  } = options;

  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    sort,
    year,
    branch,
    section
  });

  try {
    const response = await fetch(
      `http://localhost:3000/api/leaderboard?${params}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch leaderboard');
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    throw error;
  }
}

// Usage
const leaderboard = await getLeaderboard({
  year: '3',
  branch: '5',
  section: 'A',
  sort: 'attendance',
  page: 1,
  limit: 50
});

console.log(leaderboard.data);
```

### React Hook

```javascript
import { useState, useEffect } from 'react';

function useLeaderboard(filters) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const result = await getLeaderboard(filters);
        setData(result);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [filters]);

  return { data, loading, error };
}

// Usage in component
function Leaderboard() {
  const { data, loading, error } = useLeaderboard({
    year: '3',
    branch: '5',
    sort: 'attendance'
  });

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  
  return (
    <div>
      {data.data.map(student => (
        <div key={student.roll_no}>
          {student.student_name}: {student.attendance_percentage}%
        </div>
      ))}
    </div>
  );
}
```

### Python (requests)

```python
import requests

def get_leaderboard(
    page=1,
    limit=50,
    sort='attendance',
    year='all',
    branch='all',
    section='all'
):
    params = {
        'page': page,
        'limit': limit,
        'sort': sort,
        'year': year,
        'branch': branch,
        'section': section
    }
    
    response = requests.get(
        'http://localhost:3000/api/leaderboard',
        params=params
    )
    
    response.raise_for_status()
    return response.json()

# Usage
leaderboard = get_leaderboard(
    year='3',
    branch='5',
    section='A',
    sort='attendance'
)

for student in leaderboard['data']:
    print(f"{student['student_name']}: {student['attendance_percentage']}%")
```

---

## Performance Considerations

### Database Indexes

Ensure the following indexes exist for optimal query performance:

```sql
CREATE INDEX idx_attendance ON student_stats(attendance_percentage DESC);
CREATE INDEX idx_midmarks ON student_stats(midmarks_average DESC);
CREATE INDEX idx_filters ON student_stats(year, branch, section);
```

### Response Times

Expected response times:

- **Without filters:** ~50-100ms
- **With filters:** ~30-80ms
- **Large result sets (100 rows):** ~100-200ms

### Caching

Consider adding caching for frequently accessed pages:

```javascript
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 300 }); // 5 min cache

app.get('/api/leaderboard', async (req, res) => {
  const cacheKey = JSON.stringify(req.query);
  const cached = cache.get(cacheKey);
  
  if (cached) {
    return res.json(cached);
  }
  
  // Fetch from database...
  const result = await getLeaderboard(filters);
  cache.set(cacheKey, result);
  res.json(result);
});
```

---

## Testing

### Manual Testing

```bash
# Test basic endpoint
curl http://localhost:3000/api/leaderboard

# Test pagination
curl "http://localhost:3000/api/leaderboard?page=2&limit=10"

# Test filtering
curl "http://localhost:3000/api/leaderboard?year=3&branch=5&section=A"

# Test sorting
curl "http://localhost:3000/api/leaderboard?sort=midmarks"

# Test error handling (invalid page)
curl "http://localhost:3000/api/leaderboard?page=-1"
```

### Automated Testing

```javascript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from './server.js';

describe('Leaderboard API', () => {
  it('should return leaderboard data', async () => {
    const response = await request(app)
      .get('/api/leaderboard')
      .expect(200);
    
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeInstanceOf(Array);
  });

  it('should filter by year', async () => {
    const response = await request(app)
      .get('/api/leaderboard?year=3')
      .expect(200);
    
    expect(response.body.data.every(s => s.year === 3)).toBe(true);
  });

  it('should handle invalid page', async () => {
    const response = await request(app)
      .get('/api/leaderboard?page=-1')
      .expect(400);
    
    expect(response.body.success).toBe(false);
  });
});
```

---

## Future Enhancements

### Planned Features

1. **Search Endpoint**
   ```
   GET /api/students/search?q=john
   ```

2. **Individual Student Stats**
   ```
   GET /api/students/:rollno
   ```

3. **Department Statistics**
   ```
   GET /api/stats/departments
   ```

4. **Historical Trends**
   ```
   GET /api/trends/:rollno
   ```

5. **WebSocket Updates**
   - Real-time leaderboard updates
   - Live attendance notifications

---

## Troubleshooting

### Common Issues

**CORS errors:**
- Add your frontend origin to `allowedOrigins` in `server.ts`
- Check that CORS middleware is applied before routes

**Empty results:**
- Verify `student_stats` table has data
- Check that filters match existing records
- Run `SELECT COUNT(*) FROM student_stats` to verify data

**Slow queries:**
- Check that indexes are created
- Monitor query execution time in logs
- Consider adding query result caching

**Port conflicts:**
- Change `PORT` environment variable
- Kill process on port 3000: `lsof -ti:3000 | xargs kill`

---

## Support

For API issues or questions:
- **GitHub Issues:** https://github.com/tobioffice/NbkristQik/issues
- **Telegram:** @tobioffice
- **Bot:** @nbkristqik

---

*Last Updated: February 1, 2026*
