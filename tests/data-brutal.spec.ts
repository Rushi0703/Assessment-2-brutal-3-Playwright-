import { test, expect } from '../utils/auth.fixture';
//import data from '../testData/';
import { startTest, endTest, addRuntimeData, fetchRuntimeData, getTestDataFromDB, getTestDataFromFaker, getTestDataFromJsonFile } from '../utils/utilities';
// import dotenv from 'dotenv';
// dotenv.config();

test.describe('Data Brutal Tests — data-project', () => {


  const productIds = [1, 5, 10, 50, 100, 150, 194];

  // Use following code to run testcase for multiple data sets
  // testData.runs.forEach((data, index) => {
  // test(`TC_001_runId_${index + 1}`, async ({ page }) => {

  // Use following code to Fetch test data from different sources
  // const data = getTestDataFromDB('select * from users', 'TC_001_runId_1');
  // const data = getTestDataFromFaker('person.firstName');
  // const data = getTestDataFromJsonFile('./testData/TD_TC_001.json');

  test(`Product ID price > 0 and title length > 0`, async ({ request }, testInfo) => {

    // Add runtime data 
    //await addRuntimeData(testInfo.title, data);

    let status = 'passed';

    // Start the test
    const { logs, startTime } = await startTest("TC_001_runId_1");

    let errorMessage: string | undefined;

    try {
      for (const productId of productIds) {
        const response = await request.get(process.env.DUMMY_JSON + `/products/${productId}`);

        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.price).toBeGreaterThan(0);
        expect(body.title.length).toBeGreaterThan(0);
        expect(body.rating).toBeGreaterThanOrEqual(0);

        await testInfo.attach(`product-${productId}`, {
          body: JSON.stringify(
            {
              id: body.id,
              title: body.title,
              price: body.price,
              rating: body.rating,
              status: response.status(),
            },
            null,
            2
          ),
          contentType: 'application/json',
        });
      };


    } catch (error: any) {
      status = 'failed';
      errorMessage = error.message;
      throw error;
    } finally {

      // End the test
      await endTest("TC_001_runId_1", logs, startTime, status, testInfo, errorMessage,);

    }

  });



  // (B) test.each for DummyJSON login scenarios — 4 sub-tests
  const loginScenarios: Array<{ user: string; pw: string; status: number }> = [
    { user: 'emilys', pw: 'emilyspass', status: 200 },
    { user: 'emilys', pw: 'WRONG', status: 400 },
    { user: 'nonexistent', pw: 'any', status: 400 },
    { user: '', pw: '', status: 400 },
  ];

  for (const scenario of loginScenarios) {

    test(`Login scenario: user="${scenario.user}" expects status ${scenario.status}`, async ({ request }, testInfo) => {



      // Add runtime data 
      //await addRuntimeData(testInfo.title, data);

      let status = 'passed';

      // Start the test
      const { logs, startTime } = await startTest("TC_002_runId_2");

      let errorMessage: string | undefined;

      try {
        const response = await request.post(process.env.DUMMY_JSON + '/auth/login', {
          data: { username: scenario.user, password: scenario.pw },
          headers: { 'Content-Type': 'application/json' },
        });

        expect(response.status()).toBe(scenario.status);

        await testInfo.attach(`login-${scenario.user || 'empty'}-${scenario.status}`, {
          body: JSON.stringify(
            {
              username: scenario.user,
              expectedStatus: scenario.status,
              actualStatus: response.status(),
              passed: response.status() === scenario.status,
            },
            null,
            2
          ),
          contentType: 'application/json',
        });





      } catch (error: any) {
        status = 'failed';
        errorMessage = error.message;
        throw error;
      } finally {

        // End the test
        await endTest("TC_002_runId_2", logs, startTime, status, testInfo, errorMessage,);

      }

    });
  }


  // (C) test.each for RestCountries — 5 sub-tests (note: Brasília with accent)
  const countriesData: Array<[string, string]> = [
    ['germany', 'Berlin'],
    ['france', 'Paris'],
    ['japan', 'Tokyo'],
    ['australia', 'Canberra'],
    ['brazil', 'Bras\u00EDlia'], // Brasília with accent — unicode safe
  ];

  for (const [country, expectedCapital] of countriesData) {


    test(`Country ${country} has capital ${expectedCapital}`, async ({ request }, testInfo) => {



      // Add runtime data 
      //await addRuntimeData(testInfo.title, data);

      let status = 'passed';

      // Start the test
      const { logs, startTime } = await startTest("TC_003_runId_3");

      let errorMessage: string | undefined;

      try {

        const response = await request.get(
          process.env.COUNTRY_URL + `/v3.1/name/${country}?fields=name,capital`
        );

        expect(response.status()).toBe(200);
        const body = await response.json();
        const capital = body[0].capital[0];
        expect(capital).toBe(expectedCapital);

        await testInfo.attach(`country-${country}`, {
          body: JSON.stringify(
            {
              country,
              expectedCapital,
              actualCapital: capital,
              passed: capital === expectedCapital,
            },
            null,
            2
          ),
          contentType: 'application/json',
        });




      } catch (error: any) {
        status = 'failed';
        errorMessage = error.message;
        throw error;
      } finally {

        // End the test
        await endTest("TC_003_runId_3", logs, startTime, status, testInfo, errorMessage,);

      }

    });
  }
  // (D) 194 products: full statistical validation

  test(`194 products: full statistical validation`, async ({ request }, testInfo) => {



    // Add runtime data 
    //await addRuntimeData(testInfo.title, data);

    let status = 'passed';

    // Start the test
    const { logs, startTime } = await startTest("TC_004_runId_4");

    let errorMessage: string | undefined;

    try {
      const response = await request.get(process.env.DUMMY_JSON + '/products?limit=0');

      expect(response.status()).toBe(200);
      const body = await response.json();
      const products = body.products as Array<{
        id: number;
        price: number;
        category: string;
        title: string;
      }>;

      // Assert total count
      expect(products.length).toBe(194);

      // Every price > 0
      for (const product of products) {
        expect(product.price).toBeGreaterThan(0);
      }

      // No duplicate IDs
      const ids = products.map((p) => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(products.length);

      // At least 5 unique categories
      const categories = products.map((p) => p.category);
      const uniqueCategories = new Set(categories);
      expect(uniqueCategories.size).toBeGreaterThanOrEqual(5);

      await testInfo.attach('194-products-stats', {
        body: JSON.stringify(
          {
            totalProducts: products.length,
            allPricesPositive: products.every((p) => p.price > 0),
            uniqueIdCount: uniqueIds.size,
            uniqueCategoryCount: uniqueCategories.size,
            categories: Array.from(uniqueCategories),
          },
          null,
          2
        ),
        contentType: 'application/json',
      });


    } catch (error: any) {
      status = 'failed';
      errorMessage = error.message;
      throw error;
    } finally {

      // End the test
      await endTest("TC_004_runId_4", logs, startTime, status, testInfo, errorMessage,);

    }

  });


  // (E) 208 users: email uniqueness

  test(`208 users: email uniqueness`, async ({ request }, testInfo) => {



    // Add runtime data 
    //await addRuntimeData(testInfo.title, data);

    let status = 'passed';

    // Start the test 
    const { logs, startTime } = await startTest("TC_005_runId_5");

    let errorMessage: string | undefined;

    try {
      const response = await request.get(process.env.DUMMY_JSON + '/users?limit=0');

      expect(response.status()).toBe(200);
      const body = await response.json();
      const users = body.users as Array<{ id: number; email: string }>;

      expect(users.length).toBe(208);

      // All emails match basic regex
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const user of users) {
        expect(user.email).toMatch(emailRegex);
      }

      // Unique emails
      const emailSet = new Set(users.map((u) => u.email));
      expect(emailSet.size).toBe(208);

      await testInfo.attach('208-users-emails', {
        body: JSON.stringify(
          {
            totalUsers: users.length,
            uniqueEmailCount: emailSet.size,
            allEmailsValid: users.every((u) => emailRegex.test(u.email)),
          },
          null,
          2
        ),
        contentType: 'application/json',
      });


    } catch (error: any) {
      status = 'failed';
      errorMessage = error.message;
      throw error;
    } finally {

      // End the test
      await endTest("TC_005_runId_5", logs, startTime, status, testInfo, errorMessage,);

    }

  });



});   
