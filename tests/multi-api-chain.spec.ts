import { test, expect } from '../utils/auth.fixture';
//import data from '../testData/';
import { startTest, endTest, addRuntimeData, fetchRuntimeData, getTestDataFromDB, getTestDataFromFaker, getTestDataFromJsonFile } from '../utils/utilities';
// import dotenv from 'dotenv';
// dotenv.config();

test.describe('4-API Chain', () => {


    test(`4-API aggregation chain — all data flows in one function`, async ({ request }, testInfo) => {



        // Add runtime data 
        //await addRuntimeData(testInfo.title, data);

        let status = 'passed';

        // Start the test
        const { logs, startTime } = await startTest("TC_001_runId_1");

        let errorMessage: string | undefined;

        try {
           // ── Step 1: DummyJSON login ──────────────────────────────────────────────
    const djLoginResponse = await request.post('[/auth/login', {
      data: { username: 'emilys', password: 'emilyspass' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(djLoginResponse.status()).toBe(200);
    const djLoginBody = await djLoginResponse.json();
    let djToken: string = djLoginBody.accessToken;
    let djUserId: number = djLoginBody.id;
    expect(djToken).toBeTruthy();
    expect(typeof djUserId).toBe('number');

    await testInfo.attach('step1-dummyjson-login', {
      body: JSON.stringify({ status: djLoginResponse.status(), djUserId, tokenPresent: !!djToken }, null, 2),
      contentType: 'application/json',
    });

    // ── Step 2: DummyJSON products with Bearer token ─────────────────────────
    const productsResponse = await request.get(process.env.DUMMY_JSON + '/products?limit=5&skip=0', {
      headers: { Authorization: `Bearer ${djToken}` },
    });
    expect(productsResponse.status()).toBe(200);
    const productsBody = await productsResponse.json();
    const products = productsBody.products as Array<{ title: string; price: number }>;

    // Find product with highest price
    let highestPriceProduct = products[0];
    for (const product of products) {
      if (product.price > highestPriceProduct.price) {
        highestPriceProduct = product;
      }
    }
    let premiumProductTitle: string = highestPriceProduct.title;
    let premiumPrice: number = highestPriceProduct.price;

    await testInfo.attach('step2-products', {
      body: JSON.stringify(
        { status: productsResponse.status(), premiumProductTitle, premiumPrice },
        null,
        2
      ),
      contentType: 'application/json',
    });

    //  Step 3: FakeStore login
    const fakeLoginResponse = await request.post(process.env.FAKESTORE_URL + '/auth/login', {
      data: { username: 'johnd', password: 'm38rmF$' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(fakeLoginResponse.status()).toBe(201);
    const fakeLoginBody = await fakeLoginResponse.json();
    let fakeToken: string = fakeLoginBody.token;
    expect(fakeToken).toBeTruthy();
    expect(fakeToken).not.toBe(djToken);

    await testInfo.attach('step3-fakestore-login', {
      body: JSON.stringify(
        { status: fakeLoginResponse.status(), tokenPresent: !!fakeToken, tokensAreDifferent: fakeToken !== djToken },
        null,
        2
      ),
      contentType: 'application/json',
    });

    // ── Step 4: RestCountries Germany ────────────────────────────────────────
    const countryResponse = await request.get(
      process.env.COUNTRY_URL + '/v3.1/name/germany?fields=name,capital,population'
    );
    expect(countryResponse.status()).toBe(200);
    const countryBody = await countryResponse.json();
    let capitalCity: string = countryBody[0].capital[0];
    let germanyPop: number = countryBody[0].population;
    expect(capitalCity).toBe('Berlin');

    await testInfo.attach('step4-germany', {
      body: JSON.stringify({ status: countryResponse.status(), capitalCity, germanyPop }, null, 2),
      contentType: 'application/json',
    });

    // Step 5: JSONPlaceholder audit log post
    const auditBody = `DJUser:${djUserId}|Premium:${premiumProductTitle}@$${premiumPrice}|Capital:${capitalCity}|Pop:${germanyPop}`;

    const postResponse = await request.post(process.env.JSON_PLACEHOLDER + '/posts', {
      data: {
        title: 'Chain Report',
        body: auditBody,
        userId: 1,
      },
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    });

    expect(postResponse.status()).toBe(201);
    const postBody = await postResponse.json();
    expect(postBody.id).toBe(101);

    // Assert returned body contains required substrings
    const returnedBody: string = postBody.body;
    expect(returnedBody).toContain('Berlin');
    expect(returnedBody).toContain(premiumProductTitle);
    expect(returnedBody).toContain(djUserId.toString());

    await testInfo.attach('step5-audit-log', {
      body: JSON.stringify(
        {
          status: postResponse.status(),
          postId: postBody.id,
          returnedBody,
          containsBerlin: returnedBody.includes('Berlin'),
          containsPremiumProduct: returnedBody.includes(premiumProductTitle),
          containsDjUserId: returnedBody.includes(djUserId.toString()),
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

   

});     