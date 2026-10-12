import { createAccount, authMessage } from './account.js';

const IN = 2.54, FLAP = 2;
// Supplier sizes in inches: [width (left to right), length (top to bottom)], flap NOT included.
const DEFAULT_BAGS = [
  [6,8],[7,10],[8,10],[8,12],[9,12],[10,12],[10,14],[12,14],[12,16],[12,18],[14,16],[14,18],[14,20],
  [16,20],[16,22],[18,20],[18,22],[18,24],[20,22],[20,24],[22,24],[24,24],[24,26],[24,28],[26,28],[28,28],
];
const LOCAL_KEY = 'polybag-sizes';
const sortBags = list => list.sort((a, b) => a[0] * a[1] - b[0] * b[1] || a[0] - b[0]);
function loadLocalBags() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (e) {}
  return DEFAULT_BAGS.map(b => [...b]);
}
let BAGS = sortBags(loadLocalBags());
const maxW = () => Math.max(...BAGS.map(b => b[0]), 6), maxL = () => Math.max(...BAGS.map(b => b[1]), 8) + FLAP;
const PRESETS = [['T-shirt (folded)', 28, 22, 3, true], ['Kurta (folded)', 35, 28, 4, true], ['9 cm cube', 9, 9, 9],
  ['Phone box', 17, 9, 4], ['Paperback book', 21, 14, 3], ['Shoe box', 33, 20, 12]];
const state = { L: 30, B: 20, H: 5, M: 1.5, soft: false };
const $ = id => document.getElementById(id);
const f1 = n => (Math.round(n * 10) / 10).toString();
const r2 = n => Math.round(n * 100) / 100;

// ---- sizing ---------------------------------------------------------------
// need for one orientation: `along` runs top-to-bottom, `across` runs left-to-right.
// Flat bag around a block: width wraps across + H; length pinches H/2 below and H/2 above, plus room to close.
const CLOSE = 1;     // cm of flat bag above the product so the flap folds over and seals
const TIGHT = 0.5;   // inches: a fit with less spare than this is flagged and the next size up recommended
const SOFT_H = 0.5;  // soft items (clothing) compress, so height counts at half and tight fits are fine
function need(along, across, H, M) { return { w: (across + H + M) / IN, l: (along + H + M + CLOSE) / IN, along, across }; }
const fits = (bag, n) => bag[0] >= n.w - 1e-9 && bag[1] >= n.l - 1e-9;
const roomy = (bag, n, t) => bag[0] - n.w >= t - 1e-9 && bag[1] - n.l >= t - 1e-9;
// p = {L, B, H, M, soft}; H is the real height, softness applied here
function choose(p) {
  const H = p.soft ? p.H * SOFT_H : p.H, t = p.soft ? 0 : TIGHT;
  const opts = [need(p.L, p.B, H, p.M), need(p.B, p.L, H, p.M)];  // upright, or turned 90°
  const smallest = test => {
    let r = null;
    for (const n of opts) {
      const bag = BAGS.find(b => test(b, n));          // BAGS is sorted smallest first
      if (bag && (!r || bag[0] * bag[1] < r.bag[0] * r.bag[1])) r = { bag, n, turned: n !== opts[0] };
    }
    return r;
  };
  const fit = smallest(fits), comfy = smallest((b, n) => roomy(b, n, t));
  if (comfy) return { best: comfy, tight: fit && fit.bag !== comfy.bag ? fit : null, opts, H, t };
  return { best: fit, tight: null, tightOnly: !!fit, opts, H, t };
}

