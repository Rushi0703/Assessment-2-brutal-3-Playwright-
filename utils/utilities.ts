import test, { Page, TestInfo } from '@playwright/test';
import { generateAggregateA11yHtmlReport } from './convert_axe_report_into_html';
import { AxeBuilder } from '@axe-core/playwright';
import path from 'path';
import fs from 'fs';
import { log } from './logger';
import dotenv from 'dotenv';
import { sendTeamsMessage } from './post_teams_message';
import { sendSlackMessage } from './post_slack_message';
import { reportFailureToJira, TestFailureContext } from './jira_Integration';
import { createXrayTestExecutionIfNotExists } from './xray_Integration';
import { executeQuery } from '../utils/databaseUtils';
import { el, faker } from '@faker-js/faker';

dotenv.config();

let runTimeData: Record<string, any> = {};
let globalRunTimeData: Record<string, any> = {};

/**
 * Accumulates all test data sourced during a test run (from JSON files, DB queries,
 * or Faker). Data is grouped by source type, with each source containing an array
 * of entries with their keys and values. Cleared at the start of each test via `startTest`
 * and attached to the report as `test-data.json` in `endTest`.
 */
let testDataAccumulator: Record<string, Array<{ key: string; data: any }>> = {};


// ============================================================================
// Runtime Data Utilities
// ============================================================================

/**
 * Adds or updates a key-value pair in the runtime data store.
 * Call this from your tests to capture dynamic data (e.g. generated IDs,
 * API responses, form values) that you want attached to the report.
 *
 * @param key   - A unique string key to identify the data entry.
 * @param value - Any serialisable value to store against that key.
 *
 * @example
 * addRuntimeData('createdUserId', response.id);
 * addRuntimeData('loginTimestamp', new Date().toISOString());
 */
export async function addRuntimeData(key: string, value: any, isGlobal?: boolean): Promise<void> {
  if (isGlobal) globalRunTimeData[key] = value;
  else runTimeData[key] = value;
  await log('INFO', '============================================================================');
  if (isGlobal) await log('INFO', `[GLOBAL RUNTIME DATA] Added key: "${key}" with value: ${JSON.stringify(value)}`);
  else await log('INFO', `[RUNTIME DATA] Added key: "${key}" with value: ${JSON.stringify(value)}`);
  await log('INFO', '============================================================================');
}

/**
 * Retrieves a single value from the runtime data store by key.
 *
 * @param key - The key of the data entry to retrieve.
 * @returns The stored value, or `undefined` if the key does not exist.
 *
 * @example
 * const userId = fetchRuntimeData('createdUserId');
 */
export async function fetchRuntimeData(key: string, isGlobal?: boolean): Promise<any> {
  const value = isGlobal ? globalRunTimeData[key] : runTimeData[key]; 
  await log('INFO', '============================================================================');
  if (isGlobal) await log('INFO', `[GLOBAL RUNTIME DATA] Fetched key: "${key}" with value: ${JSON.stringify(value)}`);
  else await log('INFO', `[RUNTIME DATA] Fetched key: "${key}" with value: ${JSON.stringify(value)}`);
  await log('INFO', '============================================================================');
  return value;
}

/**
 * Returns a shallow copy of the entire runtime data map.
 * Useful for debugging or when you need to inspect all captured data at once.
 *
 * @returns A copy of all currently stored runtime data entries.
 *
 * @example
 * const allData = getAllRuntimeData();
 * console.log(JSON.stringify(allData, null, 2));
 */
export async function getAllRuntimeData(): Promise<Record<string, any>> {
  const allData = { ...runTimeData, ...globalRunTimeData };
  await log('INFO', '============================================================================');
  await log('INFO', `[RUNTIME DATA] Retrieved all runtime data entries (${Object.keys(allData).length} entries)`);
  await log('INFO', '============================================================================');
  return allData;
}

/**
 * Removes a single entry from the runtime data store by key.
 *
 * @param key - The key of the data entry to remove.
 *
 * @example
 * removeRuntimeData('temporaryToken');
 */
export async function removeRuntimeData(key: string, isGlobal?: boolean): Promise<void> {

  const removedValue = isGlobal ? globalRunTimeData[key] : runTimeData[key];
  delete runTimeData[key];
  await log('INFO', '============================================================================');
  if (isGlobal) await log('INFO', `[GLOBAL RUNTIME DATA] Removed key: "${key}" with value: ${JSON.stringify(removedValue)}`);
  else await log('INFO', `[RUNTIME DATA] Removed key: "${key}" with value: ${JSON.stringify(removedValue)}`);
  await log('INFO', '============================================================================');
}

