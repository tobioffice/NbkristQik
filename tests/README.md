# NbkristQik Tests

Comprehensive test suite for the NbkristQik Telegram bot.

## Setup

Install dependencies:
```bash
npm install
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run with UI
```bash
npm run test:ui
```

### Run with coverage
```bash
npm run test:coverage
```

### Watch mode
```bash
npm test -- --watch
```

## Test Structure

```
tests/
├── setup.ts                           # Global test setup
├── mocks/                             # Mock data and utilities
│   ├── academic.mock.ts               # Academic module mocks
│   ├── redis.mock.ts                  # Redis client mocks
│   └── axios.mock.ts                  # HTTP request mocks
├── unit/                              # Unit tests
│   ├── academic.test.ts               # Academic module tests
│   ├── academicTG.test.ts             # AcademicTG formatting tests
│   └── constants.test.ts              # Constants validation
└── integration/                       # Integration tests
    └── academic.integration.test.ts   # End-to-end flow tests
```

## Test Coverage

The test suite covers:

### Academic Module (`academic.test.ts`)
- ✅ Roll number normalization (uppercase, trim)
- ✅ Custom error classes (AcademicError, ServerDownError, etc.)
- ✅ HTTP request handling with retry logic
- ✅ Session management and renewal
- ✅ Cache integration (Redis)
- ✅ Fallback to database on network failure
- ✅ HTML parsing for attendance
- ✅ HTML parsing for midmarks
- ✅ Error handling and recovery

### AcademicTG Module (`academicTG.test.ts`)
- ✅ Telegram message formatting
- ✅ Progress bar generation
- ✅ Status emoji selection
- ✅ Subject name truncation
- ✅ Date formatting
- ✅ Error message formatting
- ✅ Attendance table layout
- ✅ Midmarks table layout

### Integration Tests (`academic.integration.test.ts`)
- ✅ Full attendance fetch → format flow
- ✅ Full midmarks fetch → format flow
- ✅ Error recovery with fallback
- ✅ Session expiry and auto-renewal
- ✅ Redis caching flow

## Writing New Tests

### Unit Test Template

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('YourModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should do something', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = yourFunction(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

### Mocking External Dependencies

```typescript
vi.mock('../../src/services/redis/getRedisClient.js', () => ({
  getClient: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
  }),
}));
```

## CI/CD Integration

Tests can be integrated into GitHub Actions:

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
      - run: npm run test:coverage
```

## Troubleshooting

### Tests timing out
Increase timeout in `vitest.config.ts`:
```typescript
export default defineConfig({
  test: {
    testTimeout: 10000,
  },
});
```

### Mock not working
Ensure mock is defined before import:
```typescript
vi.mock('./module'); // Must be before import
import { something } from './module';
```

### Redis connection errors
Tests use mocked Redis client. If you see connection errors, check that mocks are properly set up in `tests/setup.ts`.

## Best Practices

1. **Isolate tests**: Each test should be independent
2. **Clear mocks**: Use `vi.clearAllMocks()` in `beforeEach`
3. **Mock external services**: Don't make real HTTP/Redis calls
4. **Test edge cases**: Empty data, errors, timeouts
5. **Use descriptive names**: Test names should explain what they test
6. **Keep tests fast**: Unit tests should run in milliseconds

## Future Improvements

- [ ] Add E2E tests with real Telegram bot interaction
- [ ] Add performance benchmarks
- [ ] Add mutation testing
- [ ] Add visual regression tests for formatted messages
- [ ] Add load testing for concurrent requests
