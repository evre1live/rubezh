// «РУБЕЖ»: меню, лобби, ввод, интерфейс боковой панели и связь сцены со снимками партии.
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { LocalSession, RemoteSession } from './session.js';
import { Game } from '../sim/game.js';
import { loadAssets } from './assets.js';
import { MAP, STRUCTS, BUILDABLE, RULES, STRUCT_KINDS, ENEMIES, WAVES, PLAYER_COLORS, pathTiles, decorTiles } from '../sim/data.js';

const SOLO_ONLY = !!window.RUBEZH_SOLO;
const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Math.min(8, +params.get('speed') || 1));
const $ = id => document.getElementById(id);
const show = (el, on = true) => (typeof el === 'string' ? $(el) : el).classList.toggle('hidden', !on);
const fmtTime = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const PATH = pathTiles(), DECOR = decorTiles();

const SAY = {
  build_done: ['Строительство завершено', '', 'Строительство завершено'],
  building: ['Строим…', '', null],
  no_money: ['Недостаточно средств', 'warn', 'Недостаточно средств'],
  busy: ['Сначала закончите текущую стройку', 'warn', null],
  cancelled: ['Стройка отменена, деньги возвращены', '', null],
  low_power: ['Энергия на исходе — Разрядники гаснут', 'warn', 'Энергия на исходе'],
  power_ok: ['Энергия восстановлена', '', null],
  wave: ['Приближается противник', 'warn', 'Приближается противник'],
  disks: ['Радар: летающие диски! Нужен «Небосвод»', 'warn', 'Радар. Летающие диски'],
  psi: ['Внимание: пси-ведущие. Бейте их первыми', 'psi', 'Внимание. Пси-ведущие'],
  wave_clear: ['Волна отбита', '', 'Волна отбита'],
  base_attack: ['Наш штаб атакован', 'warn', 'Наш штаб атакован'],
  plant_attack: ['Диск атакует электростанцию', 'warn', 'Электростанция атакована'],
  captured: ['Наша башня захвачена', 'psi', 'Башня захвачена'],
  struct_lost: ['Строение потеряно', 'warn', 'Строение потеряно'],
  promoted: ['Башня получила лычку', '', null],
  elite: ['Башня стала элитной', '', 'Элита'],
  victory: ['Победа. Рубеж удержан', '', 'Победа. Рубеж удержан'],
  defeat: ['Штаб потерян', 'warn', 'Штаб потерян'],
};
const SAY_SOUND = { build_done: 'build', no_money: 'deny', busy: 'deny', low_power: 'alarm', base_attack: 'alarm', captured: 'capture', plant_attack: 'alarm' };

// ---------- картинки ----------
const UI = 'assets/ui/';
function loadImage(src) {
  return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}
const uiReady = {};

// ---------- состояние ----------
const sound = new Sound();
let R = null;
let session = null;
let snap = null, snapAt = 0, interval = 50;
let me = null;
let placing = null, pinging = false;
let cameoImgs = {}, cameoTeam = null;
let occ = new Map();
let gameOn = false, ended = false, endTimer = 0;
let shownCredits = 0;
let lastReady = false;
let firstGame = true;
let room = null;
let myColor = PLAYER_COLORS[0];
let paused = false;

// ---------- имя ----------
const nameIn = $('in-name');
try { nameIn.value = localStorage.getItem('rubezh-name') || ''; } catch {}
const myName = () => {
  const n = nameIn.value.trim().slice(0, 18) || 'Командир';
  try { localStorage.setItem('rubezh-name', n); } catch {}
  return n;
};

// ---------- голос штаба ----------
function eva(text, cls = '') {
  const box = $('eva');
  const m = document.createElement('div');
  m.className = 'm ' + cls; m.textContent = text;
  box.appendChild(m);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => m.classList.add('out'), 3200);
  setTimeout(() => m.remove(), 3900);
}

// ---------- иконки строительства ----------
function buildCameos(team) {
  if (cameoTeam === team) return;
  cameoTeam = team;
  cameoImgs = BUILDABLE.every(k => uiReady['cameo_' + k]) ? {} : Renderer.renderCameos(BUILDABLE, team, (k, c) => R.makeStructModel(k, c));
  const wrap = $('cameos');
  wrap.innerHTML = '';
  BUILDABLE.forEach((kind, i) => {
    const d = STRUCTS[kind];
    const b = document.createElement('button');
    b.className = 'cameo'; b.dataset.kind = kind;
    b.style.backgroundImage = `url(${uiReady['cameo_' + kind] || cameoImgs[kind]})`;
    b.innerHTML = `<span class="key">${i + 1}</span><span class="cost">${d.cost}</span><span class="nm">${d.short || d.name}</span><span class="clock hidden"></span><span class="ready hidden">Готово</span>`;
    b.addEventListener('click', () => cameoClick(kind));
    b.addEventListener('contextmenu', e => { e.preventDefault(); cameoCancel(kind); });
    b.addEventListener('mouseenter', () => showTip(b, kind));
    b.addEventListener('mouseleave', () => show('tooltip', false));
    wrap.appendChild(b);
  });
}

