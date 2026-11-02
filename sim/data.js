// Общие данные игры «РУБЕЖ»: карта, башни, враги, волны.
// Этот файл используют и сервер, и браузер.

export const TICK = 0.05; // секунды на тик симуляции (20 тиков в секунду)

export const MAP = {
  id: 'tashkent',
  name: 'Ташкент, 1987',
  w: 22,
  h: 14,
  // путь врагов: от пси-маяка слева до штаба справа (координаты в клетках, центр клетки = +0.5)
  path: [
    [-1.5, 3.5], [5.5, 3.5], [5.5, 10.5], [11.5, 10.5], [11.5, 4.5],
    [16.5, 4.5], [16.5, 9.5], [19.9, 9.5],
  ],
  spawn: [-1.5, 3.5],
  hq: { x: 20, y: 9, w: 2, h: 2 },
  // стартовые электростанции: в одиночной игре обе у игрока, в кооперативе по одной
  startPlants: [[8, 7], [14, 7]],
  // постройки города и деревья: занимают клетки, строить на них нельзя
  decor: [
    { kind: 'tvtower', x: 8, y: 1 },
    { kind: 'house', x: 1, y: 6, w: 2, h: 2, floors: 5, tone: 0 },
    { kind: 'house', x: 1, y: 11, w: 2, h: 2, floors: 3, tone: 1 },
    { kind: 'house', x: 13, y: 12, w: 3, h: 1, floors: 4, tone: 2 },
    { kind: 'house', x: 18, y: 1, w: 2, h: 2, floors: 6, tone: 0 },
    { kind: 'house', x: 3, y: 0, w: 2, h: 1, floors: 3, tone: 2 },
    { kind: 'house', x: 20, y: 5, w: 2, h: 2, floors: 4, tone: 1 },
    { kind: 'tree', x: 0, y: 0 }, { kind: 'tree', x: 2, y: 1 }, { kind: 'tree', x: 7, y: 5 },
    { kind: 'tree', x: 9, y: 12 }, { kind: 'tree', x: 10, y: 13 }, { kind: 'tree', x: 3, y: 13 },
    { kind: 'tree', x: 13, y: 1 }, { kind: 'tree', x: 15, y: 0 }, { kind: 'tree', x: 21, y: 13 },
    { kind: 'tree', x: 18, y: 12 }, { kind: 'tree', x: 0, y: 9 }, { kind: 'tree', x: 21, y: 0 },
    { kind: 'tree', x: 12, y: 0 }, { kind: 'tree', x: 7, y: 13 },
  ],
};

// Строения игрока. power > 0 — потребление, < 0 — выработка.
export const STRUCTS = {
  shkval: {
    name: 'Шквал', role: 'Пулемётное гнездо', desc: 'Дёшево и быстро. Косит пехоту, против брони слаб.',
    cost: 300, build: 4, power: 10, hp: 300, range: 3.6, dmg: 9, cd: 0.22, weapon: 'mg', hitsGround: true, hitsAir: false,
  },
  razryadnik: {
    name: 'Разрядник', role: 'Тесла-башня', desc: 'Молния бьёт цепью по трём целям. Ест много энергии, без неё гаснет.',
    cost: 700, build: 8, power: 75, hp: 500, range: 3.2, dmg: 95, cd: 1.8, weapon: 'tesla', chain: 2, chainRange: 1.9, chainMul: 0.6, hitsGround: true, hitsAir: false,
  },
  nebosvod: {
    name: 'Небосвод', role: 'Зенитная батарея', desc: 'Сбивает летающие диски. По земле не стреляет.',
    cost: 500, build: 6, power: 25, hp: 400, range: 5.5, dmg: 34, cd: 0.7, weapon: 'flak', splash: 1.1, hitsGround: false, hitsAir: true,
  },
  plant: {
    name: 'Электростанция', short: 'Станция', role: 'Энергия', desc: '+100 энергии. Диски врага охотятся за станциями.',
    cost: 400, build: 6, power: -100, hp: 600,
  },
  hq: { name: 'Штаб', role: 'Сердце обороны', power: -50, hp: 1000 },
};
export const STRUCT_KINDS = ['hq', 'plant', 'shkval', 'razryadnik', 'nebosvod'];
export const BUILDABLE = ['shkval', 'razryadnik', 'nebosvod', 'plant'];

// Армия Ордена Третьего Глаза
export const ENEMIES = {
  clone: { name: 'Клон', hp: 70, speed: 1.25, reward: 12, armor: 'inf', leak: 40 },
  brute: { name: 'Громила', hp: 650, speed: 0.7, reward: 70, armor: 'heavy', leak: 150 },
  disk: { name: 'Диск', hp: 260, speed: 1.5, reward: 50, armor: 'air', leak: 100, air: true },
  psi: { name: 'Пси-ведущий', hp: 380, speed: 0.85, reward: 90, armor: 'inf', leak: 120, captureRange: 3.2, captureCd: 8, captureTime: 10 },
};
export const ENEMY_KINDS = ['clone', 'brute', 'disk', 'psi'];

