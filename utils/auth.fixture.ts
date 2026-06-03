import { test as base, expect } from '@playwright/test';

type AuthFixtures = {
  djToken: string;
  fakeToken: string;
  decodedPayload: Record<string, unknown>;
};

export const test = base.extend<AuthFixtures>({
  djToken: async ({ request }, use) => {
    const response = await request.post(process.env.DUMMY_JSON + '/auth/login', {
      data: {
        username: 'emilys',
        password: 'emilyspass',
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.accessToken).toBeTruthy();

    await use(body.accessToken as string);
  },

  fakeToken: async ({ request }, use) => {
    const response = await request.post(process.env.FAKESTORE_URL + '/auth/login', {
      data: {
        username: 'johnd',
        password: 'm38rmF$',
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

   expect([200, 201]).toContain(response.status());
    const body = await response.json();
    expect(body.token).toBeTruthy();

    await use(body.token as string);
  },

  decodedPayload: async ({ djToken }, use) => {
    const segments = djToken.split('.');
    const base64Segment = segments[1];
    // Use Buffer.from (Node.js) — NOT atob() which is browser-only
    const decoded = Buffer.from(base64Segment, 'base64').toString('utf-8');
    const payload = JSON.parse(decoded) as Record<string, unknown>;

    await use(payload);
  },
});

export { expect } from '@playwright/test';
