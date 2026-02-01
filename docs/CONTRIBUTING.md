# Contributing to NbkristQik

Thank you for considering contributing to NbkristQik! 🎉

This document provides guidelines and instructions for contributing to the project.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Workflow](#development-workflow)
4. [Coding Standards](#coding-standards)
5. [Commit Guidelines](#commit-guidelines)
6. [Pull Request Process](#pull-request-process)
7. [Issue Guidelines](#issue-guidelines)
8. [Testing](#testing)
9. [Documentation](#documentation)

---

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors, regardless of:
- Experience level
- Gender identity and expression
- Sexual orientation
- Disability
- Personal appearance
- Body size
- Race
- Ethnicity
- Age
- Religion
- Nationality

### Expected Behavior

- **Be respectful** and considerate in your communication
- **Be collaborative** and open to feedback
- **Be inclusive** and welcoming to newcomers
- **Focus on what's best** for the project and community
- **Give and receive constructive criticism** gracefully

### Unacceptable Behavior

- Harassment, trolling, or discriminatory language
- Personal attacks or insults
- Publishing others' private information
- Spamming or off-topic discussions
- Any conduct that could reasonably be considered inappropriate

### Enforcement

Violations of the Code of Conduct may result in:
1. Warning from maintainers
2. Temporary ban from the repository
3. Permanent ban from the project

Report violations to: **@tobioffice** on Telegram

---

## Getting Started

### Prerequisites

Before you begin, ensure you have:

- **Node.js** v20.x or higher
- **pnpm** (preferred) or npm
- **Git**
- **Code editor** (VS Code recommended)
- **Telegram account** (for testing bot)

### Fork and Clone

1. **Fork the repository:**
   - Visit https://github.com/tobioffice/NbkristQik
   - Click "Fork" in the top-right corner

2. **Clone your fork:**
```bash
git clone https://github.com/YOUR_USERNAME/NbkristQik.git
cd NbkristQik
```

3. **Add upstream remote:**
```bash
git remote add upstream https://github.com/tobioffice/NbkristQik.git
```

4. **Verify remotes:**
```bash
git remote -v
# origin    https://github.com/YOUR_USERNAME/NbkristQik.git (fetch)
# origin    https://github.com/YOUR_USERNAME/NbkristQik.git (push)
# upstream  https://github.com/tobioffice/NbkristQik.git (fetch)
# upstream  https://github.com/tobioffice/NbkristQik.git (push)
```

### Development Setup

1. **Install dependencies:**
```bash
pnpm install
```

2. **Copy environment template:**
```bash
cp .env.example .env
```

3. **Configure environment variables:**
```bash
# Required for local development
TELEGRAM_BOT_TOKEN=your_test_bot_token
TURSO_DATABASE_URL=your_test_db_url
TURSO_AUTH_TOKEN=your_test_auth_token
N_USERNAME=test_username
N_PASSWORD=test_password
ADMIN_ID=your_telegram_user_id
```

**⚠️ Important:** Use a **test bot** and **test database** for development, not production credentials!

4. **Run in development mode:**
```bash
pnpm dev
```

5. **Verify setup:**
   - Send `/start` to your test bot
   - Bot should respond with welcome message

---

## Development Workflow

### Creating a New Branch

Always create a feature branch for your changes:

```bash
# Update your local main branch
git checkout main
git pull upstream main

# Create a new feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/bug-description
```

### Branch Naming Convention

Use descriptive branch names with prefixes:

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions or changes
- `chore/` - Maintenance tasks

**Examples:**
```
feature/add-notification-system
fix/attendance-calculation-error
docs/update-api-documentation
refactor/simplify-error-handling
test/add-academic-service-tests
chore/update-dependencies
```

### Making Changes

1. **Make your changes** in the feature branch

2. **Test locally:**
```bash
pnpm test
pnpm lint
pnpm build
```

3. **Commit your changes:**
```bash
git add .
git commit -m "feat: add notification system"
```

4. **Push to your fork:**
```bash
git push origin feature/your-feature-name
```

5. **Keep your branch updated:**
```bash
git fetch upstream
git rebase upstream/main
```

---

## Coding Standards

### TypeScript Guidelines

**✅ Do:**
```typescript
// Use explicit types
function getStudent(rollno: string): Promise<Student> {
  return studentModel.getStudent(rollno);
}

// Use interfaces for complex types
interface AttendanceData {
  percentage: number;
  attended: number;
  total: number;
}

// Use async/await over promises
async function fetchData() {
  try {
    const data = await api.fetch();
    return data;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

// Use descriptive variable names
const attendancePercentage = calculatePercentage(attended, total);
```

**❌ Don't:**
```typescript
// Avoid 'any' type
function process(data: any) { }

// Avoid complex nested callbacks
getData((err, data) => {
  processData(data, (err, result) => {
    saveResult(result, (err) => { });
  });
});

// Avoid unclear variable names
const x = calc(a, b);
```

### Code Style

- **Indentation:** 2 spaces
- **Quotes:** Single quotes for strings (`'hello'`)
- **Semicolons:** Yes, always
- **Line length:** Max 100 characters
- **Trailing commas:** Yes, in multiline arrays/objects

### Formatting

We use **Prettier** for consistent formatting:

```bash
# Format code
pnpm format

# Check formatting
pnpm format:check
```

**Prettier config (`.prettierrc`):**
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "arrowParens": "avoid"
}
```

### Linting

We use **ESLint** for code quality:

```bash
# Run linter
pnpm lint

# Auto-fix issues
pnpm lint:fix
```

---

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, whitespace)
- `refactor:` - Code refactoring (no functionality change)
- `perf:` - Performance improvements
- `test:` - Test additions or changes
- `chore:` - Maintenance tasks (deps, build, etc.)
- `ci:` - CI/CD changes

### Examples

**Good commits:**
```bash
feat(bot): add notification system for attendance drops

- Implement NotificationService class
- Add threshold configuration
- Send alerts when attendance < 75%

Closes #42

fix(scraper): handle session timeout correctly

- Detect expired session by checking response HTML
- Automatically renew session when expired
- Add retry logic for failed requests

Fixes #56

docs(api): document leaderboard endpoint parameters

- Add query parameter descriptions
- Include request/response examples
- Document error codes

refactor(services): simplify error handling logic

- Extract error mapping to separate function
- Reduce code duplication
- Improve readability
```

**Bad commits:**
```bash
# Too vague
fix: bug fix

# Missing type
added new feature

# Not descriptive
update code
```

### Commit Best Practices

- **One logical change per commit**
- **Write clear, descriptive messages**
- **Use imperative mood** ("add", not "added")
- **Reference issues** when applicable (#123)
- **Keep subject under 50 characters**
- **Wrap body at 72 characters**

---

## Pull Request Process

### Before Submitting

1. **Sync with upstream:**
```bash
git fetch upstream
git rebase upstream/main
```

2. **Run all checks:**
```bash
pnpm lint
pnpm test
pnpm build
```

3. **Update documentation** if needed

4. **Add/update tests** for new features

### Creating a Pull Request

1. **Push your branch:**
```bash
git push origin feature/your-feature-name
```

2. **Open PR on GitHub:**
   - Go to your fork on GitHub
   - Click "Compare & pull request"
   - Fill out the PR template

3. **PR Title Format:**
```
<type>: <description> (Closes #issue)
```

**Examples:**
```
feat: Add notification system for attendance drops (Closes #42)
fix: Handle session timeout correctly (Fixes #56)
docs: Update API documentation (Closes #12)
```

### PR Description Template

```markdown
## Summary
Brief description of the changes

## Changes Made
- List of specific changes
- Include technical details
- Mention any breaking changes

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed
- [ ] All tests passing

## Screenshots (if applicable)
Add screenshots or GIFs demonstrating the changes

## Related Issues
Closes #123
Relates to #456

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings introduced
- [ ] Tests added/updated
- [ ] All tests passing
```

### Review Process

1. **Automated checks** will run:
   - Linting
   - Tests
   - Build

2. **Maintainer review:**
   - Code quality
   - Functionality
   - Documentation
   - Test coverage

3. **Address feedback:**
   - Make requested changes
   - Push new commits
   - Request re-review

4. **Merge:**
   - Maintainer will merge once approved
   - Your branch will be deleted automatically

### After Merge

1. **Update your local repository:**
```bash
git checkout main
git pull upstream main
```

2. **Delete your feature branch:**
```bash
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
```

---

## Issue Guidelines

### Creating Issues

Use the appropriate issue template:

**Bug Report:**
```markdown
**Describe the bug**
Clear description of the bug

**To Reproduce**
Steps to reproduce:
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What should happen

**Screenshots**
If applicable

**Environment:**
- OS: [e.g., Ubuntu 22.04]
- Node.js version: [e.g., 20.11.0]
- Bot version: [e.g., 1.2.0]

**Additional context**
Any other relevant information
```

**Feature Request:**
```markdown
**Is your feature request related to a problem?**
Clear description of the problem

**Describe the solution**
What you want to happen

**Describe alternatives**
Other solutions you've considered

**Additional context**
Any other relevant information
```

### Issue Labels

We use labels to categorize issues:

- `bug` - Something isn't working
- `enhancement` - New feature or improvement
- `documentation` - Documentation improvements
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention needed
- `priority: high` - High priority
- `priority: low` - Low priority
- `status: in progress` - Being worked on
- `status: blocked` - Blocked by something

---

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test tests/unit/academic.test.ts

# Run tests in watch mode
pnpm test:watch

# Generate coverage report
pnpm test:coverage
```

### Writing Tests

We use **Vitest** for testing.

**Example unit test:**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { Academic } from '../src/services/student.utils/Academic';

describe('Academic Service', () => {
  it('should fetch attendance data', async () => {
    const academic = new Academic('21B81A05E9');
    const attendance = await academic.getAttendanceJSON();
    
    expect(attendance).toBeDefined();
    expect(attendance.percentage).toBeGreaterThan(0);
  });

  it('should handle invalid roll number', async () => {
    const academic = new Academic('INVALID');
    
    await expect(academic.getAttendanceJSON())
      .rejects
      .toThrow('Student not found');
  });
});
```

**Example integration test:**
```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/api/server';

describe('Leaderboard API', () => {
  it('should return leaderboard data', async () => {
    const response = await request(app)
      .get('/api/leaderboard')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeInstanceOf(Array);
  });
});
```

### Test Coverage

Aim for:
- **Unit tests:** > 80% coverage
- **Integration tests:** Key user flows
- **Critical paths:** 100% coverage

---

## Documentation

### When to Update Documentation

- **New features:** Add usage instructions
- **API changes:** Update API.md
- **Breaking changes:** Update README.md and migration guide
- **Bug fixes:** Update if behavior changes

### Documentation Files

- `README.md` - Project overview, quick start
- `docs/ARCHITECTURE.md` - System architecture
- `docs/API.md` - REST API documentation
- `docs/DATABASE.md` - Database schema
- `docs/DEPLOYMENT.md` - Deployment guide
- `docs/CONTRIBUTING.md` - This file

### Documentation Style

- **Be clear and concise**
- **Use examples** liberally
- **Include code snippets**
- **Add diagrams** for complex concepts
- **Keep it up-to-date**

---

## Recognition

Contributors are recognized in:

- `README.md` - Contributors section
- GitHub Contributors page
- Release notes (for significant contributions)

---

## Questions?

If you have questions:

- **GitHub Discussions:** Start a discussion
- **Issues:** Create an issue with `question` label
- **Telegram:** Message @tobioffice
- **Email:** Check package.json for contact info

---

## Thank You! 🙏

Your contributions make NbkristQik better for everyone. We appreciate your time and effort!

**Happy coding!** 🚀

---

*Last Updated: February 1, 2026*
