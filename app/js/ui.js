import * as M from './model.js';
import { persist } from './db.js';

/* ---------- small helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fdate = iso => iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fday = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
const ftime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const wide = () => window.innerWidth >= 1100;
const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };

const PATHS = {
  home: '<path d="M3 11 12 4l9 7v9H3z"/><path d="M9 20v-6h6v6"/>',
  box: '<path d="M3 8 12 3l9 5v8l-9 5-9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  share: '<path d="M12 15V4m0 0L8 8m4-4 4 4"/><path d="M5 12v7h14v-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  up: '<path d="M7 17 17 7M9 7h8v8"/>',
  down: '<path d="M12 5v14m0 0-5-5m5 5 5-5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v5m0 2.5v.5"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
};
const ic = name => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;

const chip = (kind, text) => `<span class="chip chip-${kind}">${ic({ out: 'up', in: 'check', moved: 'swap', warn: 'alert' }[kind])}${esc(text)}</span>`;
const moveChip = m => chip({ out: 'out', back: 'in', move: 'moved' }[m.type], { out: 'Out', back: 'Returned', move: 'Moved' }[m.type]);

function statusChip(a, st) {
  if (!st.out) return chip('in', 'In place');
  return chip('out', st.out === a.qty ? `Out · ${st.where}` : `${st.out} of ${a.qty} out`);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4500);
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'phone';
  return 'computer';
}

function readFile(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); });
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Hands the CSV to the device's share sheet (Mail is one tap away, with the file attached).
// Where the browser cannot attach files, the file is saved and a blank email is opened instead.
async function emailFile(name, text, subject, body) {
  const file = new File([text], name, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: subject, text: body }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  download(name, text);
  location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + `\n\n(Attach the file "${name}" from your Downloads folder.)`)}`;
  return 'downloaded';
}

/* ---------- shell and routing ---------- */

const TABS = [['home', 'Home', 'home'], ['assets', 'Everything', 'box'], ['more', 'More', 'menu']];

function shell(view) {
  const h = M.hall();
  const unsent = h ? M.unsentCount() : 0;
  const tab = ['home', 'assets'].includes(view.tab) ? view.tab : 'more';
  const nav = view.bare ? '' : `
    <nav class="nav">
      <div class="brand"><img src="icon.svg" alt="" width="28" height="28"><span>LDC Inventory</span></div>
      <div class="tabs">${TABS.map(([id, label, icon]) => `
        <a href="#/${id}" class="tab ${tab === id ? 'on' : ''}" ${tab === id ? 'aria-current="page"' : ''}>${ic(icon)}<span>${label}</span>${id === 'more' && unsent ? '<i class="dot"></i>' : ''}</a>`).join('')}
      </div>
      <div class="rail-foot">${ic('phone')}<span>Saved on this ${deviceName()}${unsent ? `<br><b>${plural(unsent, 'change')} not sent</b>` : ''}</span></div>
    </nav>`;
  // On a phone there is no tab bar: every screen has one way back, to Home.
  const homelink = view.bare || view.modal || view.split || view.tab === 'home' ? '' : `<a class="homelink" href="#/home">${ic('back')}Home</a>`;
  return `<div class="shell ${view.bare ? 'bare' : ''}">${nav}<main class="view ${view.split ? 'split' : ''}" id="view">${homelink}${view.html}</main></div>`;
}

const VIEWS = {};

/* ---------- coordinator lock ----------
   A PIN kept on this device keeps volunteers out of the coordinator screens by accident.
   It is a convenience lock, not security: there is no server, so anyone who clears the
   browser's data, or reads this code, can get past it. */
const GATED = new Set(['more', 'projects', 'project', 'movements', 'share', 'item', 'setup', 'setpin']);
const LOCK_AFTER = 10 * 60 * 1000;
let unlocked = false, unlockedAt = 0;
const hasPin = () => !!M.S.meta.pin;
const isOpen = () => !hasPin() || (unlocked && Date.now() - unlockedAt < LOCK_AFTER);
async function hashPin(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function savePin(pin) {
  const salt = M.uid();
  await M.setMeta('pin', { salt, hash: await hashPin(pin, salt) });
  unlocked = true; unlockedAt = Date.now();
}
let current;

function parseRoute() {
  const [path, qs] = (location.hash.slice(1) || '/home').split('?');
  return { parts: path.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || '')) };
}

function render() {
  const { parts, q } = parseRoute();
  let name = parts[0] || 'home';
  if (!M.hall() || !VIEWS[name]) name = M.hall() ? 'home' : 'setup';
  const gated = M.hall() && (GATED.has(name) || (name === 'log' && q.type === 'move'));
  if (gated && isOpen()) unlockedAt = Date.now();
  const view = gated && !isOpen() ? VIEWS.pin() : VIEWS[name](parts.slice(1), q);
  current = view;
  $('#app').innerHTML = shell(view);
  const root = $('#view');
  root.onclick = e => { const el = e.target.closest('[data-act]'); if (el && view.on?.[el.dataset.act]) view.on[el.dataset.act](el, e); };
  root.oninput = e => view.input?.(e.target, e);
  root.onchange = e => view.change?.(e.target, e);
  root.onsubmit = e => { e.preventDefault(); view.submit?.(e.target, e); };
  // Enter in a search box must not submit the form around it.
  root.onkeydown = e => { if (e.key === 'Enter' && e.target.type === 'search') e.preventDefault(); };
  if (!view.keepScroll) window.scrollTo(0, 0);
}

/* ---------- Home ---------- */

