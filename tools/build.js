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

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', 'rubezh-solo.html');
fs.writeFileSync(out, html);
console.log(`${path.relative(ROOT, out)}: ${(html.length / 1024).toFixed(0)} КБ`);
