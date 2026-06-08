import 'dotenv/config';
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const [targetUrlArg, outputPathArg] = process.argv.slice(2);
const targetUrl = targetUrlArg || process.env.ARGUS_TARGET_URL || 'http://127.0.0.1:5173';
const outputPath = outputPathArg || 'artifacts/accessibility-tree/home.json';

function fail(message: string): never {
  console.error(`Accessibility tree capture failed: ${message}`);
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    const client = await page.context().newCDPSession(page);
    const accessibilityTree = await client.send('Accessibility.getFullAXTree');

    if (!accessibilityTree) {
      fail('Playwright returned an empty accessibility tree.');
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(accessibilityTree, null, 2), 'utf8');

    console.log(`Accessibility tree saved to: ${outputPath}`);
    console.log(`Target URL: ${targetUrl}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'Unexpected Playwright accessibility tree error.');
});
