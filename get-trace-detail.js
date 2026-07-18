/**
 * Get flamegraph + traces list screenshots using actual trace IDs
 */
const { chromium } = require('/Users/p0k053u/.local/lib/node_modules/playwright-core');
const fs   = require('fs');
const path = require('path');

const SIGNOZ  = 'http://localhost:8080';
const DIR     = '/Users/p0k053u/signoz-blog-demo/screenshots';
const TRACE_ID = '9f22d24561085622215ef89a9c629a81'; // slow N+1 trace (2840ms)
const sleep   = ms => new Promise(r => setTimeout(r, ms));

async function shot(page, filename, desc) {
  const fp = path.join(DIR, filename);
  await page.screenshot({ path: fp, fullPage: false });
  const kb = Math.round(fs.statSync(fp).size / 1024);
  console.log(`  📸 ${desc} (${kb}KB) → ${filename}`);
}

async function dismissDialogs(page) {
  try {
    for (const text of ['Okay', 'Ok', 'Got it', 'Close', 'Skip', 'Maybe later']) {
      const btn = page.locator(`button:has-text("${text}")`).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        await sleep(500);
      }
    }
  } catch (_) {}
}

async function login(page) {
  await page.goto(`${SIGNOZ}/login`, { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await page.fill('#email', 'admin@beacon.local');
  await page.click('button:has-text("Next")');
  await sleep(2500);
  await page.fill('#currentPassword', 'Blog@2026');
  await page.click('button:has-text("Sign in with Password")');
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15000 });
  await sleep(2000);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await login(page);
  console.log('Logged in, finding trace routes...');

  // --- Find the actual traces explorer URL ---
  // Click "Explore Traces" from home
  await page.goto(`${SIGNOZ}/home`, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  // Screenshot the home page (it's actually great for the blog!)
  await shot(page, '00-home-dashboard.png', 'SigNoz Home — observability active + catalog-api P99=2840ms');

  // Click "Open Traces Explorer"
  try {
    const traceLink = page.locator('a:has-text("Open Traces Explorer"), a:has-text("Explore Traces"), button:has-text("Explore Traces")').first();
    if (await traceLink.isVisible({ timeout: 3000 })) {
      await traceLink.click();
      await sleep(3000);
      console.log('Traces URL:', page.url());
    }
  } catch (_) {}

  // If didn't navigate, try direct URLs
  const currentUrl = page.url();
  if (currentUrl.includes('/home') || currentUrl.includes('/services')) {
    // Try different traces paths
    for (const tryPath of ['/traces-explorer', '/traces', '/trace', '/explorer']) {
      await page.goto(`${SIGNOZ}${tryPath}`, { waitUntil: 'domcontentloaded' });
      await sleep(2000);
      const u = page.url();
      if (!u.includes('/home') && !u.includes('/login') && !u.includes('/services')) {
        console.log('Found traces at:', u);
        break;
      }
    }
  }

  const tracesUrl = page.url();
  console.log('Final traces URL:', tracesUrl);
  await dismissDialogs(page);
  await sleep(2000);
  await shot(page, '02-traces-explorer.png', 'Traces Explorer list');

  // --- Navigate directly to the slow trace detail ---
  console.log('\nNavigating to N+1 trace:', TRACE_ID);

  // Try different URL formats
  const traceUrls = [
    `${SIGNOZ}/traces/${TRACE_ID}`,
    `${SIGNOZ}/trace/${TRACE_ID}`,
    `${SIGNOZ}/traces-explorer/${TRACE_ID}`,
    `${SIGNOZ}${tracesUrl.replace(SIGNOZ,'')}/${TRACE_ID}`,
  ];

  let gotFlamegraph = false;
  for (const tUrl of traceUrls) {
    await page.goto(tUrl, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    const u = page.url();
    console.log('  Tried:', tUrl.replace(SIGNOZ,''), '→ URL:', u.replace(SIGNOZ,''));

    // Check if we have flamegraph content
    const hasFlamegraph = await page.locator('[class*="flamegraph"], [class*="span"], svg rect, [class*="waterfall"]').count();
    if (hasFlamegraph > 0) {
      console.log('  ✓ Flamegraph elements found:', hasFlamegraph);
      await dismissDialogs(page);
      await sleep(2000);
      await shot(page, '04-trace-flamegraph.png', 'Trace Flamegraph — GET /api/products 2840ms (N+1 bug)');
      await page.mouse.wheel(0, 300);
      await sleep(1500);
      await shot(page, '04b-flamegraph-detail.png', 'Flamegraph detail — 47 SELECT product_attributes spans');
      gotFlamegraph = true;
      break;
    }
  }

  if (!gotFlamegraph) {
    // Try using the sidebar navigation to find traces
    await page.goto(`${SIGNOZ}/home`, { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    // Look for traces in sidebar
    const sidebarLinks = await page.locator('nav a, aside a, [class*="sidebar"] a').all();
    for (const link of sidebarLinks) {
      const href = await link.getAttribute('href');
      const text = await link.textContent();
      if (href && (href.includes('trace') || (text && text.toLowerCase().includes('trace')))) {
        console.log('Sidebar trace link:', href, text?.trim());
      }
    }

    // Screenshot current state for debugging
    await shot(page, '04-trace-fallback.png', 'Trace page (navigation fallback)');
    console.log('  ⚠ Could not find flamegraph — check trace URL format');
  }

  // --- LOGS with trace icon (dismiss dialog first) ---
  console.log('\nLogs Explorer...');
  await page.goto(`${SIGNOZ}/logs/logs-explorer`, { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await dismissDialogs(page);
  await sleep(3000);
  await shot(page, '05-logs-explorer-clean.png', 'Logs Explorer — catalog-api logs (WARN=slow, ERR=error)');

  // Hover to show trace icon
  try {
    const rows = page.locator('table tbody tr');
    if (await rows.count() > 0) {
      await rows.first().hover();
      await sleep(800);
      await shot(page, '05b-log-trace-icon.png', 'Log row hover — click Trace to jump to flamegraph');
    }
  } catch (_) {}

  // --- SERVICE DETAIL ---
  console.log('\nService detail...');
  await page.goto(`${SIGNOZ}/services/catalog-api?relativeTime=30m`, { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  await dismissDialogs(page);
  await shot(page, '06-service-detail-overview.png', 'catalog-api service — latency spike to 3s (N+1 bug)');
  await page.mouse.wheel(0, 450);
  await sleep(2000);
  await shot(page, '06b-key-operations-table.png', 'Key Operations — GET /api/products P99=2840ms, 6% errors');

  // --- SERVICES LIST ---
  console.log('\nServices list...');
  await page.goto(`${SIGNOZ}/services`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('table tbody tr', { timeout: 15000 });
  } catch (_) {}
  await sleep(5000);
  await shot(page, '01-services-list.png', 'Services list — catalog-api visible with latency data');

  await browser.close();

  console.log('\n' + '═'.repeat(60));
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
  console.log(`✅ ${files.length} screenshots total:\n`);
  files.forEach(f => {
    const kb = Math.round(fs.statSync(path.join(DIR, f)).size / 1024);
    console.log(`  ${kb.toString().padStart(4)}KB  ${f}`);
  });
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