// ---- rendering ------------------------------------------------------------
let shown = null, goal = null;
function computeGoal() {
  const c = choose(state), n = c.best ? c.best.n : c.opts[0];
  // when nothing fits, draw the exact custom size needed
  const W = c.best ? c.best.bag[0] : Math.ceil(n.w), BL = c.best ? c.best.bag[1] : Math.ceil(n.l);
  return { ...c, v: { W, BL, nw: n.w, nl: n.l, pw: n.across / IN, pl: n.along / IN, ph: c.H / IN } };
}
function draw(v) {
  const VW = 560, VH = 600, pad = 50;
  const k = Math.min((VW - pad * 2) / Math.max(maxW(), v.W), (VH - pad * 2) / Math.max(maxL(), v.BL + FLAP));
  const bw = v.W * k, bl = v.BL * k, bf = FLAP * k;
  const x0 = (VW - bw) / 2, y0 = VH - pad - (bl + bf);
  let grid = '';
  for (let g = 0; g * k <= VW; g += 2) grid += `<line class="grid" x1="${VW / 2 + g * k}" x2="${VW / 2 + g * k}" y1="0" y2="${VH}"/><line class="grid" x1="${VW / 2 - g * k}" x2="${VW / 2 - g * k}" y1="0" y2="${VH}"/>`;
  for (let g = 0; g * k <= VH; g += 2) grid += `<line class="grid" x1="0" x2="${VW}" y1="${VH - pad - g * k}" y2="${VH - pad - g * k}"/>`;
  const nw = v.nw * k, nl = v.nl * k, pw = v.pw * k, pl = v.pl * k;
  const nx = x0 + (bw - nw) / 2, ny = y0 + bf + bl - nl - 2;
  const px = x0 + (bw - pw) / 2, py = y0 + bf + bl - (v.ph / 2) * k - pl;
  $('front').innerHTML = `${grid}
    <rect x="${x0}" y="${y0 + bf}" width="${bw}" height="${bl}" rx="4" fill="var(--bag)" stroke="var(--bag-edge)" stroke-width="2"/>
    <rect x="${x0}" y="${y0}" width="${bw}" height="${bf}" rx="4" fill="var(--flap)" stroke="var(--bag-edge)" stroke-width="2"/>
    <line x1="${x0 + 6}" x2="${x0 + bw - 6}" y1="${y0 + bf * .55}" y2="${y0 + bf * .55}" stroke="var(--bag-edge)" stroke-dasharray="5 4"/>
    <text x="${x0 + bw / 2}" y="${y0 + bf * .55 - 6}" text-anchor="middle" font-size="11">2 in flap</text>
    <rect x="${nx}" y="${ny}" width="${nw}" height="${nl}" rx="3" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="6 4"/>
    <rect x="${px}" y="${py}" width="${pw}" height="${pl}" rx="3" fill="var(--product)" stroke="var(--product-edge)" stroke-width="2"/>
    ${pl > 34 && pw > 60 ? `<text x="${px + pw / 2}" y="${py + pl / 2 + 4}" text-anchor="middle" font-weight="600">Product</text>` : ''}
    <line class="dim" x1="${x0}" x2="${x0 + bw}" y1="${y0 + bf + bl + 18}" y2="${y0 + bf + bl + 18}"/>
    <line class="dim" x1="${x0}" x2="${x0}" y1="${y0 + bf + bl + 12}" y2="${y0 + bf + bl + 24}"/>
    <line class="dim" x1="${x0 + bw}" x2="${x0 + bw}" y1="${y0 + bf + bl + 12}" y2="${y0 + bf + bl + 24}"/>
    <text class="dimtxt" x="${x0 + bw / 2}" y="${y0 + bf + bl + 38}" text-anchor="middle">width ${f1(v.W)} in</text>
    <line class="dim" x1="${x0 - 16}" x2="${x0 - 16}" y1="${y0 + bf}" y2="${y0 + bf + bl}"/>
    <line class="dim" x1="${x0 - 22}" x2="${x0 - 10}" y1="${y0 + bf}" y2="${y0 + bf}"/>
    <line class="dim" x1="${x0 - 22}" x2="${x0 - 10}" y1="${y0 + bf + bl}" y2="${y0 + bf + bl}"/>
    <text class="dimtxt" transform="translate(${x0 - 24} ${y0 + bf + bl / 2}) rotate(-90)" text-anchor="middle">length ${f1(v.BL)} in</text>`;
  drawSide(v, k, y0 + bf + bl, y0 + bf, bf, pl);
}
// Side view: product seen edge-on, bag pinched to a seam below it, closed flat above it, flap folded over the front.
function drawSide(v, k, yBottom, yMouth, bf, pl) {
  const t = v.ph * k, SW = Math.max(150, t + 110), cx = SW / 2;
  const boxB = yBottom - t / 2, boxT = boxB - pl, apex = boxT - t / 2;
  const short = yMouth > apex + 0.5;                        // bag too short: mouth can't close flat
  const open = short ? Math.min(t / 2, yMouth - apex) : 0;  // half-gap left at the mouth
  const panel = s => `M ${cx} ${yBottom} L ${cx + s * t / 2} ${boxB} L ${cx + s * t / 2} ${boxT} L ${cx + s * open} ${short ? yMouth : apex} L ${cx + s * open} ${yMouth}`;
  const r = 5, ok = short ? 'var(--bad)' : 'var(--ok)';
  // flap continues from the back panel (right) and folds down over the front panel (left)
  const flap = short
    ? `M ${cx + open} ${yMouth} L ${cx + open} ${yMouth - bf}`
    : `M ${cx} ${yMouth} A ${r} ${r} 0 0 0 ${cx - 2 * r} ${yMouth} L ${cx - 2 * r} ${yMouth + bf}`;
  const top = yMouth - (short ? bf : 0) - 34, h = yBottom + 26 - top;
  const half = t > 24 ? `
    <text x="${cx + t / 2 + 6}" y="${boxB + t / 4 + 4}" class="dimtxt">½H</text>
    <text x="${cx + t / 2 + 6}" y="${boxT - t / 4 + 4}" class="dimtxt">½H</text>` : '';
  $('side').setAttribute('viewBox', `0 ${top} ${SW} ${h}`);
  $('side').innerHTML = `
    <rect x="${cx - t / 2}" y="${boxT}" width="${t}" height="${pl}" rx="2" fill="var(--product)" stroke="var(--product-edge)" stroke-width="2"/>
    <path d="${panel(1)}" fill="none" stroke="var(--bag-edge)" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="${panel(-1)}" fill="none" stroke="var(--bag-edge)" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="${flap}" fill="none" stroke="${ok}" stroke-width="4" stroke-linecap="round"/>${half}
    ${short ? '' : `<text x="${cx - 2 * r - 6}" y="${yMouth + bf / 2 + 4}" text-anchor="end" class="dimtxt" style="fill:var(--ok)">flap</text>`}
    <text x="${cx}" y="${top + 18}" text-anchor="middle" style="fill:${ok};font-weight:600">${short ? 'won\'t close' : 'closes & seals'}</text>
    <text x="${cx}" y="${yBottom + 18}" text-anchor="middle" class="dimtxt">bottom seam</text>`;
}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate() {
  if (!shown || reduceMotion) shown = { ...goal.v };
  let moving = false;
  for (const key in goal.v) {
    const d = goal.v[key] - shown[key];
    if (Math.abs(d) > 0.005) { shown[key] += d * 0.22; moving = true; } else shown[key] = goal.v[key];
  }
  draw(shown);
  if (moving) requestAnimationFrame(animate);
}
function update() {
  goal = computeGoal();
  const { best, tight, tightOnly, opts, H } = goal, { L, B, M } = state;
  const n = best ? best.n : opts[0];
  $('result').classList.toggle('none', !best);
  const tw = $('tight-warn'); tw.hidden = true;
  if (best) {
    const [w, l] = best.bag;
    $('out-size').textContent = `${w} × ${l} in`;
    $('out-sub').textContent = `+ 2 in flap · ${f1(w * IN)} × ${f1(l * IN)} cm (${f1((l + FLAP) * IN)} cm with flap)`;
    $('r-spare').textContent = `${f1(w - n.w)} in wide · ${f1(l - n.l)} in long`;
    if (tight) {
      const sp = Math.min(tight.bag[0] - tight.n.w, tight.bag[1] - tight.n.l);
      tw.hidden = false;
      tw.textContent = `${tight.bag[0]} × ${tight.bag[1]} technically fits, but with only ${f1(sp)} in to spare. That's too tight to pack and seal reliably, so the next size up is recommended.`;
    } else if (tightOnly) {
      tw.hidden = false;
      tw.textContent = `Tight fit: only ${f1(Math.min(w - n.w, l - n.l))} in to spare, and there's no bigger size in your list. Test-pack one before using it.`;
    }
  } else {
    $('out-size').textContent = 'No size in your list fits';
    $('out-sub').textContent = `Needs a custom bag of at least ${f1(n.w)} × ${f1(n.l)} in + flap, or a box.`;
    $('r-spare').textContent = '–';
  }
  const hTxt = state.soft ? `½×${f1(state.H)}` : f1(H);
  $('r-nw').textContent = `${f1(n.across)} + ${hTxt} + ${f1(M)} = ${f1(n.w * IN)} cm (${f1(n.w)} in)`;
  $('r-nl').textContent = `${f1(n.along)} + ${hTxt} + ${f1(M)} + ${CLOSE} = ${f1(n.l * IN)} cm (${f1(n.l)} in)`;
  $('r-orient').textContent = best && best.turned ? 'turned sideways' : 'upright (length top to bottom)';

  $('sizes').innerHTML = BAGS.map(b => {
    const cls = best && b === best.bag ? (tightOnly ? 'pick tight' : 'pick')
      : opts.some(o => roomy(b, o, goal.t)) ? 'fits' : opts.some(o => fits(b, o)) ? 'tight' : '';
    return `<span class="${cls}">${b[0]}×${b[1]}</span>`;
  }).join('');

  // advice: would a different thickness side give a smaller bag?
  const note = $('note'); note.hidden = true;
  const area = r => r ? r.bag[0] * r.bag[1] : Infinity;
  const alts = state.soft ? [] : [['length', choose({ ...state, L: B, B: H, H: L }).best], ['width', choose({ ...state, B: H, H: B }).best]];
  const better = alts.filter(([, r]) => area(r) < area(best)).sort((a, b) => area(a[1]) - area(b[1]))[0];
  if (better) {
    note.className = 'note tip'; note.hidden = false;
    note.textContent = `Tip: if the product can be packed with its ${better[0]} as the thickness instead, a ${better[1].bag[0]} × ${better[1].bag[1]} in bag is enough.`;
  } else if (!state.soft && H > Math.min(L, B)) {
    note.className = 'note tip'; note.hidden = false;
    note.textContent = 'Heads-up: this product is thicker than it is wide. A flat poly bag will bulge; a box or padded mailer may protect it better.';
  } else if (best && best.turned) {
    note.className = 'note info'; note.hidden = false;
    note.textContent = 'Turning the product sideways inside the bag lets you use a smaller size.';
  }
  renderProducts();  // "Bag now" column follows the size list
  requestAnimationFrame(animate);
}

