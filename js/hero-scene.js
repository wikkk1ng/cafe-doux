// Café Doux — 3D-макарон первого экрана и разбор на слои.
// Модуль грузится не сразу, а когда браузер освободится после показа страницы (см. macaron.js);
// до этого на месте макарона стоит картинка-заглушка в той же позе.
// Canvas закреплён на экране, пока прокручивается .scene-rail (первый экран + разбор на слои).
// Положение и размер объекта задаёт невидимая рамка .scene__slot, поэтому макарон не заходит на текст.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadMacaronModel, makePartMesh, isLiteDevice, createThemeLighting, MODEL_URL, MODEL_LITE_URL } from './macaron-model.js';

const canvas = document.getElementById('macaron');
const slot = document.getElementById('sceneSlot');
const recipe = document.getElementById('recipe');
const blob = document.getElementById('sceneBlob');
const isMobile = window.matchMedia('(max-width: 860px)').matches || window.matchMedia('(pointer: coarse)').matches;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// облегчённый режим: телефоны, планшеты, слабые компьютеры
const lite = isLiteDevice();
// ?poster — служебный режим: отрисовать картинку-заглушку и сохранить её (только на локальном сервере)
const posterMode = new URLSearchParams(location.search).has('poster');

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: posterMode });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, lite ? 1.25 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(0, 0, 10);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const key = new THREE.DirectionalLight(0xffe2bf, 2.6);
key.position.set(-4, 5, 6);
scene.add(key);
const rim = new THREE.DirectionalLight(0xffc9a8, 1.4);
rim.position.set(5, 2, -4);
scene.add(rim);
const hemi = new THREE.HemisphereLight(0xfff4e4, 0x6b4a36, 0.55);
scene.add(hemi);

// вечером — тёплая лампа сбоку и ниже, мягче окружение; свет перетекает вместе с темой страницы
const lighting = createThemeLighting({
  renderer, scene,
  lights: [
    { light: key, day: { color: 0xffe2bf, intensity: 2.6, position: [-4, 5, 6] }, evening: { color: 0xffad66, intensity: 3.1, position: [-5, 3, 5] } },
    { light: rim, day: { color: 0xffc9a8, intensity: 1.4, position: [5, 2, -4] }, evening: { color: 0xff8f52, intensity: 0.9, position: [5, 1.5, -4] } },
    { light: hemi, day: { color: 0xfff4e4, ground: 0x6b4a36, intensity: 0.55 }, evening: { color: 0x8a5a3c, ground: 0x140c08, intensity: 0.28 } },
  ],
  env: { day: 0.55, evening: 0.2 },
  exposure: { day: 1.05, evening: 1.0 },
});

/* ---------- мягкая тень ---------- */
function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(70,32,30,0.5)');
  grd.addColorStop(0.45, 'rgba(70,32,30,0.2)');
  grd.addColorStop(1, 'rgba(70,32,30,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false, toneMapped: false })
);
shadow.renderOrder = -1;
scene.add(shadow);

/* ---------- иерархия ---------- */
const rig = new THREE.Group();     // положение и масштаб по рамке .scene__slot
const tilt = new THREE.Group();    // наклон от курсора и прокрутки
const spin = new THREE.Group();    // вращение
const holder = new THREE.Group();  // нормированная модель
rig.add(tilt); tilt.add(spin); spin.add(holder);
scene.add(rig);

const layers = { bottom: new THREE.Group(), middle: new THREE.Group(), top: new THREE.Group() };
holder.add(layers.bottom, layers.middle, layers.top);

