// Процедурные модели: геометрия собирается в коде, текстуры рисуются на canvas.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.05, flatShading: true, ...o });
}
export function glow(color, intensity = 1.4, o = {}) {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.5, flatShading: true, ...o });
}
function shadow(m, cast = true) { m.castShadow = cast; m.receiveShadow = true; return m; }
export function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const mesh = shadow(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m));
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}
export function cyl(rt, rb, h, seg, m, x = 0, y = 0, z = 0) {
  const mesh = shadow(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m));
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}
function beam(a, b, r, m, seg = 5) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = shadow(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m));
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}
function sandbags(r, n, layers, m, y0 = 0.05) {
  const g = new THREE.Group();
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < n; i++) {
      const a = (i + (l % 2) * 0.5) / n * Math.PI * 2;
      const b = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.085, 0.11), m));
      b.position.set(Math.cos(a) * r, y0 + 0.045 + l * 0.08, Math.sin(a) * r);
      b.rotation.y = -a + Math.PI / 2;
      b.scale.set(1, 1, 1);
      g.add(b);
    }
  }
  return g;
}

const C = {
  concrete: 0x9b9890, concreteD: 0x6f6d67, sand: 0xa4956a, olive: 0x55603d, oliveD: 0x3c4430, metal: 0x3a3f45,
  copper: 0xb7743b, steel: 0x7d8790, wall: 0xcfc6b2, roof: 0x55524c,
};

// заготовка строения: корень (позиция) -> body (растёт при постройке)
function shell() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  root.userData.body = body;
  root.userData.mats = [];
  return root;
}
function collectMats(root) {
  const mats = new Set();
  root.traverse(o => { if (o.isMesh && o.material && !o.userData.noTint) mats.add(o.material); });
  root.userData.mats = [...mats].filter(m => m.isMeshStandardMaterial).map(m => ({ m, e: m.emissive.clone(), ei: m.emissiveIntensity }));
  return root;
}

// ---------- строения ----------
export function makeShkval(team) {
  const root = shell(); const b = root.userData.body;
  const conc = mat(C.concrete), teamM = mat(team, { roughness: 0.6 });
  b.add(box(0.86, 0.05, 0.86, mat(C.concreteD)));
  b.add(sandbags(0.38, 11, 2, mat(C.sand)));
  b.add(cyl(0.22, 0.25, 0.26, 8, conc, 0, 0.05));
  b.add(cyl(0.255, 0.255, 0.035, 8, mat(0x2a2a2a), 0, 0.2));
  const tur = new THREE.Group(); tur.position.y = 0.31; b.add(tur);
  tur.add(box(0.2, 0.09, 0.22, mat(C.olive), 0, 0, -0.02));
  tur.add(box(0.205, 0.025, 0.12, teamM, 0, 0.06, -0.05));
  tur.add(box(0.06, 0.07, 0.08, mat(C.oliveD), 0, 0.02, 0.1));
  const barrel = cyl(0.022, 0.022, 0.32, 6, mat(0x1d1f22, { metalness: 0.6, roughness: 0.4 }));
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.055, 0.25); tur.add(barrel);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.055, 0.42); tur.add(muzzle);
  root.userData.turret = tur; root.userData.muzzles = [muzzle]; root.userData.top = 0.62;
  return collectMats(root);
}

