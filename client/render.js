// Изометрическая сцена: местность, город, строения, враги, эффекты, полосы здоровья.
import * as THREE from 'three';
import { MAP, STRUCTS, ENEMIES, STRUCT_KINDS, ENEMY_KINDS, RULES, pathPos, laneOffset } from '../sim/data.js';
import * as M from './models.js';

const E = 5;          // поля вокруг карты (клетки)
const S = 48;         // пикселей текстуры на клетку
const DISK_Y = 1.35;
const ENEMY_SCALE = { clone: 2.0, brute: 1.65, disk: 1.6, psi: 1.9 };

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- частицы ----------
class Particles {
  constructor(max, additive) {
    this.max = max; this.list = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.alpha = new Float32Array(max); this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 40 }, uSoft: { value: additive ? 1.6 : 1.0 } },
      vertexShader: `attribute vec3 aColor; attribute float aAlpha; attribute float aSize; uniform float uScale;
        varying vec3 vC; varying float vA;
        void main(){ vC=aColor; vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=max(1.0,aSize*uScale); }`,
      fragmentShader: `varying vec3 vC; varying float vA; uniform float uSoft;
        void main(){ vec2 c=gl_PointCoord-0.5; float d=length(c)*2.0; if(d>1.0) discard; float a=pow(1.0-d,uSoft); gl_FragColor=vec4(vC, a*vA); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    this.geo = g;
  }
  add(p) {
    if (this.list.length >= this.max) this.list.shift();
    p.t = 0; p.vx ??= 0; p.vy ??= 0; p.vz ??= 0; p.grav ??= 0; p.drag ??= 0; p.size1 ??= p.size; p.alpha ??= 1;
    this.list.push(p);
  }
  update(dt) {
    let n = 0;
    const keep = [];
    for (const p of this.list) {
      p.t += dt;
      if (p.t >= p.life) continue;
      keep.push(p);
      p.vy -= p.grav * dt;
      const k = 1 - p.drag * dt;
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.grav > 0) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      const u = p.t / p.life;
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.col[n * 3] = p.c[0]; this.col[n * 3 + 1] = p.c[1]; this.col[n * 3 + 2] = p.c[2];
      this.alpha[n] = p.alpha * (p.fadeIn ? Math.min(1, u * 6) : 1) * (1 - u * u);
      this.size[n] = lerp(p.size, p.size1, u);
      n++;
    }
    this.list = keep;
    for (const k of ['position', 'aColor', 'aAlpha', 'aSize']) this.geo.attributes[k].needsUpdate = true;
    this.geo.setDrawRange(0, n);
  }
}

const col = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const COL = {
  fire: col('#ffb44a'), fire2: col('#ff6a2a'), spark: col('#ffe9a8'), smoke: col('#3c3a38'), smokeL: col('#8d8a84'), steam: col('#d9d6cf'),
  tesla: col('#8fd6ff'), teslaW: col('#e8f8ff'), psi: col('#b46cff'), psiG: col('#8cff5a'), dust: col('#a99b7a'), blood: col('#6f8f3c'),
};

export class Renderer {
  constructor(canvas, overlay) {
    this.canvas = canvas; this.overlay = overlay; this.octx = overlay.getContext('2d');
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 1.22;
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090b);

    this.cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 300);
    this.camDir = new THREE.Vector3(1, 1.18, 1).normalize();
    this.target = new THREE.Vector3(MAP.w / 2, 0, MAP.h / 2);
    this.zoom = 1;
    this.baseHalf = 10;

    this.addLights();
    this.terrainCanvas = this.paintTerrain();
    this.addTerrain();
    this.addCity();

    this.fxAdd = new Particles(2600, true); this.fxSmoke = new Particles(1400, false);
    this.scene.add(this.fxAdd.points, this.fxSmoke.points);

    this.structs = new Map(); this.enemies = new Map();
    this.lines = []; this.rings = []; this.texts = []; this.decals = []; this.pings = []; this.dying = [];
    this.selected = null; this.hover = null;
    this.owners = new Map();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.ray = new THREE.Raycaster();
    this.time = 0;
    this.lowPower = false;

    // кольца выбора и радиуса
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 40), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, depthWrite: false }));
    this.selRing.rotation.x = -Math.PI / 2; this.selRing.position.y = 0.03; this.selRing.visible = false; this.scene.add(this.selRing);
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 72), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.rangeRing.rotation.x = -Math.PI / 2; this.rangeRing.position.y = 0.035; this.rangeRing.visible = false; this.scene.add(this.rangeRing);
    this.rangeFill = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false }));
    this.rangeFill.rotation.x = -Math.PI / 2; this.rangeFill.position.y = 0.03; this.rangeFill.visible = false; this.scene.add(this.rangeFill);
    this.tileMark = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), new THREE.MeshBasicMaterial({ color: 0x5cff6a, transparent: true, opacity: 0.35, depthWrite: false }));
    this.tileMark.rotation.x = -Math.PI / 2; this.tileMark.position.y = 0.04; this.tileMark.visible = false; this.scene.add(this.tileMark);
    this.ghost = null; this.ghostKind = null;

    this.resize();
  }

  // ---------- сцена ----------
  addLights() {
    this.scene.add(new THREE.HemisphereLight(0xe2ecff, 0x6a7448, 1.25));
    const sun = new THREE.DirectionalLight(0xfff0d6, 3.1);
    sun.position.set(MAP.w / 2 - 9, 18, MAP.h / 2 - 3);
    sun.target.position.set(MAP.w / 2, 0, MAP.h / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -20; sc.right = 20; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 60;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    this.flash = new THREE.PointLight(0x9fdcff, 0, 4, 2);
    this.scene.add(this.flash);
  }

  paintTerrain() {
    const W = (MAP.w + E * 2) * S, H = (MAP.h + E * 2) * S;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const R = rng(7);
    const px = v => (v + E) * S;
    // трава
    x.fillStyle = '#6b9543'; x.fillRect(0, 0, W, H);
    const greens = ['#7aa34c', '#5c8738', '#86ad55', '#64903d', '#97a656', '#557f33'];
    for (let i = 0; i < 4200; i++) {
      x.globalAlpha = 0.06 + R() * 0.12;
      x.fillStyle = greens[(R() * greens.length) | 0];
      x.beginPath(); x.arc(R() * W, R() * H, 3 + R() * 16, 0, Math.PI * 2); x.fill();
    }
    for (let i = 0; i < 120; i++) {
      x.globalAlpha = 0.12 + R() * 0.15; x.fillStyle = R() < 0.5 ? '#8d7c55' : '#7a6c4a';
      x.beginPath(); x.ellipse(R() * W, R() * H, 10 + R() * 40, 6 + R() * 24, R() * 3, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 1;
    // площадь штаба и телебашни
    const plaza = (x0, y0, w, h) => {
      x.fillStyle = '#a19c8f'; x.fillRect(px(x0), px(y0), w * S, h * S);
      x.strokeStyle = '#7d796f'; x.lineWidth = 2;
      for (let i = 0; i <= w * 2; i++) { x.beginPath(); x.moveTo(px(x0) + i * S / 2, px(y0)); x.lineTo(px(x0) + i * S / 2, px(y0 + h)); x.stroke(); }
      for (let i = 0; i <= h * 2; i++) { x.beginPath(); x.moveTo(px(x0), px(y0) + i * S / 2); x.lineTo(px(x0 + w), px(y0) + i * S / 2); x.stroke(); }
    };
    plaza(MAP.hq.x - 0.3, MAP.hq.y - 0.3, MAP.hq.w + 0.6, MAP.hq.h + 0.6);
    x.save(); x.strokeStyle = '#e0b83a'; x.lineWidth = 5; x.setLineDash([14, 10]);
    x.strokeRect(px(MAP.hq.x - 0.25), px(MAP.hq.y - 0.25), (MAP.hq.w + 0.5) * S, (MAP.hq.h + 0.5) * S); x.restore();
    const tv = MAP.decor.find(d => d.kind === 'tvtower');
    if (tv) { x.fillStyle = '#aaa596'; x.beginPath(); x.arc(px(tv.x + 0.5), px(tv.y + 0.5), S * 0.75, 0, Math.PI * 2); x.fill(); }
    for (const d of MAP.decor) if (d.kind === 'house') { x.fillStyle = 'rgba(70,66,58,0.55)'; x.fillRect(px(d.x) - 4, px(d.y) - 4, d.w * S + 8, d.h * S + 8); }
    // дорога: тротуар, асфальт, разметка
    const pts = [[-E, MAP.path[0][1]], ...MAP.path];
    const road = (w, color) => {
      x.strokeStyle = color; x.lineWidth = w * S; x.lineJoin = 'miter'; x.lineCap = 'butt';
      x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(px(a), px(b)) : x.moveTo(px(a), px(b))); x.stroke();
    };
    road(1.42, '#6f6b62'); road(1.34, '#b3ad9e'); road(1.02, '#3f4144'); road(0.96, '#47494c');
    for (let i = 0; i < 2600; i++) {
      const d = R() * (MAP.path.length + 8);
      const seg = Math.min(pts.length - 2, Math.floor(R() * (pts.length - 1)));
      const [ax, ay] = pts[seg], [bx, by] = pts[seg + 1];
      const t = R();
      const off = (R() - 0.5) * 0.9;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / len, ny = (bx - ax) / len;
      x.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
      x.fillRect(px(ax + (bx - ax) * t + nx * off), px(ay + (by - ay) * t + ny * off), 2 + d % 3, 2);
    }
    x.save(); x.strokeStyle = '#d9c35a'; x.lineWidth = 3; x.setLineDash([16, 16]);
    x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(px(a), px(b)) : x.moveTo(px(a), px(b))); x.stroke(); x.restore();
    // пси-заражение у маяка
    const [sx, sy] = MAP.spawn;
    const g = x.createRadialGradient(px(sx - 0.9), px(sy), 0, px(sx - 0.9), px(sy), S * 4.2);
    g.addColorStop(0, 'rgba(120,40,190,0.75)'); g.addColorStop(0.5, 'rgba(90,30,140,0.35)'); g.addColorStop(1, 'rgba(60,20,90,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(190,120,255,0.55)'; x.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      let cx = px(sx - 0.9), cy = px(sy), a = R() * Math.PI * 2;
      x.beginPath(); x.moveTo(cx, cy);
      for (let k = 0; k < 6; k++) { a += (R() - 0.5) * 1.2; cx += Math.cos(a) * S * 0.45; cy += Math.sin(a) * S * 0.45; x.lineTo(cx, cy); }
      x.stroke();
    }
    // мелкая зернистость
    const img = x.getImageData(0, 0, W, H); const dd = img.data;
    for (let i = 0; i < dd.length; i += 4) { const n = (R() - 0.5) * 14; dd[i] += n; dd[i + 1] += n; dd[i + 2] += n; }
    x.putImageData(img, 0, 0);
    // затемнение за пределами поля
    x.fillStyle = 'rgba(6,10,8,0.30)';
    x.beginPath(); x.rect(0, 0, W, H); x.rect(px(0), px(0), MAP.w * S, MAP.h * S); x.fill('evenodd');
    const fade = (x0, y0, x1, y1) => { const gr = x.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(7,9,11,1)'); gr.addColorStop(1, 'rgba(7,9,11,0)'); return gr; };
    x.fillStyle = fade(0, 0, 0, E * S * 0.9); x.fillRect(0, 0, W, E * S);
    x.fillStyle = fade(0, H, 0, H - E * S * 0.9); x.fillRect(0, H - E * S, W, E * S);
    x.fillStyle = fade(W, 0, W - E * S * 0.9, 0); x.fillRect(W - E * S, 0, E * S, H);
    x.fillStyle = fade(0, 0, E * S * 0.6, 0); x.fillRect(0, 0, E * S, H);
    x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 2; x.strokeRect(px(0), px(0), MAP.w * S, MAP.h * S);
    return c;
  }

  addTerrain() {
    const tex = new THREE.CanvasTexture(this.terrainCanvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.r.capabilities.getMaxAnisotropy();
    const geo = new THREE.PlaneGeometry(MAP.w + E * 2, MAP.h + E * 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    m.rotation.x = -Math.PI / 2; m.position.set(MAP.w / 2, 0, MAP.h / 2); m.receiveShadow = true;
    this.scene.add(m);
    // сетка для стройки
    this.gridCanvas = document.createElement('canvas'); this.gridCanvas.width = MAP.w * 32; this.gridCanvas.height = MAP.h * 32;
    this.gridTex = new THREE.CanvasTexture(this.gridCanvas);
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(MAP.w, MAP.h), new THREE.MeshBasicMaterial({ map: this.gridTex, transparent: true, depthWrite: false }));
    gm.rotation.x = -Math.PI / 2; gm.position.set(MAP.w / 2, 0.02, MAP.h / 2); gm.visible = false; gm.renderOrder = 1;
    this.grid = gm; this.scene.add(gm);
  }

  addCity() {
    this.decor = [];
    let seed = 11;
    const add = (o, x, z) => { o.position.set(x, 0, z); this.scene.add(o); return o; };
    for (const d of MAP.decor) {
      if (d.kind === 'house') add(M.makeHouse(d.w, d.h, d.floors, d.tone, seed += 13), d.x + d.w / 2, d.y + d.h / 2);
      else if (d.kind === 'tree') { const t = add(M.makeTree(seed += 5), d.x + 0.5, d.y + 0.5); t.rotation.y = seed; t.scale.setScalar(0.9 + (seed % 5) * 0.06); }
      else if (d.kind === 'tvtower') this.tv = add(M.makeTvTower(), d.x + 0.5, d.y + 0.5);
    }
    // деревья и дома за краем поля — город продолжается
    const R = rng(3);
    for (let i = 0; i < 70; i++) {
      const side = i % 4;
      let x, z;
      if (side === 0) { x = -E + R() * (MAP.w + E * 2); z = -0.6 - R() * 3; }
      else if (side === 1) { x = -E + R() * (MAP.w + E * 2); z = MAP.h + 0.6 + R() * 3; }
      else if (side === 2) { x = MAP.w + 0.6 + R() * 3; z = R() * MAP.h; }
      else { x = -0.6 - R() * 3; z = R() * MAP.h; if (Math.abs(z - MAP.path[0][1]) < 1.3) continue; }
      if (R() < 0.75) { const t = add(M.makeTree(i), x, z); t.scale.setScalar(0.8 + R() * 0.5); }
      else add(M.makeHouse(1 + (R() < 0.5), 1, 2 + (R() * 5 | 0), i % 3, i * 31), x, z);
    }
    // фонари и машины у дороги
    for (let i = 1; i < MAP.path.length - 1; i++) {
      const [x, y] = MAP.path[i];
      const l = add(M.makeLamp(), x + 0.62, y - 0.62); l.rotation.y = Math.PI * 0.75;
    }
    const cars = [[2.5, 2.25, 0, 0xb83a2a], [9, 11.75, 0, 0xd6c79a], [12.75, 7.5, Math.PI / 2, 0x3d6a8f], [18.2, 10.75, 0, 0x6c7f4a]];
    for (const [x, z, r, c] of cars) { const car = add(M.makeCar(c), x, z); car.rotation.y = r; }
    this.beacon = add(M.makeBeacon(), MAP.spawn[0] - 0.9, MAP.spawn[1]);
  }

  // ---------- камера ----------
  resize() {
    const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600;
    this.w = w; this.h = h;
    this.r.setSize(w, h, false);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = w * dpr; this.overlay.height = h * dpr;
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fit();
  }
  fit() {
    const aspect = this.w / this.h;
    this.target.set(MAP.w / 2, 0, MAP.h / 2);
    this.cam.position.copy(this.target).addScaledVector(this.camDir, 60);
    this.cam.lookAt(this.target); this.cam.updateMatrixWorld();
    const inv = this.cam.matrixWorldInverse;
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const [x, z] of [[-0.3, -0.3], [MAP.w + 0.3, -0.3], [MAP.w + 0.3, MAP.h + 0.3], [-0.3, MAP.h + 0.3], [-3.2, 3.5]]) {
      const v = new THREE.Vector3(x, 0, z).applyMatrix4(inv);
      minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x); miny = Math.min(miny, v.y); maxy = Math.max(maxy, v.y);
    }
    // сдвигаем цель в центр рамки карты
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.cam.quaternion);
    const t = this.target.clone().addScaledVector(right, (minx + maxx) / 2).addScaledVector(up, (miny + maxy) / 2);
    t.addScaledVector(this.camDir, -t.y / this.camDir.y);
    this.target.copy(t); this.home = t.clone();
    const topPad = 56 / this.h;
    this.baseHalf = Math.max((maxy - miny) / 2 / (1 - topPad), (maxx - minx) / 2 / aspect) * 1.03;
    this.updateCam();
  }
  updateCam() {
    const aspect = this.w / this.h;
    const half = this.baseHalf;
    const shift = half * (56 / this.h);
    this.cam.left = -half * aspect; this.cam.right = half * aspect;
    this.cam.top = half + shift * 0.5; this.cam.bottom = -half + shift * 0.5;
    this.cam.zoom = this.zoom;
    this.cam.position.copy(this.target).addScaledVector(this.camDir, 60);
    this.cam.lookAt(this.target);
    this.cam.updateProjectionMatrix(); this.cam.updateMatrixWorld();
  }
  zoomBy(f, sx, sy) {
    const before = sx !== undefined ? this.screenToWorld(sx, sy) : null;
    this.zoom = clamp(this.zoom * f, 0.9, 2.6);
    this.updateCam();
    if (before) {
      const after = this.screenToWorld(sx, sy);
      if (after) { this.target.x += before.x - after.x; this.target.z += before.z - after.z; this.clampTarget(); this.updateCam(); }
    }
  }
  panScreen(dx, dy) {
    const a = this.screenToWorld(this.w / 2, this.h / 2), b = this.screenToWorld(this.w / 2 + dx, this.h / 2 + dy);
    if (!a || !b) return;
    this.target.x += a.x - b.x; this.target.z += a.z - b.z;
    this.clampTarget(); this.updateCam();
  }
  clampTarget() {
    this.target.x = clamp(this.target.x, -1, MAP.w + 1); this.target.z = clamp(this.target.z, -1, MAP.h + 1);
  }
  centerOn(x, z) { this.target.set(clamp(x, 0, MAP.w), 0, clamp(z, 0, MAP.h)); this.updateCam(); }
  screenToWorld(sx, sy) {
    const ndc = new THREE.Vector2(sx / this.w * 2 - 1, -(sy / this.h) * 2 + 1);
    this.ray.setFromCamera(ndc, this.cam);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, p) ? p : null;
  }
  worldToScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.cam);
    return [(v.x + 1) / 2 * this.w, (1 - v.y) / 2 * this.h, v.z];
  }

  // ---------- синхронизация со снимком ----------
  setPlayers(pl) { for (const p of pl) this.owners.set(p[0], p[2]); }

  syncStructs(st, now) {
    const seen = new Set();
    for (const s of st) {
      const [id, ki, owner, x, y, hp, rank, captured, drained, ba] = s;
      seen.add(id);
      let v = this.structs.get(id);
      const kind = STRUCT_KINDS[ki];
      if (!v) {
        const color = kind === 'hq' ? 0xc03028 : (this.owners.get(owner) || '#d8342c');
        const obj = M.STRUCT_MAKERS[kind](new THREE.Color(color));
        const cx = kind === 'hq' ? x + MAP.hq.w / 2 : x + 0.5, cz = kind === 'hq' ? y + MAP.hq.h / 2 : y + 0.5;
        obj.position.set(cx, 0, cz);
        obj.scale.setScalar(kind === 'hq' ? 1.25 : 1.36);
        obj.rotation.y = kind === 'plant' ? Math.PI / 2 : 0;
        this.scene.add(obj);
        v = { id, kind, obj, owner, x: cx, z: cz, aim: null, yaw: Math.PI * 0.25, lastShot: -9, born: now - ba * 1000, capturedFx: false, smokeT: 0 };
        if (ba < 1) this.buildDust(cx, cz, kind === 'hq' ? 1.2 : 0.6);
        this.structs.set(id, v);
      }
      v.hp = hp; v.rank = rank; v.captured = captured; v.drained = drained; v.owner = owner;
    }
    for (const [id, v] of this.structs) {
      if (seen.has(id)) continue;
      this.structs.delete(id);
      if (this.selected === id) this.selected = null;
      if (v.sold) { v.sinkT = 0; this.dying.push(v); }
      else this.scene.remove(v.obj);
    }
  }

  syncEnemies(en) {
    const seen = new Set();
    for (const e of en) {
      const [id, ti, a, b, hp, flags, scale, captive] = e;
      seen.add(id);
      let v = this.enemies.get(id);
      const kind = ENEMY_KINDS[ti];
      if (!v) {
        const obj = M.ENEMY_MAKERS[kind]();
        obj.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
        this.scene.add(obj);
        v = { id, kind, obj, air: !!(flags & 1), off: laneOffset(id), prev: null, cur: null, phase: Math.random() * 6, x: 0, z: 0, heading: 0 };
        this.enemies.set(id, v);
        if (kind === 'psi' || kind === 'brute') { const p0 = pathPos(a, v.off); this.ring(p0.x, 0.05, p0.y, kind === 'psi' ? 0xb46cff : 0x8cff5a, 1.2, 0.6); }
      }
      v.prev = v.cur || { a, b };
      v.cur = { a, b };
      v.hp = hp; v.flags = flags; v.scale = scale; v.captive = captive;
    }
    for (const [id, v] of this.enemies) {
      if (seen.has(id)) continue;
      this.scene.remove(v.obj);
      this.enemies.delete(id);
    }
  }

  // позиция врага в мире с учётом интерполяции
  enemyPos(v, alpha) {
    if (!v.cur) return { x: 0, y: 0, z: 0 };
    if (v.air) {
      const x = lerp(v.prev.a, v.cur.a, alpha), z = lerp(v.prev.b, v.cur.b, alpha);
      return { x, y: DISK_Y, z };
    }
    const d = lerp(v.prev.a, v.cur.a, alpha);
    const p = pathPos(d, v.off);
    return { x: p.x, y: 0, z: p.y, dx: p.dx, dz: p.dy };
  }

  // ---------- события ----------
  handleEvents(ev, alpha) {
    const killPos = new Map();
    for (const e of ev) if (e.e === 'kill') killPos.set(e.id, { x: e.x, y: e.air ? DISK_Y : 0.25, z: e.y });
    const posOf = id => {
      const v = this.enemies.get(id);
      if (v) { const p = this.enemyPos(v, alpha); return { x: p.x, y: p.y + (v.air ? 0 : (v.kind === 'brute' ? 0.4 : 0.25)), z: p.z }; }
      return killPos.get(id) || null;
    };
    for (const e of ev) {
      switch (e.e) {
        case 'shot': this.fxShot(e, posOf); break;
        case 'kill': this.fxKill(e); break;
        case 'build': break;
        case 'destroyed': this.fxStructBoom(e.x, e.y, e.kind); break;
        case 'sold': { const v = this.structs.get(e.id); if (v) v.sold = true; break; }
        case 'capture': { const t = this.structs.get(e.id); if (t) this.ring(t.x, 0.05, t.z, 0xb46cff, 1.4, 0.7); break; }
        case 'release': { const t = this.structs.get(e.id); if (t) this.ring(t.x, 0.05, t.z, 0xffffff, 0.9, 0.4); break; }
        case 'leak': { for (const h of this.structs.values()) if (h.kind === 'hq') this.fxBoom(h.x + (Math.random() - 0.5), 0.5, h.z + (Math.random() - 0.5), 0.8); break; }
        case 'grow': { const v = this.enemies.get(e.id); if (v) { const p = this.enemyPos(v, alpha); this.burst(p.x, 0.4, p.z, COL.psiG, 10, 1.2, 0.08, true); } break; }
        case 'rank': { const v = this.structs.get(e.id); if (v) { this.ring(v.x, 0.05, v.z, 0xffd36a, 1.0, 0.6); this.floatText(v.x, 1.2, v.z, e.rank === 2 ? 'Элита' : 'Лычка', '#ffd36a'); } break; }
        case 'ping': this.addPing(e.x, e.y, e.color); break;
        case 'end': if (!e.won) for (const h of this.structs.values()) if (h.kind === 'hq') this.ruinHQ(h); break;
        case 'drain': break;
      }
    }
  }

  fxShot(e, posOf) {
    const s = this.structs.get(e.id);
    if (!s) return;
    const mz = s.obj.userData.muzzles;
    const from = new THREE.Vector3();
    (mz[(Math.random() * mz.length) | 0] || s.obj).getWorldPosition(from);
    let to = null;
    if (e.sid) { const t = this.structs.get(e.sid); if (t) to = { x: t.x, y: 0.35, z: t.z }; }
    else if (e.tid) to = posOf(e.tid);
    else if (e.chain) to = posOf(e.chain[0]);
    if (e.k === 'flak' && !to && e.x !== undefined) to = { x: e.x, y: DISK_Y, z: e.y };
    if (!to) return;
    s.aim = to; s.lastShot = this.time;
    if (e.k === 'mg') {
      this.line([from, new THREE.Vector3(to.x, to.y, to.z)], 0xffd36a, 0.06);
      this.fxAdd.add({ x: from.x, y: from.y, z: from.z, life: 0.06, size: 0.32, size1: 0.12, c: COL.spark, alpha: 1 });
      for (let i = 0; i < 2; i++) this.fxAdd.add({ x: to.x, y: to.y, z: to.z, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 1.5, vz: (Math.random() - 0.5) * 2, grav: 6, life: 0.2, size: 0.07, c: COL.spark });
      this.onSound?.('mg');
    } else if (e.k === 'tesla') {
      const pts = [from];
      const chain = e.chain ? e.chain.map(posOf).filter(Boolean) : [to];
      for (const p of chain) pts.push(new THREE.Vector3(p.x, p.y, p.z));
      for (let i = 0; i < pts.length - 1; i++) this.bolt(pts[i], pts[i + 1], i === 0 ? 1 : 0.7);
      this.flash.position.copy(from); this.flash.intensity = 6; this.flash.color.set(0x9fdcff);
      s.orbFlash = 1;
      this.onSound?.('tesla');
    } else if (e.k === 'flak') {
      this.line([from, new THREE.Vector3(to.x, to.y, to.z)], 0xffc070, 0.05);
      this.fxAdd.add({ x: from.x, y: from.y, z: from.z, life: 0.08, size: 0.4, size1: 0.1, c: COL.fire, alpha: 1 });
      setTimeout(() => {
        this.fxAdd.add({ x: to.x, y: to.y, z: to.z, life: 0.14, size: 0.9, size1: 0.3, c: COL.fire, alpha: 1 });
        for (let i = 0; i < 3; i++) this.fxSmoke.add({ x: to.x + (Math.random() - 0.5) * 0.3, y: to.y + (Math.random() - 0.5) * 0.2, z: to.z + (Math.random() - 0.5) * 0.3, vy: 0.1, life: 1.1, size: 0.35, size1: 0.8, c: COL.smoke, alpha: 0.75, drag: 1 });
        for (let i = 0; i < 6; i++) this.fxAdd.add({ x: to.x, y: to.y, z: to.z, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, vz: (Math.random() - 0.5) * 3, drag: 3, life: 0.3, size: 0.06, c: COL.spark });
      }, 90);
      this.onSound?.('flak');
    }
  }

  fxKill(e) {
    const x = e.x, z = e.y, y = e.air ? DISK_Y : 0.2;
    if (e.kind === 'disk') {
      this.fxBoom(x, y, z, 1.1);
      for (let i = 0; i < 10; i++) this.fxSmoke.add({ x, y, z, vx: (Math.random() - 0.5) * 1.5, vy: Math.random() * 1, vz: (Math.random() - 0.5) * 1.5, grav: 3, life: 1.2, size: 0.12, c: COL.smoke, alpha: 0.9, drag: 0.5 });
      this.decal(x, z, 0.6);
      this.onSound?.('boom');
    } else if (e.kind === 'brute') {
      this.burst(x, 0.3, z, COL.blood, 26, 2.4, 0.1, false);
      this.burst(x, 0.3, z, COL.psiG, 16, 1.6, 0.08, true);
      this.ring(x, 0.05, z, 0x8cff5a, 1.3, 0.5);
      this.onSound?.('squish');
    } else if (e.kind === 'psi') {
      this.ring(x, 0.3, z, 0xc070ff, 2.2, 0.7);
      this.burst(x, 0.4, z, COL.psi, 40, 2.5, 0.12, true);
      this.onSound?.('psiDie');
    } else {
      this.burst(x, 0.25, z, COL.psi, 10, 1.4, 0.08, true);
      this.burst(x, 0.25, z, COL.psiG, 5, 1.2, 0.06, true);
      this.onSound?.('pop');
    }
    const n = this.playerCount || 1;
    if (e.reward && e.kind !== 'clone') this.floatText(x, y + 0.5, z, '+' + Math.round(e.reward * (1 + 0.35 * (n - 1)) / n), '#ffd36a', 0.8);
  }

  fxBoom(x, y, z, s) {
    this.fxAdd.add({ x, y, z, life: 0.25, size: 1.6 * s, size1: 0.6 * s, c: COL.spark });
    for (let i = 0; i < 14 * s; i++) this.fxAdd.add({ x, y, z, vx: (Math.random() - 0.5) * 3 * s, vy: Math.random() * 2.5 * s, vz: (Math.random() - 0.5) * 3 * s, drag: 2.5, life: 0.5 + Math.random() * 0.3, size: 0.5 * s, size1: 0.15, c: Math.random() < 0.5 ? COL.fire : COL.fire2 });
    for (let i = 0; i < 8 * s; i++) this.fxSmoke.add({ x: x + (Math.random() - 0.5) * 0.4 * s, y: y + Math.random() * 0.3, z: z + (Math.random() - 0.5) * 0.4 * s, vy: 0.4 + Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.3, drag: 0.6, life: 1.6 + Math.random(), size: 0.5 * s, size1: 1.2 * s, c: COL.smoke, alpha: 0.7, fadeIn: true });
  }

  fxStructBoom(x, z, kind) {
    const s = kind === 'hq' ? 2.2 : 1.4;
    this.fxBoom(x, 0.4, z, s);
    setTimeout(() => this.fxBoom(x + 0.25, 0.6, z - 0.2, s * 0.7), 160);
    for (let i = 0; i < 16; i++) this.fxSmoke.add({ x, y: 0.4, z, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 3, grav: 7, life: 1.4, size: 0.1, c: [0.35, 0.33, 0.3], alpha: 1 });
    this.ring(x, 0.05, z, 0xffb44a, 2.2, 0.5);
    this.decal(x, z, 1.2);
    this.onSound?.('bigboom');
  }

  ruinHQ(h) {
    h.ruined = true;
    for (let i = 0; i < 5; i++) setTimeout(() => this.fxStructBoom(h.x + (Math.random() - 0.5) * 1.2, h.z + (Math.random() - 0.5) * 1.2, i === 4 ? 'hq' : 'plant'), i * 280);
    setTimeout(() => {
      const u = h.obj.userData;
      u.body.scale.y = 0.45; h.obj.rotation.z = 0.06;
      for (const mm of u.mats) { mm.m.color.multiplyScalar(0.35); mm.m.emissiveIntensity = 0; }
      if (u.blink) u.blink.emissiveIntensity = 0;
    }, 1150);
  }

  buildDust(x, z, r) {
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      this.fxSmoke.add({ x: x + Math.cos(a) * r, y: 0.05, z: z + Math.sin(a) * r, vx: Math.cos(a) * 0.6, vy: 0.2, vz: Math.sin(a) * 0.6, drag: 1.5, life: 1.0, size: 0.3, size1: 0.6, c: COL.dust, alpha: 0.6 });
    }
  }

  burst(x, y, z, c, n, speed, size, add) {
    const sys = add ? this.fxAdd : this.fxSmoke;
    for (let i = 0; i < n; i++) sys.add({ x, y, z, vx: (Math.random() - 0.5) * speed, vy: Math.random() * speed * 0.8, vz: (Math.random() - 0.5) * speed, grav: 3, drag: 1.5, life: 0.5 + Math.random() * 0.4, size, size1: size * 0.3, c, alpha: 1 });
  }

  line(pts, color, life) {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    l.renderOrder = 4; this.scene.add(l);
    this.lines.push({ obj: l, t: 0, life });
  }

  bolt(a, b, power) {
    const n = 9;
    const make = () => {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = new THREE.Vector3().lerpVectors(a, b, t);
        if (i > 0 && i < n) { const j = 0.16 * Math.sin(t * Math.PI); p.x += (Math.random() - 0.5) * j * 2; p.y += (Math.random() - 0.5) * j * 2; p.z += (Math.random() - 0.5) * j * 2; }
        pts.push(p);
      }
      return pts;
    };
    for (let k = 0; k < 3; k++) {
      setTimeout(() => {
        const pts = make();
        this.line(pts, k === 0 ? 0xffffff : 0x9fdcff, 0.09);
        for (let i = 0; i < pts.length - 1; i++) {
          for (let j = 0; j < 3; j++) {
            const p = new THREE.Vector3().lerpVectors(pts[i], pts[i + 1], j / 3);
            this.fxAdd.add({ x: p.x, y: p.y, z: p.z, life: 0.12, size: 0.16 * power, size1: 0.05, c: COL.tesla, alpha: 0.9 });
          }
        }
      }, k * 45);
    }
    this.fxAdd.add({ x: b.x, y: b.y, z: b.z, life: 0.18, size: 0.7 * power, size1: 0.2, c: COL.teslaW, alpha: 1 });
    for (let i = 0; i < 6; i++) this.fxAdd.add({ x: b.x, y: b.y, z: b.z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3, grav: 4, life: 0.3, size: 0.06, c: COL.tesla });
  }

  ring(x, y, z, color, r, life) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.scale.setScalar(0.1); m.renderOrder = 4;
    this.scene.add(m);
    this.rings.push({ obj: m, t: 0, life, r });
  }

  decal(x, z, r) {
    if (!this.decalTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(15,12,10,0.85)'); gr.addColorStop(0.6, 'rgba(25,20,15,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      this.decalTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6; m.position.set(x, 0.015, z); m.renderOrder = 1;
    this.scene.add(m); this.decals.push({ obj: m, t: 0, life: 30 });
  }

  floatText(x, y, z, text, color, life = 1.2) { this.texts.push({ x, y, z, text, color, t: 0, life }); }

  addPing(x, z, color) {
    this.pings.push({ x, z, color, t: 0, life: 4 });
    this.ring(x, 0.05, z, new THREE.Color(color).getHex(), 1.6, 1);
    this.onSound?.('ping');
  }

  // ---------- стройка ----------
  setGhost(kind, team) {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    this.ghostKind = kind;
    this.grid.visible = !!kind; this.tileMark.visible = !!kind;
    if (!kind) { this.rangeRing.visible = this.rangeFill.visible = false; return; }
    const g = M.STRUCT_MAKERS[kind](new THREE.Color(team));
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, opacity: 0.45, depthWrite: false });
    g.traverse(o => { if (o.isMesh) { o.material = this.ghostMat; o.castShadow = false; } });
    g.rotation.y = kind === 'plant' ? Math.PI / 2 : 0;
    g.scale.setScalar(1.36);
    this.ghost = g; g.visible = false; this.scene.add(g);
  }
  moveGhost(tx, ty, ok) {
    if (!this.ghost) return;
    this.ghost.visible = true;
    this.ghost.position.set(tx + 0.5, 0, ty + 0.5);
    this.ghostMat.color.set(ok ? 0x7dff8a : 0xff5a4a);
    this.tileMark.position.set(tx + 0.5, 0.04, ty + 0.5);
    this.tileMark.material.color.set(ok ? 0x5cff6a : 0xff4a3a);
    const r = STRUCTS[this.ghostKind].range;
    if (r) this.showRange(tx + 0.5, ty + 0.5, r, ok ? 0xbfffc4 : 0xffb0a8); else this.rangeRing.visible = this.rangeFill.visible = false;
  }
  showRange(x, z, r, color = 0xffffff) {
    for (const m of [this.rangeRing, this.rangeFill]) { m.visible = true; m.position.x = x; m.position.z = z; m.scale.setScalar(r); m.material.color.set(color); }
  }
  paintGrid(okFn) {
    const c = this.gridCanvas, x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    for (let ty = 0; ty < MAP.h; ty++) for (let tx = 0; tx < MAP.w; tx++) {
      const ok = okFn(tx, ty);
      if (ok) { x.fillStyle = 'rgba(110,255,130,0.16)'; x.fillRect(tx * 32 + 1, ty * 32 + 1, 30, 30); }
      x.strokeStyle = ok ? 'rgba(160,255,170,0.45)' : 'rgba(255,255,255,0.08)'; x.lineWidth = 1;
      x.strokeRect(tx * 32 + 0.5, ty * 32 + 0.5, 31, 31);
    }
    this.gridTex.needsUpdate = true;
  }

  // ---------- кадр ----------
  frame(dt, alpha, state) {
    this.time += dt;
    const t = this.time;
    this.lowPower = state.lowPower;
    this.playerCount = state.playerCount || 1;

    // строения
    for (const v of this.structs.values()) {
      const u = v.obj.userData;
      const age = (performance.now() - v.born) / 1000;
      const k = clamp(age, 0, 1);
      if (!v.ruined) u.body.scale.y = k < 1 ? 0.05 + 0.95 * (1 - Math.pow(1 - k, 3)) : 1;
      if (u.turret) {
        let want = v.yaw;
        if (v.aim) want = Math.atan2(v.aim.x - v.x, v.aim.z - v.z);
        if (t - v.lastShot > 3) { v.aim = null; want = v.yaw + dt * 0.3; }
        let d = want - u.turret.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        u.turret.rotation.y += d * Math.min(1, dt * 12);
        v.yaw = u.turret.rotation.y;
      }
      if (u.orb) {
        v.orbFlash = Math.max(0, (v.orbFlash || 0) - dt * 4);
        const off = this.lowPower && !v.captured;
        u.orb.material.emissiveIntensity = off ? 0.05 : 1.2 + Math.sin(t * 9 + v.id) * 0.25 + v.orbFlash * 4;
        u.orb.material.emissive.set(v.captured ? 0xc070ff : 0x58b8ff);
        if (!off && Math.random() < dt * 3) this.fxAdd.add({ x: v.x + (Math.random() - 0.5) * 0.2, y: 1.12 + (Math.random() - 0.5) * 0.2, z: v.z + (Math.random() - 0.5) * 0.2, life: 0.15, size: 0.08, c: COL.tesla });
      }
      if (u.smoke) {
        v.smokeT -= dt;
        if (v.smokeT <= 0 && !v.drained) {
          v.smokeT = 0.35;
          for (const so of u.smoke) {
            const p = new THREE.Vector3(); so.getWorldPosition(p);
            this.fxSmoke.add({ x: p.x, y: p.y, z: p.z, vx: 0.15 + Math.random() * 0.1, vy: 0.5, vz: (Math.random() - 0.5) * 0.1, drag: 0.3, life: 2.4, size: 0.18, size1: 0.6, c: COL.steam, alpha: 0.45, fadeIn: true });
          }
        }
        u.win.emissiveIntensity = v.drained ? (Math.random() < 0.3 ? 0.1 : 0.6) : 1.2;
        if (v.drained && Math.random() < dt * 8) this.fxAdd.add({ x: v.x + (Math.random() - 0.5) * 0.5, y: 0.3 + Math.random() * 0.4, z: v.z + (Math.random() - 0.5) * 0.5, vy: 0.8, life: 0.4, size: 0.1, c: COL.psi });
      }
      if (u.dish && !v.ruined) { u.dish.rotation.y += dt * 0.9; u.blink.emissiveIntensity = (t % 1.2) < 0.15 ? 3 : 0.2; }
      // повреждённые строения дымят и горят
      if (v.hp < 0.55 || v.ruined) {
        const r = v.kind === 'hq' ? 0.9 : 0.35;
        if (Math.random() < dt * (v.hp < 0.3 || v.ruined ? 9 : 4)) this.fxSmoke.add({ x: v.x + (Math.random() - 0.5) * r, y: 0.4 + Math.random() * 0.3, z: v.z + (Math.random() - 0.5) * r, vx: 0.12, vy: 0.55, drag: 0.3, life: 2.2, size: 0.25, size1: 0.8, c: COL.smoke, alpha: 0.6, fadeIn: true });
        if ((v.hp < 0.3 || v.ruined) && Math.random() < dt * 14) this.fxAdd.add({ x: v.x + (Math.random() - 0.5) * r, y: 0.3 + Math.random() * 0.3, z: v.z + (Math.random() - 0.5) * r, vy: 0.7, life: 0.45, size: 0.22, size1: 0.05, c: Math.random() < 0.5 ? COL.fire : COL.fire2 });
      }
      // захват
      if (v.captured && !v.capturedFx) { v.capturedFx = true; }
      if (v.capturedFx) {
        const on = !!v.captured;
        const pulse = 0.6 + Math.sin(t * 6) * 0.3;
        for (const mm of u.mats) {
          if (on) { mm.m.emissive.set(0x7a2cff); mm.m.emissiveIntensity = pulse; }
          else { mm.m.emissive.copy(mm.e); mm.m.emissiveIntensity = mm.ei; }
        }
        if (!on) v.capturedFx = false;
        else if (Math.random() < dt * 6) this.fxAdd.add({ x: v.x + (Math.random() - 0.5) * 0.6, y: Math.random() * 0.8, z: v.z + (Math.random() - 0.5) * 0.6, vy: 0.6, life: 0.6, size: 0.1, c: COL.psi });
      }
    }
    // проданные: уходят в землю
    for (const v of this.dying) {
      v.sinkT += dt;
      v.obj.userData.body.scale.y = Math.max(0.01, 1 - v.sinkT * 1.5);
      if (v.sinkT > 0.7) this.scene.remove(v.obj);
    }
    this.dying = this.dying.filter(v => v.sinkT <= 0.7);

    // враги
    for (const v of this.enemies.values()) {
      const p = this.enemyPos(v, alpha);
      const o = v.obj, u = o.userData;
      const mvx = p.x - v.x, mvz = p.z - v.z;
      if (Math.hypot(mvx, mvz) > 0.0005) v.heading = Math.atan2(mvx, mvz);
      v.x = p.x; v.z = p.z;
      let dh = v.heading - o.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      o.rotation.y += dh * Math.min(1, dt * 10);
      o.position.set(p.x, p.y, p.z);
      const sc = v.scale || 1;
      o.scale.setScalar(ENEMY_SCALE[v.kind] * (v.kind === 'brute' ? sc : 1));
      if (u.legs) {
        const sp = v.kind === 'brute' ? 7 : 12;
        u.legs.forEach((l, i) => (l.rotation.x = Math.sin(t * sp + v.phase + i * Math.PI) * 0.6));
        if (v.kind !== 'brute') o.position.y = Math.abs(Math.sin(t * sp + v.phase)) * 0.02;
      }
      if (u.arms) u.arms.forEach((a, i) => (a.rotation.x = Math.sin(t * 7 + v.phase + i * Math.PI + 1) * 0.35));
      if (v.kind === 'disk') {
        o.position.y = DISK_Y + Math.sin(t * 2 + v.id) * 0.06;
        u.lights.rotation.y += dt * 4;
        o.rotation.z = Math.sin(t * 1.3 + v.id) * 0.08;
        const latched = !!(v.flags & 2);
        u.beam.visible = latched;
        if (latched) {
          const h = o.position.y - 0.5;
          u.beam.scale.set(1, h, 1); u.beam.position.y = -h / 2 - 0.05;
          u.beam.material.opacity = 0.25 + Math.sin(t * 20) * 0.1;
        }
      }
      if (v.kind === 'psi') {
        u.halo.rotation.z += dt * 3;
        u.halo.position.y = 0.52 + Math.sin(t * 3 + v.id) * 0.03;
        if (v.captive) {
          const tw = this.structs.get(v.captive);
          if (tw && Math.random() < dt * 30) {
            const k = Math.random();
            this.fxAdd.add({ x: lerp(p.x, tw.x, k), y: lerp(0.5, 0.6, k) + Math.sin(k * Math.PI) * 0.6, z: lerp(p.z, tw.z, k), life: 0.25, size: 0.1, c: COL.psi, alpha: 0.9 });
          }
        }
        if (Math.random() < dt * 4) this.fxAdd.add({ x: p.x, y: 0.55, z: p.z, vy: 0.4, life: 0.5, size: 0.07, c: COL.psi });
      }
    }

    // маяк и телебашня
    if (this.beacon) {
      const u = this.beacon.userData;
      u.crystal.rotation.y += dt * 1.2; u.crystal.position.y = 2.0 + Math.sin(t * 2) * 0.08;
      u.rings.forEach((r, i) => { r.rotation.x = Math.PI / 2 + Math.sin(t + i) * 0.25; r.rotation.y = t * (0.6 + i * 0.3); });
      if (Math.random() < dt * 10) this.fxAdd.add({ x: this.beacon.position.x + (Math.random() - 0.5), y: 0.2, z: this.beacon.position.z + (Math.random() - 0.5), vy: 1 + Math.random(), life: 1.2, size: 0.09, c: Math.random() < 0.7 ? COL.psi : COL.psiG });
    }
    if (this.tv) this.tv.userData.blink.material.emissiveIntensity = (t % 1.6) < 0.2 ? 3 : 0.3;

    // эффекты
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 40);
    for (const l of this.lines) { l.t += dt; l.obj.material.opacity = 1 - l.t / l.life; if (l.t >= l.life) { this.scene.remove(l.obj); l.obj.geometry.dispose(); l.obj.material.dispose(); } }
    this.lines = this.lines.filter(l => l.t < l.life);
    for (const r of this.rings) { r.t += dt; const u = r.t / r.life; r.obj.scale.setScalar(0.1 + r.r * (1 - Math.pow(1 - u, 2))); r.obj.material.opacity = 0.8 * (1 - u); if (u >= 1) { this.scene.remove(r.obj); r.obj.geometry.dispose(); r.obj.material.dispose(); } }
    this.rings = this.rings.filter(r => r.t < r.life);
    for (const d of this.decals) { d.t += dt; d.obj.material.opacity = Math.min(1, (d.life - d.t) / 5); if (d.t >= d.life) { this.scene.remove(d.obj); d.obj.geometry.dispose(); d.obj.material.dispose(); } }
    this.decals = this.decals.filter(d => d.t < d.life);
    this.fxAdd.update(dt); this.fxSmoke.update(dt);
    const scale = this.r.domElement.height / ((this.cam.top - this.cam.bottom) / this.cam.zoom);
    this.fxAdd.mat.uniforms.uScale.value = scale; this.fxSmoke.mat.uniforms.uScale.value = scale;

    // выбор
    const sel = this.selected && this.structs.get(this.selected);
    if (sel) {
      this.selRing.visible = true; this.selRing.position.set(sel.x, 0.03, sel.z);
      this.selRing.scale.setScalar(sel.kind === 'hq' ? 2 : 1);
      const r = STRUCTS[sel.kind].range;
      if (r && !this.ghostKind) this.showRange(sel.x, sel.z, r, 0xffffff);
    } else {
      this.selRing.visible = false;
      if (!this.ghostKind) this.rangeRing.visible = this.rangeFill.visible = false;
    }

    this.r.render(this.scene, this.cam);
    this.drawOverlay(dt, alpha);
  }

  // ---------- полосы здоровья, лычки, надписи ----------
  drawOverlay(dt, alpha) {
    const x = this.octx;
    x.clearRect(0, 0, this.w, this.h);
    const pips = (cx, cy, w, frac) => {
      const n = Math.max(4, Math.floor(w / 4));
      const filled = Math.ceil(frac * n);
      const col = frac > 0.5 ? '#5fe35a' : frac > 0.25 ? '#f0cc3a' : '#f04a3a';
      x.fillStyle = 'rgba(0,0,0,0.75)'; x.fillRect(cx - w / 2 - 1, cy - 1, n * 4 + 1, 6);
      for (let i = 0; i < n; i++) { x.fillStyle = i < filled ? col : 'rgba(255,255,255,0.08)'; x.fillRect(cx - w / 2 + i * 4, cy, 3, 4); }
    };
    const zoomK = this.zoom;
    for (const v of this.enemies.values()) {
      if (v.hp >= 1 && this.hover !== v.id) continue;
      const u = v.obj.userData;
      const [sx, sy] = this.worldToScreen(v.obj.position.x, v.obj.position.y + u.top * v.obj.scale.y + 0.08, v.obj.position.z);
      pips(sx, sy - 6, u.bar * Math.min(1.4, zoomK), v.hp);
    }
    for (const v of this.structs.values()) {
      const u = v.obj.userData;
      const [sx, sy] = this.worldToScreen(v.x, u.top * v.obj.scale.y + 0.1, v.z);
      const show = v.hp < 0.999 || this.selected === v.id || this.hover === v.id;
      if (show) pips(sx, sy - 8, (v.kind === 'hq' ? 64 : 40) * Math.min(1.4, zoomK), v.hp);
      if (v.rank) this.chevrons(sx + (v.kind === 'hq' ? 34 : 24), sy - 12, v.rank);
      if (v.captured) {
        x.save(); x.font = '600 13px Oswald, sans-serif'; x.textAlign = 'center';
        x.fillStyle = '#d6b8ff'; x.shadowColor = '#7a2cff'; x.shadowBlur = 8;
        x.fillText('ЗАХВАЧЕНА', sx, sy - 16); x.restore();
      }
      if (v.kind === 'razryadnik' && this.lowPower && !v.captured) {
        const [lx, ly] = this.worldToScreen(v.x, 0.55, v.z);
        x.save(); x.font = '600 12px Oswald, sans-serif'; x.textAlign = 'center'; x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,0.75)';
        x.strokeText('нет энергии', lx, ly); x.fillStyle = '#ffb38a'; x.fillText('нет энергии', lx, ly); x.restore();
      }
    }
    // надписи
    for (const t of this.texts) {
      t.t += dt;
      const [sx, sy] = this.worldToScreen(t.x, t.y + t.t * 0.6, t.z);
      x.save(); x.globalAlpha = 1 - (t.t / t.life) ** 2;
      x.font = '600 14px Oswald, sans-serif'; x.textAlign = 'center'; x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,0.8)';
      x.strokeText(t.text, sx, sy); x.fillStyle = t.color; x.fillText(t.text, sx, sy); x.restore();
    }
    this.texts = this.texts.filter(t => t.t < t.life);
    // метки игроков
    for (const p of this.pings) {
      p.t += dt;
      const [sx, sy] = this.worldToScreen(p.x, 0, p.z);
      const k = p.t / p.life;
      x.save(); x.globalAlpha = 1 - k * k;
      x.strokeStyle = p.color; x.lineWidth = 2;
      const r = 10 + ((p.t * 30) % 22);
      x.beginPath(); x.ellipse(sx, sy, r, r * 0.55, 0, 0, Math.PI * 2); x.stroke();
      x.fillStyle = p.color; x.font = '700 22px Russo One, sans-serif'; x.textAlign = 'center';
      x.shadowColor = '#000'; x.shadowBlur = 6; x.fillText('!', sx, sy - 18 - Math.abs(Math.sin(p.t * 6)) * 6);
      x.restore();
    }
    this.pings = this.pings.filter(p => p.t < p.life);
  }

  chevrons(cx, cy, rank) {
    const x = this.octx;
    x.save(); x.fillStyle = '#ffd36a'; x.strokeStyle = '#3a2a00'; x.lineWidth = 1;
    const n = rank === 2 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const y = cy + i * 5;
      x.beginPath(); x.moveTo(cx - 6, y); x.lineTo(cx, y + 4); x.lineTo(cx + 6, y); x.lineTo(cx + 6, y + 3); x.lineTo(cx, y + 7); x.lineTo(cx - 6, y + 3); x.closePath(); x.fill(); x.stroke();
    }
    if (rank === 2) { x.beginPath(); x.arc(cx, cy - 4, 3, 0, Math.PI * 2); x.fill(); }
    x.restore();
  }

  // ---------- радар ----------
  radarSetup(canvas) {
    this.radarCanvas = canvas;
    const right = new THREE.Vector3(1, 0, -1).normalize();
    const up = new THREE.Vector3(-1, 0, -1).normalize().multiplyScalar(Math.sin(Math.asin(this.camDir.y)));
    const corners = [[0, 0], [MAP.w, 0], [MAP.w, MAP.h], [0, MAP.h]].map(([x, z]) => [x * right.x + z * right.z, -(x * up.x + z * up.z)]);
    const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const W = canvas.width, H = canvas.height, pad = 6;
    const k = Math.min((W - pad * 2) / (maxx - minx), (H - pad * 2) / (maxy - miny));
    const ox = (W - (maxx - minx) * k) / 2 - minx * k, oy = (H - (maxy - miny) * k) / 2 - miny * k;
    // мир -> радар: rx = a*x + b*z + c, ry = d*x + e*z + f
    this.rA = [right.x * k, right.z * k, ox, -up.x * k, -up.z * k, oy];
    const [a, b, c, d, e, f] = this.rA;
    const det = a * e - b * d;
    this.rInv = [e / det, -b / det, -d / det, a / det];
    const base = document.createElement('canvas'); base.width = W; base.height = H;
    const g = base.getContext('2d');
    g.fillStyle = '#04120d'; g.fillRect(0, 0, W, H);
    g.save();
    g.setTransform(a / S, d / S, b / S, e / S, c - (a + b) * E, f - (d + e) * E);
    g.beginPath(); g.rect(E * S, E * S, MAP.w * S, MAP.h * S); g.clip();
    g.filter = 'saturate(0.8) brightness(0.85)';
    g.drawImage(this.terrainCanvas, 0, 0);
    g.restore();
    this.radarBase = base;
  }
  radarToWorld(rx, ry) {
    const [a, b, c, d, e, f] = this.rA; const [i0, i1, i2, i3] = this.rInv;
    const X = rx - c, Y = ry - f;
    return { x: i0 * X + i1 * Y, z: i2 * X + i3 * Y };
  }
  drawRadar(enemyFlash) {
    const cv = this.radarCanvas; if (!cv) return;
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    if (this.lowPower) {
      const img = g.createImageData(W, H);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 70; img.data[i] = v * 0.6; img.data[i + 1] = v; img.data[i + 2] = v * 0.7; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0);
      return;
    }
    g.drawImage(this.radarBase, 0, 0);
    const [a, b, c, d, e, f] = this.rA;
    const P = (x, z) => [a * x + b * z + c, d * x + e * z + f];
    for (const v of this.structs.values()) {
      const [rx, ry] = P(v.x, v.z);
      g.fillStyle = v.captured ? '#b46cff' : v.kind === 'hq' ? '#ffd36a' : (this.owners.get(v.owner) || '#d8342c');
      const s = v.kind === 'hq' ? 6 : 4;
      g.fillRect(rx - s / 2, ry - s / 2, s, s);
    }
    for (const v of this.enemies.values()) {
      const [rx, ry] = P(v.x, v.z);
      g.fillStyle = v.air ? '#ff7ae0' : '#c27bff';
      g.beginPath(); g.arc(rx, ry, v.kind === 'clone' ? 1.6 : 2.6, 0, Math.PI * 2); g.fill();
    }
    for (const p of this.pings) { const [rx, ry] = P(p.x, p.z); g.strokeStyle = p.color; g.lineWidth = 1.5; g.beginPath(); g.arc(rx, ry, 4 + (p.t * 8) % 6, 0, Math.PI * 2); g.stroke(); }
    // рамка обзора
    const pts = [[0, 0], [this.w, 0], [this.w, this.h], [0, this.h]].map(([sx, sy]) => this.screenToWorld(sx, sy)).filter(Boolean);
    if (pts.length === 4) {
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1;
      g.beginPath(); pts.forEach((p, i) => { const [rx, ry] = P(p.x, p.z); i ? g.lineTo(rx, ry) : g.moveTo(rx, ry); }); g.closePath(); g.stroke();
    }
    // строки развёртки
    g.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    if (enemyFlash) { g.strokeStyle = 'rgba(255,90,60,0.8)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, W - 3, H - 3); }
  }

  // ---------- картинки для иконок строительства ----------
  static renderCameos(kinds, team) {
    const W = 240, H = 180;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(W, H, false); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15;
    const out = {};
    for (const kind of kinds) {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a4030, 1.1));
      const sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.set(-3, 6, 2); scene.add(sun);
      const rim = new THREE.DirectionalLight(0x8fb8ff, 1.2); rim.position.set(3, 2, -4); scene.add(rim);
      const m = M.STRUCT_MAKERS[kind](new THREE.Color(team));
      if (kind === 'plant') m.rotation.y = Math.PI / 2;
      scene.add(m);
      const bb = new THREE.Box3().setFromObject(m);
      const c = bb.getCenter(new THREE.Vector3());
      const size = bb.getSize(new THREE.Vector3());
      const cam = new THREE.OrthographicCamera(-1, 1, 0.75, -0.75, 0.1, 50);
      const dir = new THREE.Vector3(1, 0.85, 1.25).normalize();
      cam.position.copy(c).addScaledVector(dir, 10); cam.lookAt(c);
      cam.zoom = 1.55 / Math.max(size.y * 1.05, Math.hypot(size.x, size.z) * 0.85); cam.updateProjectionMatrix();
      r.render(scene, cam);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#3b4b57'); gr.addColorStop(0.6, '#1d262d'); gr.addColorStop(1, '#0d1215');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      const gl = g.createRadialGradient(W / 2, H * 0.6, 4, W / 2, H * 0.6, W * 0.6); gl.addColorStop(0, 'rgba(255,220,160,0.18)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gl; g.fillRect(0, 0, W, H);
      g.drawImage(r.domElement, 0, 0);
      g.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
      out[kind] = cv.toDataURL('image/png');
      scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } });
    }
    r.dispose();
    try { r.forceContextLoss(); } catch {}
    return out;
  }
}
