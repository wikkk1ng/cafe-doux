// Café Doux — фото сайта в WebP нескольких размеров + srcset/sizes в index.html.
// Браузер сам выбирает файл под ширину экрана и плотность пикселей: телефону — маленький,
// большому монитору — крупный. Исходный JPEG остаётся запасным для старых браузеров.
//
// Запуск из папки build:  node images.mjs
// Повторный запуск безопасен: файлы пересоздаются, уже обёрнутые <picture> не трогаются.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(ROOT, 'assets', 'img');
const HTML = path.join(ROOT, 'index.html');

const WIDTHS = [400, 640, 960, 1280, 1600, 2000];

// sizes — сколько CSS-пикселей картинки нужно при разной ширине экрана.
// Почти все фото кадрируются (object-fit: cover), поэтому нужная ширина бывает больше рамки:
// например, горизонтальный круассан в вертикальной карточке на телефоне — 169vw.
// Цифры сняты в браузере на ширине экрана 375, 800 и 1440 px.
const SIZES = {
  'macaron-pink.jpg':     '(max-width: 560px) 90vw, (max-width: 860px) 88vw, 36vw',
  'almond-croissant.jpg': '(max-width: 560px) 169vw, (max-width: 860px) 81vw, 40vw',
  'crepe-berries.jpg':    '(max-width: 560px) 90vw, (max-width: 860px) 43vw, 21vw',
  'cardamom-bun.jpg':     '(max-width: 560px) 90vw, (max-width: 860px) 43vw, 21vw',
  'baker-hands.jpg':      '(max-width: 860px) 156vw, 97vw',
  'bread-flour.jpg':      '(max-width: 860px) 53vw, 26vw',
  'bread-loaf.jpg':       '(max-width: 860px) 54vw, 36vw',
  'croissant-tray.jpg':   '(max-width: 860px) 48vw, 20vw',
  'bakery-shelves.jpg':   '(max-width: 860px) 72vw, 37vw',
  'cafe-hall.jpg':        '(max-width: 860px) 104vw, 40vw',
  'window-table.jpg':     '(max-width: 860px) 124vw, 104vw',
  // фон финального блока притемнён — на телефоне сознательно берём размер поменьше
  'bakery-counter.jpg':   '(max-width: 560px) 140vw, (max-width: 860px) 144vw, 109vw',
};
// мука на тёмном противне и притемнённый фон — мелкая фактура, качество ниже незаметно
const QUALITY = { 'bakery-counter.jpg': 70, 'cardamom-bun.jpg': 66 };

const base = name => name.replace(/\.jpe?g$/, '');
let html = fs.readFileSync(HTML, 'utf8');
let saved = 0, before = 0;

for (const [name, sizes] of Object.entries(SIZES)) {
  const src = path.join(IMG, name);
  const meta = await sharp(src).metadata();
  const widths = WIDTHS.filter(w => w < meta.width);
  widths.push(meta.width);                       // самый крупный — исходный размер, без увеличения
  const srcset = [];
  let biggest = 0;
  for (const w of widths) {
    const out = `${base(name)}-${w}.webp`;
    const info = await sharp(src).resize({ width: w }).webp({ quality: QUALITY[name] || 78, effort: 6 }).toFile(path.join(IMG, out));
    srcset.push(`assets/img/${out} ${w}w`);
    biggest = info.size;
  }
  const jpg = fs.statSync(src).size;
  before += jpg; saved += jpg - biggest;
  console.log(`${name.padEnd(22)} ${(jpg / 1024).toFixed(0).padStart(5)} KB → ${(biggest / 1024).toFixed(0).padStart(4)} KB (самый крупный WebP), размеров: ${widths.length}`);

  // <img … src="assets/img/name.jpg" …>  →  <picture><source …><img …></picture>
  const re = new RegExp(`(<picture>\\s*<source[^>]*>\\s*)?(<img[^>]*src="assets/img/${name.replace('.', '\\.')}"[^>]*>)(\\s*</picture>)?`);
  const m = html.match(re);
  if (!m) { console.warn('  нет в index.html:', name); continue; }
  const img = m[2];
  const picture = `<picture><source type="image/webp" srcset="${srcset.join(', ')}" sizes="${sizes}">${img}</picture>`;
  html = html.replace(m[0], picture);
}

fs.writeFileSync(HTML, html);
console.log(`\nJPEG всего ${(before / 1024).toFixed(0)} KB; даже самые крупные WebP легче на ${(saved / 1024).toFixed(0)} KB`);
