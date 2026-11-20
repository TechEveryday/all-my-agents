// Regenerates the README screenshots in docs/screenshots/ (light + dark).
//
//   npm run screenshots
//
// Builds the client, serves it on a throwaway port, and drives your installed
// Google Chrome with puppeteer-core. Every /api request is answered from
// ./fixtures.mjs, so the images only ever show demo data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import puppeteer from 'puppeteer-core';
import { fixture } from './fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'docs/screenshots');
const CHROME = process.env.CHROME_PATH || {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  linux: '/usr/bin/google-chrome',
}[process.platform];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

async function serveBuild() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ama-shots-'));
  await build({ configFile: path.join(ROOT, 'vite.config.js'), logLevel: 'warn', build: { outDir: dist, emptyOutDir: true } });
  const server = http.createServer((req, res) => {
    const file = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const target = file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream' });
    fs.createReadStream(target).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => { server.close(); fs.rmSync(dist, { recursive: true, force: true }); } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(page, base, { tab, rail = null }) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t, r) => {
    localStorage.setItem('ama-page', t);
    if (r) localStorage.setItem('ama-rail', r);
    else localStorage.removeItem('ama-rail');
  }, tab, rail);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main .card');
  await sleep(700); // let data land and the rail's slide-in finish
}

const SHOTS = [
  { name: 'my-work', tab: 'work', fullPage: true },
  { name: 'agent-activity', tab: 'work', rail: 's-398' },
  {
    name: 'actions-menu',
    tab: 'work',
    async prepare(page) {
      const btn = '[aria-label="Actions for web-app#57"]';
      // Scroll first: the menu closes itself on scroll, so open it only once the page is still.
      await page.$eval(btn, (el) => el.scrollIntoView({ block: 'center' }));
      await sleep(300);
      await page.$eval(btn, (el) => el.click());
      await page.waitForSelector('.menu');
      await sleep(150);
      await page.evaluate(() => [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Advance to'))?.click());
      await sleep(250);
      // Crop to the streams card plus the open menu.
      return page.evaluate(() => {
        const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('In-Progress streams')).getBoundingClientRect();
        const menu = document.querySelector('.menu').getBoundingClientRect();
        const top = Math.min(card.top, menu.top) - 16;
        const bottom = Math.max(card.bottom, menu.bottom) + 16;
        return { x: card.left - 16, y: top + window.scrollY, width: card.width + 32, height: bottom - top };
      });
    },
  },
  { name: 'workflow', tab: 'workflow', fullPage: true },
  { name: 'pull-requests', tab: 'prs', fit: true },
  { name: 'settings', tab: 'settings', fullPage: true },
];

const server = await serveBuild();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
fs.mkdirSync(OUT, { recursive: true });

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const { pathname } = new URL(req.url());
    if (!pathname.startsWith('/api/')) return req.continue();
    if (pathname === '/api/events') return req.respond({ status: 200, contentType: 'text/event-stream', body: 'retry: 600000\n\n' });
    const body = fixture(pathname);
    return req.respond({ status: body ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body ?? { error: 'demo' }) });
  });

  for (const theme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    for (const shot of SHOTS) {
      await open(page, server.url, shot);
      let clip = shot.prepare ? await shot.prepare(page) : undefined;
      if (shot.fit) {
        // Short pages: crop to the content instead of leaving the rest of the viewport empty.
        const bottom = await page.evaluate(() => document.querySelector('.app').getBoundingClientRect().bottom - 28);
        clip = { x: 0, y: 0, width: 1440, height: Math.min(900, Math.ceil(bottom)) };
      }
      const file = path.join(OUT, `${shot.name}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: Boolean(shot.fullPage), clip, captureBeyondViewport: Boolean(shot.fullPage) });
      console.log(`  ${path.relative(ROOT, file)}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
