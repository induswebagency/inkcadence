import './styles/tokens.css';
import './styles/layout.css';
import { Store } from './lib/store.js';
import { Imaging } from './lib/imaging.js';
import { Glyphs } from './lib/glyphs.js';
import { Rendering } from './lib/render.js';
import { Presets } from './lib/presets.js';
import { CharCNN } from './lib/charcnn.js';
import { Harvest } from './lib/harvest.js';
import { Assignment } from './lib/assignment.js';
import { PackShare } from './lib/packshare.js';
import { packQuality, tryPhrase } from './lib/qa.js';
import { INKCADENCE_CONFIG } from './lib/config.js';

CharCNN.load(['/charcnn.json', 'charcnn.json']).catch(function (err) {
  console.warn('[CharCNN]', err && err.message ? err.message : err);
});

const root = document.getElementById('app');

const S = {
  user: null,
  packs: [],
  activeId: null,
  refImages: [],
  sheetSrc: null,
  lastPages: [],
  pen: null,
  wizardStep: 1,
  draftPack: null,
  renderMode: 'auto',
  route: 'marketing',
};

function $(sel, el = document) {
  return el.querySelector(sel);
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const THEME_KEY = 'inkcadence-theme';

function readTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme, persist) {
  document.documentElement.setAttribute('data-theme', theme);
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0c141e' : '#f3efe6');
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* private mode */ }
  const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme, false);
}

function themeToggleHtml(extraClass = 'ghost tiny') {
  const dark = readTheme() === 'dark';
  return `<button type="button" class="${extraClass} theme-toggle" id="themeToggle" aria-pressed="${dark}" aria-label="Switch color theme">${dark ? 'Light theme' : 'Dark theme'}</button>`;
}

function wireThemeToggle() {
  const btn = $('#themeToggle');
  if (!btn) return;
  btn.onclick = () => {
    const next = readTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
    btn.textContent = next === 'dark' ? 'Light theme' : 'Dark theme';
    btn.setAttribute('aria-pressed', String(next === 'dark'));
  };
}

initTheme();

function brandSvg(id) {
  return `<svg width="36" height="36" viewBox="0 0 128 128" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8fb6ff"/><stop offset=".48" stop-color="#2a5bd0"/><stop offset="1" stop-color="#16307a"/>
    </linearGradient></defs>
    <path fill="none" stroke="url(#${id})" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"
      stroke-dasharray="240" pathLength="240" style="animation:strokeDraw 1.2s ease both"
      d="M14 96 C26 96 28 32 44 32 C60 32 58 104 74 104 C90 104 92 40 112 40"/>
  </svg>`;
}

function parseRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  if (hash.startsWith('/app')) return 'app';
  if (hash.startsWith('/login') || hash.startsWith('/auth')) return 'auth';
  if (hash.startsWith('/pricing')) return 'pricing';
  if (hash.startsWith('/legal')) return 'legal';
  if (hash.startsWith('/verify') || hash.startsWith('/reset')) return 'auth';
  return 'marketing';
}

function navigate(path) {
  location.hash = path;
}

/* ---------------- marketing ---------------- */
function renderMarketing() {
  root.innerHTML = `
  <div class="marketing">
    <nav class="marketing-nav">
      <a class="brand-mark" href="#/">${brandSvg('lgNav')}<strong>Inkcadence</strong></a>
      <div class="row">
        <a class="small muted" href="#/pricing">Pricing</a>
        ${themeToggleHtml()}
        <button class="ghost tiny" id="navLogin">Log in</button>
        <button class="tiny" id="navStart">Open app</button>
      </div>
    </nav>
    <section class="hero">
      <div class="hero-inner">
        ${brandSvg('lgHero')}
        <h1 class="hero-brand">Ink<span>cadence</span></h1>
        <p>Your hand, on every page — learn from your own assignments, then write new ones with the same ink, slant, and letterforms.</p>
        <div class="row hero-cta">
          <button id="ctaStart">Start writing</button>
          <button class="ghost" id="ctaSelfhost">Self-host docs</button>
        </div>
      </div>
    </section>
    <footer class="marketing-nav muted small">
      <span>Classical always works · Neural when you want it</span>
      <a href="#/legal">Privacy &amp; terms</a>
    </footer>
  </div>`;
  $('#navLogin').onclick = () => navigate('/login');
  $('#navStart').onclick = () => goAppOrAuth();
  $('#ctaStart').onclick = () => goAppOrAuth();
  $('#ctaSelfhost').onclick = () => { window.open('/SELFHOST.md', '_blank'); };
  wireThemeToggle();
}