// ---- inputs ---------------------------------------------------------------
function set(id, cm, from) {
  cm = parseFloat(cm); if (!isFinite(cm)) return;
  state[id] = Math.max(id === 'M' ? 0 : 0.1, cm);
  if (from !== $(id)) $(id).value = state[id];
  if (from !== $(id + '-n')) $(id + '-n').value = r2(state[id]);
  if (from !== $(id + '-i')) $(id + '-i').value = r2(state[id] / IN);
  update();
}
function setSoft(v) { $('soft').checked = state.soft = !!v; }
['L', 'B', 'H', 'M'].forEach(id => {
  $(id).addEventListener('input', e => set(id, e.target.value, e.target));
  $(id + '-n').addEventListener('input', e => { if (e.target.value !== '') set(id, e.target.value, e.target); });
  $(id + '-i').addEventListener('input', e => { if (e.target.value !== '') set(id, e.target.value * IN, e.target); });
  [$(id + '-n'), $(id + '-i')].forEach(el => el.addEventListener('change', () => set(id, state[id])));
});
$('soft').addEventListener('change', e => { state.soft = e.target.checked; update(); });
PRESETS.forEach(([name, l, b, h, soft = false]) => {
  const btn = document.createElement('button'); btn.textContent = name;
  btn.onclick = () => { setSoft(soft); set('L', l); set('B', b); set('H', h); };
  $('presets').appendChild(btn);
});

