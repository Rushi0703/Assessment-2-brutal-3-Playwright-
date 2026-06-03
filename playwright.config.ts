import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html']
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'https://developer.shell.com',

    trace: 'retain-on-failure-and-retries',
  },


  /* Configure the timeout for expect */
  expect: {
    timeout: 10000, // Set default timeout for expect assertions
  },

   projects: [
    {
      name: 'dummyjson-project',
      testMatch: '**/auth-chain.spec.ts',
      use: {
        baseURL: 'https://dummyjson.com'
      }
    },

    {
      name: 'data-project',
      testMatch: '**/data-brutal.spec.ts',
      use: {
        baseURL: 'https://dummyjson.com'
      }
    },

    {
      name: 'chain-project',
      testMatch: '**/multi-api-chain.spec.ts',
      use: {
        baseURL: 'https://dummyjson.com'
      }
    }
  ]

});
