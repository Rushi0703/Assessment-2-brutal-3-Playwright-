import { Page } from "@playwright/test";

export async function registerUser(page: Page, data: any) {
    await page.goto('https://developer.shell.com/');
    await page.getByRole('link', { name: 'Sign In' }).click();
    await page.getByRole('link', { name: 'Sign up' }).click();
    await page.getByRole('link', { name: 'Register' }).click();
    await page.getByRole('textbox', { name: 'First name *' }).fill(data.firstName);
    await page.getByRole('textbox', { name: 'Last name *' }).fill(data.lastName);
    await page.getByRole('textbox', { name: 'Email address *' }).fill(data.email);
    await page.getByRole('textbox', { name: 'Password *' }).fill(data.password);
    await page.getByRole('combobox', { name: 'Selected country' }).click();
    await page.getByText('+91').click();
    await page.getByRole('textbox', { name: 'Mobile number' }).fill(data.mobileNumber);
    await page.getByRole('textbox', { name: 'Company name *' }).fill(data.companyName);
    await page.getByRole('button', { name: 'Create account' }).click();
}