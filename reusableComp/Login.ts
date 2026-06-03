import test, { Page } from "@playwright/test";
export async function loginUser(page: Page, data: any) {
    await test.step('Login User', async () => {
        await page.getByRole('link', { name: 'Sign In' }).click();
        await page.getByRole('link', { name: 'Log in' }).click();
        await page.getByRole('heading', { name: 'Welcome' }).click();
        await page.getByRole('textbox', { name: 'Email address *' }).fill(data.email);
        await page.getByRole('textbox', { name: 'Password *' }).fill(data.password);
        await page.getByRole('button', { name: 'Sign in' }).click();
    });
}