function showTip(el, kind) {
  const d = STRUCTS[kind];
  const t = $('tooltip');
  const pw = d.power < 0 ? `+${-d.power} энергии` : `−${d.power} энергии`;
  t.innerHTML = `<div class="tn">${d.name}</div><div class="tr">${d.role}</div><div class="td">${d.desc}</div><div class="tf"><span>${d.cost} кр.</span><span>${pw}</span><span>${d.build} с</span></div>`;
  const r = el.getBoundingClientRect();
  t.style.left = Math.max(8, r.left - 232) + 'px';
  t.style.top = Math.min(innerHeight - 140, r.top) + 'px';
  show(t, true);
}

function cameoClick(kind) {
  sound.init(); sound.play('click');
  if (!me || ended) return;
  const b = me[4], ready = me[6];
  if (!b) { session.send({ t: 'build', kind }); return; }
  if (b === kind && ready) { startPlacing(kind); return; }
  if (b === kind) { eva('Строится… Правая кнопка по иконке — отменить'); return; }
  eva('Сначала закончите текущую стройку', 'warn'); sound.play('deny');
}
function cameoCancel(kind) {
  if (!me) return;
  if (me[4] === kind) { session.send({ t: 'cancel' }); stopPlacing(); sound.play('click'); }
}

// ---------- стройка на карте ----------
function canPlace(tx, ty) {
  if (!snap) return false;
  if (tx < 0 || ty < 0 || tx >= MAP.w || ty >= MAP.h) return false;
  const k = ty * MAP.w + tx;
  if (PATH.has(k) || DECOR.has(k) || occ.has(k)) return false;
  const cx = tx + 0.5, cy = ty + 0.5;
  for (const s of snap.st) {
    if (s[7]) continue;
    const hq = STRUCT_KINDS[s[1]] === 'hq';
    const sx = hq ? s[3] + MAP.hq.w / 2 : s[3] + 0.5, sy = hq ? s[4] + MAP.hq.h / 2 : s[4] + 0.5;
    if (Math.hypot(sx - cx, sy - cy) <= RULES.buildRadius + (hq ? 0.8 : 0)) return true;
  }
  return false;
}
function startPlacing(kind) {
  placing = kind; pinging = false;
  R.setGhost(kind, myColor);
  R.paintGrid(canPlace);
  R.selected = null; updateSelPanel();
  $('view').classList.add('placing'); $('view').classList.remove('pinging');
  hint(`Поставьте «${STRUCTS[kind].name}» на зелёную клетку · <b>правая кнопка</b> — отложить`);
}
function stopPlacing() {
  placing = null; R && R.setGhost(null);
  $('view').classList.remove('placing');
  hint(null);
}
function hint(html) { const h = $('hint'); if (!html) { show(h, false); return; } h.innerHTML = html; show(h, true); }

