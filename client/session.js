// Сессии: одиночная (партия считается в браузере) и сетевая (партию считает сервер).
// У обеих одинаковый интерфейс, поэтому остальной код не знает, где идёт игра.
import { Game, TICK } from '../sim/game.js';

export class LocalSession {
  constructor(name, speed = 1) {
    this.mp = false;
    this.you = 'me';
    this.interval = TICK * 1000;
    this.speed = speed;
    this.name = name;
    this.paused = false;
  }
  start(onSnap) {
    this.onSnap = onSnap;
    this.game = new Game({ players: [{ id: 'me', name: this.name }], seed: Date.now() & 0xffff });
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.paused) return;
      for (let i = 0; i < this.speed; i++) this.game.step();
      this.onSnap(this.game.snapshot(), this.game.drainEvents());
    }, this.interval);
    this.onSnap(this.game.snapshot(), this.game.drainEvents());
  }
  send(cmd) { if (this.game) this.game.command(this.you, cmd); }
  restart() { this.start(this.onSnap); }
  setPaused(p) { this.paused = p; }
  stop() { clearInterval(this.timer); this.game = null; }
}

export class RemoteSession {
  constructor() {
    this.mp = true;
    this.interval = TICK * 2000;
    this.handlers = {};
    this.queue = [];
    this.you = null;
    this.token = null;
    try { this.token = localStorage.getItem('rubezh-token'); } catch {}
  }
  on(type, fn) { this.handlers[type] = fn; return this; }
  emit(type, msg) { const h = this.handlers[type]; if (h) h(msg); }
  connect(name) {
    this.name = name;
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;
      try { ws = new WebSocket(`${proto}//${location.host}/ws`); } catch (e) { reject(e); return; }
      this.ws = ws;
      let opened = false;
      ws.onopen = () => { opened = true; this.raw({ type: 'hello', name, token: this.token }); };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'welcome') {
          this.you = m.pid; this.token = m.token;
          try { localStorage.setItem('rubezh-token', m.token); } catch {}
          resolve(this);
          for (const q of this.queue) this.raw(q);
          this.queue = [];
        } else if (m.type === 'snap') {
          if (this.onSnap) this.onSnap(m.s, m.ev);
        } else this.emit(m.type, m);
      };
      ws.onclose = () => {
        if (!opened) { reject(new Error('Сервер недоступен')); return; }
        this.emit('disconnect', {});
        // переподключение
        if (!this.closing) setTimeout(() => this.connect(this.name).catch(() => this.emit('disconnect', {})), 1500);
      };
      ws.onerror = () => {};
    });
  }
  raw(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }
  start(onSnap) { this.onSnap = onSnap; }
  send(cmd) { this.raw({ type: 'cmd', cmd }); }
  restart() { this.raw({ type: 'restart' }); }
  setPaused() {}
  stop() { this.onSnap = null; }
  close() { this.closing = true; try { this.ws.close(); } catch {} }
}
