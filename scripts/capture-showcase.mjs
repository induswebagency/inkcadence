/**
 * Walk the Vite app through a real train → write session and save
 * light/dark screenshots plus ordered frames for the README GIF.
 *
 *   npm install --prefix scripts/.capture puppeteer-core
 *   node scripts/capture-showcase.mjs
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'scripts', '.capture', 'package.json'));
const puppeteer = require('puppeteer-core');

const OUT = path.join(ROOT, 'docs', 'media');
const FIX = path.join(ROOT, 'test', 'fixtures', 'samples');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.INK_URL || 'http://127.0.0.1:5173';

const frames = [];

function shotPath(name) {
  return path.join(OUT, name);
}

async function settle(page) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await new Promise((r) => setTimeout(r, 700));
}

async function click(page, sel) {
  await page.waitForSelector(sel);
  const info = await page.evaluate((s) => {
    const el = document.querySelector(s);
    el.scrollIntoView({ block: 'center' });
    const ret = typeof el.onclick === 'function' ? el.onclick(new MouseEvent('click')) : null;
    const snapshot = () => ({
      id: el.id,
      hasOnclick: typeof el.onclick === 'function',
      panes: [1, 2, 3, 4].map((i) => {
        const pane = document.getElementById('wiz' + i);
        return pane ? !pane.hidden : null;
      }),
      msg: (document.querySelector('#buildMsg')?.innerText || '') + (document.querySelector('#writeMsg')?.innerText || ''),
      packs: document.querySelectorAll('#packList li:not(.empty)').length,
    });
    if (ret && typeof ret.then === 'function') return ret.then(snapshot);
    return snapshot();
  }, sel);
  console.log('click', sel, JSON.stringify(info));
}

async function setTheme(page, theme) {
  await page.evaluate((next) => {
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('inkcadence-theme', next);
    const btn = document.querySelector('#themeToggle');
    if (btn) {
      btn.textContent = next === 'dark' ? 'Light theme' : 'Dark theme';
      btn.setAttribute('aria-pressed', String(next === 'dark'));
    }
  }, theme);
}

async function shoot(page, slug, { frame = false } = {}) {
  await setTheme(page, 'light');
  await settle(page);
  const light = `${slug}-light.jpg`;
  const dark = `${slug}-dark.jpg`;
  await page.screenshot({ path: shotPath(light), type: 'jpeg', quality: 82 });
  if (frame) frames.push(light);
  await setTheme(page, 'dark');
  await settle(page);
  await page.screenshot({ path: shotPath(dark), type: 'jpeg', quality: 82 });
  if (slug === 'write-result') frames.push(dark);
  await setTheme(page, 'light');
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
    args: ['--disable-gpu', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  const step = (name) => console.log('step', name);
  page.on('pageerror', (err) => console.error('PAGE', err.message));

  await page.goto(BASE + '/#/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#ctaStart');
  step('home');
  await shoot(page, 'home', { frame: true });

  await click(page, '#ctaStart');
  await page.waitForSelector('#authUser');
  await shoot(page, 'login', { frame: true });

  await page.type('#authUser', 'maya');
  await page.type('#authPass', 'notebook1');
  await click(page, '#btnSignup');
  await page.waitForSelector('#packName');
  const wired = await page.evaluate(() => ({
    wireError: window.__wireError || '',
    next: typeof document.getElementById('wizNext1')?.onclick,
    gx: !!document.getElementById('gx'),
    build: typeof document.getElementById('btnBuild')?.onclick,
  }));
  console.log('wired', JSON.stringify(wired));
  if (wired.wireError || wired.next !== 'function') {
    throw new Error('App wiring failed: ' + (wired.wireError || 'wizNext1 has no handler'));
  }
  await shoot(page, 'train-empty', { frame: true });

  await page.$eval('#packName', (el) => { el.value = 'Blue pen notes'; });
  const ref = await page.$('#fileRef');
  await ref.uploadFile(
    path.join(FIX, 'sample_page_1.jpg'),
    path.join(FIX, 'sample_page_2.jpg'),
    path.join(FIX, 'sample_page_3.jpg'),
  );
  await page.waitForFunction(() => document.querySelectorAll('#thumbsRef canvas').length >= 3);
  await shoot(page, 'train-samples', { frame: true });

  await click(page, '#wizNext1');
  await page.waitForSelector('#fileSheet');
  const sheet = await page.$('#fileSheet');
  await sheet.uploadFile(path.join(FIX, 'glyph_sheet.jpg'));
  await page.waitForSelector('#sheetCanvas');
  await page.waitForFunction(() => {
    const c = document.querySelector('#sheetCanvas');
    return c && c.width > 50;
  });
  await page.evaluate(() => document.querySelector('#sheetCanvas')?.scrollIntoView({ block: 'start' }));
  await shoot(page, 'train-sheet', { frame: true });

  step('analyze');
  await click(page, '#wizNext2');
  await page.waitForSelector('.qa-score', { timeout: 120000 });
  await shoot(page, 'train-quality', { frame: true });

  await click(page, '#btnTryPreview');
  await page.waitForSelector('#tryPreview canvas');
  await page.evaluate(() => document.querySelector('#tryPreview canvas')?.scrollIntoView({ block: 'center' }));
  await shoot(page, 'train-preview', { frame: true });

  await click(page, '#wizNext3');
  await page.waitForSelector('#btnBuild');
  await shoot(page, 'train-save', { frame: true });
  await click(page, '#btnBuild');
  await page.waitForSelector('.glyphgrid img');
  await page.evaluate(() => document.querySelector('.glyphgrid')?.scrollIntoView({ block: 'center' }));
  await shoot(page, 'train-glyphs', { frame: true });

  await click(page, '.tabs button[data-tab="write"]');
  await page.waitForSelector('#wText');
  await page.$eval('#wText', (el) => {
    el.value = [
      '# Week 3 notes',
      'The mitochondria produce ATP for the cell.',
      'Photosynthesis converts light into chemical energy.',
      'I can write homework in my own hand.',
    ].join('\n');
  });
  await shoot(page, 'write-form', { frame: true });
  await click(page, '#btnRender');
  await page.waitForSelector('canvas.page');
  await page.evaluate(() => document.querySelector('canvas.page')?.scrollIntoView({ block: 'center' }));
  await shoot(page, 'write-result', { frame: true });

  const pageShot = await page.$('canvas.page');
  await pageShot.screenshot({ path: shotPath('result-page.jpg'), type: 'jpeg', quality: 88 });

  await page.goto(BASE + '/#/pricing', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#toApp');
  await shoot(page, 'pricing');

  await page.goto(BASE + '/#/legal', { waitUntil: 'networkidle0' });
  await page.waitForSelector('article.legal');
  await shoot(page, 'legal');

  const manifest = { frames, out: OUT };
  console.log(JSON.stringify(manifest, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