// ---------- ввод ----------
const viewEl = $('view'), canvas = $('scene');
let drag = null, mouse = { x: 0, y: 0, in: false };
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  sound.init();
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (e.button === 2 || e.button === 1) { drag = { x, y, moved: false, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); return; }
  if (e.button !== 0 || !gameOn) return;
  if (e.pointerType === 'touch') { drag = { x, y, moved: false, id: e.pointerId, touch: true }; canvas.setPointerCapture(e.pointerId); return; }
  clickWorld(x, y);
});
canvas.addEventListener('pointermove', e => {
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  mouse = { x, y, in: true };
  if (drag) {
    const dx = x - drag.x, dy = y - drag.y;
    if (drag.moved || Math.hypot(dx, dy) > 4) { drag.moved = true; R.panScreen(-dx, -dy); drag.x = x; drag.y = y; }
    return;
  }
  hoverAt(x, y);
});
canvas.addEventListener('pointerup', e => {
  if (!drag) return;
  const d = drag; drag = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  if (d.moved) return;
  if (d.touch) { clickWorld(d.x, d.y); return; }
  // правый клик без движения — отмена
  if (placing) { stopPlacing(); sound.play('click'); }
  else if (pinging) { pinging = false; viewEl.classList.remove('pinging'); hint(null); }
  else { R.selected = null; updateSelPanel(); }
});
canvas.addEventListener('pointerleave', () => { mouse.in = false; if (R) R.hover = null; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  R.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

function tileAt(x, y) {
  const p = R.screenToWorld(x, y);
  if (!p) return null;
  return { tx: Math.floor(p.x), ty: Math.floor(p.z), wx: p.x, wz: p.z };
}
function hoverAt(x, y) {
  if (!R) return;
  const t = tileAt(x, y);
  if (!t) return;
  if (placing) { R.moveGhost(t.tx, t.ty, canPlace(t.tx, t.ty)); return; }
  const s = occ.get(t.ty * MAP.w + t.tx);
  let hov = s ? s[0] : null;
  if (!hov) {
    let best = 0.45;
    for (const v of R.enemies.values()) { const d = Math.hypot(v.x - t.wx, v.z - t.wz); if (d < best) { best = d; hov = v.id; } }
  }
  R.hover = hov;
  canvas.style.cursor = s ? 'pointer' : '';
}
function clickWorld(x, y) {
  const t = tileAt(x, y);
  if (!t) return;
  if (pinging) {
    session.send({ t: 'ping', x: t.wx, y: t.wz });
    pinging = false; viewEl.classList.remove('pinging'); hint(null); $('btn-ping').classList.remove('on');
    return;
  }
  if (placing) {
    if (!canPlace(t.tx, t.ty)) { sound.play('deny'); eva(placeReason(t.tx, t.ty), 'warn'); return; }
    session.send({ t: 'place', x: t.tx, y: t.ty });
    stopPlacing();
    return;
  }
  const s = occ.get(t.ty * MAP.w + t.tx);
  R.selected = s ? s[0] : null;
  if (s) sound.play('click');
  updateSelPanel();
}
function placeReason(tx, ty) {
  const k = ty * MAP.w + tx;
  if (tx < 0 || ty < 0 || tx >= MAP.w || ty >= MAP.h) return 'Вне карты';
  if (PATH.has(k)) return 'На дороге строить нельзя';
  if (DECOR.has(k) || occ.has(k)) return 'Место занято';
  return 'Слишком далеко от базы — стройте рядом со своими зданиями';
}

const keys = new Set();
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Enter' && e.target.id === 'in-code') $('btn-join').click(); return; }
  keys.add(e.code);
  if (!gameOn) return;
  if (e.code === 'Escape') {
    if (placing) stopPlacing();
    else if (pinging) { pinging = false; viewEl.classList.remove('pinging'); hint(null); }
    else if (R.selected) { R.selected = null; updateSelPanel(); }
    else togglePause(true);
  }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= BUILDABLE.length) cameoClick(BUILDABLE[n - 1]);
  if (e.code === 'Space') { e.preventDefault(); $('btn-wave').click(); }
  if (e.code === 'KeyQ') $('btn-ping').click();
  if ((e.code === 'Delete' || e.code === 'Backspace') && R.selected) $('sel-sell')?.click();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ---------- кнопки боковой панели ----------
$('btn-wave').addEventListener('click', () => { sound.init(); if (snap && snap.ph === 'countdown') { session.send({ t: 'wave' }); sound.play('click'); } });
$('btn-ping').addEventListener('click', () => {
  sound.init();
  pinging = !pinging; if (pinging) stopPlacing();
  viewEl.classList.toggle('pinging', pinging);
  $('btn-ping').classList.toggle('on', pinging);
  hint(pinging ? 'Нажмите на карту, чтобы поставить метку для союзника' : null);
});
$('btn-menu').addEventListener('click', () => togglePause(true));
$('radar').addEventListener('pointerdown', e => {
  const cv = $('radar'); const r = cv.getBoundingClientRect();
  const w = R.radarToWorld((e.clientX - r.left) / r.width * cv.width, (e.clientY - r.top) / r.height * cv.height);
  R.centerOn(w.x, w.z);
});

function togglePause(on) {
  paused = on;
  show('pausemenu', on);
  if (session) session.setPaused(on);
  $('opt-sfx').checked = sound.sfxOn; $('opt-music').checked = sound.musicOn; $('opt-voice').checked = sound.voiceOn;
}
$('btn-resume').addEventListener('click', () => togglePause(false));
$('opt-sfx').addEventListener('change', e => sound.setSfx(e.target.checked));
$('opt-music').addEventListener('change', e => sound.setMusic(e.target.checked));
$('opt-voice').addEventListener('change', e => sound.setVoice(e.target.checked));
$('opt-quality').addEventListener('change', e => { R.setQuality(e.target.value); try { localStorage.setItem('rubezh-quality', e.target.value); } catch {} });
$('btn-quit').addEventListener('click', () => {
  togglePause(false);
  if (session && session.mp) session.raw({ type: 'leave' });
  try { sessionStorage.removeItem('rubezh-room'); } catch {}
  quitToMenu();
});

// ---------- панель выбранного строения ----------
function updateSelPanel() {
  const p = $('selpanel');
  const s = snap && R && R.selected && snap.st.find(o => o[0] === R.selected);
  if (!s) { show(p, false); return; }
  const kind = STRUCT_KINDS[s[1]], d = STRUCTS[kind];
  const owner = snap.pl.find(q => q[0] === s[2]);
  const mine = s[2] === session.you;
  const refund = Math.round((d.cost || 0) * RULES.sellRefund);
  const rank = ['Новобранец', 'Ветеран', 'Элита'][s[6]];
  const pw = d.power < 0 ? `+${-d.power}` : `−${d.power}`;
  p.innerHTML = `<div class="sn">${d.name}</div><div class="so">${kind === 'hq' ? 'Общий штаб' : owner ? owner[1] : ''}${s[7] ? ' · <span style="color:#d6b8ff">захвачена</span>' : ''}</div>
    <div class="sr"><span>Прочность</span><b>${Math.round(s[5] * 100)}%</b></div>
    ${d.weapon ? `<div class="sr"><span>Звание</span><b>${rank}</b></div>` : ''}
    <div class="sr"><span>Энергия</span><b>${pw}</b></div>
    ${mine && kind !== 'hq' ? `<button class="sbbtn red" id="sel-sell">Продать за ${refund}</button>` : ''}`;
  const sb = $('sel-sell');
  if (sb) sb.onclick = () => { session.send({ t: 'sell', id: s[0] }); sound.play('sell'); R.selected = null; updateSelPanel(); };
  show(p, true);
}

// ---------- снимки ----------
function onSnap(s, ev) {
  const now = performance.now();
  if (snap) interval = Math.max(30, Math.min(160, interval * 0.8 + (now - snapAt) * 0.2));
  snap = s; snapAt = now;
  me = s.pl.find(p => p[0] === session.you) || s.pl[0];
  R.setPlayers(s.pl);
  if (me && me[2] !== myColor) { myColor = me[2]; buildCameos(myColor); }
  R.syncStructs(s.st, now);
  R.syncEnemies(s.en);
  occ = new Map();
  for (const st of s.st) {
    const hq = STRUCT_KINDS[st[1]] === 'hq';
    const w = hq ? MAP.hq.w : 1, h = hq ? MAP.hq.h : 1;
    for (let y = st[4]; y < st[4] + h; y++) for (let x = st[3]; x < st[3] + w; x++) occ.set(y * MAP.w + x, st);
  }
  R.handleEvents(ev, 0);
  for (const e of ev) handleEvent(e);
  updateHud();
  if (placing) R.paintGrid(canPlace);
  if (R.selected) updateSelPanel();
}

function handleEvent(e) {
  if (e.to && e.to !== session.you) return;
  switch (e.e) {
    case 'say': {
      const m = SAY[e.key];
      if (!m) return;
      eva(m[0], m[1]);
      if (m[2]) sound.say(m[2]);
      if (SAY_SOUND[e.key]) sound.play(SAY_SOUND[e.key]);
      return;
    }
    case 'deny': eva(e.msg, 'warn'); sound.play('deny'); return;
    case 'build': if (e.owner === session.you) sound.play('place'); return;
    case 'wave': sound.play('wave'); return;
    case 'bonus': eva(`Ранний вызов волны: +${e.amount} кредитов`); sound.play('cash'); return;
    case 'capture': sound.play('capture'); return;
    case 'end':
      ended = true; stopPlacing();
      clearTimeout(endTimer);
      endTimer = setTimeout(() => showEnd(e.won), 2600);
      return;
  }
}

function updateHud() {
  const s = snap;
  $('hud-wave').textContent = `${Math.max(s.wv, s.ph === 'countdown' ? s.wv + 1 : s.wv)} / ${s.nw}`;
  const timer = $('hud-timer');
  if (s.ph === 'countdown') {
    const pv = s.next.map(([k, n]) => `<span class="pv"><img src="${UI}enemy_${k}.webp" alt="">${ENEMIES[k].name} ×${n}</span>`).join('');
    timer.innerHTML = `${s.wv === 0 ? 'Первая волна' : 'Следующая волна'} через<span class="t">${fmtTime(s.cd)}</span>${pv}`;
    timer.classList.toggle('alarm', s.cd <= 5);
  } else if (s.ph === 'wave') {
    timer.innerHTML = `Идёт волна · врагов на карте: <span class="t">${s.en.length}</span>`;
    timer.classList.remove('alarm');
  } else timer.textContent = s.ph === 'won' ? 'Рубеж удержан' : 'Штаб потерян';
  const hq = $('hud-hq');
  hq.style.width = `calc(${s.hq * 100}% - 2px)`;
  hq.className = s.hq > 0.5 ? '' : s.hq > 0.25 ? 'mid' : 'low';
  $('hud-players').innerHTML = s.pl.length > 1 ? s.pl.map(p => `<div class="hud-cell pl"><i style="background:${p[2]};color:${p[2]}"></i>${escapeHtml(p[1])}<span class="c">${p[3]}</span></div>`).join('') : '';
  // энергия
  const [prod, use] = s.pw;
  const cap = Math.max(prod, use, 200) * 1.15;
  const fill = $('pw-fill');
  fill.style.height = (prod / cap * 100) + '%';
  fill.className = 'pw-fill' + (use > prod ? ' low' : use > prod * 0.85 ? ' warn' : '');
  $('pw-use').style.bottom = (use / cap * 100) + '%';
  $('powerbar').title = `Энергия: выработка ${prod}, расход ${use}`;
  $('radar-off').classList.toggle('on', use > prod);
  const ip = $('i-power'); ip.textContent = `${use} / ${prod}`; ip.className = use > prod ? 'low' : '';
  if (me) $('i-kills').textContent = me[7];
  $('i-income').textContent = `+${RULES.income} кр./с`;
  // кнопка волны
  const wb = $('btn-wave');
  wb.disabled = s.ph !== 'countdown';
  wb.classList.toggle('pulse', s.ph === 'countdown');
  wb.textContent = s.ph === 'countdown' && s.cd > 0 ? `Волна сейчас +${s.cd * RULES.earlyBonus}` : 'Волна сейчас';
  const [tip, warnTip] = tipFor(s);
  const tt = $('tip-text');
  if (tt.textContent !== tip) tt.textContent = tip;
  $('sb-tip').classList.toggle('warn', warnTip);
  // иконки
  if (!me) return;
  const [, , , credits, bkind, prog, ready] = me;
  for (const b of $('cameos').children) {
    const kind = b.dataset.kind, d = STRUCTS[kind];
    const mineB = bkind === kind;
    b.classList.toggle('poor', !bkind && credits < d.cost);
    b.classList.toggle('busy', !!bkind && !mineB);
    const clock = b.querySelector('.clock'), rd = b.querySelector('.ready');
    show(clock, mineB && !ready);
    if (mineB && !ready) clock.style.setProperty('--p', (prog * 100).toFixed(1) + '%');
    show(rd, mineB && ready);
  }
  if (ready && !lastReady && !placing && !ended) startPlacing(bkind);
  if (!ready && placing && bkind !== placing) stopPlacing();
  lastReady = !!ready;
  if (firstGame && s.ph === 'countdown' && s.wv === 0 && !bkind && !placing && s.st.length <= 3 && $('briefing').classList.contains('hidden')) hint('Нажмите на иконку справа или клавишу <b>1</b>, чтобы построить башню');
  else if (!placing && !pinging && $('hint').textContent.startsWith('Нажмите на иконку')) hint(null);
}
function tipFor(s) {
  const [prod, use] = s.pw;
  const kinds = new Set(s.st.filter(x => x[2] === session.you).map(x => STRUCT_KINDS[x[1]]));
  const next = new Set(s.next.map(n => n[0]));
  const onMap = new Set(s.en.map(e => e[1]));
  if (use > prod) return ['Энергии не хватает: Разрядники молчат, остальные башни стреляют вдвое реже. Постройте станцию или продайте лишнее.', true];
  if ((next.has('disk') || onMap.has(2)) && !s.st.some(x => STRUCT_KINDS[x[1]] === 'nebosvod')) return ['Летят диски — их сбивает только «Небосвод». Поставьте его рядом с электростанцией.', true];
  if (next.has('psi') || onMap.has(3)) return ['Пси-ведущий захватывает самую дорогую башню рядом. Убейте его — башня вернётся.', false];
  if (next.has('brute') || onMap.has(1)) return ['Громила толстокож: пулемёты почти не берут, нужен Разрядник. Он растёт, поедая павших клонов.', false];
  if (prod - use < 30 && kinds.size) return ['Запас энергии на исходе. Следующей постройкой лучше взять станцию.', false];
  if (s.ph === 'countdown' && s.wv === 0) return ['Башни у поворотов дороги бьют дольше. Стройте рядом со своими зданиями.', false];
  if (s.ph === 'countdown') return ['Вызовите волну раньше — за каждую сэкономленную секунду штаб доплатит.', false];
  return ['Башни получают лычки за победы: ветеран бьёт сильнее, элита ещё и чинится быстрее.', false];
}
const escapeHtml = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- кадр ----------
let lastT = performance.now(), radarT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (!R) return;
  // движение карты с клавиатуры
  if (gameOn) {
    const sp = 600 * dt;
    let dx = 0, dy = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= sp;
    if (keys.has('KeyD') || keys.has('ArrowRight')) dx += sp;
    if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= sp;
    if (keys.has('KeyS') || keys.has('ArrowDown')) dy += sp;
    if (dx || dy) R.panScreen(dx, dy);
  }
  const alpha = snap ? Math.min(1, (now - snapAt) / interval) : 1;
  R.frame(dt, alpha, { lowPower: snap ? snap.pw[1] > snap.pw[0] : false, playerCount: snap ? snap.pl.length : 1 });
  if (gameOn && me) {
    const target = me[3];
    if (Math.abs(target - shownCredits) < 1) shownCredits = target;
    else shownCredits += (target - shownCredits) * Math.min(1, dt * 10);
    $('credits').textContent = Math.round(shownCredits);
  }
  radarT -= dt;
  if (radarT <= 0 && gameOn) { radarT = 0.1; R.drawRadar(snap && snap.ph === 'wave' && snap.hq < 1 && (now % 1000) < 500); }
  sound.intensity = snap && snap.ph === 'wave' ? 1 : 0;
}

