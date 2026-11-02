// Сборка одиночной версии в один HTML-файл (шрифты и код внутри): dist/rubezh-solo.html
// node tools/build.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = p => path.join(ROOT, 'client', p);

const res = await esbuild.build({
  entryPoints: [C('main.js')], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

let fonts = fs.readFileSync(C('fonts.css'), 'utf8');
fonts = fonts.replace(/url\(fonts\/([^)]+)\)/g, (m, f) => `url(data:font/woff2;base64,${fs.readFileSync(C('fonts/' + f)).toString('base64')})`);
const css = fs.readFileSync(C('style.css'), 'utf8');

let html = fs.readFileSync(C('index.html'), 'utf8');
html = html
  .replace(/<link rel="stylesheet" href="fonts.css">\n?/, '')
  .replace(/<link rel="stylesheet" href="style.css">\n?/, '')
  .replace(/<script type="importmap">.*?<\/script>\n?/, '')
  .replace(/<script type="module" src="main.js"><\/script>\n?/, '')
  .replace('<!--INLINE_CSS-->', () => `<style>\n${fonts}\n${css}</style>`)
  .replace('<!--INLINE_JS-->', () => `<script>window.RUBEZH_SOLO = true;</script>\n<script>${js}</script>`);

const DIST = path.join(ROOT, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
const out = path.join(DIST, 'rubezh-solo.html');
fs.writeFileSync(out, html);
fs.cpSync(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true });
const files = [];
const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(path.join(DIST, 'assets'));
fs.writeFileSync(path.join(DIST, 'files.json'), JSON.stringify(files.map(f => ({ as: path.relative(DIST, f), path: f })), null, 1));
const total = files.reduce((a, f) => a + fs.statSync(f).size, 0) + html.length;
console.log(`${path.relative(ROOT, out)}: ${(html.length / 1024).toFixed(0)} КБ, файлов в assets: ${files.length}, всего ${(total / 1048576).toFixed(1)} МБ`);
