/**
 * Get traces page and flamegraph screenshots
 */
const { chromium } = require('/Users/p0k053u/.local/lib/node_modules/playwright-core');
const fs   = require('fs');
const path = require('path');

const SIGNOZ = 'http://localhost:8080';
const DIR    = '/Users/p0k053u/signoz-blog-demo/screenshots';
const sleep  = ms => new Promise(r => setTimeout(r, ms));

async function shot(page, filename, desc) {
  const fp = path.join(DIR, filename);
  await page.screenshot({ path: fp });
  const kb = Math.round(fs.statSync(fp).size / 1024);
  console.log(`  📸 ${desc} (${kb}KB) → ${filename}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // Login
  await page.goto(`${SIGNOZ}/login`, { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await page.fill('#email', 'admin@beacon.local');
  await page.click('button:has-text("Next")');
  await sleep(2500);
  await page.fill('#currentPassword', 'Blog@2026');
  await page.click('button:has-text("Sign in with Password")');
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15000 });
  await sleep(2000);
  console.log('Logged in');

  // --- TRACES EXPLORER ---
  // Navigate to traces page
  await page.goto(`${SIGNOZ}/traces?relativeTime=30m`, { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  await shot(page, '02-traces-explorer.png', 'Traces Explorer');

  // Dismiss any dialogs
  try {
    const okBtn = page.locator('button:has-text("Okay"), button:has-text("Ok"), button:has-text("Got it"), button:has-text("Close")').first();
    if (await okBtn.isVisible({ timeout: 2000 })) {
      await okBtn.click();
      await sleep(1000);
    }
  } catch (_) {}

  // Sort by duration
  try {
    const allTh = await page.locator('th').all();
    for (const th of allTh) {
      const txt = (await th.textContent()) || '';
      if (txt.toLowerCase().includes('duration')) {
        await th.click(); await sleep(800);
        await th.click(); await sleep(2000);
        console.log('  Sorted by duration');
        break;
      }
    }
  } catch (_) {}

  await shot(page, '03-traces-sorted-duration.png', 'Traces sorted by duration (slowest first)');

  // Click on a trace row to get flamegraph
  try {
    // Try trace links first
    const traceLinks = await page.locator('a[href*="traceId"], a[href*="/trace/"]').all();
    if (traceLinks.length > 0) {
      await traceLinks[0].click();
    } else {
      // Try table rows
      const trs = page.locator('table tbody tr');
      const n = await trs.count();
      console.log('  Rows found:', n);
      if (n > 0) await trs.first().click();
    }
    await sleep(6000);
    console.log('  Trace URL:', page.url());
    await shot(page, '04-trace-flamegraph.png', 'Trace flamegraph — N+1 DB spans');
    // Scroll to see more spans
    await page.mouse.wheel(0, 500);
    await sleep(2000);
    await shot(page, '04b-flamegraph-scrolled.png', 'Flamegraph scrolled — all child DB spans');
  } catch (e) {
    console.log('  Flamegraph error:', e.message.slice(0, 80));
  }

  // --- LOGS: Close any dialogs, hover row for trace icon ---
  await page.goto(`${SIGNOZ}/logs/logs-explorer`, { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  // Dismiss quick filter popup
  try {
    const okBtn = page.locator('button:has-text("Okay"), button:has-text("Ok")').first();
    if (await okBtn.isVisible({ timeout: 3000 })) {
      await okBtn.click();
      await sleep(1000);
    }
  } catch (_) {}
  await sleep(3000);
  await shot(page, '05-logs-explorer-clean.png', 'Logs Explorer — no dialog, trace icon visible');

  // Hover a log row
  try {
    const logRows = page.locator('table tbody tr, [class*="log-row"]');
    const n = await logRows.count();
    if (n > 0) {
      await logRows.first().hover();
      await sleep(1000);
      await shot(page, '05b-log-hover-trace-icon.png', 'Log row hover — trace icon appears');
    }
  } catch (_) {}

  // --- SERVICE DETAIL ---
  await page.goto(`${SIGNOZ}/services/catalog-api?relativeTime=30m`, { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  await shot(page, '06-service-detail-latency.png', 'catalog-api service detail with p50/p90/p99 graphs');
  await page.mouse.wheel(0, 400);
  await sleep(2000);
  await shot(page, '06b-service-key-operations.png', 'Key Operations table — GET /api/products p99=2840ms');

  await browser.close();

  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
  console.log('\n✅ All screenshots:');
  files.forEach(f => console.log('  •', f, `(${Math.round(fs.statSync(path.join(DIR,f)).size/1024)}KB)`));
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