// ---- account & saved products -----------------------------------------------
let store = null, mode = 'loading', products = [], activeId = null, pendingDelete = null, canSave = false;
let carry = null;  // products kept on this device, moved into the account after a mobile login
let flash = null;  // a message to show once the account switch has landed
// +919876543210 -> +91 98765 43210
const prettyPhone = p => /^\+91\d{10}$/.test(p || '') ? `+91 ${p.slice(3, 8)} ${p.slice(8)}` : (p || '');
const account = createAccount();
function status(text, kind = '') { const s = $('save-status'); s.textContent = text; s.className = 'status ' + kind; }
function editMsg(text) { $('edit-msg').textContent = text; }
function failed(e) {
  if (e && e.code === 'permission-denied') status("You don't have access to these saved products. Log out and log in again.", 'bad');
  else if (e && e.code === 'resource-exhausted') status('Storage limit reached. Delete some saved products, then try again.', 'bad');
  else status("Couldn't reach your saved products. Check your connection and try again.", 'bad');
}

async function onAccount(info) {
  const prev = store;
  if (info.mode === 'phone') info = { ...info, label: prettyPhone(info.label) };
  mode = info.mode; store = info.store; products = []; activeId = null; pendingDelete = null;
  renderAccountBar(info);
  if (!store) {
    canSave = false; $('save-btn').disabled = true;
    status('Log in or continue as a guest to save products.');
    renderProducts(); openLogin('choose');
    return;
  }
  canSave = true; $('save-btn').disabled = false;
  BAGS = store.kind === 'local' ? sortBags(loadLocalBags()) : sortBags(DEFAULT_BAGS.map(b => [...b]));
  store.watchBags(bags => {
    BAGS = sortBags(bags.map(b => [Number(b.w), Number(b.l)]).filter(b => b[0] > 0 && b[1] > 0));
    renderEditor(); update();
  }, failed);
  store.watchProducts(list => { products = list; renderProducts(); }, failed);
  renderEditor(); update();
  if (mode === 'guest' || mode === 'phone') closeLogin();

  if (mode === 'device-guest') {
    status(account.enabled ? 'Guest: products are saved in this browser only.'
                           : 'Guest: products are saved in this browser only. Mobile login isn\'t set up on this site yet.');
    editMsg('Width × length in inches, flap not included. Saved in this browser.');
  } else if (mode === 'guest') {
    status('Guest: products are saved for this device. Log in with your mobile number to keep them and use them on any device.');
    editMsg('Width × length in inches, flap not included. Saved for this device.');
  } else {
    status(`Logged in as ${info.label}. Products save to your account.`, 'ok');
    editMsg('Width × length in inches, flap not included. Saved to your account.');
  }
  if (info.error) status(info.error, 'bad');
  if (mode === 'phone' && flash) { status(flash, 'ok'); flash = null; }

  // products saved on this device before a mobile login move into the account
  if (mode === 'phone' && carry && carry.items.length) {
    const { items, from } = carry; carry = null;
    try {
      for (const p of items) { const { id, ...body } = p; await store.saveProduct(null, body); }
      for (const p of items) await from.deleteProduct(p.id);
      status(`Logged in as ${info.label}. Moved ${items.length} product${items.length > 1 ? 's' : ''} from this device into your account.`, 'ok');
    } catch (e) { failed(e); }
  }
  if (prev && prev !== store && prev.kind === 'local') prev.stop();
}

