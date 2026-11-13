import { getAll, put, STORES } from './db.js';
import { parseCSV, toCSV } from './csv.js';

// Five linked tables (halls, rooms, assets, projects, movements) plus a share history.
// Movements are append-only: nothing here edits or deletes one.
export const S = { halls: [], rooms: [], assets: [], projects: [], movements: [], shares: [], meta: {} };

const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

export async function load() {
  for (const s of STORES) {
    const rows = await getAll(s);
    if (s === 'meta') S.meta = Object.fromEntries(rows.map(r => [r.id, r.value]));
    else S[s] = rows;
  }
  S.meta.seq ??= 0;
}

export async function setMeta(key, value) {
  S.meta[key] = value;
  await put('meta', { id: key, value });
}

// local = written on this device, so it counts as a change that has not been sent yet.
async function save(store, rec, local = true) {
  if (local) { rec.updated = now(); rec.seq = S.meta.seq + 1; await setMeta('seq', rec.seq); }
  else rec.seq = 0;
  const i = S[store].findIndex(x => x.id === rec.id);
  if (i >= 0) S[store][i] = rec; else S[store].push(rec);
  await put(store, rec);
  return rec;
}

/* ---------- reading ---------- */

export const hall = () => S.halls.find(h => h.id === S.meta.hallId) || S.halls[0] || null;
const inHall = store => { const h = hall(); return h ? S[store].filter(x => x.hallId === h.id) : []; };
export const byId = (store, id) => S[store].find(x => x.id === id);
export const rooms = () => inHall('rooms').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const assets = () => inHall('assets').sort((a, b) => a.assetId.localeCompare(b.assetId));
export const projects = () => inHall('projects').sort((a, b) => (b.started || '').localeCompare(a.started || ''));
export const movements = () => inHall('movements').sort((a, b) => b.at.localeCompare(a.at));
export const shares = () => inHall('shares').sort((a, b) => b.at.localeCompare(a.at));
export const roomName = id => byId('rooms', id)?.name || 'No room';

// Where an item stands right now, worked out from its movements.
export function assetState(a) {
  const hist = S.movements.filter(m => m.assetRef === a.id).sort((x, y) => x.at.localeCompare(y.at));
  let out = 0, last = null;
  for (const m of hist) {
    if (m.type === 'out') { out += m.qty; last = m; }
    else if (m.type === 'back') out = Math.max(0, out - m.qty);
  }
  out = Math.min(out, a.qty);
  return {
    out,
    inPlace: a.qty - out,
    where: out ? (last?.to || 'Out') : '',
    since: out ? last?.at : null,
    projectId: out ? (last?.projectId || '') : '',
    history: hist.reverse(),
  };
}

// Did everything that left for this project come back?
export function projectStats(p) {
  const per = new Map();
  for (const m of S.movements) {
    if (m.projectId !== p.id) continue;
    const e = per.get(m.assetRef) || { taken: 0, back: 0, lastOut: null };
    if (m.type === 'out') { e.taken += m.qty; if (!e.lastOut || m.at > e.lastOut.at) e.lastOut = m; }
    else if (m.type === 'back') e.back += m.qty;
    per.set(m.assetRef, e);
  }
  const rows = [...per].map(([id, e]) => ({ asset: byId('assets', id), taken: e.taken, back: Math.min(e.back, e.taken), lastOut: e.lastOut }))
    .filter(r => r.asset && r.taken > 0)
    .sort((a, b) => a.asset.assetId.localeCompare(b.asset.assetId));
  const taken = rows.reduce((n, r) => n + r.taken, 0);
  const back = rows.reduce((n, r) => n + r.back, 0);
  return { rows, taken, back, out: taken - back, stillOut: rows.filter(r => r.back < r.taken), done: rows.filter(r => r.back >= r.taken) };
}

/* ---------- writing ---------- */

const assetCode = (code, n) => `LDC-${code}-${String(n).padStart(4, '0')}`;

export function nextAssetId() {
  const h = hall();
  const max = inHall('assets').reduce((n, a) => Math.max(n, parseInt(a.assetId.split('-').pop(), 10) || 0), 0);
  return assetCode(h.code, max + 1);
}

