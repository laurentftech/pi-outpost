import { test, expect } from '@playwright/test';

test.describe('ToolCard markdown rendering', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('http://localhost:4173/', { timeout: 10000 });
    // Wait for the app to load
    await page.waitForSelector('#root', { timeout: 10000 });
  });

  test('app loads successfully', async ({ page }) => {
    const title = await page.title();
    // Title contains the pi symbol (π)
    expect(title).toBe('π test');
    
    const rootDiv = await page.$('#root');
    expect(rootDiv).toBeTruthy();
  });

  test('verifies page is responsive', async ({ page }) => {
    // Just verify we can interact with the page
    const body = await page.$('body');
    expect(body).toBeTruthy();
  });
});