function renderPricing() {
  root.innerHTML = `
  <div class="marketing">
    <nav class="marketing-nav">
      <a class="brand-mark" href="#/">${brandSvg('lgPrice')}<strong>Inkcadence</strong></a>
      <div class="row">${themeToggleHtml()}<button class="tiny" id="back">Back</button></div>
    </nav>
    <section class="hero">
      <div class="hero-inner rise">
        <h1 class="hero-brand" style="font-size:clamp(2.2rem,5vw,3.4rem)">Write freely.<br><span>Upgrade when ready.</span></h1>
        <p>Self-host is free forever. Hosted plans unlock sync, neural training minutes, and higher pack limits.</p>
        <div class="grid2" style="text-align:left;margin-top:24px">
          <div class="panel"><h3>Self-host</h3><p class="muted small">Unlimited classical writing on your machine. Docker Compose in one command.</p><button class="ghost" id="toDocs">Read SELFHOST.md</button></div>
          <div class="panel"><h3>Pro / Team</h3><p class="muted small">Hosted accounts, Stripe billing, neural fine-tunes, email recovery.</p><button id="toApp">Open app</button></div>
        </div>
      </div>
    </section>
  </div>`;
  $('#back').onclick = () => navigate('/');
  $('#toDocs').onclick = () => window.open('/SELFHOST.md', '_blank');
  $('#toApp').onclick = () => goAppOrAuth();
  wireThemeToggle();
}

function renderLegal() {
  root.innerHTML = `
  <div class="marketing">
    <nav class="marketing-nav">
      <a class="brand-mark" href="#/">${brandSvg('lgLegal')}<strong>Inkcadence</strong></a>
      ${themeToggleHtml()}
    </nav>
    <article class="legal panel rise">
      <h1>Privacy &amp; terms</h1>
      <p>Inkcadence processes handwriting samples in the browser for classical style extraction. Source photos are not uploaded in the default self-host path — only extracted style pack JSON may sync to your server.</p>
      <p><b>AI-assisted handwriting disclosure:</b> generated pages may include an optional watermark. Do not use outputs to forge signatures, certificates, or official documents.</p>
      <p class="muted small">MIT licensed. SaaS deployments may process account email for verification, billing, and support.</p>
    </article>
  </div>`;
  wireThemeToggle();
}

/* ---------------- auth ---------------- */
function renderAuth() {
  const hash = location.hash;
  const isReset = hash.includes('/reset');
  const isVerify = hash.includes('/verify');
  root.innerHTML = `
  <div class="auth-shell">
    <div class="panel auth-panel">
      ${brandSvg('lgAuth')}
      <h1 class="brand">Inkcadence</h1>
      <p class="tag">Your hand, on every page.</p>
      <p class="muted small">Train on your own pages, then generate new ones in your own hand.</p>
      ${isReset ? resetForm() : isVerify ? verifyForm() : loginForm()}
      <div id="authMsg" class="msg"></div>
      <p class="muted small" id="storeNote" style="margin-top:16px"></p>
      <p class="small" style="margin-top:12px"><a href="#/">← Back to home</a></p>
      <div class="row" style="margin-top:10px">${themeToggleHtml()}</div>
    </div>
  </div>`;
  wireAuth();
  wireThemeToggle();
  Store.ready.then((mode) => {
    const note = $('#storeNote');
    if (!note) return;
    if (mode === 'remote') {
      note.textContent = 'Account and style packs sync to the Inkcadence server. Samples stay in this browser; only the extracted profile is uploaded.';
    } else if (INKCADENCE_CONFIG.apiBase) {
      note.innerHTML = 'Server unreachable — local-only account in this browser.';
    } else {
      note.textContent = 'Local account. Data lives in this browser and is never uploaded.';
    }
  });
}

function loginForm() {
  return `
    <div class="field"><label>Username</label><input id="authUser" autocomplete="username" placeholder="e.g. aarav"></div>
    <div class="field"><label>Password</label><input id="authPass" type="password" autocomplete="current-password" placeholder="at least 8 characters"></div>
    <div class="field"><label>Email <span class="muted">(optional)</span></label><input id="authEmail" type="email" autocomplete="email" placeholder="for recovery"></div>
    <div class="row"><button id="btnLogin" style="flex:2">Log in</button><button id="btnSignup" class="ghost" style="flex:1">Create</button></div>`;
}
function resetForm() {
  return `
    <div class="field"><label>New password</label><input id="resetPass" type="password" placeholder="at least 8 characters"></div>
    <button id="btnReset">Set new password</button>`;
}
function verifyForm() {
  return `<p class="hint">Confirming your email…</p><button id="btnVerify">Verify email</button>`;
}

function wireAuth() {
  const msg = (t, k) => { const el = $('#authMsg'); el.className = 'msg' + (k ? ' ' + k : ''); el.textContent = t || ''; };
  if ($('#btnLogin')) {
    $('#btnLogin').onclick = () => {
      msg('Checking…');
      Store.login($('#authUser').value, $('#authPass').value)
        .then((u) => { S.user = u; navigate('/app'); })
        .catch((e) => msg(e.message, 'bad'));
    };
    $('#btnSignup').onclick = () => {
      msg('Creating…');
      const email = $('#authEmail')?.value;
      // Store.signup currently username+password; email goes via API body extension if remote.
      Store.signup($('#authUser').value, $('#authPass').value, email)
        .then((u) => { S.user = u; navigate('/app'); })
        .catch((e) => msg(e.message, 'bad'));
    };
    $('#authPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnLogin').click(); });
  }
  if ($('#btnReset')) {
    const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token');
    $('#btnReset').onclick = async () => {
      try {
        const res = await fetch((INKCADENCE_CONFIG.apiBase || '') + '/api/auth/reset-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, password: $('#resetPass').value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Reset failed');
        msg('Password updated. You can log in.', 'ok');
      } catch (e) { msg(e.message, 'bad'); }
    };
  }
  if ($('#btnVerify')) {
    const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token');
    $('#btnVerify').onclick = async () => {
      try {
        const res = await fetch((INKCADENCE_CONFIG.apiBase || '') + '/api/auth/verify-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Verify failed');
        msg('Email verified.', 'ok');
      } catch (e) { msg(e.message, 'bad'); }
    };
  }
}

