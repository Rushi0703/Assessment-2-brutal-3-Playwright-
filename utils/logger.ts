import fs from 'fs';
import path from 'path';
import { TestInfo } from '@playwright/test';

// Helper function to get formatted current time string
function getFormattedTime(): string {
  const date = new Date();
  return new Intl.DateTimeFormat(['ban', 'id'], {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}


/**
 * Logs a message with the specified level to a daily log file.
 * 
 * @param level - The severity level of the log message. Can be 'INFO', 'ERROR', 'WARN', or 'DEBUG'.
 * @param message - The message to log.
 * 
 * The log file is named with the current date in the format `execution_logs_YYYY_MM_DD.log`
 * and is stored in the `logs` directory relative to the current file. Each log entry includes
 * the formatted time, log level, and message.
 */
export async function log(level: 'INFO' | 'ERROR' | 'WARN' | 'DEBUG', message: string): Promise<void> {
  // Construct the log file name based on the current date
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const logFileName = `execution_logs_${year}_${month}_${day}.log`;

  // Ensure the log directory exists
  const logDirPath = await path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logDirPath)) {
    await fs.promises.mkdir(logDirPath);
  }

  // Construct the log file path and message
  const logFilePath = path.join(logDirPath, logFileName);
  const logMessage = `${getFormattedTime()} ${level} ${message}\n`;

  // Log to console and allure report
  await console.log(logMessage);

  // Log to file
  await fs.promises.appendFile(logFilePath, logMessage, 'utf-8');
}


/**
 * Asserts that a condition is true, and logs an error with the given message and
 * attaches it to the test result if it is not.
 * @param condition - The condition to assert.
 * @param message - The message to log and attach if the condition is false.
 * @param testInfo - The test information for the current test. If provided, the
 *     message will be attached to the test result.
 */
export async function assertCondition(condition: boolean, message: string, testInfo?: TestInfo ): Promise<void> {
  if (!condition) {
    await log('ERROR', message);
    // Log the error message to the console and attach it to allure report
    console.error(message);
    if (testInfo?.attach) {
      await testInfo.attach('Assertion Failure', {
        body: message,
        contentType: 'text/plain',
      });
    }
    throw new Error(message);
  }
}