function renderAccountBar(info) {
  $('acct-label').textContent = info.label || '';
  $('acct-label').hidden = !info.label;
  $('acct-login').hidden = info.mode === 'phone';
  $('acct-logout').hidden = !(info.mode === 'phone' || (info.mode === 'guest'));
  $('acct-logout').textContent = info.mode === 'guest' ? 'Leave guest mode' : 'Log out';
}

$('save-btn').addEventListener('click', async () => {
  const name = $('pname').value.trim();
  if (!name) { status('Type a product name first.', 'bad'); $('pname').focus(); return; }
  if (!canSave || !store) { openLogin('choose'); return; }
  const body = { name, L: state.L, B: state.B, H: state.H, M: state.M, soft: state.soft, updatedAt: Date.now() };
  // same name (ignoring case) updates that product instead of making a duplicate
  const existing = products.find(p => String(p.name).toLowerCase() === name.toLowerCase());
  $('save-btn').disabled = true;
  try {
    activeId = await store.saveProduct(existing ? existing.id : null, body);
    status(existing ? `Updated "${name}".` : `Saved "${name}".`, 'ok');
    renderProducts();
  } catch (e) { failed(e); }
  $('save-btn').disabled = !canSave;
});
$('pname').addEventListener('keydown', e => { if (e.key === 'Enter') $('save-btn').click(); });

