/**
 * SigNoz Screenshot Automation — headless, reliable
 */
const { chromium } = require('/Users/p0k053u/.local/lib/node_modules/playwright-core');
const fs   = require('fs');
const path = require('path');

const SIGNOZ = 'http://localhost:8080';
const DIR    = '/Users/p0k053u/signoz-blog-demo/screenshots';
const EMAIL  = 'admin@beacon.local';
const PASS   = 'Blog@2026';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function shot(page, filename, desc) {
  const fp = path.join(DIR, filename);
  await page.screenshot({ path: fp, fullPage: false });
  const size = Math.round(fs.statSync(fp).size / 1024);
  console.log(`  📸 ${desc} (${size}KB)\n     → ${filename}`);
}

async function login(page) {
  await page.goto(`${SIGNOZ}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  await page.fill('#email', EMAIL);
  await page.click('button:has-text("Next")');
  await sleep(2500);
  await page.fill('#currentPassword', PASS);
  await page.click('button:has-text("Sign in with Password")');
  // Wait until we leave the login page
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15000 });
  await sleep(2000);
  console.log('  ✓ Logged in →', page.url());
}

async function main() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  console.log('🚀 Launching headless Chromium...');
  const browser = await chromium.launch({ headless: true });
  const ctx  = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // ── LOGIN ──────────────────────────────────────────────────────────────
  console.log('\n[1/6] Login...');
  await login(page);

  // ── 1: SERVICES OVERVIEW ───────────────────────────────────────────────
  console.log('\n[2/6] Services page...');
  await page.goto(`${SIGNOZ}/services`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait for service rows to appear
  try {
    await page.waitForSelector('table tbody tr, [class*="service"][class*="row"]', { timeout: 20000 });
  } catch (_) {}
  await sleep(4000);
  await shot(page, '01-services-overview.png', 'Services Overview');

  // ── 2: TRACES EXPLORER ─────────────────────────────────────────────────
  console.log('\n[3/6] Traces Explorer...');
  await page.goto(`${SIGNOZ}/traces`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForSelector('table, [class*="trace"]', { timeout: 20000 });
  } catch (_) {}
  await sleep(4000);
  await shot(page, '02-traces-explorer.png', 'Traces Explorer');

  // Sort by duration descending
  try {
    // Try clicking on Duration column header
    const headers = await page.locator('th').all();
    for (const h of headers) {
      const text = await h.textContent();
      if (text && text.toLowerCase().includes('duration')) {
        await h.click(); await sleep(600);
        await h.click(); await sleep(1500); // second click = descending
        break;
      }
    }
    await sleep(2000);
    await shot(page, '03-traces-sorted-duration.png', 'Traces sorted by duration (slowest first)');
  } catch (e) {
    console.log('  ⚠ Sort error:', e.message.slice(0, 60));
    await shot(page, '03-traces-page.png', 'Traces page');
  }

  // ── 3: TRACE DETAIL (FLAMEGRAPH) ───────────────────────────────────────
  console.log('\n[4/6] Trace detail (flamegraph)...');
  try {
    // Click first row
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    console.log('  Found', count, 'trace rows');
    if (count > 0) {
      await rows.nth(0).click();
      await sleep(5000);
      const newUrl = page.url();
      console.log('  Trace URL:', newUrl);
      if (newUrl.includes('trace') || newUrl.includes('traceId')) {
        await shot(page, '04-trace-flamegraph.png', 'Trace Flamegraph — N+1 DB spans');
        // Scroll down a bit to show full flamegraph
        await page.mouse.wheel(0, 300);
        await sleep(1500);
        await shot(page, '04b-trace-flamegraph-scrolled.png', 'Flamegraph scrolled — all 47 DB spans');
      } else {
        await shot(page, '04-trace-detail.png', 'Trace detail page');
      }
    }
  } catch (e) {
    console.log('  ⚠ Trace detail error:', e.message.slice(0, 80));
  }

  // ── 4: LOGS EXPLORER ──────────────────────────────────────────────────
  console.log('\n[5/6] Logs Explorer...');
  await page.goto(`${SIGNOZ}/logs/logs-explorer`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForSelector('[class*="log"], table tbody tr', { timeout: 20000 });
  } catch (_) {}
  await sleep(5000);
  await shot(page, '05-logs-explorer.png', 'Logs Explorer — catalog-api logs with Trace icon');

  // Hover a log row to reveal trace icon
  try {
    const logRow = page.locator('table tbody tr').first();
    if (await logRow.isVisible({ timeout: 3000 })) {
      await logRow.hover();
      await sleep(1000);
      await shot(page, '05b-logs-trace-icon-hover.png', 'Log row hovered — Trace icon visible');
    }
  } catch (_) {}

  // ── 5: SERVICE DETAIL ─────────────────────────────────────────────────
  console.log('\n[6/6] Service detail + alerts...');
  await page.goto(`${SIGNOZ}/services`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForSelector('table tbody tr', { timeout: 15000 });
    await sleep(3000);
    // Find and click catalog-api
    const rows = await page.locator('table tbody tr').all();
    for (const row of rows) {
      const text = await row.textContent();
      if (text && text.includes('catalog-api')) {
        await row.click();
        await sleep(5000);
        await shot(page, '06-service-detail.png', 'catalog-api service detail metrics');
        // Scroll for more charts
        await page.mouse.wheel(0, 400);
        await sleep(2000);
        await shot(page, '06b-service-detail-charts.png', 'catalog-api — latency histogram');
        break;
      }
    }
  } catch (e) {
    console.log('  ⚠ Service detail:', e.message.slice(0, 60));
  }

  // Final services clean shot
  await page.goto(`${SIGNOZ}/services`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try { await page.waitForSelector('table tbody tr', { timeout: 15000 }); } catch (_) {}
  await sleep(5000);
  await shot(page, '07-services-final.png', 'Services — final hero shot for blog');

  // ── SUMMARY ────────────────────────────────────────────────────────────
  await browser.close();

  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
  console.log('\n' + '═'.repeat(60));
  console.log(`✅  ${files.length} screenshots saved:\n`);
  files.forEach(f => {
    const kb = Math.round(fs.statSync(path.join(DIR, f)).size / 1024);
    console.log(`   ${f}  (${kb}KB)`);
  });
  console.log(`\n📁 ${DIR}`);
}

main().catch(err => {
  console.error('\n❌', err.message);
  process.exit(1);
});
