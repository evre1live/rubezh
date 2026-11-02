// Симуляция партии «РУБЕЖ». Без графики: одинаково работает на сервере и в браузере.
import {
  TICK, MAP, STRUCTS, STRUCT_KINDS, BUILDABLE, ENEMIES, ENEMY_KINDS, ARMOR, WAVES, RULES,
  PLAYER_COLORS, PATH_LEN, pathPos, laneOffset, pathTiles, decorTiles, waveSummary,
} from './data.js';

const PATH = pathTiles();
const DECOR = decorTiles();

export class Game {
  constructor({ players, seed = 1 }) {
    this.tick = 0;
    this.time = 0;
    this.seed = seed;
    this.nextId = 1;
    this.events = [];
    this.phase = 'countdown';
    this.wave = 0; // сколько волн уже начато
    this.countdown = RULES.firstCountdown;
    this.spawnQueue = [];
    this.waveTime = 0;
    this.enemies = [];
    this.structs = [];
    this.lowPower = false;
    this.n = players.length;
    this.hpScale = RULES.hpScale[this.n] || 1 + 0.6 * (this.n - 1);
    this.players = players.map((p, i) => ({
      id: p.id, name: p.name, color: PLAYER_COLORS[i % PLAYER_COLORS.length], slot: i,
      credits: RULES.startCredits[this.n] || 400,
      build: null, // { kind, progress, ready }
      kills: 0, built: 0, spent: 0,
    }));
    this.occ = new Map(); // клетка -> строение

    const hq = this.addStruct('hq', null, MAP.hq.x, MAP.hq.y, true);
    hq.w = MAP.hq.w; hq.h = MAP.hq.h;
    for (let yy = MAP.hq.y; yy < MAP.hq.y + MAP.hq.h; yy++)
      for (let xx = MAP.hq.x; xx < MAP.hq.x + MAP.hq.w; xx++) this.occ.set(yy * MAP.w + xx, hq);
    this.hq = hq;
    MAP.startPlants.forEach(([x, y], i) => {
      const owner = this.players[i % this.players.length].id;
      this.addStruct('plant', owner, x, y, true);
    });
    this.updatePower(true);
  }

  // ---------- служебное ----------
  emit(e) { this.events.push(e); }
  say(key, to) { this.emit(to ? { e: 'say', key, to } : { e: 'say', key }); }
  player(id) { return this.players.find(p => p.id === id); }
  drainEvents() { const ev = this.events; this.events = []; return ev; }

  addStruct(kind, owner, x, y, instant = false) {
    const def = STRUCTS[kind];
    const s = {
      id: this.nextId++, kind, owner, x, y, w: 1, h: 1,
      hp: def.hp, maxHp: def.hp, cd: 0, kills: 0, rank: 0,
      captured: 0, capturedUntil: 0, lastHit: -99, born: instant ? -99 : this.time,
      drainedBy: 0,
    };
    this.structs.push(s);
    if (kind !== 'hq') this.occ.set(y * MAP.w + x, s);
    return s;
  }

  center(s) { return { x: s.x + s.w / 2, y: s.y + s.h / 2 }; }

  removeStruct(s, reason) {
    this.structs = this.structs.filter(o => o !== s);
    for (const [k, v] of this.occ) if (v === s) this.occ.delete(k);
    for (const e of this.enemies) if (e.captive === s.id) e.captive = 0;
    const c = this.center(s);
    this.emit({ e: reason === 'sold' ? 'sold' : 'destroyed', id: s.id, kind: s.kind, x: c.x, y: c.y });
    this.updatePower();
  }

  updatePower(silent = false) {
    let prod = 0, use = 0;
    for (const s of this.structs) {
      const p = STRUCTS[s.kind].power;
      if (p < 0) { if (!s.drainedBy) prod += -p; }
      else use += p;
    }
    this.power = { prod, use };
    const low = use > prod;
    if (low !== this.lowPower && !silent) this.say(low ? 'low_power' : 'power_ok');
    this.lowPower = low;
  }