async function goAppOrAuth() {
  const u = S.user || await Store.currentUser();
  if (u) { S.user = u; navigate('/app'); }
  else navigate('/login');
}

/* ---------------- app shell ---------------- */
async function renderApp() {
  if (!S.user) {
    S.user = await Store.currentUser();
    if (!S.user) return navigate('/login');
  }
  await refreshPacks();
  const remote = Store.mode() === 'remote';
  root.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar" aria-label="Account and style packs">
      <div class="sidebar-brand">
        ${brandSvg('lgSide')}
        <div>
          <span class="brand-name">Inkcadence</span>
          <span class="brand-tag">your hand, on every page</span>
        </div>
      </div>
      <div class="sidebar-who">
        <div class="avatar" id="avatar">${esc(String(S.user).charAt(0).toUpperCase())}</div>
        <div style="min-width:0">
          <div class="uname" id="whoami">${esc(S.user)}</div>
          <div style="margin-top:4px"><span class="mode-pill ${remote ? 'synced' : 'on-device'}" id="accountMode">${remote ? 'synced' : 'on device'}</span></div>
        </div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-head">
          <h3>Style packs</h3>
          <span class="pack-count" id="packCount">0</span>
        </div>
        <ul class="plist" id="packList"></ul>
      </div>
      <div class="sidebar-actions">
        <button class="btn-new" id="btnNewPack">＋ New style pack</button>
        <button class="btn-ghost" id="btnHome">Marketing</button>
        ${themeToggleHtml('btn-ghost')}
        <button class="btn-ghost" id="btnLogout">Log out</button>
      </div>
    </aside>
    <main class="workspace">
      <div class="tabs">
        <button data-tab="train" class="on">1 · Train</button>
        <button data-tab="write">2 · Write</button>
      </div>
      <section id="tabTrain">${trainWizardHtml()}</section>
      <section id="tabWrite" hidden>${writeHtml()}</section>
    </main>
  </div>`;
  wireApp();
  wireThemeToggle();
  renderPackList();
  renderPackSelect();
}

function trainWizardHtml() {
  return `
  <div class="panel rise">
    <h2>Train a style pack</h2>
    <p class="muted small">Guided classical training — samples teach the look; the sheet captures letterforms; QA scores the pack before save.</p>
    <div class="wizard-steps">
      <span class="step on" data-step="1">1 Samples</span>
      <span class="step" data-step="2">2 Sheet</span>
      <span class="step" data-step="3">3 Quality</span>
      <span class="step" data-step="4">4 Save</span>
    </div>
    <div class="field"><label>Pack name</label><input id="packName" placeholder="e.g. My blue-pen hand"></div>
    <div id="wiz1">
      <div class="drop">
        <h4>Old assignments</h4>
        <p class="small muted">1–8 photos or scans for pen colours, slant, stroke width, spacing.</p>
        <input type="file" id="fileRef" accept="image/*" multiple hidden>
        <button class="ghost tiny" id="btnPickRef">Choose images</button>
        <div class="thumbs" id="thumbsRef"></div>
      </div>
      <div class="row" style="margin-top:14px"><button id="wizNext1">Continue to sheet</button></div>
    </div>
    <div id="wiz2" hidden>
      <div class="drop">
        <h4>Template sheet</h4>
        <p class="small muted">Print, fill every character, photograph flat. <a href="${import.meta.env.BASE_URL}sheet.html" target="_blank">Open printable sheet ↗</a></p>
        <input type="file" id="fileSheet" accept="image/*" hidden>
        <button class="ghost tiny" id="btnPickSheet">Upload filled sheet</button>
        <div id="sheetWrap" hidden>
          <canvas id="sheetCanvas" style="width:100%;max-width:520px;border:1px solid var(--line);border-radius:8px;background:#fff"></canvas>
          <div class="grid2" style="gap:6px;margin-top:8px">
            <div><label class="small muted">Left %</label><input id="gx" type="range" min="0" max="60" value="4.5" step="0.5"></div>
            <div><label class="small muted">Top %</label><input id="gy" type="range" min="0" max="70" value="8.5" step="0.5"></div>
            <div><label class="small muted">Width %</label><input id="gw" type="range" min="30" max="100" value="91" step="0.5"></div>
            <div><label class="small muted">Height %</label><input id="gh" type="range" min="20" max="95" value="86" step="0.5"></div>
            <div style="grid-column:1/-1"><button type="button" class="ghost tiny" id="btnAutoGrid">Auto-align grid</button></div>
          </div>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="ghost" id="wizBack2">Back</button>
        <button id="wizNext2">Analyze &amp; score</button>
      </div>
    </div>
    <div id="wiz3" hidden>
      <div id="qaBody"></div>
      <div class="field" style="margin-top:12px">
        <label>Try phrase preview</label>
        <input id="tryPhrase" value="${esc(tryPhrase())}">
        <button class="ghost tiny" id="btnTryPreview" style="margin-top:8px">Preview</button>
        <div id="tryPreview" style="margin-top:10px"></div>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="ghost" id="wizBack3">Back</button>
        <button id="wizNext3">Continue to save</button>
      </div>
    </div>
    <div id="wiz4" hidden>
      <p class="hint">Ready to save. Classical glyphs stay in the pack; neural training is optional later.</p>
      <div class="row">
        <button class="ghost" id="wizBack4">Back</button>
        <button id="btnBuild">Save style pack</button>
        <span class="small muted" id="buildState"></span>
      </div>
    </div>
    <div id="buildMsg" style="margin-top:12px"></div>
  </div>
  <div class="panel" id="resultCard" hidden><h3>Extracted style</h3><div id="resultBody"></div></div>`;
}

function writeHtml() {
  return `
  <div class="panel rise">
    <h2>Write a page</h2>
    <div class="field"><label>Style pack</label><select id="wPack"></select></div>
    <div class="field"><label>Writer</label>
      <select id="wMode">
        <option value="auto">Auto (neural if ready)</option>
        <option value="classical">Classical</option>
        <option value="neural">Neural</option>
      </select>
    </div>
    <div class="field"><label>Text — start a line with <code>#</code> for a heading</label>
      <textarea id="wText"># Assignment — Inkcadence
Name: ______     Roll: ______

The classical engine stamps your captured letterforms with natural jitter.
When a neural model is ready for this pack, Auto mode uses it and falls back silently if the ML service is down.</textarea>
    </div>
    <div class="grid2">
      <div>
        <div class="field"><label>Ink</label><div class="swatch" id="wColor"></div></div>
        <div class="field"><label>Paper</label>
          <select id="wPaper"><option value="ruled">Lined A4</option><option value="plain">Blank A4</option><option value="grid">Grid A4</option></select>
        </div>
        <div class="field"><label>Heading style</label>
          <select id="wHeading"><option value="underline">Underline</option><option value="double">Double</option><option value="none">None</option></select>
        </div>
      </div>
      <div>
        <div class="field"><label>Writing size</label><input id="wSize" type="range" min="22" max="56" value="34"></div>
        <div class="field"><label>Natural variation</label><input id="wJitter" type="range" min="0" max="150" value="55"></div>
        <div class="field"><label>Page seed</label><input id="wSeed" type="range" min="1" max="99" value="7"></div>
      </div>
    </div>
    <div class="row">
      <button id="btnRender">Render pages</button>
      <button class="ghost" id="btnPrint">Print / PDF</button>
      <button class="ghost" id="btnTrainNeural">Train neural model</button>
      <label class="small muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="wMark" checked style="width:auto"> AI watermark</label>
    </div>
    <div id="writeMsg" style="margin-top:10px"></div>
  </div>
  <div id="pages"></div>`;
}

function setWizard(step) {
  S.wizardStep = step;
  for (let i = 1; i <= 4; i++) {
    const pane = $('#wiz' + i);
    if (pane) pane.hidden = i !== step;
  }
  document.querySelectorAll('.wizard-steps .step').forEach((el) => {
    const n = +el.dataset.step;
    el.classList.toggle('on', n === step);
    el.classList.toggle('done', n < step);
  });
}

function card(el, html, kind) {
  if (!el) return;
  el.innerHTML = html ? `<div class="${kind === 'bad' ? 'err' : 'hint'}">${html}</div>` : '';
}

async function refreshPacks() {
  S.packs = (await Store.packs(S.user)) || [];
  if (!S.activeId && S.packs.length) S.activeId = S.packs[0].id;
  if (!S.packs.some((p) => p.id === S.activeId)) S.activeId = S.packs[0]?.id || null;
}

function renderPackList() {
  const ul = $('#packList');
  if (!ul) return;
  const count = $('#packCount');
  if (count) count.textContent = String(S.packs.length);
  ul.innerHTML = '';
  if (!S.packs.length) {
    ul.innerHTML = '<li class="empty">No packs yet. Train your first handwriting style to see it here.</li>';
    return;
  }
  S.packs.forEach((p) => {
    const li = document.createElement('li');
    li.className = p.id === S.activeId ? 'active' : '';
    li.title = p.name;
    const glyphs = (p.glyphs && p.glyphs.length) || 0;
    const pens = (p.penColours && p.penColours.length) || 0;
    const meta = glyphs ? `${glyphs} glyphs${pens ? ' · ' + pens + ' ink' : ''}` : 'Style pack';
    li.innerHTML = `<span class="dot" style="background:${(p.penColours && p.penColours[0]) || '#2f6fed'}"></span>
      <div style="flex:1;min-width:0"><span class="pname">${esc(p.name)}</span><span class="pmeta">${esc(meta)}</span></div>`;
    const del = document.createElement('button');
    del.className = 'pack-del';
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete ' + p.name);
    del.textContent = '×';
    del.onclick = (ev) => {
      ev.stopPropagation();
      if (!confirm('Delete "' + p.name + '"?')) return;
      Store.deletePack(S.user, p.id).then((list) => {
        S.packs = list;
        if (S.activeId === p.id) S.activeId = list[0]?.id || null;
        renderPackList();
        renderPackSelect();
      });
    };
    li.onclick = () => { S.activeId = p.id; renderPackList(); renderPackSelect(); showResult(p); };
    li.appendChild(del);
    ul.appendChild(li);
  });
}

function renderPackSelect() {
  const sel = $('#wPack');
  if (!sel) return;
  sel.innerHTML = '';
  if (!S.packs.length) {
    sel.innerHTML = '<option value="">— no style pack yet —</option>';
    return;
  }
  S.packs.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name + (p.modelStatus === 'ready' ? ' · neural ready' : '');
    if (p.id === S.activeId) o.selected = true;
    sel.appendChild(o);
  });
  syncPenSwatches();
}

function activePack() {
  return S.packs.find((p) => p.id === S.activeId) || null;
}

function syncPenSwatches() {
  const box = $('#wColor');
  if (!box) return;
  box.innerHTML = '';
  const p = activePack();
  const colours = p?.penColours?.length ? p.penColours : ['#1b2a4a', '#123a8c', '#111111'];
  S.pen = colours[0];
  colours.forEach((hex, i) => {
    const b = document.createElement('button');
    b.style.background = hex;
    if (i === 0) b.className = 'on';
    b.onclick = () => {
      S.pen = hex;
      [...box.children].forEach((c) => { c.className = ''; });
      b.className = 'on';
    };
    box.appendChild(b);
  });
}

function gridRect(src) {
  const x = src.width * (+$('#gx').value / 100);
  const y = src.height * (+$('#gy').value / 100);
  const w = src.width * (+$('#gw').value / 100);
  const h = src.height * (+$('#gh').value / 100);
  return { x, y, w: Math.min(w, src.width - x), h: Math.min(h, src.height - y) };
}

function setGridPercents(p) {
  if ($('#gx')) $('#gx').value = String(p.gx);
  if ($('#gy')) $('#gy').value = String(p.gy);
  if ($('#gw')) $('#gw').value = String(p.gw);
  if ($('#gh')) $('#gh').value = String(p.gh);
}

function autoAlignSheetGrid() {
  if (!S.sheetSrc || !Glyphs.detectSheetGrid) return;
  const rect = Glyphs.detectSheetGrid(S.sheetSrc, Glyphs.COLS, Glyphs.ROWS);
  setGridPercents(Glyphs.rectToPercents(rect, S.sheetSrc.width, S.sheetSrc.height));
}

function drawSheetPreview() {
  const src = S.sheetSrc;
  const cv = $('#sheetCanvas');
  if (!src || !cv) return;
  const W = 520, H = Math.round(W * src.height / src.width);
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.drawImage(src, 0, 0, W, H);
  const rect = gridRect(src);
  const sx = W / src.width, sy = H / src.height;
  const cw = rect.w / Glyphs.COLS, ch = rect.h / Glyphs.ROWS;
  ctx.strokeStyle = 'rgba(47,111,237,.85)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= Glyphs.COLS; i++) {
    const x = (rect.x + i * cw) * sx;
    ctx.beginPath(); ctx.moveTo(x, rect.y * sy); ctx.lineTo(x, (rect.y + rect.h) * sy); ctx.stroke();
  }
  for (let j = 0; j <= Glyphs.ROWS; j++) {
    const y = (rect.y + j * ch) * sy;
    ctx.beginPath(); ctx.moveTo(rect.x * sx, y); ctx.lineTo((rect.x + rect.w) * sx, y); ctx.stroke();
  }
  $('#sheetWrap').hidden = false;
}

async function buildDraftPack() {
  const name = $('#packName').value.trim() || 'Untitled pack';
  let stats = null;
  if (S.refImages.length) {
    stats = Imaging.mergeAnalyses(S.refImages.map((c) => Imaging.analyze(c)));
  }
  let glyphs = [], missing = [], cellH = 92, cellW = 70;
  if (S.sheetSrc) {
    const rect = gridRect(S.sheetSrc);
    const res = Glyphs.extractGlyphs(S.sheetSrc, rect, Glyphs.COLS, Glyphs.ROWS, Glyphs.CHARS);
    glyphs = res.glyphs;
    missing = res.missing;
    cellH = rect.h / Glyphs.ROWS;
    cellW = rect.w / Glyphs.COLS;
  }
  let harvested = [];
  const hadSheetGlyphs = glyphs.length > 0;
  if (S.refImages.length) {
    if (typeof CharCNN !== 'undefined' && CharCNN.load && !CharCNN.isReady()) {
      try { await CharCNN.load(['/charcnn.json', 'charcnn.json']); } catch (_) { /* empty harvest */ }
    }
    harvested = await Harvest.harvestFromPagesAsync(S.refImages, { maxCrops: 120, maxPerChar: 4 });
    glyphs = Harvest.mergeVariants(glyphs, harvested);
    if (!hadSheetGlyphs && harvested.length) {
      const med = Harvest.medianCellMetrics ? Harvest.medianCellMetrics(harvested) : null;
      if (med) {
        cellH = med.cellH;
        cellW = med.cellW;
      } else if (harvested[0].cellH) {
        cellH = harvested[0].cellH;
        cellW = harvested[0].cellW;
      }
    }
  }
  if (!stats) {
    stats = {
      pages: 0, slant: 0.1, strokeWidth: 3, lineGap: Math.round(cellH * 1.7),
      inkRatio: 0, paper: '#fdfcf7', palette: [{ hex: '#1b2a4a', kind: 'pen', share: 100 }], thumbs: [],
    };
  }
  const base = Presets.matchFromStats(stats);
  let pens = stats.palette.filter((c) => c.kind !== 'faint').map((c) => c.hex);
  if (!pens.length) pens = (base.penColours || ['#1b2a4a']).slice();
  const scored = Assignment.styleScore(stats);
  const pats = stats.patterns || {};
  let jitter = base.defaultJitter;
  if (pats.neatness != null) {
    jitter = pats.neatness >= 0.72 ? 0.28 : (pats.neatness >= 0.5 ? 0.48 : 0.7);
  } else if (pats.qualityGuess === 'best') {
    jitter = 0.28;
  }
  const paperStyle = pats.paperStyle || stats.paperStyle || 'ruled';
  const pack = {
    id: 'pk_' + Date.now().toString(36),
    name,
    created: Date.now(),
    cellH, cellW, glyphs, missing, stats,
    patterns: pats,
    harvestedCount: harvested.length,
    penColours: pens.slice(0, 4),
    paper: stats.paper,
    paperStyle,
    slant: stats.slant,
    strokeWidth: stats.strokeWidth,
    lineGap: stats.lineGap || base.lineGap,
    fontFamily: glyphs.length ? null : base.fontFamily,
    headingStyle: base.headingStyle,
    defaultJitter: jitter,
    tracking: base.tracking,
    baseStyleId: base.id,
    baseStyleName: base.name,
    styleScore: scored.score,
    renderMode: 'auto',
  };
  S.draftPack = pack;
  return pack;
}

function showQa(pack) {
  const qa = packQuality(pack);
  $('#qaBody').innerHTML = `
    <div class="qa-score">${qa.score}<span class="small muted"> / 100</span></div>
    <div class="meter"><span style="width:${qa.score}%"></span></div>
    <div class="stats">
      <div class="stat"><b>${qa.completeness}%</b><span>glyph coverage</span></div>
      <div class="stat"><b>${qa.captured}/${qa.total}</b><span>letterforms</span></div>
      <div class="stat"><b>${qa.strokeConf}</b><span>stroke confidence</span></div>
      <div class="stat"><b>${(pack.stats && pack.stats.pages) || 0}</b><span>sample pages</span></div>
    </div>
    ${qa.missing.length ? `<p class="small muted"><b>${qa.missing.length}</b> empty: ${esc(qa.missing.join(' '))}</p>` : ''}
    <p class="hint">${qa.ready ? 'Looks good to save.' : 'Coverage is low — fill more sheet cells for better classical output.'}</p>`;
}

function showResult(pack) {
  if (!pack || !$('#resultBody')) return;
  const st = pack.stats || {};
  const qa = packQuality(pack);
  let html = `<div class="stats">
    <div class="stat"><b>${st.pages || 0}</b><span>reference pages</span></div>
    <div class="stat"><b>${st.slant != null ? (st.slant * 100).toFixed(0) + '%' : '—'}</b><span>slant</span></div>
    <div class="stat"><b>${st.strokeWidth || '—'}</b><span>stroke px</span></div>
    <div class="stat"><b>${(pack.glyphs || []).length}</b><span>letterforms</span></div>
    <div class="stat"><b>${qa.score}</b><span>QA score</span></div>
  </div>`;
  if ((pack.glyphs || []).length) {
    html += '<div class="glyphgrid">' + pack.glyphs.slice(0, 90).map((g) =>
      `<figure><img src="${g.url}" alt="${esc(g.ch)}"><figcaption>${esc(g.ch)}</figcaption></figure>`
    ).join('') + '</div>';
  }
  $('#resultBody').innerHTML = html;
  $('#resultCard').hidden = false;
}

function wireApp() {
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => { x.className = ''; });
      b.className = 'on';
      $('#tabTrain').hidden = b.dataset.tab !== 'train';
      $('#tabWrite').hidden = b.dataset.tab !== 'write';
      if (b.dataset.tab === 'write') syncPenSwatches();
    };
  });
  $('#btnLogout').onclick = () => Store.logout().then(() => { S.user = null; navigate('/login'); });
  $('#btnHome').onclick = () => navigate('/');
  $('#btnNewPack').onclick = () => {
    S.activeId = null; S.draftPack = null; S.refImages = []; S.sheetSrc = null;
    $('#packName').value = '';
    $('#thumbsRef').innerHTML = '';
    setWizard(1);
    document.querySelector('.tabs button[data-tab="train"]').click();
  };

  $('#btnPickRef').onclick = () => $('#fileRef').click();
  $('#btnPickSheet').onclick = () => $('#fileSheet').click();
  $('#fileRef').onchange = () => {
    const files = [...($('#fileRef').files || [])].slice(0, 8);
    Promise.all(files.map((f) => Imaging.loadImageFile(f).catch(() => null))).then((cans) => {
      S.refImages = cans.filter(Boolean);
      $('#thumbsRef').innerHTML = '';
      S.refImages.forEach((c) => {
        const t = document.createElement('canvas');
        const s = 150 / c.width;
        t.width = 150; t.height = Math.round(c.height * s);
        t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
        $('#thumbsRef').appendChild(t);
      });
      card($('#buildMsg'), S.refImages.length + ' page(s) ready.');
    });
  };
  $('#fileSheet').onchange = () => {
    const f = ($('#fileSheet').files || [])[0];
    if (!f) return;
    Imaging.loadImageFile(f).then((c) => {
      S.sheetSrc = c;
      autoAlignSheetGrid();
      drawSheetPreview();
      card($('#buildMsg'), 'Sheet loaded. Grid auto-aligned — tweak if needed.');
    }).catch((e) => card($('#buildMsg'), e.message, 'bad'));
  };
  ['gx', 'gy', 'gw', 'gh'].forEach((id) => $('#' + id).addEventListener('input', drawSheetPreview));
  if ($('#btnAutoGrid')) {
    $('#btnAutoGrid').onclick = () => {
      if (!S.sheetSrc) { card($('#buildMsg'), 'Load a sheet first.', 'bad'); return; }
      autoAlignSheetGrid();
      drawSheetPreview();
      card($('#buildMsg'), 'Grid re-aligned from the sheet scan.');
    };
  }

  $('#wizNext1').onclick = () => setWizard(2);
  $('#wizBack2').onclick = () => setWizard(1);
  $('#wizNext2').onclick = async () => {
    if (!S.refImages.length && !S.sheetSrc) {
      card($('#buildMsg'), 'Add samples or a sheet first.', 'bad');
      return;
    }
    card($('#buildMsg'), 'Recognising letters with the handwriting CNN…');
    const pack = await buildDraftPack();
    showQa(pack);
    setWizard(3);
  };
  $('#wizBack3').onclick = () => setWizard(2);
  $('#wizNext3').onclick = () => setWizard(4);
  $('#wizBack4').onclick = () => setWizard(3);

  $('#btnTryPreview').onclick = async () => {
    const pack = S.draftPack || activePack();
    if (!pack) return;
    await Glyphs.hydrate(pack);
    const pages = Rendering.renderPages({
      text: $('#tryPhrase').value,
      pack,
      size: 32,
      jitter: 0.45,
      seed: 3,
      penColour: (pack.penColours && pack.penColours[0]) || '#1b2a4a',
      paper: 'ruled',
      paperColour: pack.paper || '#fdfcf7',
      watermark: false,
    });
    const host = $('#tryPreview');
    host.innerHTML = '';
    const c = pages[0];
    c.style.width = '100%';
    c.style.maxWidth = '420px';
    c.style.height = 'auto';
    c.style.borderRadius = '8px';
    c.style.boxShadow = '0 8px 24px rgba(20,30,50,.14)';
    host.appendChild(c);
  };

  $('#btnBuild').onclick = async () => {
    const pack = S.draftPack || (await buildDraftPack());
    if (!$('#packName').value.trim()) { card($('#buildMsg'), 'Name the pack first.', 'bad'); return; }
    pack.name = $('#packName').value.trim();
    $('#btnBuild').disabled = true;
    $('#buildState').textContent = 'saving…';
    try {
      const saved = await Store.savePack(S.user, pack);
      S.activeId = saved.id || pack.id;
      await refreshPacks();
      renderPackList();
      renderPackSelect();
      showResult(pack);
      card($('#buildMsg'), 'Saved <b>' + esc(pack.name) + '</b>.');
      setWizard(1);
    } catch (e) {
      card($('#buildMsg'), 'Could not save: ' + e.message, 'bad');
    } finally {
      $('#btnBuild').disabled = false;
      $('#buildState').textContent = '';
    }
  };

  if ($('#wPack')) {
    $('#wPack').onchange = () => { S.activeId = $('#wPack').value; renderPackList(); syncPenSwatches(); };
  }

  $('#btnRender').onclick = async () => {
    const pack = activePack();
    if (!pack) { card($('#writeMsg'), 'Create a style pack first.', 'bad'); return; }
    const btn = $('#btnRender');
    btn.disabled = true;
    card($('#writeMsg'), 'Laying out pages…');
    try {
      const mode = $('#wMode').value;
      let neuralPages = null;
      if (mode !== 'classical' && Store.mode() === 'remote' && pack.id) {
        try {
          const token = localStorage.getItem('inkcadence:token');
          const res = await fetch((INKCADENCE_CONFIG.apiBase || '') + '/api/packs/' + encodeURIComponent(pack.id) + '/infer', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(token ? { authorization: 'Bearer ' + token } : {}),
            },
            body: JSON.stringify({ text: $('#wText').value, renderMode: mode, options: {} }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.glyphs?.length) {
              const neuralPack = { ...pack, glyphs: data.glyphs, fontFamily: null };
              await Glyphs.hydrate(neuralPack);
              neuralPages = Rendering.renderPages({
                text: $('#wText').value,
                pack: neuralPack,
                size: +$('#wSize').value,
                jitter: +$('#wJitter').value / 100,
                seed: +$('#wSeed').value,
                penColour: S.pen || pack.penColours?.[0] || '#1b2a4a',
                paper: $('#wPaper').value,
                paperColour: pack.paper || '#fdfcf7',
                headingStyle: $('#wHeading').value,
                watermark: $('#wMark').checked,
                continuity: true,
                pageNumbers: true,
              });
            } else if (data.pages?.length) {
              neuralPages = data.pages;
            }
          }
        } catch { /* classical fallback */ }
      }

      let pages;
      if (Array.isArray(neuralPages) && neuralPages[0] && neuralPages[0].getContext) {
        pages = neuralPages;
        card($('#writeMsg'), 'Rendered with neural glyph atlas.');
      } else if (Array.isArray(neuralPages) && typeof neuralPages[0] === 'string') {
        const imgs = neuralPages.map((dataUrl) => {
          const img = new Image();
          img.src = dataUrl;
          return img;
        });
        await Promise.all(imgs.map((img) => new Promise((r) => { img.onload = r; img.onerror = r; })));
        pages = imgs.map((img) => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || Rendering.PAGE_W;
          c.height = img.naturalHeight || Rendering.PAGE_H;
          c.getContext('2d').drawImage(img, 0, 0);
          return c;
        });
        card($('#writeMsg'), 'Rendered with neural writer.');
      } else {
        await Glyphs.hydrate(pack);
        pages = Rendering.renderPages({
          text: $('#wText').value,
          pack,
          size: +$('#wSize').value,
          jitter: +$('#wJitter').value / 100,
          seed: +$('#wSeed').value,
          penColour: S.pen || pack.penColours?.[0] || '#1b2a4a',
          paper: $('#wPaper').value,
          paperColour: pack.paper || '#fdfcf7',
          headingStyle: $('#wHeading').value,
          watermark: $('#wMark').checked,
          fontFamily: pack.fontFamily,
          tracking: pack.tracking,
          continuity: true,
          pageNumbers: true,
        });
        card($('#writeMsg'), mode === 'neural' ? 'ML unavailable — classical fallback.' : '');
      }

      S.lastPages = pages;
      const host = $('#pages');
      host.innerHTML = '';
      const bar = document.createElement('div');
      bar.className = 'pagebar';
      bar.innerHTML = `<div class="small muted">${pages.length} page(s)</div>`;
      const dl = document.createElement('button');
      dl.className = 'ghost tiny';
      dl.textContent = 'Download PNGs';
      dl.onclick = () => {
        pages.forEach((c, i) => {
          setTimeout(() => {
            const a = document.createElement('a');
            a.download = (pack.name.replace(/[^\w-]+/g, '_') || 'page') + '_p' + (i + 1) + '.png';
            a.href = c.toDataURL('image/png');
            a.click();
          }, i * 350);
        });
      };
      bar.appendChild(dl);
      host.appendChild(bar);
      pages.forEach((c, i) => {
        const wrap = document.createElement('div');
        wrap.style.marginBottom = '22px';
        wrap.innerHTML = `<div class="small muted" style="text-align:center;margin-bottom:6px">Page ${i + 1}</div>`;
        c.className = 'page';
        wrap.appendChild(c);
        host.appendChild(wrap);
      });
    } catch (e) {
      card($('#writeMsg'), 'Render failed: ' + e.message, 'bad');
    } finally {
      btn.disabled = false;
    }
  };

  $('#btnPrint').onclick = () => {
    if (!S.lastPages.length) { card($('#writeMsg'), 'Render first.', 'bad'); return; }
    const w = window.open('', '_blank');
    if (!w) { card($('#writeMsg'), 'Allow pop-ups for print.', 'bad'); return; }
    const imgs = S.lastPages.map((c) => '<img src="' + c.toDataURL('image/jpeg', 0.92) + '">').join('');
    w.document.write('<!doctype html><title>Print</title><style>@page{size:A4;margin:0}body{margin:0}img{display:block;width:210mm;height:297mm;page-break-after:always}</style>' + imgs);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  };

  $('#btnTrainNeural').onclick = async () => {
    const pack = activePack();
    if (!pack || Store.mode() !== 'remote') {
      card($('#writeMsg'), 'Neural training needs a synced pack on the API.', 'bad');
      return;
    }
    try {
      const token = localStorage.getItem('inkcadence:token');
      const res = await fetch((INKCADENCE_CONFIG.apiBase || '') + '/api/packs/' + encodeURIComponent(pack.id) + '/train-model', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Train failed');
      card($('#writeMsg'), 'Neural job queued (' + data.jobId + '). Classical writing still works.');
    } catch (e) {
      card($('#writeMsg'), e.message, 'bad');
    }
  };
}

async function router() {
  await Store.ready;
  S.route = parseRoute();
  if (S.route === 'marketing') return renderMarketing();
  if (S.route === 'pricing') return renderPricing();
  if (S.route === 'legal') return renderLegal();
  if (S.route === 'auth') return renderAuth();
  return renderApp();
}

window.addEventListener('hashchange', () => { router().catch(console.error); });
Store.ready.then(() => router()).catch((err) => {
  root.innerHTML = `<div class="auth-shell"><div class="panel err">Failed to start: ${esc(err.message)}</div></div>`;
});
