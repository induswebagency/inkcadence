/**
 * Capture a clear classic-writer walkthrough and encode docs/media/working.gif.
 *
 * Needs Chrome + ffmpeg. Serves are expected at INK_URL (default classic :8080).
 *
 *   npx --yes serve . -l 8080
 *   node scripts/make-working-gif.mjs
 */
import { createRequire } from 'module';
import { mkdir, writeFile, copyFile } from 'fs/promises';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'scripts', '.capture', 'package.json'));
const puppeteer = require('puppeteer-core');

const OUT = path.join(ROOT, 'docs', 'media');
const FRAME_DIR = path.join(OUT, '_gif_frames');
const FIX = path.join(ROOT, 'test', 'fixtures', 'samples');
const ASSIGN = path.join(FIX, 'assignments');
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.INK_URL || 'http://127.0.0.1:8080/classic/';
const FFMPEG = process.env.FFMPEG ||
  'C:\\Users\\pc\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\\ffmpeg.exe';

async function settle(ms = 500) {
  await new Promise((r) => setTimeout(r, ms));
}

function findFfmpeg() {
  if (existsSync(FFMPEG)) return FFMPEG;
  const which = spawnSync('where', ['ffmpeg'], { encoding: 'utf8' });
  if (which.status === 0) return which.stdout.split(/\r?\n/).find(Boolean);
  throw new Error('ffmpeg not found');
}