  canPlace(x, y) {
    if (x < 0 || y < 0 || x >= MAP.w || y >= MAP.h) return 'Вне карты';
    const k = y * MAP.w + x;
    if (PATH.has(k)) return 'На дороге строить нельзя';
    if (DECOR.has(k)) return 'Место занято';
    if (this.occ.has(k)) return 'Место занято';
    const cx = x + 0.5, cy = y + 0.5;
    const near = this.structs.some(s => {
      if (s.captured) return false;
      const c = this.center(s);
      const r = RULES.buildRadius + (s.kind === 'hq' ? 0.8 : 0);
      return Math.hypot(c.x - cx, c.y - cy) <= r;
    });
    if (!near) return 'Слишком далеко от базы';
    return null;
  }

  // ---------- команды игроков ----------
  command(pid, cmd) {
    const p = this.player(pid);
    if (!p || !cmd) return;
    const over = this.phase === 'won' || this.phase === 'lost';
    switch (cmd.t) {
      case 'build': {
        if (over || !BUILDABLE.includes(cmd.kind)) return;
        if (p.build) { this.say('busy', pid); return; }
        const def = STRUCTS[cmd.kind];
        if (p.credits < def.cost) { this.say('no_money', pid); return; }
        p.credits -= def.cost; p.spent += def.cost;
        p.build = { kind: cmd.kind, progress: 0, ready: false };
        this.say('building', pid);
        return;
      }
      case 'cancel': {
        if (!p.build) return;
        p.credits += STRUCTS[p.build.kind].cost; p.spent -= STRUCTS[p.build.kind].cost;
        p.build = null;
        this.say('cancelled', pid);
        return;
      }
      case 'place': {
        if (over || !p.build || !p.build.ready) return;
        const x = cmd.x | 0, y = cmd.y | 0;
        const err = this.canPlace(x, y);
        if (err) { this.emit({ e: 'deny', to: pid, msg: err }); return; }
        const s = this.addStruct(p.build.kind, pid, x, y);
        p.build = null; p.built++;
        this.emit({ e: 'build', id: s.id, kind: s.kind, owner: pid, x: x + 0.5, y: y + 0.5 });
        this.updatePower();
        return;
      }
      case 'sell': {
        const s = this.structs.find(o => o.id === cmd.id);
        if (!s || s.kind === 'hq' || s.owner !== pid || s.captured) return;
        p.credits += Math.round(STRUCTS[s.kind].cost * RULES.sellRefund);
        this.removeStruct(s, 'sold');
        return;
      }
      case 'wave': {
        if (this.phase !== 'countdown') return;
        const bonus = Math.floor(this.countdown) * RULES.earlyBonus;
        for (const q of this.players) q.credits += bonus;
        this.countdown = 0;
        if (bonus > 0) this.emit({ e: 'bonus', amount: bonus });
        return;
      }
      case 'ping': {
        this.emit({ e: 'ping', x: +cmd.x || 0, y: +cmd.y || 0, pid, color: p.color });
        return;
      }
    }
  }

  // ---------- шаг симуляции ----------
  step() {
    const dt = TICK;
    this.tick++;
    this.time += dt;
    if (this.phase === 'won' || this.phase === 'lost') return;

    // доход и стройка
    for (const p of this.players) {
      p.credits += RULES.income * dt;
      if (p.build && !p.build.ready) {
        const def = STRUCTS[p.build.kind];
        p.build.progress += dt / def.build * (this.lowPower ? 0.5 : 1);
        if (p.build.progress >= 1) {
          p.build.progress = 1; p.build.ready = true;
          this.say('build_done', p.id);
        }
      }
    }

    // волны
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.startWave();
    } else if (this.phase === 'wave') {
      this.waveTime += dt;
      for (const g of this.spawnQueue) {
        while (g.left > 0 && this.waveTime >= g.next) {
          this.spawn(g.kind);
          g.left--; g.next += g.every;
        }
      }
      const pending = this.spawnQueue.some(g => g.left > 0);
      if (!pending && this.enemies.length === 0) this.endWave();
    }

    this.moveEnemies(dt);
    this.fireTowers(dt);
    this.psiCapture();