// ---------- экраны ----------
function screen(id) {
  for (const s of ['menu', 'lobby', 'briefing', 'endscreen']) show(s, s === id);
}
function enterGame() {
  gameOn = true; ended = false; snap = null; me = null; lastReady = false; shownCredits = 0;
  R.structs.forEach(v => R.scene.remove(v.obj)); R.structs.clear();
  R.enemies.forEach(v => R.scene.remove(v.obj)); R.enemies.clear();
  R.selected = null;
  stopPlacing();
  show('hud', true); show('sidebar', true);
  requestAnimationFrame(() => { R.resize(); R.radarSetup($('radar')); });
}
function menuBackdrop() {
  const g = new Game({ players: [{ id: 'menu', name: '' }, { id: 'menu2', name: '' }] });
  const s0 = g.snapshot();
  R.setPlayers(s0.pl);
  R.syncStructs(s0.st.map(x => { x[9] = 1; return x; }), performance.now() - 2000);
  R.syncEnemies([]);
}
function quitToMenu() {
  gameOn = false; ended = false;
  clearTimeout(endTimer);
  if (session) { session.stop(); if (session.close) session.close(); }
  session = null; room = null; snap = null;
  R.structs.forEach(v => R.scene.remove(v.obj)); R.structs.clear();
  R.enemies.forEach(v => R.scene.remove(v.obj)); R.enemies.clear();
  stopPlacing();
  show('hud', false); show('sidebar', false); show('selpanel', false);
  menuBackdrop();
  screen('menu');
  requestAnimationFrame(() => R.resize());
}