export function makeRazryadnik(team) {
  const root = shell(); const b = root.userData.body;
  b.add(box(0.8, 0.12, 0.8, mat(C.concrete)));
  b.add(box(0.812, 0.035, 0.812, mat(team, { roughness: 0.6 }), 0, 0.045));
  b.add(box(0.5, 0.06, 0.5, mat(C.concreteD), 0, 0.12));
  const metal = mat(C.metal, { metalness: 0.55, roughness: 0.45 });
  for (const [x, z] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) {
    b.add(beam(new THREE.Vector3(x, 0.12, z), new THREE.Vector3(x * 0.25, 0.85, z * 0.25), 0.025, metal, 4));
  }
  b.add(cyl(0.07, 0.09, 0.95, 8, metal, 0, 0.12));
  const copper = new THREE.MeshStandardMaterial({ color: C.copper, metalness: 0.75, roughness: 0.32, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const r = 0.17 - i * 0.012;
    const t = shadow(new THREE.Mesh(new THREE.TorusGeometry(r, 0.032, 6, 14), copper));
    t.rotation.x = Math.PI / 2; t.position.y = 0.32 + i * 0.1; b.add(t);
  }
  const orbM = new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0x58b8ff, emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.3 });
  const orb = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), orbM));
  orb.position.y = 1.12; orb.userData.noTint = true; b.add(orb);
  const ring = shadow(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 6, 16), metal)); ring.rotation.x = Math.PI / 2; ring.position.y = 1.12; b.add(ring);
  const muzzle = new THREE.Object3D(); muzzle.position.y = 1.12; b.add(muzzle);
  root.userData.orb = orb; root.userData.muzzles = [muzzle]; root.userData.top = 1.32;
  return collectMats(root);
}

export function makeNebosvod(team) {
  const root = shell(); const b = root.userData.body;
  b.add(cyl(0.42, 0.44, 0.08, 8, mat(C.concreteD)));
  b.add(sandbags(0.39, 12, 1, mat(C.sand), 0.08));
  b.add(cyl(0.26, 0.28, 0.1, 8, mat(C.concrete), 0, 0.08));
  const tur = new THREE.Group(); tur.position.y = 0.18; b.add(tur);
  tur.add(cyl(0.2, 0.22, 0.1, 10, mat(C.olive)));
  tur.add(cyl(0.205, 0.205, 0.03, 10, mat(team, { roughness: 0.6 }), 0, 0.07));
  tur.add(box(0.2, 0.14, 0.16, mat(C.oliveD), 0, 0.09, -0.02));
  const pivot = new THREE.Group(); pivot.position.set(0, 0.2, 0.02); pivot.rotation.x = -0.85; tur.add(pivot);
  const bm = mat(0x1d1f22, { metalness: 0.6, roughness: 0.4 });
  const muzzles = [];
  for (const x of [-0.06, 0.06]) {
    const br = cyl(0.026, 0.03, 0.5, 6, bm, x, 0, 0); br.rotation.x = Math.PI / 2; br.position.set(x, 0, 0.25); pivot.add(br);
    const mz = new THREE.Object3D(); mz.position.set(x, 0, 0.52); pivot.add(mz); muzzles.push(mz);
  }
  root.userData.turret = tur; root.userData.muzzles = muzzles; root.userData.top = 0.72;
  return collectMats(root);
}

export function makePlant(team) {
  const root = shell(); const b = root.userData.body;
  b.add(box(0.92, 0.05, 0.92, mat(C.concreteD)));
  const wall = mat(0xbfb7a2);
  b.add(box(0.42, 0.28, 0.74, wall, -0.2, 0.05, 0));
  b.add(box(0.46, 0.04, 0.78, mat(C.roof), -0.2, 0.33, 0));
  const win = glow(0xffc35a, 1.2);
  for (let i = 0; i < 4; i++) b.add(box(0.012, 0.05, 0.08, win, 0.012, 0.16, -0.27 + i * 0.18));
  b.add(box(0.43, 0.035, 0.75, mat(team, { roughness: 0.6 }), -0.2, 0.06, 0));
  const pts = [];
  const prof = [[0.17, 0], [0.135, 0.18], [0.115, 0.32], [0.12, 0.42], [0.14, 0.5]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const towerM = mat(0xcbc4b3, { side: THREE.DoubleSide });
  const smoke = [];
  for (const z of [-0.2, 0.2]) {
    const t = shadow(new THREE.Mesh(new THREE.LatheGeometry(pts, 14), towerM));
    t.position.set(0.22, 0.05, z); b.add(t);
    const rim = shadow(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 4, 14), mat(0x8a857a))); rim.rotation.x = Math.PI / 2; rim.position.set(0.22, 0.55, z); b.add(rim);
    const so = new THREE.Object3D(); so.position.set(0.22, 0.6, z); b.add(so); smoke.push(so);
  }
  root.userData.win = win; root.userData.smoke = smoke; root.userData.top = 0.78;
  return collectMats(root);
}