    // освобождение захваченных башен и лечение
    for (const s of this.structs) {
      if (s.captured && (this.time >= s.capturedUntil || !this.enemies.some(e => e.id === s.captured))) {
        for (const e of this.enemies) if (e.captive === s.id) e.captive = 0;
        s.captured = 0;
        this.emit({ e: 'release', id: s.id });
      }
      if (s.hp < s.maxHp && this.time - s.lastHit > 5) {
        s.hp = Math.min(s.maxHp, s.hp + RULES.regen * (s.rank === 2 ? 2 : 1) * dt);
      }
    }
    this.updatePower();
  }

  startWave() {
    const def = WAVES[this.wave];
    this.wave++;
    this.phase = 'wave';
    this.waveTime = 0;
    this.spawnQueue = def.map(([kind, n, every, delay]) => ({ kind, left: n, every, next: delay }));
    this.emit({ e: 'wave', n: this.wave, total: WAVES.length });
    this.say(def.some(g => g[0] === 'disk') ? 'disks' : def.some(g => g[0] === 'psi') ? 'psi' : 'wave');
  }

  endWave() {
    for (const p of this.players) p.credits += RULES.waveBonus;
    if (this.wave >= WAVES.length) {
      this.phase = 'won';
      this.say('victory');
      this.emit({ e: 'end', won: true });
      return;
    }
    this.phase = 'countdown';
    this.countdown = RULES.countdown;
    this.emit({ e: 'wave_clear', n: this.wave, bonus: RULES.waveBonus });
    this.say('wave_clear');
  }

  spawn(kind) {
    const def = ENEMIES[kind];
    const hp = Math.round(def.hp * this.hpScale * (1 + 0.04 * (this.wave - 1)));
    const e = {
      id: this.nextId++, kind, hp, maxHp: hp, d: 0, x: MAP.spawn[0], y: MAP.spawn[1],
      speed: def.speed, air: !!def.air, scale: 1, captureCd: 4, captive: 0, target: 0, latched: 0,
      off: 0,
    };
    e.off = laneOffset(e.id);
    if (!e.air) { const p = pathPos(0, e.off); e.x = p.x; e.y = p.y; }
    this.enemies.push(e);
  }

  moveEnemies(dt) {
    const leaked = [];
    for (const e of this.enemies) {
      if (!e.air) {
        e.d += e.speed * dt;
        const p = pathPos(e.d, e.off);
        e.x = p.x; e.y = p.y;
        if (e.d >= PATH_LEN) leaked.push(e);
        continue;
      }
      // диск: летит к ближайшей станции, присасывается и тянет энергию
      let tgt = this.structs.find(s => s.id === e.target);
      if (!tgt || tgt.kind !== 'plant') {
        if (e.latched) { const old = this.structs.find(s => s.id === e.latched); if (old) old.drainedBy = 0; }
        e.latched = 0;
        let best = null, bd = Infinity;
        for (const s of this.structs) {
          if (s.kind !== 'plant') continue;
          if (s.drainedBy && s.drainedBy !== e.id) continue;
          const c = this.center(s);
          const d = Math.hypot(c.x - e.x, c.y - e.y);
          if (d < bd) { bd = d; best = s; }
        }
        tgt = best || this.hq;
        e.target = tgt.id;
      }
      const c = this.center(tgt);
      const dx = c.x - e.x, dy = c.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.15) {
        const st = Math.min(dist, e.speed * dt);
        e.x += dx / dist * st; e.y += dy / dist * st;
        if (e.latched) { tgt.drainedBy = 0; e.latched = 0; }
      } else if (tgt.kind === 'plant') {
        if (!e.latched) { e.latched = tgt.id; tgt.drainedBy = e.id; this.emit({ e: 'drain', id: e.id, tgt: tgt.id }); this.say('plant_attack'); }
        this.damageStruct(tgt, RULES.plantDrain * dt);
      } else {
        leaked.push(e);
      }
    }
    for (const e of leaked) {
      this.enemies = this.enemies.filter(o => o !== e);
      const dmg = ENEMIES[e.kind].leak;
      this.emit({ e: 'leak', id: e.id, kind: e.kind, dmg });
      this.damageStruct(this.hq, dmg);
      if (this.time - (this.lastBaseAlert || -99) > 8) { this.lastBaseAlert = this.time; this.say('base_attack'); }
    }
  }

  damageStruct(s, dmg) {
    if (!this.structs.includes(s)) return;
    s.hp -= dmg;
    s.lastHit = this.time;
    if (s.hp <= 0) {
      if (s.kind === 'hq') {
        s.hp = 0;
        this.phase = 'lost';
        this.say('defeat');
        this.emit({ e: 'end', won: false });
        return;
      }
      if (s.drainedBy) {
        const d = this.enemies.find(e => e.id === s.drainedBy);
        if (d) { d.latched = 0; d.target = 0; }
      }
      this.removeStruct(s, 'destroyed');
      this.say('struct_lost');
    }
  }

  damageEnemy(e, dmg, tower) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    if (e.hp > 0) return;
    this.enemies = this.enemies.filter(o => o !== e);
    if (e.latched) { const pl = this.structs.find(s => s.id === e.latched); if (pl) pl.drainedBy = 0; }
    const def = ENEMIES[e.kind];
    const share = def.reward * (1 + 0.35 * (this.n - 1)) / this.n;
    for (const p of this.players) p.credits += share;
    const owner = tower && this.player(tower.owner);
    if (owner) owner.kills++;
    this.emit({ e: 'kill', id: e.id, kind: e.kind, x: e.x, y: e.y, air: e.air, reward: def.reward });
    if (tower) {
      tower.kills++;
      const r = tower.kills >= RULES.vet[1] ? 2 : tower.kills >= RULES.vet[0] ? 1 : 0;
      if (r > tower.rank) {
        tower.rank = r;
        this.emit({ e: 'rank', id: tower.id, rank: r });
        if (tower.owner) this.say(r === 2 ? 'elite' : 'promoted', tower.owner);
      }
    }
    // громила подкрепляется павшими клонами рядом
    if (e.kind === 'clone') {
      for (const b of this.enemies) {
        if (b.kind !== 'brute' || b.scale >= 1.6) continue;
        if (Math.hypot(b.x - e.x, b.y - e.y) < 2.5) {
          b.scale = Math.min(1.6, b.scale + 0.08);
          b.maxHp += 30 * this.hpScale; b.hp += 60 * this.hpScale;
          this.emit({ e: 'grow', id: b.id });
          break;
        }
      }
    }
  }

  fireTowers(dt) {
    for (const s of this.structs) {
      const def = STRUCTS[s.kind];
      if (!def.weapon) continue;
      if (this.time - s.born < 1) continue; // ещё строится
      s.cd -= dt;
      if (s.cd > 0) continue;
      if (def.weapon === 'tesla' && this.lowPower && !s.captured) continue;
      const c = this.center(s);
      const mul = RULES.vetMul[s.rank];

      if (s.captured) {
        // захваченная башня бьёт по своим
        if (!def.hitsGround) continue;
        let best = null, bd = Infinity;
        for (const o of this.structs) {
          if (o === s || o.captured) continue;
          const oc = this.center(o);
          const d = Math.hypot(oc.x - c.x, oc.y - c.y);
          if (d <= def.range && d < bd) { bd = d; best = o; }
        }
        if (!best) continue;
        s.cd = def.cd;
        this.emit({ e: 'shot', id: s.id, k: def.weapon, sid: best.id });
        this.damageStruct(best, def.dmg * mul * (def.weapon === 'mg' ? 0.6 : 0.5));
        continue;
      }

      // выбор цели: наземных — кто дальше прошёл, воздушных — ближайший
      let best = null, bestScore = -Infinity;
      for (const e of this.enemies) {
        if (e.air ? !def.hitsAir : !def.hitsGround) continue;
        const d = Math.hypot(e.x - c.x, e.y - c.y);
        if (d > def.range) continue;
        const score = e.air ? -d : e.d;
        if (score > bestScore) { bestScore = score; best = e; }
      }
      if (!best) continue;
      s.cd = def.cd * (this.lowPower ? 2 : 1) * (s.rank === 2 ? 0.85 : 1);
      const dmg = def.dmg * mul;
      const armor = ARMOR[def.weapon];

      if (def.weapon === 'tesla') {
        const chain = [best.id];
        const hit = [best];
        let last = best;
        for (let i = 0; i < def.chain; i++) {
          let nx = null, nd = Infinity;
          for (const e of this.enemies) {
            if (e.air || hit.includes(e)) continue;
            const d = Math.hypot(e.x - last.x, e.y - last.y);
            if (d <= def.chainRange && d < nd) { nd = d; nx = e; }
          }
          if (!nx) break;
          hit.push(nx); chain.push(nx.id); last = nx;
        }
        this.emit({ e: 'shot', id: s.id, k: 'tesla', chain });
        hit.forEach((e, i) => this.damageEnemy(e, dmg * (i === 0 ? 1 : def.chainMul) * armor[ENEMIES[e.kind].armor], s));
      } else if (def.weapon === 'flak') {
        this.emit({ e: 'shot', id: s.id, k: 'flak', tid: best.id, x: best.x, y: best.y });
        const bx = best.x, by = best.y;
        for (const e of [...this.enemies]) {
          if (!e.air) continue;
          const d = Math.hypot(e.x - bx, e.y - by);
          if (d <= def.splash) this.damageEnemy(e, dmg * (e === best ? 1 : 0.5), s);
        }
      } else {
        this.emit({ e: 'shot', id: s.id, k: 'mg', tid: best.id });
        this.damageEnemy(best, dmg * armor[ENEMIES[best.kind].armor], s);
      }
    }
  }

  psiCapture() {
    for (const e of this.enemies) {
      if (e.kind !== 'psi') continue;
      const def = ENEMIES.psi;
      e.captureCd -= TICK;
      if (e.captive || e.captureCd > 0) continue;
      let best = null, bc = -1;
      for (const s of this.structs) {
        const sd = STRUCTS[s.kind];
        if (!sd.weapon || s.captured) continue;
        const c = this.center(s);
        if (Math.hypot(c.x - e.x, c.y - e.y) > def.captureRange) continue;
        if (sd.cost > bc) { bc = sd.cost; best = s; }
      }
      if (!best) continue;
      best.captured = e.id;
      best.capturedUntil = this.time + def.captureTime;
      e.captive = best.id;
      e.captureCd = def.captureCd;
      this.emit({ e: 'capture', id: best.id, by: e.id });
      if (best.owner) this.say('captured');
    }
  }

  // ---------- снимок для клиентов ----------
  snapshot() {
    const r2 = v => Math.round(v * 100) / 100;
    return {
      t: this.tick,
      ph: this.phase,
      wv: this.wave,
      nw: WAVES.length,
      cd: this.phase === 'countdown' ? Math.max(0, Math.ceil(this.countdown)) : 0,
      next: this.phase === 'countdown' ? waveSummary(this.wave) : [],
      pw: [this.power.prod, this.power.use],
      hq: r2(this.hq.hp / this.hq.maxHp),
      pl: this.players.map(p => [
        p.id, p.name, p.color, Math.floor(p.credits),
        p.build ? p.build.kind : null, p.build ? r2(p.build.progress) : 0, p.build ? p.build.ready : false,
        p.kills, p.built,
      ]),
      // наземные враги: дистанция по пути; воздушные: координаты
      en: this.enemies.map(e => [
        e.id, ENEMY_KINDS.indexOf(e.kind), e.air ? r2(e.x) : r2(e.d), e.air ? r2(e.y) : 0,
        r2(Math.max(0, e.hp) / e.maxHp), (e.air ? 1 : 0) | (e.latched ? 2 : 0) | (e.captive ? 4 : 0), r2(e.scale), e.captive || 0,
      ]),
      st: this.structs.map(s => [
        s.id, STRUCT_KINDS.indexOf(s.kind), s.owner, s.x, s.y, r2(Math.max(0, s.hp) / s.maxHp),
        s.rank, s.captured || 0, s.drainedBy ? 1 : 0, r2(Math.min(1, (this.time - s.born))),
      ]),
    };
  }
}

export { MAP, STRUCTS, ENEMIES, WAVES, BUILDABLE, STRUCT_KINDS, ENEMY_KINDS, RULES, TICK, PATH_LEN, pathPos, laneOffset };