async function main() {
  await mkdir(FRAME_DIR, { recursive: true });
  await mkdir(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 2 },
    args: ['--disable-gpu', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', (err) => console.error('PAGE', err.message));

  const frames = [];
  async function shot(name) {
    const file = path.join(FRAME_DIR, name + '.jpg');
    await settle(450);
    await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
    frames.push(file);
    console.log('frame', name);
  }

  console.log('goto', BASE);
  await page.goto(BASE.replace(/\/?$/, '/'), { waitUntil: 'networkidle0' });
  // Classic root may be /classic/ or /
  if (!(await page.$('#authUser')) && !(await page.$('#ctaStart'))) {
    await page.goto(BASE.includes('classic') ? 'http://127.0.0.1:8080/' : BASE, { waitUntil: 'networkidle0' });
  }

  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    try { localStorage.setItem('inkcadence-theme', 'light'); } catch (e) {}
  });

  // Auth
  if (await page.$('#authUser')) {
    await page.$eval('#authUser', (el) => { el.value = ''; });
    await page.$eval('#authPass', (el) => { el.value = ''; });
    await page.type('#authUser', 'showcase');
    await page.type('#authPass', 'notebook12');
    const signup = await page.$('#btnSignup');
    if (signup) {
      await signup.click();
      await settle(800);
    }
    // login if already exists
    if (await page.$('#authView:not([hidden])')) {
      await page.click('#btnLogin');
      await settle(800);
    }
    await page.waitForSelector('#packName', { timeout: 20000 }).catch(() => {});
  }

  await shot('01-home-app');

  // Train tab
  const trainTab = await page.$('.tabs button[data-tab="train"]');
  if (trainTab) await trainTab.click();
  await page.waitForSelector('#packName');
  await page.$eval('#packName', (el) => { el.value = 'Exam navy hand'; });
  await shot('02-train');

  const ref = await page.$('#fileRef');
  const sampleA = existsSync(path.join(ASSIGN, 'exam_lined_navy_neat.jpg'))
    ? path.join(ASSIGN, 'exam_lined_navy_neat.jpg')
    : path.join(FIX, 'sample_page_1.jpg');
  const sampleB = existsSync(path.join(ASSIGN, 'exam_phone_photo_blue.jpg'))
    ? path.join(ASSIGN, 'exam_phone_photo_blue.jpg')
    : path.join(FIX, 'sample_page_2.jpg');
  await ref.uploadFile(sampleA, sampleB);
  await page.waitForFunction(() => document.querySelectorAll('#thumbsRef canvas').length >= 1);
  await settle(600);
  await page.evaluate(() => document.querySelector('#thumbsRef')?.scrollIntoView({ block: 'center' }));
  await shot('03-samples');

  await page.click('#btnBuild');
  await page.waitForSelector('#resultCard:not([hidden])', { timeout: 120000 });
  await settle(900);
  await page.evaluate(() => document.querySelector('#resultCard')?.scrollIntoView({ block: 'start' }));
  await shot('04-learned');

  // Write
  await page.click('.tabs button[data-tab="write"]');
  await page.waitForSelector('#wText');
  await page.$eval('#wText', (el) => {
    el.value = [
      '# Assignment 4 — Biology',
      'Name: ______     Roll: ______',
      '',
      '1. Explain osmosis in one sentence.',
      'Osmosis is the diffusion of water across a membrane.',
      '',
      '2. What do mitochondria produce?',
      'They produce ATP for the cell.',
    ].join('\n');
  });
  if (await page.$('#wSize')) {
    await page.$eval('#wSize', (el) => { el.value = '42'; el.dispatchEvent(new Event('input')); });
  }
  if (await page.$('#wPaper')) {
    await page.$eval('#wPaper', (el) => { el.value = 'ruled'; });
  }
  if (await page.$('#wMark')) {
    await page.$eval('#wMark', (el) => { el.checked = false; });
  }
  await shot('05-write-form');

  await page.click('#btnRender');
  await page.waitForSelector('canvas.page', { timeout: 120000 });
  await settle(700);
  await page.evaluate(() => document.querySelector('canvas.page')?.scrollIntoView({ block: 'center' }));
  await shot('06-write-ui');

  // Crisp crop of the handwritten page only (top band where ink lives)
  const pageHandle = await page.$('canvas.page');
  const pagePath = path.join(FRAME_DIR, '07-page-full.jpg');
  await pageHandle.screenshot({ path: pagePath, type: 'jpeg', quality: 95 });
  frames.push(pagePath);

  // Zoom crop via ffmpeg later — also save a UI-free zoom for the GIF climax
  await browser.close();

  const ffmpeg = findFfmpeg();
  const zoom = path.join(FRAME_DIR, '08-page-zoom.jpg');
  spawnSync(ffmpeg, [
    '-y', '-i', pagePath,
    '-vf', 'crop=iw:ih*0.42:0:0,scale=1200:-1',
    '-q:v', '2', zoom,
  ], { stdio: 'inherit' });
  frames.push(zoom);

  // Sequence list with dwell (duplicate climax frames for clarity)
  const seq = [
    frames[0], frames[0],
    frames[1],
    frames[2], frames[2],
    frames[3], frames[3],
    frames[4],
    frames[5],
    frames[6],
    zoom, zoom, zoom, zoom,
  ].filter(Boolean);

  const listFile = path.join(FRAME_DIR, 'concat.txt');
  await writeFile(listFile, seq.map((f) => `file '${f.replace(/\\/g, '/')}'\nduration 1.15\n`).join('') + `file '${seq[seq.length - 1].replace(/\\/g, '/')}'\n`);

  const palette = path.join(FRAME_DIR, 'palette.png');
  const gifOut = path.join(OUT, 'working.gif');
  const scaled = path.join(FRAME_DIR, 'scaled_%03d.jpg');

  // Normalize sizes
  for (let i = 0; i < seq.length; i++) {
    const dest = path.join(FRAME_DIR, 'n' + String(i).padStart(3, '0') + '.jpg');
    spawnSync(ffmpeg, [
      '-y', '-i', seq[i],
      '-vf', 'scale=1100:720:force_original_aspect_ratio=decrease,pad=1100:720:(ow-iw)/2:(oh-ih)/2:color=0xf7f4ee',
      '-q:v', '2', dest,
    ], { stdio: 'inherit' });
    seq[i] = dest;
  }
  await writeFile(listFile, seq.map((f) => `file '${f.replace(/\\/g, '/')}'\nduration 1.2\n`).join('') + `file '${seq[seq.length - 1].replace(/\\/g, '/')}'\n`);

  // Build an image2 sequence at 1 fps so palettegen sees every key frame.
  const seqPattern = path.join(FRAME_DIR, 's%03d.jpg');
  for (let i = 0; i < seq.length; i++) {
    await copyFile(seq[i], path.join(FRAME_DIR, 's' + String(i).padStart(3, '0') + '.jpg'));
  }
  spawnSync(ffmpeg, [
    '-y', '-framerate', '1', '-i', seqPattern.replace(/\\/g, '/'),
    '-vf', 'scale=1100:720:force_original_aspect_ratio=decrease,pad=1100:720:(ow-iw)/2:(oh-ih)/2:color=0xf7f4ee,palettegen=max_colors=256:stats_mode=full',
    palette,
  ], { stdio: 'inherit' });

  spawnSync(ffmpeg, [
    '-y', '-framerate', '1', '-i', seqPattern.replace(/\\/g, '/'),
    '-i', palette,
    '-lavfi', 'scale=1100:720:force_original_aspect_ratio=decrease,pad=1100:720:(ow-iw)/2:(oh-ih)/2:color=0xf7f4ee[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
    '-loop', '0',
    gifOut,
  ], { stdio: 'inherit' });

  // Refresh stills used in README tables
  await copyFile(path.join(FRAME_DIR, '03-samples.jpg'), path.join(OUT, 'train-samples-light.jpg')).catch(() => {});
  await copyFile(path.join(FRAME_DIR, '04-learned.jpg'), path.join(OUT, 'train-quality-light.jpg')).catch(() => {});
  await copyFile(path.join(FRAME_DIR, '06-write-ui.jpg'), path.join(OUT, 'write-result-light.jpg')).catch(() => {});
  await copyFile(zoom, path.join(OUT, 'result-page.jpg')).catch(() => {});

  console.log('wrote', gifOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