function starShape(r1, r2) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 ? r2 : r1;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

export function makeHQ() {
  const root = shell(); const b = root.userData.body;
  b.add(box(1.94, 0.07, 1.94, mat(C.concreteD)));
  const pad = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.33, 24), new THREE.MeshBasicMaterial({ color: 0xe0b83a }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(0.5, 0.075, 0.55); b.add(pad);
  const wall = mat(C.wall);
  b.add(box(1.2, 0.42, 0.9, wall, -0.25, 0.07, -0.3));
  b.add(box(1.24, 0.04, 0.94, mat(C.roof), -0.25, 0.49, -0.3));
  b.add(box(0.7, 0.3, 0.6, mat(0xc2b8a1), -0.35, 0.53, -0.35));
  b.add(box(0.74, 0.035, 0.64, mat(C.roof), -0.35, 0.83, -0.35));
  const win = glow(0xffd27a, 0.9);
  for (let i = 0; i < 6; i++) b.add(box(0.1, 0.07, 0.012, win, -0.75 + i * 0.2, 0.25, 0.152));
  for (let i = 0; i < 6; i++) b.add(box(0.012, 0.07, 0.1, win, 0.352, 0.25, -0.65 + i * 0.13));
  b.add(box(1.21, 0.05, 0.91, mat(0xc03028, { roughness: 0.6 }), -0.25, 0.4, -0.3));
  const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(0.12, 0.05), { depth: 0.03, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0xc8202a, emissive: 0x801010, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.3 }));
  star.position.set(-0.25, 0.62, 0.06); b.add(star);
  // мачта и радар
  const metal = mat(C.metal, { metalness: 0.5, roughness: 0.45 });
  b.add(cyl(0.06, 0.08, 0.7, 8, metal, 0.45, 0.07, -0.55));
  const dishG = new THREE.Group(); dishG.position.set(0.45, 0.82, -0.55); b.add(dishG);
  const dish = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), mat(0xd6d2c8, { side: THREE.DoubleSide, metalness: 0.3 })));
  dish.rotation.x = -Math.PI / 2 + 0.4; dish.position.z = 0.04; dishG.add(dish);
  dishG.add(cyl(0.012, 0.012, 0.2, 4, metal, 0, 0, 0.08));
  const blinkM = glow(0xff2a2a, 2);
  const blinkers = [];
  for (const [x, h, z] of [[-0.85, 1.25, 0.05], [0.12, 1.05, -0.9]]) {
    b.add(cyl(0.012, 0.018, h, 4, metal, x, 0.07, z));
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), blinkM); l.position.set(x, 0.07 + h, z); l.userData.noTint = true; b.add(l); blinkers.push(l);
  }
  // мешки и шлагбаум
  for (let i = 0; i < 6; i++) b.add(box(0.18, 0.08, 0.1, mat(C.sand), 0.25 + (i % 3) * 0.2, 0.07, 0.88 - Math.floor(i / 3) * 0.1));
  root.userData.dish = dishG; root.userData.blink = blinkM; root.userData.top = 1.2;
  return collectMats(root);
}