// Срез — не плоский диск, а купол: у половинок он вогнут внутрь (видно полость теста),
// у ганаша чуть выпуклый, как мягкая начинка.
function makeDome(radius, y, depth, apexUp, color, creamy) {
  const R = (radius * radius + depth * depth) / (2 * depth);   // радиус сферы по хорде и стрелке
  const theta = Math.asin(Math.min(1, radius / R));
  const g = new THREE.SphereGeometry(R, 72, 36, 0, Math.PI * 2, 0, theta);
  if (!apexUp) g.rotateX(Math.PI);
  // ставим кромку купола ровно на линию разреза
  g.translate(0, y + (apexUp ? -1 : 1) * R * Math.cos(theta), 0);

  const base = {
    color: new THREE.Color(color),
    side: THREE.DoubleSide,
    roughness: creamy ? 0.55 : 0.88,
    metalness: 0,
    // нижняя грань крема смотрит от света — без подсветки она выглядела серой тарелкой
    emissive: new THREE.Color(color).multiplyScalar(creamy ? 0.42 : 0.14),
    envMapIntensity: 0.35,
  };
  // лак и бархатный отлив есть только у «полного» материала; облегчённому их не передаём
  const m = lite ? new THREE.MeshStandardMaterial(base) : new THREE.MeshPhysicalMaterial({
    ...base,
    clearcoat: creamy ? 0.2 : 0,
    clearcoatRoughness: 0.5,
    // белёсый блеск осветлял крем до белого — у ганаша он тёплый и слабый
    sheen: creamy ? 0.2 : 0.25,
    sheenColor: new THREE.Color(creamy ? 0xf2dccf : 0xfff0e4),
  });
  return new THREE.Mesh(g, m);
}

/* ---------- загрузка ---------- */
let ready = false;
let shown = false;
let frozen = false;
let readyAt = 0;
let modelHeight = 1;

function show3D() {
  canvas.classList.add('is-ready');
  document.documentElement.classList.add('hero3d-ready');
}
function hide3D() {
  canvas.classList.remove('is-ready');
  document.documentElement.classList.remove('hero3d-ready');
}

// видеокарта может «потерять» контекст (нехватка памяти, сон ноутбука) — возвращаем картинку
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); ready = false; hide3D(); });

loadMacaronModel(lite ? MODEL_LITE_URL : MODEL_URL).then(async ({ parts, maps, size, yLow, yHigh, creamRadius }) => {
  holder.scale.setScalar(2.4 / Math.max(size.x, size.y, size.z));
  modelHeight = size.y;

  const shellOptions = {
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: maps.roughnessMap,
    roughness: 0.82,
    metalness: 0,
    envMapIntensity: 0.9,
  };
  const shell = lite
    ? new THREE.MeshStandardMaterial(shellOptions)
    : new THREE.MeshPhysicalMaterial({
      ...shellOptions,
      clearcoat: 0.22,
      clearcoatRoughness: 0.55,
      sheen: 0.6,
      sheenRoughness: 0.7,
      sheenColor: new THREE.Color(0xffd9cf),
    });
  if (shell.map) shell.map.anisotropy = renderer.capabilities.getMaxAnisotropy();

  modelMeshes = [makePartMesh(parts.bottom, shell), makePartMesh(parts.middle, shell), makePartMesh(parts.top, shell)];
  layers.bottom.add(modelMeshes[0]);
  layers.middle.add(modelMeshes[1]);
  layers.top.add(modelMeshes[2]);

  // закрываем срезы: у половинок — полость, у прослойки — крем.
  // Цвет крема снят с текстуры середины прослойки: (228, 203, 191).
  // Полость половинок чуть шире крема: перекрывает зубчатую кромку разреза,
  // но остаётся внутри юбочки (она шире крема примерно на 10%).
  const rCream = creamRadius * 1.015;   // чуть шире стенки крема — прикрывает зубчатый край разреза
  // полость накрывает и затенённый стык до внутреннего края юбочки (юбочка шире крема ~на 10%)
  const rShell = creamRadius * 1.1;   // ≈ внутренний край юбочки, за силуэт не выходит
  const SHELL_INSIDE = 0xECB4AA, CREAM = 0xE4CBBF;
  layers.bottom.add(makeDome(rShell, yLow, rShell * 0.22, false, SHELL_INSIDE, false));
  layers.middle.add(makeDome(rCream, yLow, rCream * 0.1, false, CREAM, true));
  layers.middle.add(makeDome(rCream, yHigh, rCream * 0.1, true, CREAM, true));
  layers.top.add(makeDome(rShell, yHigh, rShell * 0.22, true, SHELL_INSIDE, false));

  resize();
  // шейдеры собираем в фоне, а не первым кадром — иначе страница «замирает»
  try { await renderer.compileAsync(scene, camera); } catch { /* старый браузер — соберёт при первом кадре */ }
  readyAt = clock.elapsedTime;
  spinAngle = 0;
  ready = true;
}).catch(err => {
  // 3D не загрузилось — на месте остаётся картинка-заглушка
  console.warn('Macaron model failed to load', err);
});

/* ---------- размер и положение по рамке .scene__slot ---------- */
let baseScale = 1;
const basePos = new THREE.Vector2();
let modelMeshes = null;