function showEnd(won) {
  if (!snap) return;
  const t = $('end-title');
  t.textContent = won ? 'Победа' : 'Штаб потерян';
  t.className = won ? 'win' : '';
  $('end-sub').textContent = won ? `Все ${snap.nw} волн отбиты. Ташкент свободен.` : `Орден прорвался на волне ${snap.wv} из ${snap.nw}.`;
  $('end-stats').innerHTML = snap.pl.map(p => `<div class="es"><i style="background:${p[2]}"></i><b>${escapeHtml(p[1])}</b><span>уничтожено ${p[7]}</span><span>построено ${p[8]}</span></div>`).join('');
  const host = !session.mp || (room && room.host === session.you);
  $('btn-again').textContent = session.mp ? (host ? 'В лобби' : 'Ждём командира') : 'Ещё раз';
  $('btn-again').disabled = !host;
  screen('endscreen');
  firstGame = false;
}
$('btn-again').addEventListener('click', () => {
  sound.init(); sound.play('click');
  if (!session) return;
  if (session.mp) { session.restart(); return; }
  screen(null); enterGame(); session.restart();
});
$('btn-tomenu').addEventListener('click', () => quitToMenu());

// ---------- брифинг ----------
const BRIEF = `Командир, 1987 год. Пси-маяки Ордена Третьего Глаза зажглись над Ташкентом. Удержите штаб у телебашни — шесть волн.

Стройте рядом со своими зданиями. Следите за энергией: без неё Разрядники гаснут. Диски охотятся за электростанциями — держите рядом «Небосвод». Пси-ведущих бейте первыми: они захватывают башни.`;
let briefTimer = 0;
function showBriefing(onGo) {
  screen('briefing');
  hint(null);
  drawGeneral($('crt-face'));
  const el = $('crt-text');
  let i = 0;
  clearInterval(briefTimer);
  briefTimer = setInterval(() => {
    i += 2;
    el.innerHTML = escapeHtml(BRIEF.slice(0, i)) + '<span class="cur"></span>';
    if (i >= BRIEF.length) clearInterval(briefTimer);
  }, 18);
  const intel = $('crt-intel');
  if (!intel.firstChild) intel.innerHTML = [['clone', 'Клон', 'идут толпой'], ['brute', 'Громила', 'нужен Разрядник'], ['disk', 'Диск', 'нужен Небосвод'], ['psi', 'Пси-ведущий', 'захватывает башни']]
    .map(([k, n, d]) => `<div class="ic"><img src="${UI}enemy_${k}.webp" alt=""><b>${n}</b><span>${d}</span></div>`).join('');
  $('btn-brief').onclick = () => { clearInterval(briefTimer); sound.init(); sound.play('click'); screen(null); onGo(); };
}
function drawGeneral(el) {
  if (el.firstChild) return;
  const img = new Image();
  img.src = UI + 'general.webp'; img.alt = 'Генерал';
  img.onerror = () => { img.remove(); drawGeneralFallback(el); };
  el.appendChild(img);
}
function drawGeneralFallback(el) {
  const c = document.createElement('canvas'); c.width = 112; c.height = 132; el.appendChild(c);
  const g = c.getContext('2d');
  const G = a => `rgba(140,255,150,${a})`;
  g.fillStyle = '#031006'; g.fillRect(0, 0, 112, 132);
  const bg = g.createRadialGradient(56, 60, 10, 56, 60, 80); bg.addColorStop(0, 'rgba(60,140,70,0.35)'); bg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = bg; g.fillRect(0, 0, 112, 132);
  // плечи и китель
  g.fillStyle = G(0.35); g.beginPath(); g.moveTo(6, 132); g.quadraticCurveTo(14, 92, 56, 90); g.quadraticCurveTo(98, 92, 106, 132); g.fill();
  g.fillStyle = G(0.7); g.fillRect(10, 98, 24, 7); g.fillRect(78, 98, 24, 7);
  g.fillStyle = G(0.55); for (let i = 0; i < 3; i++) g.fillRect(64, 110 + i * 6, 14, 3);
  g.fillStyle = G(0.25); g.beginPath(); g.moveTo(46, 92); g.lineTo(56, 112); g.lineTo(66, 92); g.fill();
  // голова
  g.fillStyle = G(0.5); g.beginPath(); g.ellipse(56, 64, 21, 26, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = G(0.85); g.fillRect(44, 60, 8, 3); g.fillRect(60, 60, 8, 3);
  g.fillStyle = G(0.9); g.beginPath(); g.moveTo(42, 76); g.quadraticCurveTo(56, 70, 70, 76); g.quadraticCurveTo(56, 80, 42, 76); g.fill();
  // фуражка
  g.fillStyle = G(0.75); g.beginPath(); g.ellipse(56, 42, 30, 9, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = G(0.6); g.beginPath(); g.moveTo(30, 42); g.quadraticCurveTo(56, 14, 82, 42); g.fill();
  g.fillStyle = G(1); g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 2.5 : 6; g.lineTo(56 + Math.cos(a) * r, 33 + Math.sin(a) * r); }
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)'; for (let y = 0; y < 132; y += 3) g.fillRect(0, y, 112, 1);
}