// ---------- враги ----------
export function makeClone() {
  const g = new THREE.Group();
  const uni = mat(0x4f3480), dark = mat(0x22172f), skin = mat(0xd8c2a8);
  const legs = [];
  for (const x of [-0.035, 0.035]) {
    const leg = new THREE.Group(); leg.position.set(x, 0.17, 0); g.add(leg);
    leg.add(box(0.05, 0.17, 0.06, dark, 0, -0.17, 0));
    legs.push(leg);
  }
  g.add(box(0.13, 0.15, 0.08, uni, 0, 0.17));
  g.add(box(0.135, 0.022, 0.085, glow(0x8cff4a, 1.2), 0, 0.18));
  g.add(box(0.035, 0.12, 0.05, uni, -0.085, 0.19));
  g.add(box(0.035, 0.12, 0.05, uni, 0.085, 0.19));
  g.add(box(0.08, 0.08, 0.08, skin, 0, 0.32));
  g.add(box(0.082, 0.018, 0.02, glow(0x8cff4a, 1.6), 0, 0.36, 0.035));
  g.add(box(0.03, 0.03, 0.16, mat(0x1b1b1b), 0.08, 0.2, 0.06));
  g.userData.legs = legs; g.userData.top = 0.46; g.userData.bar = 22;
  return g;
}

export function makeBrute() {
  const g = new THREE.Group();
  const skin = mat(0x6c7d4c), harness = mat(0x3d2560), dark = mat(0x2a2f22);
  const legs = [];
  for (const x of [-0.08, 0.08]) {
    const leg = new THREE.Group(); leg.position.set(x, 0.24, 0); g.add(leg);
    leg.add(box(0.1, 0.24, 0.12, dark, 0, -0.24, 0));
    legs.push(leg);
  }
  const torso = new THREE.Group(); torso.position.y = 0.24; torso.rotation.x = 0.35; g.add(torso);
  torso.add(box(0.32, 0.26, 0.22, skin, 0, 0));
  torso.add(box(0.33, 0.06, 0.23, harness, 0, 0.1));
  torso.add(box(0.02, 0.18, 0.02, glow(0x9cff4a, 1.3), 0.08, 0.04, 0.112));
  torso.add(box(0.02, 0.14, 0.02, glow(0x9cff4a, 1.3), -0.06, 0.06, 0.112));
  torso.add(box(0.12, 0.1, 0.1, skin, 0, 0.26, 0.06));
  torso.add(box(0.1, 0.02, 0.02, glow(0xff5a3a, 1.6), 0, 0.31, 0.11));
  const arms = [];
  for (const x of [-0.2, 0.2]) {
    const arm = new THREE.Group(); arm.position.set(x, 0.2, 0); torso.add(arm);
    arm.add(box(0.09, 0.3, 0.1, skin, 0, -0.3, 0.03));
    arm.add(box(0.12, 0.08, 0.12, dark, 0, -0.36, 0.04));
    arms.push(arm);
  }
  g.userData.legs = legs; g.userData.arms = arms; g.userData.top = 0.8; g.userData.bar = 34;
  return g;
}

export function makeDisk() {
  const g = new THREE.Group();
  const hull = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 10), new THREE.MeshStandardMaterial({ color: 0x6a58a6, metalness: 0.75, roughness: 0.3, flatShading: true })));
  hull.scale.y = 0.26; g.add(hull);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a1048, emissive: 0xb070ff, emissiveIntensity: 1.2, roughness: 0.2 }));
  dome.position.y = 0.05; g.add(dome);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.022, 6, 24), glow(0x8cff5a, 1.8));
  ring.rotation.x = Math.PI / 2; g.add(ring);
  const lights = new THREE.Group(); g.add(lights);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 4), glow(0xd090ff, 2));
    l.position.set(Math.cos(a) * 0.2, -0.07, Math.sin(a) * 0.2); lights.add(l);
  }
  const beamM = new THREE.MeshBasicMaterial({ color: 0xb06cff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beamMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.28, 1, 16, 1, true), beamM);
  beamMesh.visible = false; g.add(beamMesh);
  g.userData.lights = lights; g.userData.beam = beamMesh; g.userData.top = 0.3; g.userData.bar = 30;
  return g;
}

