import { test, expect } from '../utils/auth.fixture.ts';
//import data from '../testData/TD_TC_001.json';
import { startTest, endTest, addRuntimeData, fetchRuntimeData, getTestDataFromDB, getTestDataFromFaker, getTestDataFromJsonFile } from '../utils/utilities';
import dotenv from 'dotenv';
dotenv.config();



test.describe('Auth Chain Tests — dummyjson-project', () => {

  // Use following code to run testcase for multiple data sets
  // testData.runs.forEach((data, index) => {
  // test(`TC_001_runId_${index + 1}`, async ({ page }) => {

  // Use following code to Fetch test data from different sources
  // const data = getTestDataFromDB('select * from users', 'TC_001_runId_1');
  // const data = getTestDataFromFaker('person.firstName');
  // const data = getTestDataFromJsonFile('./testData/TD_TC_001.json');

  // (A) JWT payload has correct user data

  test(`JWT payload has correct user data`, async ({ decodedPayload }, testInfo) => {

    // Add runtime data 
    //await addRuntimeData(testInfo.title, data);

    // ── A  HTTPBin echoes headers unchanged ──────
    let status = 'passed';

    // Start the test
    const { logs, startTime } = await startTest("TC_001_runId_1");

    let errorMessage: string | undefined;

    try {


      expect(decodedPayload.username).toBe('emilys');
      expect(typeof decodedPayload.id).toBe('number');
      expect(typeof decodedPayload.exp).toBe('number');
      expect(decodedPayload.exp as number).toBeGreaterThan(Math.floor(Date.now() / 1000));

      await testInfo.attach('jwt-payload-assertion', {
        body: JSON.stringify(
          {
            username: decodedPayload.username,
            id: decodedPayload.id,
            exp: decodedPayload.exp,
            expGreaterThanNow: (decodedPayload.exp as number) > Math.floor(Date.now() / 1000),
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
      await endTest("TC_001_runId_1", logs, startTime, status, testInfo, errorMessage,);

    }

  });

  // (B) Bearer token accepted by DummyJSON /auth/me
  test(`Bearer token accepted by DummyJSON /auth/me`, async ({ djToken, request }, testInfo) => {

    // Add runtime data 
    //await addRuntimeData(testInfo.title, data);

    let status = 'passed';

    // Start the test
    const { logs, startTime } = await startTest("TC_001_runId_1");

    let errorMessage: string | undefined;

    try {

      const response = await request.get(process.env.DUMMY_JSON + '/auth/me', {
        headers: {
          Authorization: `Bearer ${djToken}`,
        },
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(typeof body.id).toBe('number');
      expect(body.firstName).toBe('Emily');

      await testInfo.attach('dummyjson-auth-me', {
        body: JSON.stringify({ status: response.status(), id: body.id, firstName: body.firstName }, null, 2),
        contentType: 'application/json',
      });


    } catch (error: any) {
      status = 'failed';
      errorMessage = error.message;
      throw error;
    } finally {

      // End the test
      await endTest("TC_001_runId_1", logs, startTime, status, testInfo, errorMessage,);

    }

  });

  // (C) Bearer token accepted by HTTPBin /bearer
  test(`Bearer token accepted by HTTPBin /bearer`, async ({ djToken, request }, testInfo) => {

    // Add runtime data 
    //await addRuntimeData(testInfo.title, data);

    let status = 'passed';

    // Start the test
    const { logs, startTime } = await startTest("TC_003_runId_3");

    let errorMessage: string | undefined;

    try {

      const response = await request.get(process.env.HTTPBIN_URL + '/bearer', {
        headers: {
          Authorization: `Bearer ${djToken}`,
        },
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.authenticated).toBe(true);
      expect(body.token).toBe(djToken);

      await testInfo.attach('httpbin-bearer', {
        body: JSON.stringify(
          { status: response.status(), authenticated: body.authenticated, tokenMatch: body.token === djToken },
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

  // (D) GET /auth/me with no token returns 401
  test(`GET /auth/me with no token returns 401`, async ({  request }, testInfo) => {

    // Add runtime data 
    //await addRuntimeData(testInfo.title, data);

    let status = 'passed';

    // Start the test
    const { logs, startTime } = await startTest("TC_004_runId_4");

    let errorMessage: string | undefined;

    try {

      const response = await request.get(process.env.DUMMY_JSON + '/auth/me');

      expect(response.status()).toBe(401);

      await testInfo.attach('no-token-401', {
        body: JSON.stringify({ status: response.status(), expected: 401, passed: response.status() === 401 }, null, 2),
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
  // (E) GET /auth/me with tampered token returns 401

  test(`GET /auth/me with tampered token returns 401`, async ({djToken,  request }, testInfo) => {

    // Add runtime data 
    //await addRuntimeData(testInfo.title, data);

    let status = 'passed';

    // Start the test
    const { logs, startTime } = await startTest("TC_005_runId_5");

    let errorMessage: string | undefined;

    try {
      const tamperedToken = 'abc';
      const response = await request.get(process.env.DUMMY_JSON + '/auth/me', {
        headers: {
          Authorization: ` Bearer ${tamperedToken}`,
        },
      });

      expect(response.status()).toBe(401);

      await testInfo.attach('tampered-token-401', {
        body: JSON.stringify({ status: response.status(), expected: 401, passed: response.status() === 401 }, null, 2),
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

  // (F) GET /auth/me with FakeStore token on DummyJSON returns 401 
  test(`GET /auth/me with FakeStore token on DummyJSON returns 401`, async ({  fakeToken,request }, testInfo) => {

    let status = 'passed';

    const { logs, startTime } = await startTest("TC_006_runId_6");

    let errorMessage: string | undefined;

    try {

      const response = await request.get(
        process.env.DUMMY_JSON + '/auth/me',
        {
          headers: {
            Authorization: ``,
          },
        }
      );

      // Debug actual response
      const responseBody = await response.text();

      console.log('Status:', response.status());
      console.log('Response:', responseBody);

      // Expected behavior
      expect(response.status()).toBe(401);

      await testInfo.attach('fakestore-token-on-dummyjson-401', {
        body: JSON.stringify(
          {
            status: response.status(),
            expected: 401,
            passed: response.status() === 401,
            response: responseBody,
            note: 'FakeStore token rejected by DummyJSON'
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

      await endTest(
        "TC_006_runId_6",
        logs,
        startTime,
        status,
        testInfo,
        errorMessage
      );
    }
  });

  // (G) Token refresh produces different token

  test(`Token refresh produces different token`, async ({ djToken, request }, testInfo) => {

    // Add runtime data 
    //await addRuntimeData(testInfo.title, data);

    let status = 'passed';

    // Start the test
    const { logs, startTime } = await startTest("TC_007_runId_7");

    let errorMessage: string | undefined;

    try {
      const loginResponse = await request.post(process.env.DUMMY_JSON + '/auth/login', {
        data: { username: 'emilys', password: 'emilyspass' },
        headers: { 'Content-Type': 'application/json' },
      });
      expect(loginResponse.status()).toBe(200);
      const loginBody = await loginResponse.json();
      const refreshToken: string = loginBody.refreshToken;

      const refreshResponse = await request.post(process.env.DUMMY_JSON + '/auth/refresh', {
        data: { refreshToken, expiresInMins: 1 },
        headers: { 'Content-Type': 'application/json' },
      });

      expect(refreshResponse.status()).toBe(200);
      const refreshBody = await refreshResponse.json();
      const newAccessToken: string = refreshBody.accessToken;
      expect(newAccessToken).not.toBe(djToken);

      await testInfo.attach('token-refresh', {
        body: JSON.stringify(
          { status: refreshResponse.status(), tokensAreDifferent: newAccessToken !== djToken },
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
      await endTest("TC_007_runId_7", logs, startTime, status, testInfo, errorMessage,);

    }

  });

  // (H) HTTPBin headers confirms Authorization header sent
  test(`HTTPBin headers confirms Authorization header sent`, async ({ djToken, request }, testInfo) => {

    // Add runtime data 
    //await addRuntimeData(testInfo.title, data);

    let status = 'passed';

    // Start the test
    const { logs, startTime } = await startTest("TC_008_runId_8");

    let errorMessage: string | undefined;

    try {
      const response = await request.get(process.env.HTTPBIN_URL + '/headers', {
        headers: {
          Authorization: `Bearer ${djToken}`,
        },
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.headers['Authorization']).toMatch(/^Bearer /);

      await testInfo.attach('httpbin-headers', {
        body: JSON.stringify(
          {
            status: response.status(),
            authHeader: body.headers['Authorization'],
            startsWithBearer: (body.headers['Authorization'] as string).startsWith('Bearer '),
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
      await endTest("TC_008_runId_8", logs, startTime, status, testInfo, errorMessage,);

    }

  });

});