// Генерация моделей через Tripo API.
//   node tools/tripo.js balance
//   node tools/tripo.js gen shkval_base razryadnik ...   (или group:tower, all)
//   node tools/tripo.js rig clone brute psi              (скелет + анимация ходьбы)
//   node tools/tripo.js status <task_id>
// Ключ берётся из .env (TRIPO_API_KEY), в репозиторий не попадает.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'art/gen/raw');
const STATE = path.join(ROOT, 'art/gen/state.json');
const API = 'https://api.tripo3d.ai/v2/openapi';
fs.mkdirSync(RAW, { recursive: true });

const env = fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '';
const KEY = process.env.TRIPO_API_KEY || (env.match(/TRIPO_API_KEY=(\S+)/) || [])[1];
if (!KEY) { console.error('Нет TRIPO_API_KEY'); process.exit(1); }

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'art/models.json'), 'utf8'));
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const VERSION = flag('version', 'v3.1-20260211');

async function api(method, p, body) {
  const r = await fetch(API + p, { method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({ code: r.status, message: r.statusText }));
  if (j.code !== 0) throw new Error(`${method} ${p}: ${j.code} ${j.message || ''} ${j.suggestion || ''}`.trim());
  return j.data;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function createTask(body) { const d = await api('POST', '/task', body); return d.task_id; }
async function waitTask(id, label) {
  let last = '';
  for (;;) {
    const d = await api('GET', `/task/${id}`);
    const line = `${label}: ${d.status} ${d.progress ?? ''}%`;
    if (line !== last) { console.log(line); last = line; }
    if (d.status === 'success') return d;
    if (['failed', 'cancelled', 'unknown', 'banned', 'expired'].includes(d.status)) throw new Error(`${label}: задача ${id} — ${d.status}`);
    await sleep(4000);
  }
}
async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`скачивание ${r.status} ${url.slice(0, 80)}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}
function pickOutput(out) {
  return out.pbr_model || out.model || out.base_model;
}

async function upload(file) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(ROOT, file))], { type: 'image/png' }), path.basename(file));
  const r = await fetch(API + '/upload', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`upload: ${j.code} ${j.message || ''}`);
  return j.data.image_token || j.data.file_token;
}

async function gen(m) {
  const useImage = m.image && !args.includes('--text');
  const body = useImage ? {
    type: 'image_to_model',
    model_version: VERSION,
    file: { type: 'png', file_token: await upload(m.image) },
  } : {
    type: 'text_to_model',
    model_version: VERSION,
    prompt: `${m.prompt}. ${spec.style}`.slice(0, 1024),
    negative_prompt: spec.negative.slice(0, 255),
  };
  Object.assign(body, {
    texture: true, pbr: true,
    texture_quality: m.group === 'city' ? 'standard' : 'detailed',
    auto_size: false,
  });
  if (m.faces) body.face_limit = m.faces;
  const id = await createTask(body);
  state[m.id] = { ...(state[m.id] || {}), model_task: id, prompt: m.prompt, version: VERSION, at: new Date().toISOString() };
  save();
  const d = await waitTask(id, m.id);
  const url = pickOutput(d.output);
  await download(url, path.join(RAW, `${m.id}.glb`));
  if (d.output.rendered_image) await download(d.output.rendered_image, path.join(RAW, `${m.id}.webp`)).catch(() => {});
  state[m.id].done = true; save();
  console.log(`${m.id}: готово`);
}

async function rig(m) {
  const st = state[m.id];
  if (!st || !st.model_task) throw new Error(`${m.id}: сначала gen`);
  const check = await waitTask(await createTask({ type: 'animate_prerigcheck', original_model_task_id: st.model_task }), `${m.id} проверка скелета`);
  console.log(`${m.id}: riggable=${check.output?.riggable} rig_type=${check.output?.rig_type}`);
  const rigId = await createTask({ type: 'animate_rig', original_model_task_id: st.model_task, out_format: 'glb', spec: 'tripo' });
  st.rig_task = rigId; save();
  await waitTask(rigId, `${m.id} скелет`);
  const anim = m.anim || 'walk';
  const animId = await createTask({ type: 'animate_retarget', original_model_task_id: rigId, out_format: 'glb', animation: `preset:${anim}`, bake_animation: true });
  st.anim_task = animId; save();
  const d = await waitTask(animId, `${m.id} анимация`);
  await download(pickOutput(d.output), path.join(RAW, `${m.id}_${anim}.glb`));
  st.rigged = true; save();
  console.log(`${m.id}: анимация готова`);
}

function select(list) {
  const out = [];
  for (const a of list) {
    if (a.startsWith('--')) break;
    if (a === 'all') out.push(...spec.models);
    else if (a.startsWith('group:')) out.push(...spec.models.filter(m => m.group === a.slice(6)));
    else { const m = spec.models.find(x => x.id === a); if (!m) throw new Error(`нет модели ${a}`); out.push(m); }
  }
  return out;
}

async function pool(items, n, fn) {
  const queue = [...items];
  const errors = [];
  await Promise.all(Array.from({ length: n }, async () => {
    while (queue.length) {
      const it = queue.shift();
      try { await fn(it); } catch (e) { errors.push(`${it.id}: ${e.message}`); console.error('ОШИБКА', it.id, e.message); }
    }
  }));
  return errors;
}

const [cmd, ...rest] = args;
try {
  if (cmd === 'balance') console.log(await api('GET', '/user/balance'));
  else if (cmd === 'status') console.log(JSON.stringify(await api('GET', `/task/${rest[0]}`), null, 2));
  else if (cmd === 'gen') {
    const force = args.includes('--force');
    const items = select(rest).filter(m => force || !(state[m.id] && state[m.id].done));
    console.log('генерирую:', items.map(m => m.id).join(', ') || 'нечего');
    const errors = await pool(items, +flag('jobs', 3), gen);
    if (errors.length) { console.error('\nНе вышло:\n' + errors.join('\n')); process.exitCode = 1; }
  } else if (cmd === 'rig') {
    const errors = await pool(select(rest), 2, rig);
    if (errors.length) { console.error('\nНе вышло:\n' + errors.join('\n')); process.exitCode = 1; }
  } else console.log('команды: balance | gen <id|group:x|all> [--force] [--version v] | rig <id> | status <task>');
} catch (e) { console.error(e.message); process.exitCode = 1; }