export function makePsi() {
  const g = new THREE.Group();
  const robe = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.13, 0.34, 8), mat(0x2b1146)));
  robe.position.y = 0.17; g.add(robe);
  g.add(box(0.15, 0.03, 0.15, glow(0xa65cff, 1.0), 0, 0.02));
  g.add(box(0.2, 0.04, 0.06, mat(0x3a1a5c), 0, 0.27));
  const head = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mat(0xe2d0c0))); head.position.y = 0.4; g.add(head);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 20), glow(0xc070ff, 2.2));
  halo.rotation.x = Math.PI / 2; halo.position.y = 0.52; g.add(halo);
  for (const x of [-0.11, 0.11]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), glow(0xc070ff, 2.4)); h.position.set(x, 0.24, 0.03); g.add(h);
  }
  g.userData.halo = halo; g.userData.top = 0.62; g.userData.bar = 28;
  return g;
}

// ---------- город ----------
function facadeTexture(cols, floors, tone, seed) {
  const cw = 24, fh = 30;
  const c = document.createElement('canvas');
  c.width = Math.max(32, cols * cw); c.height = floors * fh;
  const x = c.getContext('2d');
  const base = ['#d6cdb9', '#c4cbc9', '#d7b897'][tone % 3];
  x.fillStyle = base; x.fillRect(0, 0, c.width, c.height);
  let s = seed;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let f = 0; f < floors; f++) {
    x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(0, f * fh + fh - 2, c.width, 2);
    for (let i = 0; i < cols; i++) {
      const lit = rnd() < 0.22;
      x.fillStyle = lit ? '#ffd889' : (rnd() < 0.5 ? '#3c4a55' : '#2e3a44');
      x.fillRect(i * cw + 5, f * fh + 7, cw - 10, fh - 14);
      x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(i * cw + 5, f * fh + 7, cw - 10, 2);
      if (rnd() < 0.3) { x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(i * cw + 3, f * fh + fh - 9, cw - 6, 4); }
    }
  }
  for (let i = 0; i <= cols; i++) { x.fillStyle = 'rgba(0,0,0,0.07)'; x.fillRect(i * cw - 1, 0, 2, c.height); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makeHouse(w, h, floors, tone, seed) {
  const g = new THREE.Group();
  const H = floors * 0.2;
  const W = w * 0.9, D = h * 0.9;
  const tx = facadeTexture(Math.round(W * 5), floors, tone, seed);
  const tz = facadeTexture(Math.round(D * 5), floors, tone, seed + 7);
  const mx = new THREE.MeshStandardMaterial({ map: tz, roughness: 0.9 });
  const mz = new THREE.MeshStandardMaterial({ map: tx, roughness: 0.9 });
  const roof = mat(0x6b6760);
  const m = shadow(new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [mx, mx, roof, roof, mz, mz]));
  m.position.y = H / 2; g.add(m);
  g.add(box(W + 0.03, 0.04, D + 0.03, mat(0x5b5853), 0, H));
  g.add(box(0.25, 0.14, 0.2, mat(0x8a857c), W * 0.2, H + 0.04, 0));
  g.add(cyl(0.008, 0.008, 0.3, 4, mat(0x333333), -W * 0.3, H + 0.04, D * 0.2));
  g.add(box(W * 0.98, 0.05, D * 0.98, mat(0x8a8478), 0, 0));
  return g;
}

export function makeTvTower() {
  const g = new THREE.Group();
  const steel = mat(0x9aa3ab, { metalness: 0.5, roughness: 0.5 });
  const red = mat(0xc8382c), white = mat(0xe8e4dc);
  g.add(cyl(0.48, 0.5, 0.06, 12, mat(0xb4ae9f)));
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + 0.3;
    g.add(beam(new THREE.Vector3(Math.cos(a) * 0.42, 0.06, Math.sin(a) * 0.42), new THREE.Vector3(0, 2.4, 0), 0.05, steel, 5));
    const a2 = a + Math.PI / 3;
    g.add(beam(new THREE.Vector3(Math.cos(a) * 0.3, 0.7, Math.sin(a) * 0.3), new THREE.Vector3(Math.cos(a2) * 0.3, 0.7, Math.sin(a2) * 0.3), 0.02, steel, 4));
  }
  g.add(cyl(0.07, 0.09, 4.6, 8, steel, 0, 0.06));
  g.add(cyl(0.34, 0.3, 0.22, 16, mat(0xd8d3c8), 0, 3.0));
  g.add(cyl(0.345, 0.345, 0.06, 16, glow(0xffd27a, 0.8), 0, 3.08));
  g.add(cyl(0.22, 0.24, 0.14, 12, mat(0xd8d3c8), 0, 3.85));
  let y = 4.66;
  for (let i = 0; i < 8; i++) { g.add(cyl(0.035 - i * 0.002, 0.04 - i * 0.002, 0.16, 6, i % 2 ? white : red, 0, y)); y += 0.16; }
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), glow(0xff2a2a, 2.5));
  blink.position.y = y + 0.03; g.add(blink);
  g.userData.blink = blink;
  return g;
}