// Видимый силуэт макарона не совпадает с центром модели: макарон наклонён, а рамка сбоку
// от центра экрана (перспектива). Измеряем, где силуэт оказывается на экране в начальной позе,
// и сдвигаем объект так, чтобы он стоял ровно в центре рамки — и розового пятна за ней.
const _v = new THREE.Vector3();
function centerCorrection(visW, visH) {
  if (!modelMeshes) return new THREE.Vector2();
  // начальная поза — как в первый кадр (и как на картинке-заглушке)
  const saved = [rig.position.clone(), rig.scale.x, tilt.rotation.clone(), spin.rotation.y, holder.rotation.clone(),
    layers.top.position.y, layers.middle.position.y, layers.bottom.position.y];
  rig.position.set(basePos.x, basePos.y, 0); rig.scale.setScalar(baseScale);
  tilt.rotation.set(0, 0, 0); spin.rotation.y = 0; holder.rotation.set(0.35, 0, 0.12);
  layers.top.position.y = layers.middle.position.y = layers.bottom.position.y = 0;
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld();

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const mesh of modelMeshes) {
    const pos = mesh.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(camera);
      if (_v.x < minX) minX = _v.x; if (_v.x > maxX) maxX = _v.x;
      if (_v.y < minY) minY = _v.y; if (_v.y > maxY) maxY = _v.y;
    }
  }
  const target = _v.set(basePos.x, basePos.y, 0).project(camera);
  const off = new THREE.Vector2(
    (target.x - (minX + maxX) / 2) * visW / 2,
    (target.y - (minY + maxY) / 2) * visH / 2
  );
  // возвращаем позу
  rig.position.copy(saved[0]); rig.scale.setScalar(saved[1]); tilt.rotation.copy(saved[2]); spin.rotation.y = saved[3];
  holder.rotation.copy(saved[4]); layers.top.position.y = saved[5]; layers.middle.position.y = saved[6]; layers.bottom.position.y = saved[7];
  return off;
}

// Координаты считаем от самого холста, а не от окна: в начале страницы закреплённый слой
// стоит под шапкой (холст ниже края окна на её высоту), а ширина окна включает полосу прокрутки.
// Раньше из-за этого макарон после загрузки съезжал вниз и влево от пятна.
function resize() {
  const c = canvas.getBoundingClientRect();
  const w = Math.max(1, c.width), h = Math.max(1, c.height);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const visH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  const visW = visH * camera.aspect;

  const r = slot.getBoundingClientRect();
  const cx = r.left - c.left + r.width / 2;
  const cy = r.top - c.top + r.height / 2;
  basePos.set((cx / w * 2 - 1) * visW / 2, -(cy / h * 2 - 1) * visH / 2);

  const slotWorld = Math.min(r.width, r.height) / w * visW;
  baseScale = slotWorld * 0.62 / 2.4;
  basePos.add(centerCorrection(visW, visH));
}
new ResizeObserver(resize).observe(slot);
window.addEventListener('resize', resize);
document.fonts?.ready.then(resize);
resize();

/* ---------- ввод ---------- */
const pointer = { x: 0, y: 0 };
const pointerSmooth = { x: 0, y: 0 };
if (!isMobile && !posterMode) {
  window.addEventListener('pointermove', e => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });
  // курсор ушёл из окна (например, к кнопке «обновить») — макарон спокойно возвращается в исходную позу
  document.documentElement.addEventListener('mouseleave', () => { pointer.x = 0; pointer.y = 0; });
}

// heroP — прокрутка первого экрана, explodeP — разлёт слоёв в разделе «как он устроен»
let heroP = 0, heroSmooth = 0;
let explodeP = 0, explodeSmooth = 0;
let tail = 1;   // 1 — сцена видна, 0 — раздел закончился и макарон убран

function readScroll() {
  const vh = window.innerHeight;
  heroP = THREE.MathUtils.clamp(window.scrollY / vh, 0, 1);
  const r = recipe.getBoundingClientRect();
  // путь, который блок проезжает в закреплённом состоянии
  const travel = Math.max(1, r.height - vh);
  const passed = -r.top;
  // слои разлетаются за первые 75% пути, дальше кадр держится
  explodeP = THREE.MathUtils.clamp(passed / (travel * 0.75), 0, 1);
  // последние 12% — убираем макарон, чтобы он не выезжал на следующие экраны
  tail = THREE.MathUtils.clamp((travel - passed) / (travel * 0.12), 0, 1);
}
window.addEventListener('scroll', readScroll, { passive: true });
readScroll();