// ---------- одиночная игра ----------
$('btn-solo').addEventListener('click', () => {
  sound.init(); sound.play('click');
  const name = myName();
  session = new LocalSession(name, SPEED);
  myColor = PLAYER_COLORS[0]; buildCameos(myColor);
  enterGame();
  session.start(onSnap);
  session.setPaused(true);
  showBriefing(() => { session.setPaused(false); });
});

// ---------- кооператив ----------
async function connect() {
  const s = new RemoteSession();
  s.on('room', m => {
    room = m; renderLobby();
    try { sessionStorage.setItem('rubezh-room', m.code); } catch {}
    if (m.state === 'lobby' && !gameOn && $('lobby').classList.contains('hidden') && $('endscreen').classList.contains('hidden')) screen('lobby');
    if (m.state === 'lobby' && gameOn) { gameOn = false; show('hud', false); show('sidebar', false); R.structs.forEach(v => R.scene.remove(v.obj)); R.structs.clear(); R.enemies.forEach(v => R.scene.remove(v.obj)); R.enemies.clear(); screen('lobby'); requestAnimationFrame(() => R.resize()); } });
  s.on('error', m => { $('menu-err').textContent = m.msg; $('lobby-err').textContent = m.msg; sound.play('deny'); });
  s.on('start', m => {
    const idx = room ? room.players.findIndex(p => p.id === s.you) : 0;
    myColor = PLAYER_COLORS[Math.max(0, idx)]; buildCameos(myColor);
    enterGame();
    s.start(onSnap);
    if (!m.resume) showBriefing(() => {});
    else screen(null);
  });
  s.on('left', () => { room = null; try { sessionStorage.removeItem('rubezh-room'); } catch {} });
  s.on('disconnect', () => { if (gameOn) eva('Связь со штабом потеряна. Переподключаюсь…', 'warn'); });
  await s.connect(myName());
  return s;
}
async function mp(action, code) {
  sound.init(); sound.play('click');
  $('menu-err').textContent = '';
  try {
    if (!session || !session.mp) session = await connect();
    session.raw({ type: action, code, name: myName() });
    screen('lobby');
  } catch (e) {
    session = null;
    $('menu-err').textContent = 'Сервер игры недоступен. Попробуйте одиночную игру.';
  }
}
$('btn-create').addEventListener('click', () => mp('create'));
$('btn-join').addEventListener('click', () => {
  const code = $('in-code').value.trim().toUpperCase();
  if (code.length !== 4) { $('menu-err').textContent = 'Код комнаты — 4 символа'; return; }
  mp('join', code);
});
function renderLobby() {
  if (!room) return;
  $('lobby-code').textContent = room.code;
  const list = $('lobby-players');
  const rows = room.players.map((p, i) => `<div class="lp"><i style="background:${PLAYER_COLORS[i]}"></i>${escapeHtml(p.name)}${p.id === room.host ? ' · командир' : ''}${!p.connected ? ' · нет связи' : ''}<span class="st ${p.ready || p.id === room.host ? 'ok' : ''}">${p.id === room.host ? 'создал комнату' : p.ready ? 'готов' : 'не готов'}</span></div>`);
  if (room.players.length < 2) rows.push('<div class="lp empty">Ждём второго командира…</div>');
  list.innerHTML = rows.join('');
  const host = room.host === session.you;
  const mine = room.players.find(p => p.id === session.you);
  show('btn-ready', !host); show('btn-start', host);
  $('btn-ready').textContent = mine && mine.ready ? 'Не готов' : 'Готов';
  const others = room.players.filter(p => p.id !== room.host);
  $('btn-start').disabled = others.some(p => !p.ready);
  $('btn-start').textContent = room.players.length < 2 ? 'Начать бой одному' : 'Начать бой';
  $('lobby-hint').textContent = host ? (others.length && others.some(p => !p.ready) ? 'Ждём, пока союзник нажмёт «Готов».' : 'Пошлите другу ссылку или код комнаты.') : 'Нажмите «Готов» — бой начнёт создатель комнаты.';
  $('lobby-err').textContent = '';
}
$('btn-ready').addEventListener('click', () => { const mine = room.players.find(p => p.id === session.you); session.raw({ type: 'ready', ready: !(mine && mine.ready) }); sound.play('click'); });
$('btn-start').addEventListener('click', () => { session.raw({ type: 'start', speed: SPEED }); sound.play('click'); });
$('btn-leave').addEventListener('click', () => { session.raw({ type: 'leave' }); try { sessionStorage.removeItem('rubezh-room'); } catch {} quitToMenu(); });
$('btn-copy').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${room.code}`;
  try { await navigator.clipboard.writeText(url); $('btn-copy').textContent = 'Ссылка скопирована'; }
  catch { $('btn-copy').textContent = url; }
  setTimeout(() => ($('btn-copy').textContent = 'Скопировать ссылку'), 2500);
});

// ---------- запуск ----------
function checkRotate() { show('rotate', innerWidth < innerHeight && innerWidth < 700); }
addEventListener('resize', () => { if (R) R.resize(); checkRotate(); });
async function boot() {
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch {}
  const lt = document.querySelector('.loading-text');
  await loadAssets('assets/', (d, n) => { lt.textContent = `Загрузка моделей: ${d} из ${n}`; });
  lt.textContent = 'Загрузка карты…';
  const [grass, asphalt, paving, ...ui] = await Promise.all([
    loadImage('assets/tex/grass.webp'), loadImage('assets/tex/asphalt.webp'), loadImage('assets/tex/paving.webp'),
    ...BUILDABLE.map(k => loadImage(`${UI}cameo_${k}.webp`)),
  ]);
  BUILDABLE.forEach((k, i) => { if (ui[i]) uiReady['cameo_' + k] = ui[i].src; });
  R = new Renderer($('scene'), $('overlay'), { grass, asphalt, paving });
  R.onSound = n => sound.play(n);
  let q = 'high';
  try { q = localStorage.getItem('rubezh-quality') || 'high'; } catch {}
  if (params.get('q')) q = params.get('q');
  R.setQuality(q);
  $('opt-quality').value = q;
  buildCameos(myColor);
  menuBackdrop();
  if (SOLO_ONLY) { show('mp-block', false); show('mp-note', true); }
  const code = params.get('room');
  if (code && !SOLO_ONLY) { $('in-code').value = code.toUpperCase(); $('menu-err').textContent = 'Вас позвали в комнату — нажмите «Войти»'; }
  show('loading', false);
  checkRotate();
  // вернуться в комнату после перезагрузки страницы
  let saved = null;
  try { saved = sessionStorage.getItem('rubezh-room'); } catch {}
  if (saved && !SOLO_ONLY) {
    connect().then(s => { session = s; setTimeout(() => { if (!room) try { sessionStorage.removeItem('rubezh-room'); } catch {} }, 2500); }).catch(() => {});
  }
  requestAnimationFrame(loop);
  window.__rubezh = { get snap() { return snap; }, get R() { return R; }, get session() { return session; }, canPlace, cameoClick, startPlacing, clickWorld };
}
boot();