export function makeTree(seed) {
  const g = new THREE.Group();
  let s = seed * 7 + 3;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  g.add(cyl(0.035, 0.05, 0.32, 5, mat(0x5a4330)));
  const greens = [0x4d7a2a, 0x5e8b33, 0x3f6b26, 0x6a9539];
  for (let i = 0; i < 4; i++) {
    const r = 0.17 + rnd() * 0.1;
    const c = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(greens[(i + seed) % 4])));
    c.position.set((rnd() - 0.5) * 0.22, 0.38 + rnd() * 0.2 + i * 0.04, (rnd() - 0.5) * 0.22);
    c.rotation.set(rnd() * 3, rnd() * 3, 0);
    g.add(c);
  }
  return g;
}

export function makeLamp() {
  const g = new THREE.Group();
  const m = mat(0x3b3f44, { metalness: 0.5 });
  g.add(cyl(0.012, 0.016, 0.42, 4, m));
  g.add(box(0.12, 0.012, 0.012, m, 0.05, 0.41));
  const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.03), glow(0xfff0b0, 1.5)); l.position.set(0.1, 0.405, 0); g.add(l);
  return g;
}

export function makeCar(color) {
  const g = new THREE.Group();
  g.add(box(0.36, 0.08, 0.17, mat(color, { metalness: 0.3, roughness: 0.5 }), 0, 0.03));
  g.add(box(0.2, 0.07, 0.15, mat(color, { metalness: 0.3, roughness: 0.5 }), -0.02, 0.11));
  g.add(box(0.205, 0.04, 0.155, mat(0x26323a, { metalness: 0.6, roughness: 0.2 }), -0.02, 0.13));
  for (const [x, z] of [[0.11, 0.08], [-0.11, 0.08], [0.11, -0.08], [-0.11, -0.08]]) {
    const w = cyl(0.035, 0.035, 0.03, 8, mat(0x111111), x, 0, z); w.rotation.x = Math.PI / 2; w.position.y = 0.035; g.add(w);
  }
  return g;
}

export function makeBeacon() {
  const g = new THREE.Group();
  const dark = mat(0x21102f, { metalness: 0.4, roughness: 0.4 });
  g.add(cyl(0.7, 0.8, 0.12, 6, dark));
  g.add(cyl(0.12, 0.42, 1.6, 4, dark, 0, 0.12));
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: 0x3a1460, emissive: 0xb35cff, emissiveIntensity: 2.2, roughness: 0.2 }));
  crystal.position.y = 2.0; g.add(crystal);
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.4 + i * 0.16, 0.02, 6, 30), glow(i === 1 ? 0x8cff5a : 0xb35cff, 2));
    r.position.y = 1.2 + i * 0.32; rings.push(r); g.add(r);
  }
  g.userData.crystal = crystal; g.userData.rings = rings;
  return g;
}

export const STRUCT_MAKERS = { shkval: makeShkval, razryadnik: makeRazryadnik, nebosvod: makeNebosvod, plant: makePlant, hq: makeHQ };
export const ENEMY_MAKERS = { clone: makeClone, brute: makeBrute, disk: makeDisk, psi: makePsi };
