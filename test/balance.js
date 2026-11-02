// Прогон партий без графики: простой бот строит оборону, смотрим, проходятся ли волны.
// node test/balance.js
import { Game, MAP, STRUCTS, PATH_LEN, pathPos } from '../sim/game.js';

const samples = [];
for (let d = 0; d <= PATH_LEN; d += 0.5) samples.push(pathPos(d));

function bestSpot(g, kind) {
  const def = STRUCTS[kind];
  let best = null, bs = -1;
  for (let y = 0; y < MAP.h; y++) for (let x = 0; x < MAP.w; x++) {
    if (g.canPlace(x, y)) continue;
    const cx = x + 0.5, cy = y + 0.5;
    let score;
    if (kind === 'plant') score = 100 - Math.hypot(cx - 20, cy - 12);
    else if (kind === 'nebosvod') {
      score = 0;
      for (const s of g.structs) if (s.kind === 'plant') { const d = Math.hypot(s.x + 0.5 - cx, s.y + 0.5 - cy); if (d < def.range - 1) score += 10 - d; }
      score += cx * 0.2;
    } else {
      score = 0;
      for (const p of samples) if (Math.hypot(p.x - cx, p.y - cy) <= def.range) score++;
      score += cx * 0.05;
    }
    if (score > bs) { bs = score; best = [x, y]; }
  }
  return best;
}

function run({ players = 1, order, skill = 1, log = false }) {
  const g = new Game({ players: Array.from({ length: players }, (_, i) => ({ id: 'p' + i, name: 'Бот ' + i })) });
  const idx = {};
  g.players.forEach(p => (idx[p.id] = 0));
  let ticks = 0;
  while (g.phase !== 'won' && g.phase !== 'lost' && ticks < 20 * 60 * 20) {
    for (const p of g.players) {
      const o = order[(idx[p.id] + p.slot) % order.length];
      if (!p.build && skill > 0 && ticks % Math.round(20 / skill) === 0) {
        if (p.credits >= STRUCTS[o].cost) { g.command(p.id, { t: 'build', kind: o }); idx[p.id]++; }
      }
      if (p.build && p.build.ready) {
        const spot = bestSpot(g, p.build.kind);
        if (spot) g.command(p.id, { t: 'place', x: spot[0], y: spot[1] });
      }
    }
    g.step();
    const ev = g.drainEvents();
    if (log) for (const e of ev) if (e.e === 'wave' || e.e === 'wave_clear' || e.e === 'end' || e.e === 'capture') console.log((g.time).toFixed(1), JSON.stringify(e), 'hq', g.hq.hp.toFixed(0));
    ticks++;
  }
  return { phase: g.phase, wave: g.wave, hq: Math.round(g.hq.hp), time: Math.round(g.time), towers: g.structs.length, credits: g.players.map(p => Math.round(p.credits)) };
}

const good = ['shkval', 'shkval', 'razryadnik', 'shkval', 'nebosvod', 'plant', 'razryadnik', 'nebosvod', 'shkval', 'razryadnik', 'plant', 'razryadnik', 'shkval', 'razryadnik'];
const noAA = ['shkval', 'shkval', 'razryadnik', 'shkval', 'plant', 'razryadnik', 'shkval', 'razryadnik', 'plant', 'razryadnik'];
const mgOnly = ['shkval'];

for (const players of [1, 2]) {
  console.log(`--- игроков: ${players}`);
  console.log('хороший план     ', JSON.stringify(run({ players, order: good, log: process.argv.includes('-v') && players === (process.argv.includes('-2') ? 2 : 1) })));
  console.log('без зениток      ', JSON.stringify(run({ players, order: noAA })));
  console.log('только пулемёты  ', JSON.stringify(run({ players, order: mgOnly })));
  console.log('медленный игрок  ', JSON.stringify(run({ players, order: good, skill: 0.25 })));
}