/**
 * Clears all entries from the runtime data store.
 * This is called automatically at the start of each test via `startTest`.
 */
export async function clearRuntimeData(isGlobal?: boolean): Promise<void> {
  if (isGlobal) globalRunTimeData = {};
  else runTimeData = {};
}

/**
 * Attaches the current runtime data store as a JSON file to the Playwright
 * test result. Called automatically by `endTest`.
 *
 * @param testInfo - The Playwright TestInfo object used to attach the report.
 */
async function attachRuntimeDataReport(testInfo: TestInfo): Promise<void> {
  const runtimeDataExists = Object.keys(runTimeData).length !== 0;
  const globalDataExists = Object.keys(globalRunTimeData).length !== 0;

  if (runtimeDataExists || globalDataExists) {
    await log('INFO', '============================================================================');
    await log('INFO', `[RUNTIME DATA] Attaching runtime data report with ${runtimeDataExists ? Object.keys(runTimeData).length : 0} runtime entries and ${globalDataExists ? Object.keys(globalRunTimeData).length : 0} global entries`);

    const combinedData: Record<string, unknown> = {};
    if (runtimeDataExists) combinedData.runtime = runTimeData;
    if (globalDataExists) combinedData.global = globalRunTimeData;

    await testInfo.attach('runtime-data.json', {
      body: Buffer.from(JSON.stringify(combinedData, null, 2), 'utf-8'),
      contentType: 'application/json',
    });

    await log('INFO', '[RUNTIME DATA] Runtime data report attached successfully');
    await log('INFO', '============================================================================');
  }
}


// ============================================================================
// Test Data Utilities
// ============================================================================

/**
 * Reads and parses a JSON file from the given filepath and returns its contents.
 * The parsed data is recorded in the test data accumulator so it is included in
 * the `test-data.json` report attachment produced by `endTest`.
 *
 * @param filepath - Absolute or relative path to the JSON file.
 * @returns The parsed contents of the JSON file.
 * @throws If the file does not exist or cannot be parsed as JSON.
 *
 * @example
 * const data = getTestDataFromJsonFile('./test-data/users.json');
 * const email = data.users[0].email;
 */