function loadProduct(p) {
  activeId = p.id;
  $('pname').value = p.name;
  setSoft(p.soft);
  set('M', p.M ?? 1.5); set('L', p.L); set('B', p.B); set('H', p.H);
  status(`Opened "${p.name}". Change the size and press Save to update it.`, 'ok');
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}
async function deleteProduct(p) {
  try {
    await store.deleteProduct(p.id);
    if (activeId === p.id) activeId = null;
    status(`Deleted "${p.name}".`, 'ok');
  } catch (e) { failed(e); }
}
function renderProducts() {
  const body = $('plist'); if (!body) return;
  const q = $('search').value.trim().toLowerCase();
  const rows = products.filter(p => !q || String(p.name).toLowerCase().includes(q));
  body.replaceChildren();
  $('pempty').hidden = rows.length > 0;
  if (!store) $('pempty').textContent = 'Log in or continue as a guest to save products here.';
  else if (q && !rows.length) $('pempty').textContent = `No saved product matches "${$('search').value.trim()}".`;
  else $('pempty').textContent = 'No saved products yet. Set a size above, type a product name and press Save.';
  for (const p of rows) {
    const tr = document.createElement('tr'); if (p.id === activeId) tr.className = 'active';
    const c = choose({ L: +p.L, B: +p.B, H: +p.H, M: +(p.M ?? 1.5), soft: !!p.soft });
    const name = document.createElement('td'); name.className = 'name'; name.textContent = p.name;
    if (p.soft) { const s = document.createElement('span'); s.className = 'pill'; s.textContent = 'soft'; name.append(s); }
    const dims = document.createElement('td'); dims.className = 'dims';
    dims.textContent = `${f1(p.L)} × ${f1(p.B)} × ${f1(p.H)} cm`;
    const bag = document.createElement('td'); bag.className = 'bag';
    if (c.best) { const b = document.createElement('b'); b.textContent = `${c.best.bag[0]} × ${c.best.bag[1]} in`; bag.append(b); }
    else bag.textContent = 'none fits';
    const acts = document.createElement('td'); acts.className = 'acts';
    const open = document.createElement('button'); open.className = 'btn quiet small'; open.textContent = 'Open';
    open.onclick = () => loadProduct(p);
    const del = document.createElement('button');
    const confirming = pendingDelete === p.id;
    del.className = confirming ? 'btn danger small' : 'btn quiet small';
    del.textContent = confirming ? 'Confirm delete' : 'Delete';
    del.onclick = () => {
      if (pendingDelete === p.id) { pendingDelete = null; deleteProduct(p); }
      else { pendingDelete = p.id; renderProducts(); setTimeout(() => { if (pendingDelete === p.id) { pendingDelete = null; renderProducts(); } }, 4000); }
    };
    acts.append(open, del);
    tr.append(name, dims, bag, acts);
    body.append(tr);
  }
}
$('search').addEventListener('input', renderProducts);

