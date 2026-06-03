import { test, expect } from '../utils/fixtures';
import data from '../testData/TD_TC_001.json';
import { startTest, endTest, runAccessibilityScan, addRuntimeData, fetchRuntimeData, getTestDataFromDB, getTestDataFromFaker, getTestDataFromJsonFile } from '../utils/utilities';
import dotenv from 'dotenv';
dotenv.config();

test.describe('TC_001 UI TestCase Template', () => {

  // Use following code to run testcase for multiple data sets
  // testData.runs.forEach((data, index) => {
  // test(`TC_001_runId_${index + 1}`, async ({ page }) => {

  // Use following code to Fetch test data from different sources
  // const data = getTestDataFromDB('select * from users', 'TC_001_runId_1');
  // const data = getTestDataFromFaker('person.firstName');
  // const data = getTestDataFromJsonFile('./testData/TD_TC_001.json');

  test(`TC_001_runId_1`, async ({ page }, testInfo) => {

    // add runtime data 
    // await addRuntimeData(testInfo.title, data);

    // Start the test
    const { logs, startTime } = await startTest(testInfo.title, page);

    let status = 'passed';
    let errorMessage: string | undefined;

    try {

      await test.step('Navigate to URL', async () => {
        await page.goto(process.env.BASE_URL || '/');

        // run accessibility scan for the current page
        // await runAccessibilityScan(page, testInfo.title);
      });

      await test.step(`Click on menu`, async () => {
        // Add steps from here 
      });

    } catch (error: any) {
      status = 'failed';
      errorMessage = error.message;
      throw error;

    } finally {
      await endTest("TC_001_runId_1", logs, startTime, status, testInfo, errorMessage, page);
    }

    // });

  });

});