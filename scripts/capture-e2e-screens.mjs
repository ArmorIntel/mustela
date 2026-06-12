import fs from 'node:fs/promises';
import {
  startFixtureServer,
  launchExtensionContext,
  openPopup,
  bindPopupToTab,
  openFixturePage,
  getServiceWorker
} from '../tests/e2e/support/extensionHarness.js';

const outDir = process.argv[2] || 'artifacts/e2e-shots';

const server = await startFixtureServer();
const extension = await launchExtensionContext();
const { context, extensionId } = extension;
try {
  await fs.mkdir(outDir, { recursive: true });
  const page = await openFixturePage(context, server.urlFor('/iocs.html'));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('body').screenshot({ path: `${outDir}/01-page-highlights.png` });

  await page.locator('.mustela-highlight').nth(1).click();
  await page.locator('body').screenshot({ path: `${outDir}/02-page-panel.png` });

  const popup = await bindPopupToTab(context, await openPopup(context, extensionId), page);
  await popup.locator('#manualInput').fill('8.8.8.8');
  await popup.locator('#manualInvestigateBtn').click();
  await page.locator('.mustela-panel').waitFor();

  const popup2 = await bindPopupToTab(context, await openPopup(context, extensionId), page);
  await popup2.setViewportSize({ width: 420, height: 1200 });
  await popup2.locator('body').screenshot({ path: `${outDir}/03-popup-history.png` });

  await popup.close();
  await popup2.close();
  await page.close();
  const worker = await getServiceWorker(context);
  await worker.evaluate(() => chrome.storage.local.clear());
  console.log(`Captured screenshots into ${outDir}`);
} finally {
  await extension.close();
  await server.close();
}
