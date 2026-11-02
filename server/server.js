// Сервер «РУБЕЖ»: раздаёт страницу и держит комнаты для кооператива.
// Каждая комната считает свою партию 20 раз в секунду и рассылает снимки 10 раз в секунду.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game, TICK } from '../sim/game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 2;
const ALLOW_SPEED = process.env.ALLOW_SPEED === '1';

// ---------- раздача файлов ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const ROUTES = [
  ['/vendor/three.module.js', path.join(ROOT, 'node_modules/three/build/three.module.min.js')],
];
function resolveFile(url) {
  const p = decodeURIComponent(url.split('?')[0]);
  for (const [r, f] of ROUTES) if (p === r) return f;
  if (p.startsWith('/sim/')) return path.join(ROOT, 'sim', path.normalize(p.slice(5)).replace(/^(\.\.[/\\])+/, ''));
  const rel = p === '/' ? 'index.html' : path.normalize(p.slice(1)).replace(/^(\.\.[/\\])+/, '');
  return path.join(ROOT, 'client', rel);
}
const gzCache = new Map();
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  const file = resolveFile(req.url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file);
    const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300' };
    if (['.js', '.css', '.html', '.json', '.svg'].includes(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      let z = gzCache.get(file);
      if (!z || z.size !== data.length) { z = { size: data.length, buf: zlib.gzipSync(data, { level: 7 }) }; gzCache.set(file, z); }
      headers['content-encoding'] = 'gzip'; headers.vary = 'Accept-Encoding';
      res.writeHead(200, headers); res.end(z.buf); return;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

// ---------- комнаты ----------
const rooms = new Map(); // code -> room
const tokens = new Map(); // token -> { code, pid }

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function roomInfo(room) {
  return {
    type: 'room', code: room.code, host: room.host, state: room.game ? 'game' : 'lobby',
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready, connected: !!p.ws })),
  };
}
function broadcastRoom(room) { const m = roomInfo(room); for (const p of room.players.values()) send(p.ws, m); }

function startGame(room, speed = 1) {
  const list = [...room.players.values()];
  room.game = new Game({ players: list.map(p => ({ id: p.id, name: p.name })), seed: Date.now() & 0xffff });
  room.speed = speed;
  room.tick = 0;
  for (const p of list) send(p.ws, { type: 'start', you: p.id, mp: true });
  broadcastRoom(room);
  clearInterval(room.timer);
  room.timer = setInterval(() => roomTick(room), TICK * 1000);
}

function roomTick(room) {
  const g = room.game;
  if (!g) return;
  const anyone = [...room.players.values()].some(p => p.ws);
  if (!anyone) return; // все вышли — партия на паузе
  for (let i = 0; i < room.speed; i++) g.step();
  room.tick++;
  if (room.tick % 2 !== 0) return;
  const snap = g.snapshot();
  const ev = g.drainEvents();
  for (const p of room.players.values()) {
    if (!p.ws) continue;
    send(p.ws, { type: 'snap', s: snap, ev: ev.filter(e => !e.to || e.to === p.id) });
  }
  if ((g.phase === 'won' || g.phase === 'lost') && !room.endedAt) room.endedAt = Date.now();
}

function leaveRoom(room, pid) {
  room.players.delete(pid);
  for (const [t, v] of tokens) if (v.pid === pid) tokens.delete(t);
  if (room.host === pid) room.host = [...room.players.keys()][0] || null;
  if (room.players.size === 0) { clearInterval(room.timer); rooms.delete(room.code); return; }
  if (room.game) {
    // ушедший игрок: его башни остаются, деньги делим поровну
    const gp = room.game.player(pid);
    if (gp) { gp.name += ' (вышел)'; }
  }
  broadcastRoom(room);
}