let visible = true;
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(document.querySelector('.scene-rail'));

/* ---------- цикл ---------- */
const clock = new THREE.Clock();
let spinAngle = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!visible || !ready || frozen) return;
  // время считаем от момента готовности: первый кадр совпадает с картинкой-заглушкой
  const t = clock.elapsedTime - readyAt;
  lighting.update(dt);

  const k = Math.min(1, dt * 5);
  heroSmooth += (heroP - heroSmooth) * k;
  explodeSmooth += (explodeP - explodeSmooth) * k;
  pointerSmooth.x += (pointer.x - pointerSmooth.x) * Math.min(1, dt * 3);
  pointerSmooth.y += (pointer.y - pointerSmooth.y) * Math.min(1, dt * 3);

  const e = explodeSmooth;
  const eased = e * e * (3 - 2 * e); // плавный старт и финиш

  // вращение замедляется, когда макарон разобран
  const still = reduceMotion || posterMode;
  const speed = still ? 0 : (isMobile ? 0.35 : 0.28) * (1 - eased * 0.75);
  spinAngle += dt * speed;
  spin.rotation.y = spinAngle;

  // наклон: курсор + прокрутка первого экрана; при разборе разворачиваемся «в профиль»
  tilt.rotation.x = pointerSmooth.y * 0.3 * (1 - eased) + heroSmooth * 0.35 * (1 - eased);
  tilt.rotation.z = -pointerSmooth.x * 0.22 * (1 - eased);
  // при разборе чуть опускаем взгляд сверху, чтобы были видны кремовые срезы
  holder.rotation.set(0.35 - eased * 0.13, 0, 0.12 * (1 - eased));

  // разлёт слоёв (в единицах геометрии)
  const h = modelHeight;
  layers.top.position.y = eased * h * 0.82;
  layers.middle.position.y = eased * h * 0.24;
  layers.bottom.position.y = -eased * h * 0.3;

  // покачивание и общая посадка
  const floatY = still ? 0 : Math.sin(t * 1.1) * 0.06 * (1 - eased * 0.6);
  const sc = baseScale * (1 - eased * 0.2);
  rig.scale.setScalar(sc);
  rig.position.set(
    basePos.x + pointerSmooth.x * 0.08 * (1 - eased),
    basePos.y + floatY - eased * 0.35,
    0
  );

  // тень уходит вместе с нижней половинкой и слабеет при разборе
  shadow.position.set(basePos.x + 0.1 * sc, rig.position.y - (1.45 + eased * 0.5) * sc, -1.5);
  const lift = 1 + floatY * 2;
  shadow.scale.set(2.8 * sc * lift, 0.5 * sc * lift, 1);
  shadow.material.opacity = (0.75 - floatY * 1.5) * (1 - eased * 0.45);

  // пятно — декорация первого экрана, при разборе гаснет
  blob.style.opacity = String(Math.max(0, 1 - eased * 1.6) * tail);
  canvas.style.opacity = String(tail);

  renderer.render(scene, camera);

  if (!shown) {
    shown = true;
    if (posterMode) { savePoster(); return; }
    // показываем 3D со следующего кадра — когда первый кадр уже на экране
    requestAnimationFrame(show3D);
  }
}
tick();

/* ---------- служебное: картинка-заглушка ---------- */
// Открыть страницу с ?poster на локальном сервере: кадр рамки .scene__slot сохранится
// в assets/img/macaron-poster.webp (с ?theme=evening — macaron-poster-evening.webp).
// Поза — как у 3D в первый момент: без курсора и покачивания.
async function savePoster() {
  frozen = true;
  const SIZE = 1060;
  const r = slot.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  camera.aspect = c.width / c.height;
  camera.setViewOffset(c.width, c.height, r.left - c.left, r.top - c.top, r.width, r.height);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const image = await new Promise(res => canvas.toBlob(res, 'image/webp', 0.9));
  const name = document.documentElement.dataset.theme === 'evening' ? 'macaron-poster-evening.webp' : 'macaron-poster.webp';
  const resp = await fetch('/__save/' + name, { method: 'POST', body: image });
  document.title = resp.ok ? 'poster saved ' + image.size : 'poster failed ' + resp.status;
}