// множители урона по типу брони
export const ARMOR = {
  mg: { inf: 1, heavy: 0.35, air: 0 },
  tesla: { inf: 1, heavy: 1, air: 0 },
  flak: { inf: 0, heavy: 0, air: 1 },
};

// Волны: [тип, количество, интервал (с), задержка от начала волны (с)]
export const WAVES = [
  [['clone', 10, 1.0, 0]],
  [['clone', 14, 0.8, 0], ['brute', 1, 0, 11]],
  [['clone', 10, 0.9, 0], ['disk', 3, 3, 4]],
  [['clone', 18, 0.6, 0], ['brute', 3, 4, 3]],
  [['clone', 14, 0.7, 0], ['disk', 2, 4, 2], ['psi', 2, 6, 5]],
  [['clone', 22, 0.5, 0], ['brute', 3, 4, 2], ['disk', 4, 3, 5], ['psi', 2, 8, 6]],
];

export const RULES = {
  firstCountdown: 30,
  countdown: 18,
  startCredits: { 1: 1000, 2: 750, 3: 600, 4: 500 },
  income: 3,            // кредитов в секунду каждому («рудник»)
  waveBonus: 150,       // каждому за пройденную волну
  earlyBonus: 5,        // за каждую секунду, если вызвать волну раньше
  buildRadius: 4.6,     // строить можно рядом со своими строениями
  hpScale: { 1: 1, 2: 1.35, 3: 1.75, 4: 2.1 },
  sellRefund: 0.5,
  vet: [6, 18],         // убийств до 1-й и 2-й лычки
  vetMul: [1, 1.25, 1.5],
  regen: 3,             // лечение строений в секунду, если их не трогают 5 с
  plantDrain: 7,        // урон диска по станции в секунду
};

export const PLAYER_COLORS = ['#d8342c', '#2f6fd6', '#e0a526', '#2fa36b'];

// ---------- геометрия пути (общая для сервера и клиента) ----------

const segs = [];
let total = 0;
for (let i = 0; i < MAP.path.length - 1; i++) {
  const [ax, ay] = MAP.path[i];
  const [bx, by] = MAP.path[i + 1];
  const len = Math.hypot(bx - ax, by - ay);
  segs.push({ ax, ay, bx, by, len, start: total, dx: (bx - ax) / len, dy: (by - ay) / len });
  total += len;
}
export const PATH_LEN = total;

// боковое смещение врага внутри дороги — по номеру, чтобы сервер и браузер считали одинаково
export function laneOffset(id) {
  const h = Math.sin(id * 12.9898) * 43758.5453;
  return ((h - Math.floor(h)) - 0.5) * 0.5;
}

export function pathPos(d, off = 0) {
  if (d <= 0) {
    const s = segs[0];
    return { x: s.ax + s.dx * d - s.dy * off, y: s.ay + s.dy * d + s.dx * off, dx: s.dx, dy: s.dy };
  }
  for (const s of segs) {
    if (d <= s.start + s.len) {
      const t = d - s.start;
      return { x: s.ax + s.dx * t - s.dy * off, y: s.ay + s.dy * t + s.dx * off, dx: s.dx, dy: s.dy };
    }
  }
  const s = segs[segs.length - 1];
  return { x: s.bx - s.dy * off, y: s.by + s.dx * off, dx: s.dx, dy: s.dy };
}

// клетки дороги
export function pathTiles() {
  const set = new Set();
  for (const s of segs) {
    const steps = Math.ceil(s.len * 4);
    for (let i = 0; i <= steps; i++) {
      const x = Math.floor(s.ax + (s.bx - s.ax) * (i / steps));
      const y = Math.floor(s.ay + (s.by - s.ay) * (i / steps));
      if (x >= 0 && y >= 0 && x < MAP.w && y < MAP.h) set.add(y * MAP.w + x);
    }
  }
  return set;
}

export function decorTiles() {
  const set = new Set();
  for (const d of MAP.decor) {
    const w = d.w || 1, h = d.h || 1;
    for (let yy = d.y; yy < d.y + h; yy++) for (let xx = d.x; xx < d.x + w; xx++) set.add(yy * MAP.w + xx);
  }
  return set;
}

export function waveSummary(i) {
  const w = WAVES[i];
  if (!w) return [];
  const sum = {};
  for (const [k, n] of w) sum[k] = (sum[k] || 0) + n;
  return Object.entries(sum);
}