export async function createHall({ name, code, userName, roomNames, sheet }) {
  code = (code || name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'HALL';
  const h = await save('halls', { id: uid(), name, code });
  await setMeta('hallId', h.id);
  await setMeta('userName', userName);
  const names = [...roomNames];
  for (const r of sheet?.rooms || []) if (!names.some(n => n.toLowerCase() === r.toLowerCase())) names.push(r);
  const ids = {};
  for (const [i, n] of names.entries()) ids[n.toLowerCase()] = (await save('rooms', { id: uid(), hallId: h.id, name: n, order: i })).id;
  let n = 0;
  for (const it of sheet?.items || []) {
    const a = await save('assets', {
      id: uid(), hallId: h.id, assetId: assetCode(h.code, ++n), name: it.name, brand: it.brand, model: it.model,
      serial: it.serial, qty: it.qty, condition: it.condition, roomId: ids[it.room.toLowerCase()] || '',
      lastInventoried: it.date, notes: it.notes,
    });
    // The list says where each item is today. Anything not in the hall starts as "out".
    if (it.location && !/hall|in place/i.test(it.location)) {
      await save('movements', {
        id: uid(), hallId: h.id, type: 'out', assetRef: a.id, qty: a.qty, from: it.room, to: it.location, toRoomId: '',
        by: userName, projectId: '', at: it.date ? it.date + 'T12:00:00.000Z' : now(), notes: 'From the imported list',
      });
    }
  }
  return h;
}

export async function addRoom(name) {
  const existing = rooms().find(r => r.name.toLowerCase() === name.toLowerCase());
  return existing || save('rooms', { id: uid(), hallId: hall().id, name, order: rooms().length });
}

export async function saveAsset(fields, existing) {
  const rec = existing ? { ...existing, ...fields } : { id: uid(), hallId: hall().id, assetId: nextAssetId(), ...fields };
  return save('assets', rec);
}

// Photos stay on this device; they are not part of the CSV, so they do not count as a change to send.
export async function savePhoto(a, photo) {
  a.photo = photo;
  await put('assets', a);
}

export async function createProject(name) {
  return save('projects', { id: uid(), hallId: hall().id, name, started: now(), finished: '' });
}

export async function setProjectFinished(p, finished) {
  return save('projects', { ...p, finished: finished ? now() : '' });
}

// items: [{ asset, qty }]. One log entry per item.
export async function logMovements({ type, items, to, toRoomId, projectId, by, notes }) {
  const at = now();
  await setMeta('userName', by);
  for (const { asset, qty } of items) {
    const st = assetState(asset);
    const m = { id: uid(), hallId: hall().id, type, assetRef: asset.id, qty, by, at, notes: notes || '', toRoomId: '', projectId: '' };
    if (type === 'out') { m.from = roomName(asset.roomId); m.to = to; m.projectId = projectId || ''; }
    else if (type === 'back') { m.from = st.where || 'Out'; m.to = roomName(asset.roomId); m.projectId = st.projectId; }
    else { m.from = roomName(asset.roomId); m.to = roomName(toRoomId); m.toRoomId = toRoomId; m.qty = asset.qty; }
    await save('movements', m);
    if (type === 'move') await save('assets', { ...asset, roomId: toRoomId, roomAt: at });
  }
  return items.length;
}

/* ---------- sharing by CSV ---------- */

const HEADER = ['record', 'id', 'hall_id', 'updated', 'name', 'code', 'order', 'asset_id', 'brand', 'model', 'serial', 'qty',
  'condition', 'room_id', 'last_inventoried', 'notes', 'started', 'finished', 'type', 'asset_ref', 'from', 'to',
  'to_room_id', 'by', 'project_id', 'at'];

const TO_ROW = {
  halls: r => ({ record: 'hall', id: r.id, updated: r.updated, name: r.name, code: r.code }),
  rooms: r => ({ record: 'room', id: r.id, hall_id: r.hallId, updated: r.updated, name: r.name, order: r.order ?? 0 }),
  assets: r => ({
    record: 'asset', id: r.id, hall_id: r.hallId, updated: r.updated, name: r.name, asset_id: r.assetId, brand: r.brand,
    model: r.model, serial: r.serial, qty: r.qty, condition: r.condition, room_id: r.roomId, last_inventoried: r.lastInventoried, notes: r.notes,
  }),
  projects: r => ({ record: 'project', id: r.id, hall_id: r.hallId, updated: r.updated, name: r.name, started: r.started, finished: r.finished }),
  movements: r => ({
    record: 'movement', id: r.id, hall_id: r.hallId, updated: r.updated, type: r.type, asset_ref: r.assetRef, qty: r.qty,
    from: r.from, to: r.to, to_room_id: r.toRoomId, by: r.by, project_id: r.projectId, at: r.at, notes: r.notes,
  }),
};

const FROM_ROW = {
  hall: r => ['halls', { id: r.id, updated: r.updated, name: r.name, code: r.code }],
  room: r => ['rooms', { id: r.id, hallId: r.hall_id, updated: r.updated, name: r.name, order: +r.order || 0 }],
  asset: r => ['assets', {
    id: r.id, hallId: r.hall_id, updated: r.updated, name: r.name, assetId: r.asset_id, brand: r.brand, model: r.model,
    serial: r.serial, qty: +r.qty || 1, condition: r.condition, roomId: r.room_id, lastInventoried: r.last_inventoried, notes: r.notes,
  }],
  project: r => ['projects', { id: r.id, hallId: r.hall_id, updated: r.updated, name: r.name, started: r.started, finished: r.finished }],
  movement: r => ['movements', {
    id: r.id, hallId: r.hall_id, updated: r.updated, type: r.type, assetRef: r.asset_ref, qty: +r.qty || 1, from: r.from,
    to: r.to, toRoomId: r.to_room_id, by: r.by, projectId: r.project_id, at: r.at, notes: r.notes,
  }],
};

const slug = s => s.toLowerCase().replace(/kingdom hall/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hall';
const sentInfo = () => S.meta['sent:' + hall().id] || { seq: 0, at: '' };
export const lastSent = () => sentInfo();

export function unsentCount() {
  const since = sentInfo().seq;
  let n = hall().seq > since ? 1 : 0;
  for (const s of ['rooms', 'assets', 'projects', 'movements']) n += inHall(s).filter(r => r.seq > since).length;
  return n;
}

// kind: 'changes' | 'everything' | 'project'
export function buildExport(kind, projectId) {
  const h = hall();
  const since = kind === 'changes' ? sentInfo().seq : -1;
  const pick = store => inHall(store).filter(r => (r.seq ?? 0) > since);
  let rm = pick('rooms'), as = pick('assets'), pr = pick('projects'), mv = pick('movements'), label = kind;
  if (kind === 'project') {
    const p = byId('projects', projectId);
    mv = inHall('movements').filter(m => m.projectId === projectId);
    const refs = new Set(mv.map(m => m.assetRef));
    as = inHall('assets').filter(a => refs.has(a.id));
    pr = p ? [p] : []; rm = inHall('rooms'); label = slug(p?.name || 'project');
  }
  const rows = [TO_ROW.halls(h), ...rm.map(TO_ROW.rooms), ...as.map(TO_ROW.assets), ...pr.map(TO_ROW.projects),
    ...mv.sort((a, b) => a.at.localeCompare(b.at)).map(TO_ROW.movements)];
  const text = toCSV(HEADER, rows);
  return {
    name: `${slug(h.name)}_${label}_${now().slice(0, 10)}.csv`, text, size: new Blob([text]).size,
    movements: mv.length, items: as.length, records: rows.length,
  };
}

export async function markSent(kind, ex) {
  if (kind !== 'project') await setMeta('sent:' + hall().id, { seq: S.meta.seq, at: now() });
  await save('shares', { id: uid(), hallId: hall().id, dir: 'sent', kind, at: now(), name: ex.name, movements: ex.movements, items: ex.items }, false);
}

const sameRow = (store, a, b) => {
  const x = { ...TO_ROW[store](a), updated: '' }, y = { ...TO_ROW[store](b), updated: '' };
  return HEADER.every(k => String(x[k] ?? '') === String(y[k] ?? ''));
};

// Reads a CSV and says what it would change, without changing anything.
export function analyzeImport(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('That file is empty.');
  const head = rows[0].map(x => x.trim());
  if (head[0].toLowerCase() !== 'record') return { kind: 'sheet', sheet: parseSheet(rows) };
  const plan = { kind: 'app', add: [], update: [], conflicts: [], skipped: 0, newMovements: 0, hallName: '', hallId: '' };
  for (const row of rows.slice(1)) {
    const r = Object.fromEntries(head.map((h, i) => [h, (row[i] ?? '').trim()]));
    const conv = FROM_ROW[r.record]?.(r);
    if (!conv || !conv[1].id) continue;
    const [store, rec] = conv;
    if (store === 'halls') { plan.hallName = rec.name; plan.hallId = rec.id; }
    const cur = byId(store, rec.id);
    if (!cur) { plan.add.push([store, rec]); if (store === 'movements') plan.newMovements++; }
    else if (store === 'movements' || sameRow(store, cur, rec)) plan.skipped++;
    else if ((rec.updated || '') > (cur.updated || '')) plan.update.push([store, rec]);
    else plan.conflicts.push(`${cur.name || 'A record'}: this device has a newer version, so it was kept`);
  }
  return plan;
}

export async function applyImport(plan, fileName) {
  const order = ['halls', 'rooms', 'assets', 'projects', 'movements'];
  const all = [...plan.add, ...plan.update].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  for (const [store, rec] of all) {
    const cur = byId(store, rec.id);
    await save(store, cur ? { ...cur, ...rec } : rec, false);
    if (store === 'movements' && rec.type === 'move' && rec.toRoomId) {
      const a = byId('assets', rec.assetRef);
      if (a && rec.at > (a.roomAt || '')) { a.roomId = rec.toRoomId; a.roomAt = rec.at; await put('assets', a); }
    }
  }
  if (plan.hallId && !S.meta.hallId) await setMeta('hallId', plan.hallId);
  if (plan.hallId) {
    await save('shares', {
      id: uid(), hallId: plan.hallId, dir: 'received', kind: 'changes', at: now(), name: fileName,
      movements: plan.newMovements, items: all.length - plan.newMovements,
    }, false);
  }
  return all.length;
}

/* ---------- bringing in an existing spreadsheet list ---------- */

function parseDate(s) {
  s = (s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + +s * 864e5).toISOString().slice(0, 10); // Excel day number
  return '';
}

export function parseSheet(rows) {
  let hi = rows.findIndex(r => r.some(c => /item|description/i.test(c)) && r.some(c => /qty|quant|brand|serial/i.test(c)));
  if (hi < 0) hi = 0;
  const col = re => rows[hi].findIndex(c => re.test(c));
  const ix = {
    name: col(/item|description|name/i), brand: col(/brand|make/i), model: col(/model/i), serial: col(/serial/i),
    qty: col(/qty|quant/i), location: col(/loc/i), condition: col(/cond/i), date: col(/date/i), notes: col(/note/i),
  };
  if (ix.name < 0) throw new Error('Could not find an "Item" column in that file.');
  const get = (r, k) => (ix[k] >= 0 ? (r[ix[k]] || '').trim() : '');
  const sheet = { rooms: [], items: [] };
  let room = '';
  for (const r of rows.slice(hi + 1)) {
    const name = get(r, 'name');
    if (!name) continue;
    if (r.filter(c => c.trim()).length === 1) { room = name; if (!sheet.rooms.includes(room)) sheet.rooms.push(room); continue; }
    if (!room) { room = 'General'; sheet.rooms.push(room); }
    const cond = get(r, 'condition');
    sheet.items.push({
      name, room, brand: get(r, 'brand'), model: get(r, 'model'), serial: get(r, 'serial'),
      qty: parseInt(get(r, 'qty').match(/\d+/)?.[0] || '1', 10) || 1,
      location: get(r, 'location'), condition: cond ? cond[0].toUpperCase() + cond.slice(1).toLowerCase() : 'Good',
      date: parseDate(get(r, 'date')), notes: get(r, 'notes'),
    });
  }
  if (!sheet.items.length) throw new Error('No items were found in that file.');
  return sheet;
}
