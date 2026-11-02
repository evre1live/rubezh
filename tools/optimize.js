// Готовит сырые модели Tripo для игры: чистит, упрощает сетку, сжимает текстуры в WebP и геометрию в meshopt.
//   node tools/optimize.js            — все модели из art/gen/raw
//   node tools/optimize.js clone hq   — выбранные
// Результат: assets/models/<id>.glb и assets/manifest.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, resample, meshopt, getSceneVertexCount, VertexCountMethod } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'art/gen/raw');
const OUT = path.join(ROOT, 'assets/models');
fs.mkdirSync(OUT, { recursive: true });
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'art/models.json'), 'utf8'));
const manPath = path.join(ROOT, 'assets/manifest.json');
const manifest = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { models: {} };

// сколько треугольников и какой размер текстур оставлять
const BUDGET = { tower: [16000, 1024], enemy: [7000, 1024], city: [6000, 512] };
const SMALL = new Set(['bush', 'lamp', 'kiosk', 'car_white', 'car_black']);

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

function triCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    n += idx ? idx.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
  }
  return n;
}

const want = process.argv.slice(2);
const files = fs.readdirSync(RAW).filter(f => f.endsWith('.glb'));
for (const f of files) {
  const name = f.replace(/\.glb$/, '');
  const baseId = name.replace(/_(walk|run|idle)$/, '');
  const anim = name !== baseId ? name.slice(baseId.length + 1) : null;
  if (want.length && !want.includes(baseId) && !want.includes(name)) continue;
  const m = spec.models.find(x => x.id === baseId);
  if (!m) { console.log('пропуск', f); continue; }
  // для персонажей с анимацией берём анимированную версию, статичную пропускаем
  if (!anim && m.rig && fs.existsSync(path.join(RAW, `${baseId}_${m.anim || 'walk'}.glb`))) continue;
  const [faces, tex] = BUDGET[m.group];
  const doc = await io.read(path.join(RAW, f));
  const before = triCount(doc);
  const target = SMALL.has(baseId) ? Math.min(faces, 2500) : faces;
  const ratio = Math.min(1, target / Math.max(1, before));
  await doc.transform(
    dedup(),
    weld(),
    ...(ratio < 0.98 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002, lockBorder: false })] : []),
    resample(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [SMALL.has(baseId) ? 256 : tex, SMALL.has(baseId) ? 256 : tex], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = path.join(OUT, `${baseId}.glb`);
  await io.write(out, doc);
  const after = triCount(doc);
  manifest.models[baseId] = { file: `models/${baseId}.glb`, group: m.group, size: m.size, fit: m.fit, yaw: m.yaw || 0, anim: anim || undefined };
  console.log(`${baseId}: ${Math.round(before)} → ${Math.round(after)} треуг., ${(fs.statSync(out).size / 1024).toFixed(0)} КБ${anim ? ', анимация ' + anim : ''}`);
}
fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2));
console.log('manifest:', Object.keys(manifest.models).length, 'моделей');