export async function getTestDataFromJsonFile<T = any>(filepath: string): Promise<T> {
  await log('INFO', '============================================================================');
  await log('INFO', `[TEST DATA] Loading test data from JSON file: ${filepath}`);

  const resolvedPath = path.resolve(filepath);

  if (!fs.existsSync(resolvedPath)) {
    await log('INFO', `[TEST DATA] ERROR: Test data file not found at ${resolvedPath}`);
    await log('INFO', '============================================================================');
    throw new Error(`Test data file not found: ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed: T = JSON.parse(raw);

  await addToTestDataAccumulator('json-file', resolvedPath, parsed);

  const totalEntries = Object.values(testDataAccumulator).reduce((sum, arr) => sum + arr.length, 0);
  await log('INFO', `[TEST DATA] Successfully loaded test data from JSON file (${totalEntries} entries in accumulator)`);
  await log('INFO', '============================================================================');

  return parsed;
}

/**
 * Executes a SQL query against the configured PostgreSQL database and returns
 * the result rows. Delegates to the shared `executeQuery` utility and records
 * the query and its results in the test data accumulator so they are included
 * in the `test-data.json` report attachment produced by `endTest`.
 *
 * @param query      - The SQL query string to execute.
 * @param testcaseId - The test case ID used for logging inside `executeQuery`.
 * @returns An array of row objects returned by the query.
 * @throws If the query fails or the database connection cannot be established.
 *
 * @example
 * const rows = await getTestDataFromDB('SELECT * FROM users WHERE active = true', 'TC_001');
 * const email = rows[0].email;
 */
export async function getTestDataFromDB<T = any>(query: string, testcaseId: string): Promise<T[]> {
  await log('INFO', '============================================================================');
  await log('INFO', `[TEST DATA] Executing database query for test case: ${testcaseId}`);
  await log('INFO', `Query: ${query}`);

  const rows = await executeQuery(query, testcaseId);

  await addToTestDataAccumulator('database', query, rows);

  const totalEntries = Object.values(testDataAccumulator).reduce((sum, arr) => sum + arr.length, 0);
  await log('INFO', `[TEST DATA] Database query completed successfully, ${totalEntries} entries in accumulator)`);
  await log('INFO', '============================================================================');

  return rows as unknown as T[];
}

/**
 * Generates a fake value using `@faker-js/faker` for the given dot-notation key
 * and records it in the test data accumulator so it is included in the
 * `test-data.json` report attachment produced by `endTest`.
 *
 * The key mirrors the faker API path exactly, e.g.:
 *   - `"person.fullName"`     → `faker.person.fullName()`
 *   - `"internet.email"`      → `faker.internet.email()`
 *   - `"phone.number"`        → `faker.phone.number()`
 *   - `"location.city"`       → `faker.location.city()`
 *   - `"string.uuid"`         → `faker.string.uuid()`
 *
 * @param key - Dot-notation path into the faker API (e.g. `"person.fullName"`).
 * @returns The generated fake value.
 * @throws If the key does not resolve to a callable faker function.
 *
 * @example
 * const fullName  = getTestDataFromFaker('person.fullName');
 * const email     = getTestDataFromFaker('internet.email');
 * const city      = getTestDataFromFaker('location.city');
 */
export async function getTestDataFromFaker<T = any>(key: string): Promise<T> {
  await log('INFO', '============================================================================');
  await log('INFO', `[TEST DATA] Generating fake data using faker key: "${key}"`);

  const parts = key.split('.');

  if (parts.length !== 2) {
    await log('INFO', `[TEST DATA] ERROR: Invalid faker key "${key}". Expected format: "namespace.method"`);
    await log('INFO', '============================================================================');
    throw new Error(
      `Invalid faker key "${key}". Expected format: "namespace.method" (e.g. "person.fullName")`
    );
  }

  const [namespace, method] = parts;
  const ns = (faker as any)[namespace];

  if (!ns) {
    await log('INFO', `[TEST DATA] ERROR: faker namespace "${namespace}" does not exist`);
    await log('INFO', '============================================================================');
    throw new Error(`faker namespace "${namespace}" does not exist.`);
  }

  const fn = ns[method];

  if (typeof fn !== 'function') {
    await log('INFO', `[TEST DATA] ERROR: faker.${namespace}.${method} is not a function`);
    await log('INFO', '============================================================================');
    throw new Error(`faker.${namespace}.${method} is not a function.`);
  }

  const generated: T = fn.call(ns);

  await addToTestDataAccumulator('faker', key, generated);

  const totalEntries = Object.values(testDataAccumulator).reduce((sum, arr) => sum + arr.length, 0);
  await log('INFO', `[TEST DATA] Fake data generated successfully: ${JSON.stringify(generated)} (${totalEntries} entries in accumulator)`);
  await log('INFO', '============================================================================');

  return generated;
}

/**
 * Adds an entry to the test data accumulator, avoiding duplicates.
 * If an entry with the same source and key already exists, it is not added again.
 * This prevents duplicate data entries when the same data source is queried multiple times.
 *
 * @param source - The data source type ('json-file', 'database', 'faker').
 * @param key    - The identifier for the data (file path, SQL query, or faker key).
 * @param data   - The actual data value to store.
 */
async function addToTestDataAccumulator(source: string, key: string, data: any): Promise<void> {
  // Initialize source array if it doesn't exist
  if (!testDataAccumulator[source]) {
    testDataAccumulator[source] = [];
  }

  // Check if this key already exists in the source array
  const isDuplicate = testDataAccumulator[source].some(entry => entry.key === key);

  if (!isDuplicate) {
    testDataAccumulator[source].push({ key, data });
    await log('INFO', `[TEST DATA] Added entry to accumulator (source: ${source}, key: ${key})`);
  } else {
    await log('INFO', `[TEST DATA] Skipped duplicate entry (source: ${source}, key: ${key})`);
  }
}

/**
 * Attaches the test data accumulator as a JSON file to the Playwright test result.
 * Called automatically by `endTest`. Skips attachment if nothing was collected.
 *
 * @param testInfo - The Playwright TestInfo object used to attach the report.
 */
async function attachTestDataReport(testInfo: TestInfo): Promise<void> {
  
  const totalEntries = Object.values(testDataAccumulator).reduce((sum, arr) => sum + arr.length, 0);
  
  if (totalEntries === 0) {
    return;
  }
  
  await log('INFO', '============================================================================');
  await log('INFO', `[TEST DATA] Attaching test data report with ${totalEntries} entries across ${Object.keys(testDataAccumulator).length} sources`);

  await testInfo.attach('test-data.json', {
    body: Buffer.from(JSON.stringify(testDataAccumulator, null, 2), 'utf-8'),
    contentType: 'application/json',
  });

  await log('INFO', '[TEST DATA] Test data report attached successfully');
  await log('INFO', '============================================================================');
}


// ============================================================================
// Accessibility
// ============================================================================

/**
 * Runs an accessibility scan on the provided page using axe-core, generates an HTML report,
 * and attaches it to the test results.
 *
 * @param page - The Playwright page object to perform the accessibility scan on.
 * @param testcase_id - The ID of the test case to include in the logging.
 * @param step_no - The step number of the test case to include in the logging.
 *
 * This function uses axe-core to analyze the page for accessibility violations,
 * generates an aggregated HTML report of the results, and attaches the report as an
 * HTML file to the test's information. The scan includes iframe contents, waits for
 * frames to load, and ensures element references are absolute paths.
 *
 * The function logs the start and end of the accessibility scan, as well as the
 * number of violations found. It also logs the duration of the scan in milliseconds.
 * If the scan fails, it logs the error message.
 */
export async function runAccessibilityScan(page: Page, testcase_id: string): Promise<void> {
  const scanStart = Date.now();
  let status = false;

  try {
    await log("INFO", "============================================================================");
    await log("INFO", `TC_ID = ${testcase_id} | Starting accessibility scan`);

    const accessibilityScanResults = await new AxeBuilder({ page })
      .options({
        resultTypes: ['violations'],
        iframes: true,
        frameWaitTime: 200,
        absolutePaths: true,
        elementRef: true
      })
      .analyze();

    await log(
      "INFO",
      `TC_ID = ${testcase_id} | Accessibility scan completed. Violations found: ${accessibilityScanResults.violations.length}`
    );

    const htmlReport = await generateAggregateA11yHtmlReport([
      {
        url: page.url(),
        results: {
          timestamp: new Date().toISOString(),
          violations: accessibilityScanResults.violations,
          title: await page.title()
        },
      }
    ]);

    await log(
      "INFO",
      `TC_ID = ${testcase_id} | HTML report generated with ${accessibilityScanResults.violations.length} violations.`
    );
    test.step('Attach Accessibility Report', async () => {
      await test.info().attachments.push({
        name: 'Accessibility Report',
        contentType: 'text/html',
        body: Buffer.from(htmlReport, 'utf-8'),
      });
    });

    status = true;

  } catch (error) {
    await log("ERROR", `TC_ID = ${testcase_id} | Accessibility scan failed: ${error}`);
    status = false;
  } finally {
    const duration = Date.now() - scanStart;

    await log(
      "INFO",
      `TC_ID = ${testcase_id} | Execution of Accessibility Scan completed in ${duration} ms with status ${status}`
    );
    await log("INFO", "============================================================================");
  }
}

// ============================================================================
// Browser Logs
// ============================================================================

/**
 * Starts capturing browser logs for the provided page, including console
 * output, page errors, requests, responses, and request failures. The
 * returned array of strings will contain all the captured log messages.
 * 
 * @param page - The page to capture logs for.
 * @returns An array of strings containing all the captured log messages.
 */
export function startBrowserLogCapture(page: Page): string[] {
  const logs: string[] = [];

  page.on('console', msg => logs.push(`[console][${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[pageerror] ${err.message}`));
  page.on('request', req => logs.push(`[request] ${req.url()}`));
  page.on('response', res => logs.push(`[response] ${res.url()}`));
  page.on('requestfailed', req => logs.push(`[requestfailed] ${req.url()}`));

  return logs;
}

/**
 * Attaches the provided browser logs to the test result as a plain text file named 'browser-logs.txt'.
 * @param logs - The array of strings containing the browser logs to attach.
 * @param testInfo - The test information to attach the logs to.
 */
export async function attachBrowserLogs(logs: string[], testInfo: TestInfo) {
  await testInfo.attach('browser-logs.txt', {
    body: logs.join('\n'),
    contentType: 'text/plain',
  });
}


// ============================================================================
// Screenshots
// ============================================================================

/**
 * Takes a screenshot of the current page and attaches it to the test result.
 * @param page - The page to take a screenshot of.
 * @param testInfo - The test information to attach the screenshot to.
 * @param screenshotName - The name of the screenshot to save as.
 */
export async function takeScreenshot(page: Page, testInfo: TestInfo, screenshotName: string): Promise<void> {
  const screenshot = await page.screenshot();
  await testInfo.attach(screenshotName, {
    body: screenshot,
    contentType: 'image/png',
  });
}

/**
 * Takes a screenshot of the element with the given selector and attaches it to the test result.
 * If the element is not found, a warning message is logged but the test is not failed.
 * @param page - The page to take a screenshot of.
 * @param testInfo - The test information to attach the screenshot to.
 * @param selector - The selector for the element to take a screenshot of.
 * @param screenshotName - The name of the screenshot to save as.
 */
export async function takePartialScreenshot(page: Page, testInfo: TestInfo, selector: string, screenshotName: string): Promise<void> {
  const element = await page.$(selector);
  if (element) {
    const screenshot = await element.screenshot();
    await testInfo.attach(screenshotName, {
      body: screenshot,
      contentType: 'image/png',
    });
  } else {
    console.warn(`Element with selector "${selector}" not found for screenshot.`);
  }
}


// ============================================================================
// Project Utilities
// ============================================================================

/**
 * Recursively traverse the given directory to find the project root.
 * @param {string} currentDir the current directory to traverse
 * @returns {string} the project root directory
 * @throws {Error} if the project root is not found
 */
export function get_project_dir(currentDir: string): string {
  const parentDir = path.dirname(currentDir);
  const packageJsonPath = path.join(currentDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    return currentDir;
  } else if (parentDir === currentDir) {
    throw new Error('Project root not found');
  } else {
    return get_project_dir(parentDir);
  }
}


// ============================================================================
// Test Lifecycle
// ============================================================================

/**
 * Starts the test by resetting the runtime data store, initialising browser
 * log capture, and sending start notifications.
 *
 * @param testcaseId - The ID of the test case.
 * @param page - Optional Playwright page for browser log capture.
 * @returns An object containing the logs array and start time.
 */
export async function startTest(testcaseId: string, page?: Page): Promise<{ logs: string[], startTime: number }> {
  const startTime = Date.now();

  clearRuntimeData();

  await log('INFO', '============================================================================');
  await log('INFO', '                             TESTCASE  STARTED                              ');
  await log('INFO', '============================================================================');

  let logs: string[] = [];

  try {
    if (page && process.env.ATTACH_BROWSER_LOGS === 'true') {
      logs = startBrowserLogCapture(page);
    }
  } catch (error) {
    console.error(`Error in startTest: ${error}`);
  }

  return { logs, startTime };
}

/**
 * Ends the test by attaching browser logs, attaching the runtime data report,
 * sending end notifications, and reporting failures if applicable.
 *
 * @param testcaseId  - The ID of the test case.
 * @param logs        - The browser logs array captured via `startBrowserLogCapture`.
 * @param startTime   - The start time returned by `startTest`.
 * @param status      - The status of the test ('passed' or 'failed').
 * @param errorMessage - Optional error message if the test failed.
 * @param testInfo    - Optional TestInfo for attaching logs and reporting.
 * @param page        - Optional Playwright page.
 */
export async function endTest(testcaseId: string, logs: string[], startTime: number, status: any, testInfo: TestInfo, errorMessage?: string, page?: Page): Promise<void> {
  const endTime = Date.now();

  try {
    if (testInfo && logs.length > 0 && process.env.ATTACH_BROWSER_LOGS === 'true') {
      await attachBrowserLogs(logs, testInfo);
    }

    if (testInfo) {
      await attachRuntimeDataReport(testInfo);
      await attachTestDataReport(testInfo);
    }

    if (process.env.SEND_TEAMS_MESSAGE === 'true') {
      await sendTeamsMessage(testcaseId, startTime, endTime, status, errorMessage);
    }

    if (process.env.SEND_SLACK_MESSAGE === 'true') {
      await sendSlackMessage(testcaseId, startTime, endTime, status, errorMessage);
    }

    if (testInfo && status === 'failed') {
      if (process.env.REPORT_TO_JIRA === 'true' && testInfo && errorMessage) {
        await reportFailureToJira(testInfo, new Error(errorMessage));
      }

      if (process.env.REPORT_TO_XRAY === 'true' && testInfo) {
        const ctx: TestFailureContext = {
          testTitle: testInfo.title,
          testFile: testInfo.file,
          errorMessage: errorMessage || 'Unknown error',
          status: status,
          tcId: testcaseId
        };
        const aiBugSummary = `Test failure: ${testcaseId}`;
        await createXrayTestExecutionIfNotExists(ctx, aiBugSummary);
      }
    }
  } catch (error) {
    console.error(`Error in endTest: ${error}`);
  } finally {
    testDataAccumulator = {};

    await log('INFO', '============================================================================');
    await log('INFO', '                             TESTCASE ENDED                                 ');
    await log('INFO', '============================================================================');
  }
}