VIEWS.home = () => {
  const h = M.hall(), as = M.assets();
  const out = as.reduce((n, a) => n + M.assetState(a).out, 0);
  const unsent = M.unsentCount();
  const hallPick = M.S.halls.length > 1
    ? `<select class="hall-pick" data-hall aria-label="Hall">${M.S.halls.map(x => `<option value="${x.id}" ${x.id === h.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
    : `<p class="hallname">${esc(h.name)}</p>`;
  const html = `
    <header class="top"><span class="eyebrow">LDC Inventory</span><span class="pill">${ic('phone')}Saved on this ${deviceName()}</span></header>
    ${hallPick}
    ${!as.length ? `<h1>Add your first item</h1><section class="card hint"><p>There is no equipment in this hall yet.</p><a class="btn primary" href="#/item/new">${ic('plus')}Add an item</a></section>` : `
    <h1>What are you doing?</h1>
    <a class="choice out" href="#/log?type=out">${ic('up')}<b>Taking things out</b></a>
    <a class="choice in" href="#/log?type=back">${ic('down')}<b>Bringing things back</b></a>
    <a class="choice plain" href="#/assets">${ic('box')}<b>See everything</b></a>
    <a class="status ${out ? 'warn' : 'good'}" href="#/assets?f=${out ? 'out' : 'all'}">${ic(out ? 'up' : 'check')}${out ? `${plural(out, 'thing')} out right now` : 'Everything is here'}</a>`}
    ${unsent && hasPin() ? `<button class="status send" data-act="send">${ic('mail')}Send my changes (${unsent})</button>` : ''}
    <a class="morelink" href="#/more">${hasPin() && !isOpen() ? `${ic('lock')}Coordinator` : `${ic('menu')}More${unsent ? '<i class="dot"></i>' : ''}`}</a>`;
  return {
    tab: 'home', html,
    on: {
      send: async () => {
        const ex = M.buildExport('changes');
        const r = await emailFile(ex.name, ex.text, `${h.name} inventory changes`, `Changes from ${M.S.meta.userName || 'a volunteer'} for ${h.name}: ${plural(ex.movements, 'movement')}. Open it in LDC Inventory under Send or receive.`);
        if (r === 'cancelled') return;
        await M.markSent('changes', ex);
        toast(r === 'downloaded' ? `Saved ${ex.name}. Attach it to the email that just opened.` : 'Sent.');
        render();
      },
    },
    change: async el => { if (el.dataset.hall !== undefined) { await M.setMeta('hallId', el.value); render(); } },
  };
};

/* ---------- More: everything a coordinator needs, out of the volunteer's way ---------- */

VIEWS.more = () => {
  const unsent = M.unsentCount();
  const row = (href, icon, title, sub, dot) => `<a class="row tall" href="${href}"><span class="rowic">${ic(icon)}</span><span><b>${title}</b><small>${sub}</small></span>${dot ? '<i class="dot"></i>' : ''}${ic('chev')}</a>`;
  const html = `
    <h1>More</h1>
    <section class="card list">
      ${row('#/projects', 'folder', 'Projects', 'Check that everything came back from a job')}
      ${row('#/movements', 'clock', 'History', 'Everything that was taken out or brought back')}
      ${row('#/share', 'share', 'Send or receive', unsent ? `${plural(unsent, 'change')} not sent yet` : 'Pass changes to another device by email', unsent)}
    </section>
    <section class="card list">
      ${row('#/item/new', 'plus', 'Add an item', 'Put a new piece of equipment on the list')}
      ${row('#/setup?new=1', 'home', 'Set up another hall', 'Keep a second hall on this device')}
    </section>
    <section class="card list">
      ${row('#/setpin', 'lock', hasPin() ? 'Change the coordinator PIN' : 'Set a coordinator PIN', hasPin() ? 'Or turn the lock off' : 'Keep volunteers on the simple screens')}
      ${hasPin() ? `<button class="row tall" data-act="lock"><span class="rowic">${ic('lock')}</span><span><b>Lock now</b><small>Locks by itself after 10 minutes</small></span></button>` : ''}
    </section>`;
  return { tab: 'more', html, on: { lock: () => { unlocked = false; toast('Coordinator screens are locked.'); go('#/home'); } } };
};

/* ---------- Assets ---------- */

const A = { q: '', f: 'all', room: '' };

function assetList(selId) {
  const as = M.assets(), st = new Map(as.map(a => [a.id, M.assetState(a)]));
  const q = A.q.trim().toLowerCase();
  const shown = as.filter(a => {
    const s = st.get(a.id);
    if (A.f === 'out' && !s.out) return false;
    if (A.f === 'in' && s.out) return false;
    if (A.f === 'noserial' && a.serial) return false;
    if (A.room && a.roomId !== A.room) return false;
    return !q || [a.name, a.brand, a.model, a.serial, a.assetId].some(v => (v || '').toLowerCase().includes(q));
  });
  if (!shown.length) return `<p class="empty">${as.length ? 'Nothing matches.' : 'No items yet.'}</p>`;
  const groups = [...M.rooms(), { id: '', name: 'No room' }].map(r => [r, shown.filter(a => (a.roomId || '') === r.id)]).filter(g => g[1].length);
  return groups.map(([r, list]) => `
    <h3 class="sec">${esc(r.name)} · ${list.length}</h3>
    <section class="card list assets">${list.map(a => {
      const s = st.get(a.id);
      return `<a class="arow ${a.id === selId ? 'sel' : ''}" href="#/asset/${a.id}">
        <span class="mono aid">${esc(a.assetId)}</span>
        <span class="astat">${statusChip(a, s)}</span>
        <b class="aname">${esc(a.name)}</b>
        <span class="ameta">${[a.brand, a.model].filter(Boolean).map(esc).join(' · ') || '—'}</span>
        <span class="aqty">Qty ${a.qty}</span>
        <span class="acond">${esc(a.condition || '')}</span>
      </a>`;
    }).join('')}</section>`).join('');
}

function assetsPane(selId) {
  const as = M.assets(), st = as.map(a => M.assetState(a));
  const n = { all: as.length, out: st.filter(s => s.out).length, in: st.filter(s => !s.out).length, noserial: as.filter(a => !a.serial).length };
  const units = as.reduce((x, a) => x + a.qty, 0);
  const room = A.room && M.byId('rooms', A.room);
  return `
    <header class="top"><div><h1>Everything</h1><p class="sub">${esc(M.hall().name)} · ${plural(as.length, 'item')} · ${plural(units, 'unit')}</p></div>
      </header>
    <label class="search">${ic('search')}<input type="search" data-q placeholder="Search item, brand or serial" value="${esc(A.q)}"></label>
    <div class="chips">
      ${[['all', 'All'], ['out', 'Out'], ['in', 'In place'], ['noserial', 'No serial']].map(([k, l]) => `<button class="fchip ${A.f === k ? 'on' : ''}" data-act="f" data-v="${k}">${l} ${n[k]}</button>`).join('')}
      ${room ? `<button class="fchip on" data-act="room">${esc(room.name)} ${ic('x')}</button>` : ''}
    </div>
    <div id="alist">${assetList(selId)}</div>`;
}

const assetHandlers = (rerender) => ({
  on: {
    f: el => { A.f = el.dataset.v; rerender(); },
    room: () => { A.room = ''; rerender(); },
  },
  input: el => { if (el.dataset.q !== undefined) { A.q = el.value; $('#alist').innerHTML = assetList(current.selId); } },
});

VIEWS.assets = (_, q) => {
  if (q.f) A.f = q.f;
  if (q.room !== undefined) A.room = q.room;
  if (q.f || q.room !== undefined) history.replaceState(null, '', '#/assets');
  const html = wide()
    ? `<div class="pane">${assetsPane()}</div><aside class="detail"><p class="empty">Choose an item to see its details and history.</p></aside>`
    : assetsPane();
  return { tab: 'assets', split: wide(), html, ...assetHandlers(render) };
};

function assetDetail(a) {
  const st = M.assetState(a);
  const proj = st.projectId && M.byId('projects', st.projectId);
  const rows = [['Brand', a.brand], ['Model', a.model], ['Serial', a.serial ? `<span class="mono">${esc(a.serial)}</span>` : '<i>None recorded</i>', true],
    ['Quantity', a.qty], ['Condition', a.condition], ['Home room', M.roomName(a.roomId)], ['Last inventoried', fdate(a.lastInventoried)], ['Notes', a.notes]];
  return `
    <header class="top bar"><a class="backlink" href="#/assets">${ic('back')}Everything</a>${isOpen() ? `<a class="textbtn" href="#/item/${a.id}">Edit</a>` : '<span></span>'}</header>
    <section class="card">
      <div class="between"><span class="mono">${esc(a.assetId)}</span>${statusChip(a, st)}</div>
      <h1>${esc(a.name)}</h1>
      <p class="sub">${[a.brand, a.model, M.roomName(a.roomId)].filter(Boolean).map(esc).join(' · ')}</p>
      ${st.out ? `<p class="note">${st.out} of ${a.qty} ${a.qty === 1 ? 'unit' : 'units'} out since ${fdate(st.since)}${proj ? ' · ' + esc(proj.name) : ''}</p>` : ''}
    </section>
    <label class="photo ${a.photo ? 'has' : ''}">
      ${a.photo ? `<img src="${a.photo}" alt="Reference photo of ${esc(a.name)}"><span class="photo-change">Change photo</span>` : `${ic('camera')}<b>Add a reference photo</b><small>Stays on this device</small>`}
      <input type="file" accept="image/*" data-photo hidden>
    </label>
    <section class="card kv">${rows.filter(r => r[1] !== '' && r[1] != null).map(([k, v, raw]) => `<div><span>${k}</span><span>${raw ? v : esc(v)}</span></div>`).join('')}</section>
    <h3 class="sec">Movement history <small>Entries cannot be edited or deleted</small></h3>
    <section class="card timeline">${st.history.map(m => {
      const p = m.projectId && M.byId('projects', m.projectId);
      return `<div class="tl">${moveChip(m)}<time>${fdate(m.at)}</time><b>${plural(m.qty, 'unit')} · ${esc(m.from)} → ${esc(m.to)}</b><small>by ${esc(m.by)}${p ? ' · ' + esc(p.name) : ''}${m.notes ? ' · ' + esc(m.notes) : ''}</small></div>`;
    }).join('') || '<p class="empty">This item has not moved yet.</p>'}</section>
    <div class="stick">
      ${isOpen() ? `<a class="btn" href="#/log?type=move&asset=${a.id}">${ic('swap')}Move</a>` : ''}
      ${st.out ? `<a class="btn primary" href="#/log?type=back&asset=${a.id}">${ic('down')}Bring back</a>` : `<a class="btn primary" href="#/log?type=out&asset=${a.id}">${ic('up')}Take out</a>`}
    </div>`;
}

async function shrinkPhoto(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1000 / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

VIEWS.asset = ([id]) => {
  const a = M.byId('assets', id);
  if (!a) return VIEWS.assets([], {});
  const split = wide();
  const h = assetHandlers(render);
  return {
    tab: 'assets', split, selId: id, modal: !split, keepScroll: split,
    html: split ? `<div class="pane">${assetsPane(id)}</div><aside class="detail">${assetDetail(a)}</aside>` : assetDetail(a),
    ...h,
    change: async el => {
      if (el.dataset.photo === undefined || !el.files[0]) return;
      try { await M.savePhoto(a, await shrinkPhoto(el.files[0])); render(); } catch { toast('That photo could not be read.'); }
    },
  };
};

/* ---------- Taking out, bringing back, moving: one question at a time ---------- */

let L = {};

const logSteps = () => L.type === 'back' ? (L.skipHow ? ['items', 'who'] : L.all ? ['how', 'who'] : ['how', 'items', 'who'])
  : L.type === 'move' ? ['items', 'room', 'who'] : ['items', 'where', 'who'];

function logCandidates() {
  return M.assets().map(a => {
    const st = M.assetState(a);
    const max = L.type === 'out' ? st.inPlace : L.type === 'back' ? st.out : a.qty;
    return { a, st, max };
  }).filter(c => c.max > 0);
}

function logItems() {
  const q = L.q.trim().toLowerCase();
  const list = logCandidates().filter(c => !q || [c.a.name, c.a.brand, c.a.assetId].some(v => (v || '').toLowerCase().includes(q)));
  if (!list.length) return `<p class="empty">${q ? 'Nothing matches.' : L.type === 'back' ? 'Nothing is out right now.' : L.type === 'out' ? 'Everything is already out.' : 'No items.'}</p>`;
  return list.map(({ a, st, max }) => {
    const on = a.id in L.sel;
    return `<div class="pick ${on ? 'on' : ''}">
      <button type="button" class="box" data-act="toggle" data-id="${a.id}" data-max="${max}" role="checkbox" aria-checked="${on}" aria-label="${esc(a.name)}">${on ? ic('check') : ''}</button>
      <span data-act="toggle" data-id="${a.id}" data-max="${max}"><b>${esc(a.name)}</b><small>${
        L.type === 'move' ? esc(M.roomName(a.roomId)) : L.type === 'back' ? `${max} out · ${esc(st.where)}` : max > 1 ? `${max} here` : esc(M.roomName(a.roomId))}</small></span>
      ${on && max > 1 && L.type !== 'move' ? `<span class="stepper"><button type="button" data-act="dec" data-id="${a.id}" aria-label="One fewer">−</button><b>${L.sel[a.id]}</b><button type="button" data-act="inc" data-id="${a.id}" data-max="${max}" aria-label="One more">+</button></span>` : ''}
    </div>`;
  }).join('');
}

const destination = () => !L.to ? '' : L.to === 'Somewhere else' ? L.detail.trim() : (L.to !== 'Connex' && L.detail.trim() ? `${L.to}: ${L.detail.trim()}` : L.to);

function logSummary() {
  const n = Object.keys(L.sel).length, units = Object.values(L.sel).reduce((a, b) => a + b, 0);
  const things = `${plural(n, 'thing')}${units > n ? ` (${units} units)` : ''}`;
  return L.type === 'out' ? `Taking out ${things} to ${destination()}.` : L.type === 'back' ? `Bringing back ${things}.` : `Moving ${things} to ${M.roomName(L.roomId)}.`;
}

VIEWS.log = (_, q) => {
  if (L.key !== location.hash) {
    L = { key: location.hash, type: q.type || 'out', sel: {}, to: '', detail: '', roomId: '', projectId: q.project || '', newProject: '', by: M.S.meta.userName || '', notes: '', q: '', from: q, all: false, skipHow: !!(q.asset || q.project), done: '' };
    if (q.asset) { const c = logCandidates().find(c => c.a.id === q.asset); if (c) L.sel[c.a.id] = c.max; }
    if (q.project && L.type === 'back') for (const c of logCandidates()) if (c.st.projectId === q.project) L.sel[c.a.id] = c.max;
    L.step = logSteps()[0];
  }
  const leave = () => { L.key = ''; go(L.from.project ? `#/project/${L.from.project}` : L.from.asset ? `#/asset/${L.from.asset}` : '#/home'); };
  const redraw = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };

  if (L.step === 'done') {
    return {
      modal: true,
      html: `<div class="done">${ic('check')}<h1>Done</h1><p>${esc(L.done)}</p></div>
        <div class="stick col"><button class="btn primary" data-act="home">Back to start</button></div>`,
      on: { home: () => { L.key = ''; go('#/home'); } },
    };
  }

  const steps = logSteps(), i = steps.indexOf(L.step), last = i === steps.length - 1;
  const cands = logCandidates();
  const n = Object.keys(L.sel).length;
  const title = {
    how: 'What is coming back?',
    items: L.type === 'out' ? 'What are you taking?' : L.type === 'back' ? 'Which ones are coming back?' : 'What are you moving?',
    where: 'Where is it going?', room: 'Which room is its new home?', who: 'Who is doing this?',
  }[L.step];
  const dests = [['Connex', 'Storage container'], ['Another hall', 'Loaned out'], ['Off site', 'Repair or vendor'], ['Somewhere else', 'Type where']];
  const body = {
    how: () => !cands.length ? `<p class="empty">Nothing is out right now, so there is nothing to bring back.</p>` : `
      <button class="choice in" data-act="all">${ic('check')}<b>Everything that is out</b><small>${plural(cands.reduce((x, c) => x + c.max, 0), 'thing')}</small></button>
      <button class="choice plain" data-act="some">${ic('box')}<b>Only some of it</b><small>Choose which ones</small></button>`,
    items: () => `
      <label class="search">${ic('search')}<input type="search" data-lq placeholder="Find an item" value="${esc(L.q)}"></label>
      <section class="card list" id="picks">${logItems()}</section>`,
    where: () => `
      <div class="tiles one">${dests.map(([d, sub]) => `<button type="button" class="tile ${L.to === d ? 'on' : ''}" data-act="to" data-v="${d}"><b>${d}</b><small>${sub}</small></button>`).join('')}</div>
      ${L.to && L.to !== 'Connex' ? `<label class="field"><span>Where exactly?${L.to === 'Somewhere else' ? '' : ' (optional)'}</span><input data-k="detail" value="${esc(L.detail)}" placeholder="e.g. Maple Grove hall"></label>` : ''}`,
    room: () => `<div class="tiles one">${M.rooms().map(r => `<button type="button" class="tile ${L.roomId === r.id ? 'on' : ''}" data-act="room" data-v="${r.id}"><b>${esc(r.name)}</b></button>`).join('')}</div>`,
    who: () => `
      <p class="summary">${esc(logSummary())}</p>
      <label class="field"><span>Your name</span><input data-k="by" value="${esc(L.by)}" autocomplete="name" placeholder="So the log shows who did this"></label>
      ${L.type === 'out' ? `<details class="fold plainfold" ${L.projectId || L.notes ? 'open' : ''}><summary>Add a project or a note (optional)</summary>
        <label class="field"><span>Project</span><select data-k="projectId">
          <option value="">No project</option>
          ${M.projects().filter(p => !p.finished || p.id === L.projectId).map(p => `<option value="${p.id}" ${L.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          <option value="new" ${L.projectId === 'new' ? 'selected' : ''}>+ New project…</option></select></label>
        ${L.projectId === 'new' ? `<label class="field"><span>New project name</span><input data-k="newProject" value="${esc(L.newProject)}" placeholder="e.g. Remodel 2026"></label>` : ''}
        <label class="field"><span>Note</span><input data-k="notes" value="${esc(L.notes)}" placeholder="Anything worth remembering"></label>
      </details>` : ''}`,
  }[L.step]();
  const ready = { how: false, items: n > 0, where: !!destination(), room: !!L.roomId, who: true }[L.step];
  const html = `
    <header class="top bar"><a class="textbtn" data-act="cancel">Cancel</a>
      <span class="dots" aria-hidden="true">${steps.map((_, k) => `<b class="${k <= i ? 'on' : ''}"></b>`).join('')}</span>
      <small>Step ${i + 1} of ${steps.length}</small></header>
    <h1>${title}</h1>
    ${body}
    ${L.step === 'how' ? '' : `<div class="stick">
      ${i > 0 ? `<button class="btn" data-act="back">${ic('back')}Back</button>` : ''}
      <button class="btn primary grow" data-act="${last ? 'finish' : 'next'}" ${ready ? '' : 'disabled'}>${last ? 'Finish' : L.step === 'items' && n ? `Next · ${plural(n, 'thing')}` : 'Next'}</button>
    </div>`}`;

  return {
    modal: true, html,
    on: {
      cancel: leave,
      all: () => { L.all = true; L.sel = {}; for (const c of logCandidates()) L.sel[c.a.id] = c.max; L.step = 'who'; redraw(); },
      some: () => { L.all = false; L.sel = {}; L.step = 'items'; redraw(); },
      next: () => { L.step = steps[i + 1]; L.q = ''; render(); },
      back: () => { L.step = steps[i - 1]; if (L.step === 'how') L.all = false; render(); },
      toggle: el => { const id = el.dataset.id; if (id in L.sel) delete L.sel[id]; else L.sel[id] = +el.dataset.max; redraw(); },
      inc: el => { L.sel[el.dataset.id] = Math.min(+el.dataset.max, L.sel[el.dataset.id] + 1); redraw(); },
      dec: el => { L.sel[el.dataset.id] = Math.max(1, L.sel[el.dataset.id] - 1); redraw(); },
      to: el => { L.to = el.dataset.v; redraw(); },
      room: el => { L.roomId = el.dataset.v; redraw(); },
      finish: async () => {
        const items = Object.entries(L.sel).map(([id, qty]) => ({ asset: M.byId('assets', id), qty }));
        if (!items.length) return;
        if (!L.by.trim()) return toast('Add your name so the log shows who did this.');
        let projectId = L.projectId;
        if (L.type === 'out' && projectId === 'new') {
          if (!L.newProject.trim()) return toast('Give the new project a name.');
          projectId = (await M.createProject(L.newProject.trim())).id;
        }
        const summary = logSummary().replace(/^Taking out/, 'Took out').replace(/^Bringing back/, 'Brought back').replace(/^Moving/, 'Moved');
        await M.logMovements({ type: L.type, items, to: destination(), toRoomId: L.roomId, projectId, by: L.by.trim(), notes: L.notes.trim() });
        L.done = summary; L.step = 'done'; render();
        L.key = ''; // the next visit starts a fresh flow instead of showing this Done screen again
      },
    },
    input: el => {
      if (el.dataset.lq !== undefined) { L.q = el.value; $('#picks').innerHTML = logItems(); }
      else if (el.dataset.k && el.tagName !== 'SELECT') {
        L[el.dataset.k] = el.value;
        if (el.dataset.k === 'detail') { const b = $('[data-act=next]'); if (b) b.disabled = !destination(); }
      }
    },
    change: el => { if (el.tagName === 'SELECT' && el.dataset.k) { L[el.dataset.k] = el.value; redraw(); } },
  };
};

/* ---------- Movements ---------- */

const V = { q: '', f: 'all', project: '' };

function movementList() {
  const q = V.q.trim().toLowerCase();
  const list = M.movements().filter(m => {
    if (V.f !== 'all' && m.type !== V.f) return false;
    if (V.project && m.projectId !== V.project) return false;
    if (!q) return true;
    const a = M.byId('assets', m.assetRef), p = M.byId('projects', m.projectId);
    return [a?.name, m.by, p?.name, m.to, m.from].some(v => (v || '').toLowerCase().includes(q));
  });
  if (!list.length) return '<p class="empty">No entries match.</p>';
  const days = new Map();
  for (const m of list.slice(0, 300)) { const d = fdate(m.at); days.set(d, [...(days.get(d) || []), m]); }
  return [...days].map(([d, ms]) => `<h3 class="sec">${d}</h3><section class="card list">${ms.map(m => {
    const a = M.byId('assets', m.assetRef), p = M.byId('projects', m.projectId);
    return `<a class="row mrow" href="#/asset/${m.assetRef}">${moveChip(m)}<time>${ftime(m.at)}</time>
      <span><b>${esc(a?.name || 'Removed item')} ×${m.qty}</b><small>${esc(m.from)} → ${esc(m.to)}</small><small>by ${esc(m.by)}${p ? ' · ' + esc(p.name) : ''}</small></span></a>`;
  }).join('')}</section>`).join('') + (list.length > 300 ? `<p class="empty">Showing the latest 300 of ${list.length}. Search to narrow it down.</p>` : '');
}

VIEWS.movements = () => {
  const all = M.movements();
  const n = { all: all.length, out: 0, back: 0, move: 0 };
  for (const m of all) n[m.type]++;
  const html = `
    <header class="top"><div><h1>History</h1><p class="sub">${esc(M.hall().name)} · ${plural(all.length, 'entry').replace('entrys', 'entries')}</p></div>
      </header>
    <label class="search">${ic('search')}<input type="search" data-q placeholder="Search item, person or project" value="${esc(V.q)}"></label>
    <div class="chips">
      ${[['all', 'All'], ['out', 'Out'], ['back', 'Returned'], ['move', 'Moved']].map(([k, l]) => `<button class="fchip ${V.f === k ? 'on' : ''}" data-act="f" data-v="${k}">${l} ${n[k]}</button>`).join('')}
      <select class="fchip" data-project aria-label="Project"><option value="">Any project</option>${M.projects().map(p => `<option value="${p.id}" ${V.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    </div>
    <p class="lockline">${ic('lock')}Entries cannot be edited or deleted. To correct one, log a new movement.</p>
    <div id="mlist">${movementList()}</div>`;
  return {
    tab: 'movements', html,
    on: { f: el => { V.f = el.dataset.v; render(); } },
    input: el => { if (el.dataset.q !== undefined) { V.q = el.value; $('#mlist').innerHTML = movementList(); } },
    change: el => { if (el.dataset.project !== undefined) { V.project = el.value; render(); } },
  };
};

/* ---------- Projects ---------- */

const P = { f: 'open' };
const bar = s => `<div class="meter" role="img" aria-label="${s.back} of ${s.taken} units back"><i style="width:${s.taken ? (s.back / s.taken) * 100 : 0}%"></i></div>`;

VIEWS.projects = () => {
  const ps = M.projects();
  const open = ps.filter(p => !p.finished), done = ps.filter(p => p.finished);
  const card = p => {
    const s = M.projectStats(p);
    return `<a class="card pcard" href="#/project/${p.id}">
      <div class="between"><b class="ptitle">${esc(p.name)}</b>${ic('chev')}</div>
      <p class="sub">${p.finished ? `${fdate(p.started)} – ${fdate(p.finished)}` : `Started ${fdate(p.started)}`} · ${plural(s.rows.length, 'item')} · ${plural(s.taken, 'unit')}</p>
      ${!s.taken ? chip('moved', 'Nothing taken out yet') : s.out ? chip('warn', `${plural(s.out, 'unit')} still out`) : chip('in', 'Everything back')}
      ${s.taken ? `${bar(s)}<p class="between sub"><span>${s.back} of ${plural(s.taken, 'unit')} back</span><b>${Math.round((s.back / s.taken) * 100)}%</b></p>` : ''}
    </a>`;
  };
  const group = (title, list) => list.length ? `<h3 class="sec">${title}</h3>${list.map(card).join('')}` : '';
  const html = `
    <header class="top"><div><h1>Projects</h1><p class="sub">${esc(M.hall().name)}</p></div></header>
    <div class="chips">${[['open', 'Open', open.length], ['done', 'Finished', done.length], ['all', 'All', ps.length]].map(([k, l, c]) => `<button class="fchip ${P.f === k ? 'on' : ''}" data-act="f" data-v="${k}">${l} ${c}</button>`).join('')}</div>
    ${P.f !== 'done' ? group('Open', open) : ''}${P.f !== 'open' ? group('Finished', done) : ''}
    <form class="card hint">
      <p>Start a project when equipment leaves for a job. It lets you check that everything came back.</p>
      <label class="field"><span>New project name</span><input name="name" placeholder="e.g. Remodel 2026" required></label>
      <button class="btn">${ic('plus')}New project</button>
    </form>`;
  return {
    tab: 'projects', html,
    on: { f: el => { P.f = el.dataset.v; render(); } },
    submit: async form => { const p = await M.createProject(form.name.value.trim()); go(`#/project/${p.id}`); },
  };
};

function projectReport(p, s) {
  const lines = [`${p.name} (${M.hall().name})`, `Started ${fdate(p.started)}`, '', `${s.back} of ${s.taken} units back.`];
  if (s.stillOut.length) {
    lines.push('', 'STILL OUT');
    for (const r of s.stillOut) lines.push(`- ${r.asset.name} (${r.asset.assetId}): ${r.taken - r.back} of ${r.taken} missing, went to ${r.lastOut?.to || '?'} ${fday(r.lastOut?.at)}`);
  } else lines.push('', 'Everything is back.');
  if (s.done.length) { lines.push('', 'BACK'); for (const r of s.done) lines.push(`- ${r.asset.name} (${r.asset.assetId}): ${r.taken} of ${r.taken}`); }
  return lines.join('\n');
}

VIEWS.project = ([id]) => {
  const p = M.byId('projects', id);
  if (!p) return VIEWS.projects();
  const s = M.projectStats(p);
  const item = (r, out) => `<div class="card pitem">
    <div class="between"><span class="mono">${esc(r.asset.assetId)}</span>${out ? chip('warn', 'Still out') : chip('in', 'Back')}</div>
    <b>${esc(r.asset.name)}</b>
    <p class="${out ? 'note' : 'sub'}">${r.back} of ${r.taken} back${out ? ` · ${r.taken - r.back} missing` : ''}</p>
    <p class="sub">Went to ${esc(r.lastOut?.to || '')} ${fday(r.lastOut?.at)}${r.lastOut ? ' · by ' + esc(r.lastOut.by) : ''}</p>
    ${out ? `<a class="btn small" href="#/log?type=back&asset=${r.asset.id}">${ic('down')}Bring back</a>` : ''}
  </div>`;
  const html = `
    <header class="top bar"><a class="backlink" href="#/projects">${ic('back')}Projects</a><span></span></header>
    <h1>${esc(p.name)}</h1><p class="sub">${esc(M.hall().name)} · started ${fdate(p.started)}${p.finished ? ' · finished ' + fdate(p.finished) : ''}</p>
    ${!s.taken ? `<section class="card hint"><p>Nothing has been taken out for this project yet.</p><a class="btn primary" href="#/log?type=out&project=${p.id}">${ic('up')}Take items out</a></section>` : `
    <section class="card ${s.out ? 'warn' : 'good'} verdict">
      <h2>${ic(s.out ? 'alert' : 'check')}${s.out ? 'Not everything is back' : 'Everything is back'}</h2>
      <p class="big">${s.back} <small>of ${plural(s.taken, 'unit')} back</small></p>${bar(s)}
      ${s.out ? `<p>${plural(s.out, 'unit')} from ${plural(s.stillOut.length, 'item')} still out.</p>` : ''}
    </section>
    ${s.stillOut.length ? `<h3 class="sec">Still out · ${s.stillOut.length}</h3>${s.stillOut.map(r => item(r, true)).join('')}` : ''}
    ${s.done.length ? `<details class="fold"><summary>${chip('in', 'Back')} ${plural(s.done.length, 'item')} · ${plural(s.done.reduce((n, r) => n + r.taken, 0), 'unit')}</summary>${s.done.map(r => item(r, false)).join('')}</details>` : ''}`}
    <div class="stick">
      <button class="btn" data-act="report">${ic('mail')}Email report</button>
      ${s.out ? `<a class="btn primary" href="#/log?type=back&project=${p.id}">${ic('down')}Bring items back</a>` : `<button class="btn ${p.finished ? '' : 'primary'}" data-act="finish">${p.finished ? 'Reopen project' : 'Mark finished'}</button>`}
    </div>`;
  return {
    tab: 'projects', modal: true, html,
    on: {
      report: () => { location.href = `mailto:?subject=${encodeURIComponent(`${p.name}: ${s.out ? `${s.out} units still out` : 'everything is back'}`)}&body=${encodeURIComponent(projectReport(p, s))}`; },
      finish: async () => { await M.setProjectFinished(p, !p.finished); render(); },
    },
  };
};

/* ---------- Share ---------- */

let H = { kind: 'changes', project: '', plan: null, file: '' };

VIEWS.share = () => {
  const h = M.hall(), unsent = M.unsentCount(), last = M.lastSent();
  if (H.kind === 'project' && !M.byId('projects', H.project)) H.project = M.projects()[0]?.id || '';
  const ex = M.buildExport(H.kind, H.project);
  const all = M.buildExport('everything');
  const opt = (k, title, sub) => `<label class="radio ${H.kind === k ? 'on' : ''}"><input type="radio" name="kind" value="${k}" ${H.kind === k ? 'checked' : ''}><span><b>${title}</b><small>${sub}</small></span></label>`;
  const plan = H.plan;
  const html = `
    <header class="top"><div><h1>Send or receive</h1><p class="sub">Everything is saved on this ${deviceName()}. Nothing is uploaded.</p></div></header>
    <section class="card ${unsent ? 'warn' : 'good'}"><h2>${unsent ? `${plural(unsent, 'change')} not sent yet` : `${ic('check')}Nothing new to send`}</h2>
      <p>${last.at ? `Last sent ${fdate(last.at)}.` : 'Nothing has been sent from this device yet.'}</p></section>
    <section class="card"><h2>Send your inventory</h2>
      ${opt('changes', 'Changes since last send', `${plural(unsent, 'change')}`)}
      ${opt('everything', `Everything for ${esc(h.name)}`, `${plural(all.items, 'item')} · ${plural(all.movements, 'movement')}`)}
      ${M.projects().length ? opt('project', 'One project', 'Its movements and the items involved') : ''}
      ${H.kind === 'project' ? `<label class="field"><span>Project</span><select data-project>${M.projects().map(p => `<option value="${p.id}" ${H.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
      <p class="filerow">${ic('file')}<span class="mono">${esc(ex.name)}</span><small>${ex.records ? `${plural(ex.records, 'row')} · ${Math.max(1, Math.round(ex.size / 1024))} KB` : 'empty'}</small></p>
      <button class="btn primary" data-act="email" ${ex.records ? '' : 'disabled'}>${ic('mail')}Email CSV</button>
      <p class="sub center">Opens your share sheet or mail app with the file.</p>
      <button class="btn" data-act="save" ${ex.records ? '' : 'disabled'}>${ic('down')}Save CSV to this device</button>
    </section>
    <section class="card"><h2>Add someone else's changes</h2>
      <p class="sub">Open a CSV you were sent. You will see what it changes before anything is saved.</p>
      <label class="btn">${ic('file')}Choose a CSV file<input type="file" accept=".csv,text/csv" data-import hidden></label>
      ${plan ? `<div class="preview">
        <p class="filerow">${ic('file')}<span class="mono">${esc(H.file)}</span></p>
        ${plan.hallName && plan.hallId !== h.id ? `<p class="prow warnrow">${ic('alert')}<span><b>This file is for ${esc(plan.hallName)}</b><small>It will be added as a separate hall.</small></span></p>` : ''}
        <p class="prow goodrow">${ic('check')}<span><b>${plural(plan.newMovements, 'new movement')}</b><small>Will be added to this device.</small></span></p>
        ${plan.add.length - plan.newMovements + plan.update.length ? `<p class="prow goodrow">${ic('check')}<span><b>${plural(plan.add.length - plan.newMovements + plan.update.length, 'item, room or project update')}</b><small>New or newer than what is here.</small></span></p>` : ''}
        <p class="prow">${ic('x')}<span><b>${plan.skipped} already on this device</b><small>Skipped.</small></span></p>
        ${plan.conflicts.length ? `<p class="prow warnrow">${ic('alert')}<span><b>${plan.conflicts.length} kept as they are</b><small>${plan.conflicts.slice(0, 3).map(esc).join('<br>')}</small></span></p>` : ''}
        <div class="actions row2"><button class="btn primary" data-act="apply" ${plan.add.length + plan.update.length ? '' : 'disabled'}>Add ${plural(plan.add.length + plan.update.length, 'change')}</button><button class="btn" data-act="discard">Cancel</button></div>
      </div>` : ''}
    </section>
    <h3 class="sec">Sent and received</h3>
    <section class="card list">${M.shares().slice(0, 20).map(x => `<div class="row">${chip(x.dir === 'sent' ? 'out' : 'in', x.dir === 'sent' ? 'Sent' : 'Received')}<span><b>${x.dir === 'sent' && x.kind !== 'changes' ? esc(x.kind[0].toUpperCase() + x.kind.slice(1)) : plural((x.movements || 0) + (x.items || 0), 'change')}</b><small class="mono">${esc(x.name || '')}</small></span><time>${fday(x.at)}</time></div>`).join('') || '<p class="empty">Nothing sent or received yet.</p>'}</section>`;
  return {
    tab: 'share', html,
    on: {
      email: async () => {
        const r = await emailFile(ex.name, ex.text, `${h.name} inventory (${H.kind})`, `Inventory file for ${h.name}: ${plural(ex.movements, 'movement')}, ${plural(ex.items, 'item')}. Open it in LDC Inventory under Share.`);
        if (r === 'cancelled') return;
        await M.markSent(H.kind, ex);
        toast(r === 'downloaded' ? `Saved ${ex.name}. Attach it to the email that just opened.` : 'Sent.');
        render();
      },
      save: async () => { download(ex.name, ex.text); await M.markSent(H.kind, ex); toast(`Saved ${ex.name}.`); render(); },
      apply: async () => { const n = await M.applyImport(H.plan, H.file); H.plan = null; toast(`Added ${plural(n, 'change')}.`); render(); },
      discard: () => { H.plan = null; render(); },
    },
    change: async el => {
      if (el.name === 'kind') { H.kind = el.value; render(); }
      else if (el.dataset.project !== undefined) { H.project = el.value; render(); }
      else if (el.dataset.import !== undefined && el.files[0]) {
        try {
          const plan = M.analyzeImport(await readFile(el.files[0]));
          if (plan.kind === 'sheet') return toast('That looks like a spreadsheet list, not a file from this app. Use it when setting up a new hall.');
          H.plan = plan; H.file = el.files[0].name; render();
        } catch (e) { toast(e.message || 'That file could not be read.'); }
      }
    },
  };
};

/* ---------- Add / edit item ---------- */

VIEWS.item = ([id]) => {
  const a = id !== 'new' ? M.byId('assets', id) : null;
  const v = a || { name: '', brand: '', model: '', serial: '', qty: 1, condition: 'Good', roomId: A.room || M.rooms()[0]?.id || '', notes: '' };
  const html = `
    <header class="top bar"><a class="textbtn" data-act="cancel">Cancel</a><b>${a ? 'Edit item' : 'Add item'}</b><span></span></header>
    <form>
    <p class="filerow"><small>ASSET ID</small><span class="mono">${esc(a?.assetId || M.nextAssetId())}</span><small>${a ? '' : 'Assigned automatically'}</small></p>
    <section class="card"><h2>What is it?</h2>
      <label class="field"><span>Item name <em>Required</em></span><input name="name" value="${esc(v.name)}" required autocomplete="off"></label>
      <div class="two"><label class="field"><span>Brand</span><input name="brand" value="${esc(v.brand)}"></label><label class="field"><span>Model</span><input name="model" value="${esc(v.model)}"></label></div>
      <label class="field"><span>Serial number</span><input name="serial" class="mono" value="${esc(v.serial)}" placeholder="Leave blank if there is none" autocomplete="off"></label>
    </section>
    <section class="card"><h2>How many and what shape?</h2>
      <div class="field"><span>Quantity</span><span class="stepper big"><button type="button" data-act="qty" data-d="-1" aria-label="One fewer">−</button><input name="qty" inputmode="numeric" value="${v.qty}" aria-label="Quantity"><button type="button" data-act="qty" data-d="1" aria-label="One more">+</button></span></div>
      <div class="field"><span>Condition</span><div class="opts four">${['Excellent', 'Good', 'Fair', 'Poor'].map(c => `<label><input type="radio" name="condition" value="${c}" ${v.condition === c ? 'checked' : ''}><span>${c}</span></label>`).join('')}</div></div>
    </section>
    <section class="card"><h2>Where does it live?</h2>
      <div class="field"><span>Home room</span><div class="opts">${M.rooms().map(r => `<label><input type="radio" name="roomId" value="${r.id}" ${v.roomId === r.id ? 'checked' : ''}><span>${esc(r.name)}</span></label>`).join('')}</div></div>
      <label class="field"><span>Or a new room</span><input name="newRoom" placeholder="Type a room name to add it"></label>
    </section>
    <section class="card"><h2>Notes</h2>
      <label class="field"><span>Notes</span><textarea name="notes" rows="3" placeholder="Cables, cases or anything taped to it">${esc(v.notes)}</textarea></label>
      <p class="sub">You can add a reference photo from the item's page after saving.</p>
    </section>
    <div class="stick col">
      <button class="btn primary" name="go" value="save">Save item</button>
      ${a ? '' : '<button class="textbtn" name="go" value="again">Save and add another</button>'}
      <small>Saved on this device.</small>
    </div></form>`;
  const leave = () => go(a ? `#/asset/${a.id}` : '#/assets');
  return {
    tab: 'assets', modal: true, html,
    on: {
      cancel: leave,
      qty: el => { const i = el.parentElement.querySelector('input'); i.value = Math.max(1, (parseInt(i.value, 10) || 1) + +el.dataset.d); },
    },
    submit: async (form, e) => {
      const f = Object.fromEntries(new FormData(form));
      let roomId = f.roomId || '';
      if (f.newRoom.trim()) roomId = (await M.addRoom(f.newRoom.trim())).id;
      const saved = await M.saveAsset({
        name: f.name.trim(), brand: f.brand.trim(), model: f.model.trim(), serial: f.serial.trim(),
        qty: Math.max(1, parseInt(f.qty, 10) || 1), condition: f.condition || 'Good', roomId, notes: f.notes.trim(),
        lastInventoried: a?.lastInventoried || new Date().toISOString().slice(0, 10),
      }, a);
      toast('Saved.');
      if (e.submitter?.value === 'again') render(); else go(`#/asset/${saved.id}`);
    },
  };
};

/* ---------- First-run setup ---------- */

let U = { rooms: ['Auditorium', 'Stage', 'Sound Console', 'Foyer'], sheet: null, file: '', mode: 'empty', name: '', code: '', user: '' };

VIEWS.setup = (_, q) => {
  const first = !M.hall();
  const html = `
    <header class="top">${first ? '<span class="eyebrow">LDC Inventory</span>' : `<a class="backlink" href="#/home">${ic('back')}Home</a>`}</header>
    <h1>Set up your hall</h1>
    <p class="sub">Everything you enter stays on this ${deviceName()}. No account needed.</p>
    <form>
    <section class="card"><h2>1 · Your hall</h2>
      <label class="field"><span>Hall name</span><input name="name" data-u="name" value="${esc(U.name)}" placeholder="e.g. Maple Grove Kingdom Hall" required></label>
      <label class="field"><span>Short code for asset IDs</span><input name="code" data-u="code" class="mono" value="${esc(U.code)}" placeholder="MPG" maxlength="5" required>
        <small class="mono" id="codehint">Items will be numbered LDC-${esc(U.code || 'MPG')}-0001, LDC-${esc(U.code || 'MPG')}-0002…</small></label>
      <label class="field"><span>Your name</span><input name="user" data-u="user" value="${esc(U.user || M.S.meta.userName || '')}" autocomplete="name" required><small>Shown on the movements you log.</small></label>
      ${first ? `<label class="field"><span>Coordinator PIN (optional)</span><input name="pin" class="mono" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="4 digits" autocomplete="off"><small>Volunteers use the simple screens without it. You need it for everything else.</small></label>` : ''}
    </section>
    <section class="card"><h2>2 · Rooms</h2><p class="sub">Where equipment normally lives.</p>
      <div class="chips wrap">${U.rooms.map((r, i) => `<button type="button" class="fchip" data-act="rmroom" data-i="${i}" aria-label="Remove ${esc(r)}">${esc(r)} ${ic('x')}</button>`).join('')}</div>
      <div class="addrow"><input id="newroom" placeholder="Add a room" aria-label="Add a room"><button type="button" class="btn small" data-act="addroom">Add</button></div>
    </section>
    <section class="card"><h2>3 · Your equipment</h2>
      <label class="radio ${U.mode === 'sheet' ? 'on' : ''}"><input type="radio" name="mode" value="sheet" ${U.mode === 'sheet' ? 'checked' : ''}><span><b>Bring in a list</b><small>Use a spreadsheet you already have, saved as CSV.</small>
        ${U.mode === 'sheet' ? `<span class="filebox">${U.sheet ? `<span class="filerow">${ic('file')}<span class="mono">${esc(U.file)}</span>${chip('in', `${plural(U.sheet.items.length, 'item')} found`)}</span>` : ''}
          <label class="btn small">${U.sheet ? 'Choose a different file' : 'Choose a CSV file'}<input type="file" accept=".csv,text/csv" data-sheet hidden></label>
          <button type="button" class="textbtn" data-act="sample">Try it with a sample list</button></span>` : ''}</span></label>
      <label class="radio ${U.mode === 'empty' ? 'on' : ''}"><input type="radio" name="mode" value="empty" ${U.mode === 'empty' ? 'checked' : ''}><span><b>Start empty</b><small>Add items one at a time later.</small></span></label>
    </section>
    <section class="card hint"><h2>Already set up on another device?</h2>
      <p class="sub">Open the CSV that device sent you and this one will match it.</p>
      <label class="btn">${ic('file')}Open a CSV file<input type="file" accept=".csv,text/csv" data-other hidden></label>
    </section>
    <div class="stick col"><button class="btn primary">Finish setup</button><small>You can change all of this later.</small></div>
    </form>`;
  const loadSheet = (text, name) => {
    const plan = M.analyzeImport(text);
    if (plan.kind !== 'sheet') throw new Error('That file came from this app. Open it under "Already set up on another device".');
    U.sheet = plan.sheet; U.file = name; U.rooms = [...plan.sheet.rooms]; render();
  };
  return {
    bare: true, html,
    on: {
      rmroom: el => { U.rooms.splice(+el.dataset.i, 1); render(); },
      addroom: () => { const v = $('#newroom').value.trim(); if (v && !U.rooms.includes(v)) { U.rooms.push(v); render(); } },
      sample: async () => {
        try { loadSheet(await (await fetch('sample/Sample%20Inventory%20List.csv')).text(), 'Sample Inventory List.csv'); if (!U.name) { U.name = 'Sample Kingdom Hall'; U.code = 'SMP'; render(); } }
        catch (e) { toast(e.message || 'The sample list could not be loaded.'); }
      },
    },
    input: el => {
      if (!el.dataset.u) return;
      U[el.dataset.u] = el.dataset.u === 'code' ? (el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '')) : el.value;
      if (el.dataset.u === 'code') $('#codehint').textContent = `Items will be numbered LDC-${U.code || 'MPG'}-0001, LDC-${U.code || 'MPG'}-0002…`;
    },
    change: async el => {
      try {
        if (el.name === 'mode') { U.mode = el.value; render(); }
        else if (el.dataset.sheet !== undefined && el.files[0]) loadSheet(await readFile(el.files[0]), el.files[0].name);
        else if (el.dataset.other !== undefined && el.files[0]) {
          const plan = M.analyzeImport(await readFile(el.files[0]));
          if (plan.kind !== 'app' || !plan.hallId) throw new Error('That file did not come from this app. Use "Bring in a list" for a spreadsheet.');
          await M.applyImport(plan, el.files[0].name);
          await M.setMeta('hallId', plan.hallId);
          toast(`${plan.hallName} is ready on this device.`); go('#/home');
        }
      } catch (e) { toast(e.message || 'That file could not be read.'); }
    },
    submit: async form => {
      if (U.mode === 'sheet' && !U.sheet) return toast('Choose the CSV file with your list, or pick "Start empty".');
      await M.createHall({ name: form.name.value.trim(), code: form.code.value.trim(), userName: form.user.value.trim(), roomNames: U.rooms, sheet: U.mode === 'sheet' ? U.sheet : null });
      if (form.pin?.value) await savePin(form.pin.value);
      persist();
      U = { rooms: ['Auditorium', 'Stage', 'Sound Console', 'Foyer'], sheet: null, file: '', mode: 'empty', name: '', code: '', user: '' };
      toast('Your hall is set up.'); go('#/home');
    },
  };
};

/* ---------- Coordinator PIN ---------- */

let pinEntry = '', pinError = '';

VIEWS.pin = () => {
  const html = `
    <header class="top bar"><a class="textbtn" href="#/home">Cancel</a><span></span></header>
    <div class="pinpad">
      <span class="pinlock">${ic('lock')}</span>
      <h1>Coordinator PIN</h1>
      <p class="sub">This part is for the person who looks after the inventory.</p>
      <div class="pindots" aria-label="${pinEntry.length} of 4 digits entered">${[0, 1, 2, 3].map(k => `<b class="${k < pinEntry.length ? 'on' : ''}"></b>`).join('')}</div>
      <p class="pinerr" role="alert">${esc(pinError)}</p>
      <div class="keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map(k => k === '' ? '<span></span>'
        : `<button type="button" data-act="key" data-k="${k}" ${k === 'del' ? 'aria-label="Delete"' : ''}>${k === 'del' ? ic('back') : k}</button>`).join('')}</div>
      <a class="textbtn" href="#/forgot">Forgot the PIN?</a>
    </div>`;
  return {
    modal: true, html, keepScroll: true,
    on: {
      key: async el => {
        pinError = '';
        if (el.dataset.k === 'del') pinEntry = pinEntry.slice(0, -1); else if (pinEntry.length < 4) pinEntry += el.dataset.k;
        if (pinEntry.length === 4) {
          const { salt, hash } = M.S.meta.pin;
          const ok = (await hashPin(pinEntry, salt)) === hash;
          pinEntry = '';
          if (ok) { unlocked = true; unlockedAt = Date.now(); } else pinError = 'That PIN is not right. Try again.';
        }
        render();
      },
    },
  };
};

VIEWS.forgot = () => {
  const h = M.hall();
  const html = `
    <header class="top bar"><a class="backlink" href="#/home">${ic('back')}Home</a><span></span></header>
    <h1>Forgot the PIN?</h1>
    <p class="sub">There is no account behind this app, so the PIN cannot be emailed to you. To prove you look after this hall, type its full name exactly as it appears on the home screen. The PIN is then removed and you can set a new one. Nothing else is changed.</p>
    <form class="card"><label class="field"><span>Hall name</span><input name="hall" autocomplete="off" required></label>
      <button class="btn primary">Remove the PIN</button></form>`;
  return {
    modal: true, html,
    submit: async form => {
      if (form.hall.value.trim().toLowerCase() !== h.name.trim().toLowerCase()) return toast('That does not match the hall name.');
      await M.setMeta('pin', null); unlocked = false; pinEntry = ''; pinError = '';
      toast('PIN removed. Set a new one under More.'); go('#/more');
    },
  };
};

VIEWS.setpin = () => {
  const html = `
    <header class="top bar"><a class="backlink" href="#/more">${ic('back')}More</a><span></span></header>
    <h1>${hasPin() ? 'Change the coordinator PIN' : 'Set a coordinator PIN'}</h1>
    <p class="sub">With a PIN set, volunteers can take things out, bring them back, see the list and send their changes. Everything under More asks for the PIN. It is kept on this ${deviceName()} only, so set it on each device.</p>
    <form class="card">
      <label class="field"><span>New PIN</span><input name="a" class="mono" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="4 digits" autocomplete="off" required></label>
      <label class="field"><span>Type it again</span><input name="b" class="mono" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="4 digits" autocomplete="off" required></label>
      <button class="btn primary">Save PIN</button>
    </form>
    ${hasPin() ? `<button class="btn" data-act="off">Turn the lock off</button>` : ''}`;
  return {
    tab: 'more', modal: true, html,
    on: { off: async () => { await M.setMeta('pin', null); toast('The lock is off. Everyone can open More.'); go('#/more'); } },
    submit: async form => {
      if (!/^[0-9]{4}$/.test(form.a.value)) return toast('Use exactly 4 digits.');
      if (form.a.value !== form.b.value) return toast('The two PINs do not match.');
      await savePin(form.a.value);
      toast('PIN saved.'); go('#/more');
    },
  };
};

/* ---------- start ---------- */

window.addEventListener('hashchange', render);
let wasWide = wide();
window.addEventListener('resize', () => { if (wide() !== wasWide) { wasWide = wide(); render(); } });

M.load().then(render).catch(e => { $('#app').innerHTML = `<p class="boot">This browser would not open on-device storage (${esc(e?.message || e)}). Private browsing windows often block it.</p>`; });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
