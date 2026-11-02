// Загрузка готовых моделей (GLB из Tripo). Если файла нет, игра берёт процедурную модель.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const store = new Map();
export const hasAsset = id => store.has(id);

export async function loadAssets(base = 'assets/', onProgress) {
  let man;
  try {
    const r = await fetch(base + 'manifest.json', { cache: 'no-cache' });
    if (!r.ok) return 0;
    man = await r.json();
  } catch { return 0; }
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const entries = Object.entries(man.models || {});
  let done = 0;
  await Promise.all(entries.map(async ([id, meta]) => {
    try {
      const g = await loader.loadAsync(base + meta.file);
      store.set(id, { root: prepare(g.scene, meta), clips: g.animations || [], meta, skinned: hasSkin(g.scene) });
    } catch (e) { console.warn('модель не загрузилась', id, e && e.message); }
    onProgress && onProgress(++done, entries.length);
  }));
  return store.size;
}

function hasSkin(o) { let s = false; o.traverse(c => { if (c.isSkinnedMesh) s = true; }); return s; }

// приводим модель к общему виду: центр по X/Z, основание на земле, нужный размер
function prepare(scene, meta) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  let k = 1;
  if (meta.fit === 'height') k = meta.size / Math.max(1e-3, size.y);
  else if (meta.fit === 'footprint') k = meta.size / Math.max(1e-3, Math.max(size.x, size.z));
  else k = 1 / Math.max(1e-3, Math.max(size.x, size.z)); // 'box': размер задаётся при установке
  const inner = new THREE.Group();
  scene.position.set(-c.x, -box.min.y, -c.z);
  inner.add(scene);
  inner.rotation.y = (meta.yaw || 0) * Math.PI / 180;
  const root = new THREE.Group();
  inner.scale.setScalar(k);
  root.add(inner);
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.isMeshStandardMaterial) { m.envMapIntensity = 0.45; m.roughness = Math.max(0.25, m.roughness); }
      if (m.map) m.map.anisotropy = 4;
    }
  });
  const fin = new THREE.Box3().setFromObject(root);
  root.userData.size = fin.getSize(new THREE.Vector3());
  root.userData.top = fin.max.y;
  return root;
}

// новый экземпляр: свои материалы (чтобы подсвечивать захваченные башни), свой скелет
export function instance(id, shareMaterials = false) {
  const a = store.get(id);
  if (!a) return null;
  const obj = a.skinned ? SkeletonUtils.clone(a.root) : a.root.clone(true);
  if (!shareMaterials) obj.traverse(o => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
  });
  obj.userData = { ...a.root.userData };
  let mixer = null;
  if (a.clips.length) {
    mixer = new THREE.AnimationMixer(obj);
    const action = mixer.clipAction(a.clips[0]);
    action.play();
    action.time = Math.random() * a.clips[0].duration;
  }
  return { obj, mixer, meta: a.meta };
}

// модель «по коробке»: подогнать под площадь w×d клеток и высоту h
export function fitBox(obj, w, d, h) {
  const s = obj.userData.size;
  obj.scale.set(w / Math.max(1e-3, s.x), h / Math.max(1e-3, s.y), d / Math.max(1e-3, s.z));
  return obj;
}
