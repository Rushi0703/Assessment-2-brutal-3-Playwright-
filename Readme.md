# BRASO PLATS UI Testing Framework

A comprehensive Playwright-based testing framework built with TypeScript for automated UI and API testing, featuring fixtures, utilities, test data management, and integrations with Jira, Xray, Slack, and Teams.

---

## Table of Contents

- [Overview](#project-overview)
- [Base Requirements](#base-requirements)
- [Installation](#installation)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Writing Tests](#writing-tests)
  - [UI Tests](#ui-tests)
  - [API Tests](#api-tests)
- [Available Utilities](#available-utilities)
- [Test Data Management](#test-data-management)
- [Running Tests](#running-tests)
- [Integrations](#integrations)
- [Troubleshooting](#troubleshooting)

---

## Project Overview

BRASO PLATS UI is a scalable testing framework that provides:

- **UI Testing**: Automated browser testing using Playwright
- **API Testing**: REST API testing with built-in request utilities
- **Fixtures**: Pre-built test fixtures for common operations
- **Test Data Management**: Support for multiple data sources (JSON, Database, Faker)
- **Accessibility Testing**: AXE accessibility scans integrated
- **Reporting**: HTML reports with screenshots and traces
- **Integrations**: Slack, Teams, Jira, and Xray integration
- **Logging**: Comprehensive logging with multiple appenders

---

## Base Requirements

### System Requirements
- **Node.js**: v20 or higher
- **npm**: v7 or higher
- **OS**: Windows, macOS, or Linux

### Technologies
- **Playwright**: ^1.59.1 - Browser automation framework
- **TypeScript**: Latest - For type-safe test code
- **PostgreSQL**: (Optional) For database-driven tests

### Browser Support
- Chrome/Chromium (Default configured)
- Firefox (Available but commented out)
- Safari/WebKit (Available but commented out)
- Mobile browsers (Available but commented out)

---

## Installation

### Step 1: Clone or Setup Repository
```bash
git clone https://github.com/brownbox-consulting/BRASO-PLATS-UI.git  && cd BRASO-PLATS-UI
```

### Step 2: Install Dependencies
```bash
npm install
```

This will install:
- `@playwright/test` - Playwright testing framework
- `@types/node` - TypeScript node types
- `@axe-core/playwright` - Accessibility testing
- `pg` - PostgreSQL client (for database tests)
- `@faker-js/faker` - Fake data generation
- `@slack/web-api` - Slack integration
- `dotenv` - Environment variable management

### Step 3: Setup Environment Variables
Create a `.env` file in the project root:

```env
# Base URL Configuration
BASE_URL=https://developer.shell.com

# Database Configuration (Optional)
DB_HOST=localhost
DB_PORT=5432
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_database_name

# Slack Integration (Optional)
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_CHANNEL_ID=C1234567890

# Teams Integration (Optional)
TEAMS_WEBHOOK_URL=https://outlook.webhook.office.com/...

# Jira Integration (Optional)
JIRA_BASE_URL=https://jira.example.com
JIRA_USERNAME=your_username
JIRA_PASSWORD=your_api_token
JIRA_PROJECT_KEY=PROJ

# Xray Integration (Optional)
XRAY_CLIENT_ID=your_client_id
XRAY_CLIENT_SECRET=your_client_secret

# Test Configuration
TC_ID=TC_001
```

### Step 4: Install Playwright Browsers
```bash
npx playwright install
```

---

## Project Structure

```
BRASO-PLATS-UI/
├── tests/                           # Test files
│   ├── TC_*.spec.ts                 # Individual test cases
│   └── ...
├── templates/                       # Test templates
│   ├── UI_TC_Template.spec.ts       # UI test template
│   └── API_TC_Template.spec.ts      # API test template
├── utils/                           # Utility functions
├── testData/                        # Test data files
│   ├── TD_TC_*.json                 # Test data for each test case 
├── reusableComp/                    # Reusable components
│   ├── Login.ts                     # Login component
│   └── Register.ts                  # Register component
├── playwright-report/               # Generated HTML reports
├── test-results/                    # Test execution results
├── logs/                            # Test execution logs
├── playwright.config.ts             # Playwright configuration
├── package.json                     # Project dependencies
├── sonar-project.properties         # SonarQube configuration
└── README.md                        # This file
```

---

## Configuration

### Playwright Configuration (`playwright.config.ts`)

Key configuration settings:

```typescript
// Base URL for all tests
baseURL: 'https://www.google.com'

// Test directory
testDir: './tests'

// Parallel execution
fullyParallel: true

// Retries (CI: 2, Local: 0)
retries: process.env.CI ? 2 : 0

// Workers (CI: 1, Local: Auto)
workers: process.env.CI ? 1 : undefined

// Screenshot capture
screenshot: 'on'

// Trace recording
trace: 'retain-on-failure-and-retries'

// Expect timeout
timeout: 10000

// Browser: Chromium (maximized)
```

### Modifying Playwright Config

To use additional browsers:

```typescript
// Uncomment in playwright.config.ts to enable Firefox
{
  name: 'firefox',
  use: {
    ...devices['Desktop Firefox'],
    launchOptions: {
      args: ['--start-maximized'],
    },
  }
}
```

---

## Writing Tests

### UI Tests

#### Template Location
[UI_TC_Template.spec.ts](templates/UI_TC_Template.spec.ts)

#### Basic Structure

```typescript
import { test, expect } from '../utils/fixtures';
import data from '../testData/TD_TC_001.json';
import { startTest, endTest, runAccessibilityScan, addRuntimeData } from '../utils/utilities';
import dotenv from 'dotenv';

dotenv.config();

test.describe('TC_001 UI TestCase', () => {
  test(`TC_001_runId_1`, async ({ page }, testInfo) => {
    
    // Start test with logging
    const { logs, startTime } = await startTest(testInfo.title, page);
    let status = 'passed';
    let errorMessage: string | undefined;

    try {
      
      // Navigation step
      await test.step('Navigate to URL', async () => {
        await page.goto(process.env.BASE_URL || '/');
      });

      // Test steps
      await test.step('Click on menu', async () => {
        await page.click('selector');
        await expect(page.locator('selector')).toBeVisible();
      });

      // Add custom data to report
      await addRuntimeData('userId', '12345');

    } catch (error: any) {
      status = 'failed';
      errorMessage = error.message;
      throw error;

    } finally {
      await endTest("TC_001_runId_1", logs, startTime, status, testInfo, errorMessage, page);
    }
  });
});
```

#### Advanced Features

**Accessibility Scanning:**
```typescript
await test.step('Scan for accessibility issues', async () => {
  await runAccessibilityScan(page, testInfo.title);
});
```

**Multiple Data Sets:**
```typescript
testData.runs.forEach((data, index) => {
  test(`TC_001_runId_${index + 1}`, async ({ page }, testInfo) => {
    // Test code with data[index]
  });
});
```

### API Tests

#### Template Location
[API_TC_Template.spec.ts](templates/API_TC_Template.spec.ts)

#### Basic Structure

```typescript
import { test } from '../utils/fixtures';
import data from '../testData/TD_TC_001.json';
import { startTest, endTest, addRuntimeData } from '../utils/utilities';
import dotenv from 'dotenv';

dotenv.config();

test.describe('TC_001 API TestCase', () => {
  test(`TC_001_runId_1`, async ({ request }, testInfo) => {
    
    // Start test with logging
    const { logs, startTime } = await startTest("TC_001_runId_1");
    let status = 'passed';
    let errorMessage: string | undefined;

    try {

      let response;

      // GET Request
      await test.step('Get Request', async () => {
        response = await request.get('/api/endpoint');
        expect(response.status()).toBe(200);
      });

      // POST Request
      await test.step('Post Request', async () => {
        response = await request.post('/api/endpoint', {
          data: { key: 'value' }
        });
        expect(response.status()).toBe(201);
        await addRuntimeData('responseId', (await response.json()).id);
      });

      // PUT Request
      await test.step('Put Request', async () => {
        response = await request.put('/api/endpoint/1', {
          data: { key: 'updated_value' }
        });
        expect(response.status()).toBe(200);
      });

      // DELETE Request
      await test.step('Delete Request', async () => {
        response = await request.delete('/api/endpoint/1');
        expect(response.status()).toBe(204);
      });

    } catch (error: any) {
      status = 'failed';
      errorMessage = error.message;
      throw error;

    } finally {
      await endTest("TC_001_runId_1", logs, startTime, status, testInfo, errorMessage);
    }
  });
});
```

---

## Available Utilities

### Core Utilities (`utils/utilities.ts`)

#### Test Lifecycle
- `startTest(testName, page?)` - Initialize test with logging
- `endTest(testName, logs, startTime, status, testInfo, errorMessage?, page?)` - Cleanup and finalize test
- `addRuntimeData(key, value)` - Store runtime data for report attachment
- `fetchRuntimeData(key)` - Retrieve runtime data
- `getAllRuntimeData()` - Get all stored runtime data

#### Test Data Fetching
- `getTestDataFromDB(query, testCaseId)` - Fetch data from PostgreSQL database
- `getTestDataFromFaker(attribute)` - Generate fake data using Faker
- `getTestDataFromJsonFile(filePath)` - Load test data from JSON file

#### Accessibility Testing
- `runAccessibilityScan(page, testName)` - Run AXE accessibility scan

### Fixtures (`utils/fixtures.ts`)

#### Features
- Enhanced expect() with custom logging
- Smart element interactions
- Automatic logging of assertions
- Step counter integration

### Fixtures (`utils/fixtures.ts`)

Standard Playwright API testing with custom fixtures.

### Logging (`utils/logger.ts`)

```typescript
log(level: 'INFO' | 'ERROR' | 'DEBUG' | 'WARN', message: string): Promise<void>
// Log messages with multiple appenders
```

## Test Data Management

### JSON-Based Test Data

Create test data files in `testData/` directory:

```json
// testData/TD_TC_001.json
{
  "username": "testuser@example.com",
  "password": "TestPassword123!",
  "firstName": "John",
  "lastName": "Doe",
  "expectedMessage": "Login successful"
}
```

Load in test:
```typescript
import data from '../testData/TD_TC_001.json';
```

### Database-Driven Tests

```typescript
const result = await getTestDataFromDB(
  'SELECT * FROM users WHERE role = $1',
  'TC_001_runId_1'
);
```

### Faker-Generated Data

```typescript
const fakeData = await getTestDataFromFaker('person.firstName');
const fakeEmail = await getTestDataFromFaker('internet.email');
```

### Multiple Data Set Runs

```typescript
testData.runs.forEach((data, index) => {
  test(`TC_001_runId_${index + 1}`, async ({ page }, testInfo) => {
    // Test with data[index]
  });
});
```

---

## Running Tests

### Run All Tests
```bash
npm run test
# or
npx playwright test
```

### Run Specific Test File
```bash
npx playwright test tests/TC_001.spec.ts
```

### Run Tests with Tag
```bash
npx playwright test --grep @smoke
```

### Run Tests in Debug Mode
```bash
npx playwright test --debug
```

### Run Tests in UI Mode
```bash
npx playwright test --ui
```

### Run Tests in Headed Mode
```bash
npx playwright test --headed
```

### Run Tests in Specific Browser
```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

### Run Single Test Method
```bash
npx playwright test -g "TC_001_runId_1"
```

### Generate Report
```bash
npx playwright show-report
```

### View HTML Report
Open `playwright-report/index.html` in a browser.

---

## Integrations

### Slack Integration
### Teams Integration
### Jira Integration
### Xray Integration

## Troubleshooting

### Issue: Tests Not Running

**Solution:**
```bash
# Clear node_modules and reinstall
rm -r node_modules package-lock.json
npm install
npx playwright install
```

### Issue: Base URL Not Found

**Solution:**
Ensure `.env` file is created with valid `BASE_URL`:
```env
BASE_URL=https://your-app-url.com
```

### Issue: Database Connection Failed

**Solution:**
Verify database credentials in `.env`:
```bash
# Test connection
psql -h localhost -U dbuser -d dbname
```

### Issue: Playwright Browser Not Found

**Solution:**
```bash
# Reinstall browsers
npx playwright install --with-deps
```

### Issue: Slack/Teams Integration Not Working

**Solution:**
- Verify webhook URLs are correct in `.env`
- Check API token permissions
- Test webhook manually using curl:
```bash
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Test message"}' \
  YOUR_WEBHOOK_URL
```

### Issue: Timeout Errors

**Solution:**
Increase timeout in playwright.config.ts:
```typescript
expect: {
  timeout: 15000, // Increase from 10000
},
```

### Issue: Screenshot/Trace Not Captured

**Solution:**
Ensure configuration in `playwright.config.ts`:
```typescript
use: {
  screenshot: 'on',
  trace: 'retain-on-failure-and-retries',
},
```

### Issue: Reusable Components Not Found

**Solution:**
Ensure imports are correct:
```typescript
import { Login } from '../reusableComp/Login';
```

---

## Best Practices

1. **Use Page Objects**: Create reusable components for common UI interactions
2. **Organize Tests**: Group related tests using `test.describe()`
3. **Use Test Data**: Externalize test data into JSON files
4. **Implement Steps**: Use `test.step()` for better reporting
5. **Add Logging**: Use `addRuntimeData()` for debugging
6. **Handle Errors**: Always use try-catch-finally blocks
7. **Accessibility**: Include accessibility scans in critical tests
8. **CI/CD Integration**: Configure for automated execution in pipelines
9. **Report Attachment**: Attach logs and data to test reports
10. **Maintenance**: Keep selectors updated when UI changes

---

## Support & Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright API Reference](https://playwright.dev/docs/api/class-playwright)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [AXE Accessibility](https://www.deque.com/axe/)

---

**Last Updated**: May 12, 2026  
**Version**: 1.0.0