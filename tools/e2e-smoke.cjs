// Headless smoke test: menu → driver select → race start → autopilot laps.
// Requires: npm i --no-save puppeteer  (and `npm run dev` on port 5173)
// Run: node tools/e2e-smoke.cjs
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2500));

  const menu = await page.evaluate(() => ({
    teams: document.querySelectorAll('.team').length,
    drivers: document.querySelectorAll('.drv').length,
  }));
  console.log(`menu: ${menu.teams} teams, ${menu.drivers} drivers`);
  if (menu.teams !== 11 || menu.drivers !== 22) throw new Error('grid incomplete');

  await page.evaluate(() => {
    document.querySelectorAll('.drv')[0].click();
    document.querySelector('#start-race').click();
  });
  await new Promise(r => setTimeout(r, 6500)); // lights sequence

  // synchronous physics fast-forward: autopilot must complete laps on track
  const result = await page.evaluate(() => {
    window.__sim.timing.start();
    return window.__sim.simulate(400);
  });
  console.log(`laps: ${result.laps.map(t => t.toFixed(3)).join(', ')}  onTrack: ${result.onTrack}`);
  if (result.laps.length < 1) throw new Error('autopilot completed no laps');

  console.log('page errors:', errors.length ? errors : 'none');
  if (errors.length) throw new Error('console had page errors');
  console.log('SMOKE TEST PASSED');
  await browser.close();
})().catch(e => { console.error('SMOKE TEST FAILED:', e.message); process.exit(1); });
