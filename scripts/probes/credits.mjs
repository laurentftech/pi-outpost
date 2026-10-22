import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1117, height: 956 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const button = name => page.getByRole('button', { name, exact: true });
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:4420/?server=http://127.0.0.1:4419');
  await button('Settings').click(); await button('Credits →').click();
  const credits = page.locator('#widget').getByRole('heading', { name: 'Credits', exact: true }); await credits.waitFor();
  const content = page.getByText('Open-source acknowledgements', { exact: true }).locator('..');
  if (await page.getByRole('link', { name: 'Project website' }).getAttribute('href') !== 'https://laurentftech.github.io/pi-outpost/') throw Error('project link');
  if (await content.locator('details').count() || await content.getByRole('link').count()) throw Error('credits clutter');
  if (!await page.getByText('Diagram viewer and editor', { exact: true }).isVisible()) throw Error('missing component role');
  await page.screenshot({ path: '.tmp/credits-redesign.png' });
  for (let i = 0; i < 4; i++) {
    await button('Third-party notices').click();
    await page.getByRole('heading', { name: 'Third-party notices', exact: true }).waitFor();
    const notice = page.locator('pre').filter({ hasText: 'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION' }).first();
    await notice.scrollIntoViewIfNeeded(); if (!await notice.isVisible()) throw Error('license missing');
    await page.getByRole('heading', { name: 'node-pty · MIT', exact: true }).scrollIntoViewIfNeeded();
    await button('← Back to credits').click();
    await button('Third-party notices').waitFor();
    if (!await page.getByRole('heading', { name: 'pi-outpost', exact: true }).isVisible()) throw Error('return failed');
  }
  await page.setViewportSize({ width: 650, height: 500 });
  await button('Third-party notices').click();
  await page.getByRole('heading', { name: 'node-pty · MIT', exact: true }).scrollIntoViewIfNeeded();
  await button('← Back to settings').click(); await button('Credits →').click();
  await button('Third-party notices').waitFor();
  await button('Third-party notices').click();
  await button('Settings').click(); await button('Settings').click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  if (errors.length) throw Error(errors.join('\n'));
  console.log('PASS concise credits, one website, component roles, local notices, scroll and repeated navigation, reopen; no page errors');
} finally { await browser.close(); }