// ---- login dialog -----------------------------------------------------------
const dlg = $('login');
let resendTimer = null, sentTo = '';
function dlgErr(text) { $('dlg-err').textContent = text || ''; $('dlg-err').hidden = !text; }
function showStep(step) {
  ['choose', 'phone', 'otp'].forEach(s => { $('step-' + s).hidden = s !== step; });
  $('dlg-title').textContent = step === 'choose' ? 'Welcome' : step === 'phone' ? 'Log in with mobile' : 'Enter OTP';
  dlgErr('');
  if (step === 'phone') {
    $('phone-off').hidden = account.enabled;
    $('send-otp').disabled = !account.enabled;
    setTimeout(() => $('phone').focus(), 0);
  }
  if (step === 'otp') setTimeout(() => $('otp').focus(), 0);
  $('demo-note').hidden = !account.demo || step === 'choose';
}
function openLogin(step) {
  showStep(step);
  $('dlg-guest-row').hidden = mode === 'guest' || mode === 'device-guest';
  if (!dlg.open) dlg.showModal();
}
function closeLogin() { if (dlg.open) dlg.close(); }
// closing the welcome dialog without choosing means "use as guest"
dlg.addEventListener('close', () => { account.cancelOtp(); clearInterval(resendTimer); if (mode === 'signed-out') account.continueAsGuest(); });
$('dlg-close').addEventListener('click', closeLogin);
$('acct-login').addEventListener('click', () => openLogin('phone'));
$('acct-logout').addEventListener('click', async () => { await account.logout(); });
$('choose-phone').addEventListener('click', () => showStep('phone'));
$('choose-guest').addEventListener('click', () => { closeLogin(); });
$('dlg-guest').addEventListener('click', () => { closeLogin(); });
$('back-choose').addEventListener('click', () => { if (mode === 'signed-out') showStep('choose'); else closeLogin(); });
$('change-number').addEventListener('click', () => { account.cancelOtp(); clearInterval(resendTimer); showStep('phone'); });

