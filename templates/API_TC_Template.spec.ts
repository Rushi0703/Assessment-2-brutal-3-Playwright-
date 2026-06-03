import { test } from '../utils/fixtures';
//import data from '../testData/TD_TC_001.json';
import { startTest, endTest, addRuntimeData, fetchRuntimeData, getTestDataFromDB, getTestDataFromFaker, getTestDataFromJsonFile  } from '../utils/utilities';
import dotenv from 'dotenv';
dotenv.config();

test.describe('TC_001 API TestCase Template', () => {

  // Use following code to run testcase for multiple data sets
  // testData.runs.forEach((data, index) => {
  // test(`TC_001_runId_${index + 1}`, async ({ page }) => {

  // Use following code to Fetch test data from different sources
  // const data = getTestDataFromDB('select * from users', 'TC_001_runId_1');
  // const data = getTestDataFromFaker('person.firstName');
  // const data = getTestDataFromJsonFile('./testData/TD_TC_001.json');

    test(`TC_001_runId_1`, async ({ request }, testInfo) => {

      // Add runtime data 
      //await addRuntimeData(testInfo.title, data);

      let status = 'passed';

      // Start the test
      const { logs, startTime } = await startTest("TC_001_runId_1");

      let errorMessage: string | undefined;

      try {

        await test.step(`Get Request`, async () => {

          // Add steps from here 

        });

      } catch (error: any) {
        status = 'failed';
        errorMessage = error.message;
        throw error;
      } finally {

        // End the test
        await endTest("TC_001_runId_1", logs, startTime, status, testInfo, errorMessage, );

      }

    });

  // });

});