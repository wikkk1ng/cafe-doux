// Café Doux — чистовая сборка сайта в папку dist/ (её и выкладываем на GitHub Pages).
//
//   cd build && node release.mjs
//
// Что делает:
//  • встраивает CSS прямо в страницы — браузеру не нужно ждать отдельный файл стилей
//    перед первой отрисовкой (на телефоне это был главный тормоз первого экрана);
//  • сжимает JS, CSS и HTML (esbuild); исходники в корне проекта не трогает — правим их, как раньше;
//  • копирует только то, что реально нужно сайту: без исходников модели, старых файлов и служебного.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const rel = p => path.relative(ROOT, p).replaceAll('\\', '/');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const write = (file, data) => {
  const out = path.join(DIST, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, data);
};
const copy = file => {
  const out = path.join(DIST, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), out);
};
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* ---------- JS ---------- */
const minifyJs = async (code, esm) => (await esbuild.transform(code, {
  loader: 'js', minify: true, target: 'es2020', legalComments: 'none', charset: 'utf8', ...(esm ? { format: 'esm' } : {}),
})).code.trim();

const SCRIPTS = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
for (const f of SCRIPTS) {
  // main.js подключается обычным <script defer>, остальные — модули
  write(`js/${f}`, await minifyJs(read(`js/${f}`), f !== 'main.js'));
}

// three.js: только то, что импортирует сайт (ядро уже сжато авторами)
const THREE_FILES = [
  'vendor/three/build/three.module.min.js',
  'vendor/three/examples/jsm/loaders/GLTFLoader.js',
  'vendor/three/examples/jsm/libs/meshopt_decoder.module.js',
  'vendor/three/examples/jsm/environments/RoomEnvironment.js',
  'vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
];
for (const f of THREE_FILES) {
  if (f.endsWith('.min.js')) copy(f);
  else write(f, await minifyJs(read(f), true));
}

/* ---------- CSS: сжать и встроить ---------- */
let css = (await esbuild.transform(read('css/style.css'), { loader: 'css', minify: true, legalComments: 'none', charset: 'utf8' })).code.trim();
// пути в CSS были от папки css/, а теперь стили лежат в самой странице (в корне сайта)
css = css.replace(/url\((['"]?)\.\.\//g, 'url($1');

/* ---------- HTML ---------- */
// Сжатие без риска для вёрстки: убираем комментарии, а любые пробелы с переводом строки
// заменяем одним пробелом — для браузера это то же самое. Скрипты и стили сжимаем отдельно.
async function minifyHtml(html) {
  const keep = [];
  const stash = s => `\u0000${keep.push(s) - 1}\u0000`;

  html = await replaceAsync(html, /<script([^>]*)>([\s\S]*?)<\/script>/g, async (m, attrs, body) => {
    if (!body.trim()) return stash(m);
    if (/type="importmap"/.test(attrs)) return stash(`<script${attrs}>${JSON.stringify(JSON.parse(body))}</script>`);
    return stash(`<script${attrs}>${await minifyJs(body, /type="module"/.test(attrs))}</script>`);
  });
  html = await replaceAsync(html, /<style>([\s\S]*?)<\/style>/g, async (m, body) =>
    stash(`<style>${(await esbuild.transform(body, { loader: 'css', minify: true, charset: 'utf8' })).code.trim()}</style>`));

  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*\n\s*/g, ' ')   // пробел между тегами оставляем: между строчными элементами он значим
    .trim();
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i]);
}
async function replaceAsync(str, re, fn) {
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(re)) {
    parts.push(str.slice(last, m.index), await fn(...m));
    last = m.index + m[0].length;
  }
  parts.push(str.slice(last));
  return parts.join('');
}

// главная: <link rel="stylesheet"> → <style>
let index = read('index.html');
if (!index.includes('<link rel="stylesheet" href="css/style.css">')) throw new Error('index.html: не найден <link> на стили');
index = index.replace('<link rel="stylesheet" href="css/style.css">', () => `<style>${css}</style>`);
write('index.html', await minifyHtml(index));

// 404: стили подключал скрипт после <base> — теперь они встроены сразу за ним
let nf = read('404.html');
const nfLink = /\s*\+\s*'<link rel="stylesheet" href="css\/style\.css">'/;
if (!nfLink.test(nf)) throw new Error('404.html: не найдено подключение стилей');
nf = nf.replace(nfLink, '');
const firstScriptEnd = nf.indexOf('</script>') + '</script>'.length;
nf = nf.slice(0, firstScriptEnd) + `\n<style>${css}</style>` + nf.slice(firstScriptEnd);
write('404.html', await minifyHtml(nf));

/* ---------- картинки, шрифты, модели ---------- */
// берём только файлы, на которые есть ссылки в страницах, стилях и скриптах
const haystack = read('index.html') + read('404.html') + read('css/style.css') + SCRIPTS.map(f => read(`js/${f}`)).join('');
const assets = [];
for (const dir of ['assets/img', 'assets/fonts']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    const name = f.replace(/\.\w+$/, '');
    // постеры собираются из частей имени в скрипте: macaron-poster + -evening + -560
    const used = haystack.includes(f) || (f.startsWith('macaron-poster') && haystack.includes('macaron-poster'));
    if (used) assets.push(`${dir}/${f}`);
    else console.log('  не нужен сайту, пропускаю:', `${dir}/${f}`);
  }
}
assets.push('assets/macaron-v2.glb', 'assets/macaron-lite.glb');
assets.forEach(copy);

// GitHub Pages не должен обрабатывать сайт как Jekyll-проект
write('.nojekyll', '');

/* ---------- отчёт ---------- */
let total = 0;
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else total += fs.statSync(p).size;
});
walk(DIST);
const kb = f => (fs.statSync(path.join(DIST, f)).size / 1024).toFixed(1) + ' KB';
console.log(`\nindex.html ${kb('index.html')} (со встроенными стилями), 404.html ${kb('404.html')}`);
for (const f of SCRIPTS) console.log(`js/${f} ${(read(`js/${f}`).length / 1024).toFixed(1)} → ${kb(`js/${f}`)}`);
console.log(`файлов картинок и шрифтов: ${assets.length}; всего в dist: ${(total / 1024 / 1024).toFixed(2)} MB`);