// уборка: комнаты без игроков и отключившиеся слоты
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of [...room.players.values()]) {
      if (!p.ws && now - p.leftAt > (room.game ? 180000 : 30000)) leaveRoom(room, p.id);
    }
  }
}, 5000);

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
wss.on('connection', ws => {
  let me = null; // { room, pid }
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.type !== 'string') return;

    if (m.type === 'hello') {
      const name = String(m.name || 'Командир').trim().slice(0, 18) || 'Командир';
      // переподключение по токену
      const t = typeof m.token === 'string' && tokens.get(m.token);
      if (t && rooms.has(t.code)) {
        const room = rooms.get(t.code);
        const p = room.players.get(t.pid);
        if (p) {
          if (p.ws && p.ws !== ws) try { p.ws.close(); } catch {}
          p.ws = ws; p.name = name;
          me = { room, pid: p.id, token: m.token };
          send(ws, { type: 'welcome', pid: p.id, token: m.token });
          broadcastRoom(room);
          if (room.game) {
            send(ws, { type: 'start', you: p.id, mp: true, resume: true });
            send(ws, { type: 'snap', s: room.game.snapshot(), ev: [] });
          }
          return;
        }
      }
      const pid = 'p' + crypto.randomBytes(4).toString('hex');
      const token = crypto.randomBytes(12).toString('hex');
      me = { room: null, pid, token, name };
      send(ws, { type: 'welcome', pid, token });
      return;
    }
    if (!me) return;

    if (m.type === 'create' || m.type === 'join') {
      if (me.room) leaveRoom(me.room, me.pid);
      let room;
      if (m.type === 'create') {
        room = { code: makeCode(), players: new Map(), host: me.pid, game: null, timer: null };
        rooms.set(room.code, room);
      } else {
        room = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!room) { send(ws, { type: 'error', msg: 'Комната не найдена' }); return; }
        if (room.game) { send(ws, { type: 'error', msg: 'В этой комнате уже идёт бой' }); return; }
        if (room.players.size >= MAX_PLAYERS) { send(ws, { type: 'error', msg: 'Комната заполнена' }); return; }
      }
      const name = String(m.name || me.name || 'Командир').trim().slice(0, 18) || 'Командир';
      room.players.set(me.pid, { id: me.pid, name, ws, ready: false, leftAt: 0 });
      tokens.set(me.token, { code: room.code, pid: me.pid });
      me.room = room;
      broadcastRoom(room);
      return;
    }

    const room = me.room;
    if (!room) return;
    const p = room.players.get(me.pid);
    if (!p) return;

    switch (m.type) {
      case 'leave': leaveRoom(room, me.pid); me.room = null; send(ws, { type: 'left' }); return;
      case 'ready': p.ready = !!m.ready; broadcastRoom(room); return;
      case 'start': {
        if (room.host !== me.pid || room.game) return;
        const others = [...room.players.values()].filter(o => o.id !== me.pid);
        if (others.some(o => !o.ready)) { send(ws, { type: 'error', msg: 'Не все готовы' }); return; }
        startGame(room, ALLOW_SPEED ? Math.max(1, Math.min(8, m.speed | 0 || 1)) : 1);
        return;
      }
      case 'cmd': if (room.game && m.cmd && typeof m.cmd === 'object') room.game.command(me.pid, m.cmd); return;
      case 'restart': {
        if (room.host !== me.pid || !room.game) return;
        const g = room.game;
        if (g.phase !== 'won' && g.phase !== 'lost') return;
        clearInterval(room.timer); room.game = null; room.endedAt = 0;
        for (const q of room.players.values()) q.ready = false;
        broadcastRoom(room);
        return;
      }
      case 'chat': {
        const text = String(m.text || '').slice(0, 120);
        if (!text) return;
        for (const q of room.players.values()) send(q.ws, { type: 'chat', from: p.name, text });
        return;
      }
    }
  });
  ws.on('close', () => {
    if (!me || !me.room) return;
    const p = me.room.players.get(me.pid);
    if (p && p.ws === ws) { p.ws = null; p.leftAt = Date.now(); broadcastRoom(me.room); }
  });
});

server.listen(PORT, () => console.log(`РУБЕЖ: http://localhost:${PORT}`));