function phoneNumber() {
  const cc = $('cc').value, digits = $('phone').value.replace(/\D/g, '').replace(/^0+/, '');
  if (cc === '+91' && !/^[6-9]\d{9}$/.test(digits)) return { error: 'Enter a 10-digit Indian mobile number.' };
  if (cc !== '+91' && !/^\d{6,14}$/.test(digits)) return { error: 'Enter your mobile number without the country code.' };
  return { number: cc + digits };
}
async function sendOtp() {
  const { number, error } = phoneNumber();
  if (error) { dlgErr(error); return; }
  const btn = $('send-otp'), resend = $('resend');
  btn.disabled = resend.disabled = true; btn.textContent = 'Sending…';
  dlgErr('');
  try {
    await account.sendOtp(number, 'recaptcha-anchor');
    sentTo = number;
    $('otp-to').textContent = number;
    $('otp').value = '';
    showStep('otp');
    startResendTimer();
  } catch (e) { dlgErr(authMessage(e)); }
  btn.disabled = !account.enabled; btn.textContent = 'Send OTP';
}
function startResendTimer() {
  let left = 30; const r = $('resend');
  r.disabled = true; r.textContent = `Resend in ${left}s`;
  clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) { clearInterval(resendTimer); r.disabled = false; r.textContent = 'Resend OTP'; }
    else r.textContent = `Resend in ${left}s`;
  }, 1000);
}
$('send-otp').addEventListener('click', sendOtp);
$('phone').addEventListener('keydown', e => { if (e.key === 'Enter') sendOtp(); });
$('resend').addEventListener('click', sendOtp);
async function verify() {
  const code = $('otp').value.replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) { dlgErr('Enter the 6-digit OTP from the SMS.'); return; }
  const btn = $('verify'); btn.disabled = true; btn.textContent = 'Checking…'; dlgErr('');
  if (store && store.kind === 'local' && products.length) carry = { items: products.slice(), from: store };
  try {
    const { merged } = await account.verifyOtp(code, mode === 'guest' ? products.slice() : []);
    closeLogin();
    if (merged) {
      const msg = `Logged in. Added your ${merged} guest product${merged > 1 ? 's' : ''} to your account.`;
      if (mode === 'phone') status(msg, 'ok'); else flash = msg;  // the account switch may land before or after this
    }
  } catch (e) { carry = null; dlgErr(authMessage(e)); }
  btn.disabled = false; btn.textContent = 'Verify and log in';
}
$('verify').addEventListener('click', verify);
$('otp').addEventListener('keydown', e => { if (e.key === 'Enter') verify(); });
$('otp').addEventListener('input', e => { const v = e.target.value.replace(/\D/g, ''); if (v.length === 6) verify(); });

// ---- size list editor -------------------------------------------------------
function persistBags() {
  if (store) store.saveBags(BAGS.map(([w, l]) => ({ w, l }))).catch(failed);
}
function renderEditor() {
  $('edit-list').innerHTML = BAGS.map((b, i) =>
    `<span>${b[0]}×${b[1]}<button data-i="${i}" aria-label="Remove ${b[0]} by ${b[1]}">×</button></span>`).join('');
}
function changed(msg) { sortBags(BAGS); persistBags(); renderEditor(); update(); editMsg(msg); }
$('edit-list').addEventListener('click', e => {
  const i = e.target.dataset.i; if (i === undefined) return;
  if (BAGS.length === 1) { editMsg('Keep at least one size in the list.'); return; }
  const [b] = BAGS.splice(+i, 1);
  changed(`Removed ${b[0]}×${b[1]}.`);
});
$('add-btn').addEventListener('click', () => {
  const w = parseFloat($('add-w').value), l = parseFloat($('add-l').value);
  if (!(w > 0 && l > 0)) { editMsg('Enter both width and length in inches.'); return; }
  if (BAGS.some(b => b[0] === w && b[1] === l)) { editMsg(`${w}×${l} is already in the list.`); return; }
  BAGS.push([w, l]); $('add-w').value = $('add-l').value = '';
  changed(`Added ${w}×${l}.`);
});
['add-w', 'add-l'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('add-btn').click(); }));
$('reset-wrap').addEventListener('click', e => {
  const wrap = $('reset-wrap');
  if (e.target.id === 'reset-btn') {
    wrap.innerHTML = 'Replace your list with the default sizes? <button class="btn danger small" id="reset-yes">Reset</button> <button class="btn quiet small" id="reset-no">Cancel</button>';
  } else if (e.target.id === 'reset-yes' || e.target.id === 'reset-no') {
    if (e.target.id === 'reset-yes') { BAGS = sortBags(DEFAULT_BAGS.map(b => [...b])); changed('Reset to the default list.'); }
    wrap.innerHTML = '<button class="btn ghost small" id="reset-btn">Reset to default list</button>';
  }
});

// ---- start ------------------------------------------------------------------
setSoft($('soft').checked);  // browsers may restore the checkbox
['L', 'B', 'H', 'M'].forEach(id => set(id, state[id]));
renderEditor();
status('Loading…');
account.start(onAccount);
