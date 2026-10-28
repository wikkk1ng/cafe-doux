// Café Doux — страница 404: «макарон укатился».
// В цифрах «404» ноль — это 3D-макарон. После загрузки он выкатывается из своего места
// и останавливается справа; его можно толкать курсором или смахнуть пальцем.
// Если закатить обратно в «0» — он встаёт на место, и появляется подпись «нашёлся!».
// Без WebGL или при ошибке загрузки остаётся обычная розовая цифра 0.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadMacaronModel, makePartMesh, isLiteDevice, createThemeLighting, MODEL_LITE_URL } from './macaron-model.js';

const root = document.documentElement;
const canvas = document.getElementById('nfCanvas');
const digits = document.getElementById('nfDigits');
const zero = document.getElementById('nfZero');
const baseMark = document.getElementById('nfBase');
const floorLine = document.getElementById('nfFloor');
const pushNote = document.getElementById('nfPush');
const foundNote = document.getElementById('nfFound');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// модуль подгружается из 404.html уже после загрузки страницы — сначала текст, потом макарон
if ('WebGLRenderingContext' in window) {
  try { start(); } catch (err) { console.warn('404: 3D unavailable', err); }
}

function start() {
  const lite = isLiteDevice();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lite ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.38;

  // Камера подобрана так, что в плоскости z = 0 одна единица сцены — ровно один CSS-пиксель:
  // макарон можно ставить прямо по координатам цифр на странице.
  const FOV = 20;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);

  const key = new THREE.DirectionalLight(0xffe6c8, 2.1);
  const hemi = new THREE.HemisphereLight(0xfff4e4, 0x6b4a36, 0.5);
  const fill = new THREE.DirectionalLight(0xffd9c4, 0.45);
  scene.add(key, hemi, fill);
  const lighting = createThemeLighting({
    renderer, scene,
    lights: [
      { light: key, day: { color: 0xffe6c8, intensity: 2.1, position: [-800, 650, 260] }, evening: { color: 0xffad66, intensity: 2.6, position: [-850, 450, 260] } },
      { light: hemi, day: { color: 0xfff4e4, ground: 0x6b4a36, intensity: 0.5 }, evening: { color: 0x7a4e34, ground: 0x120a06, intensity: 0.26 } },
      { light: fill, day: { color: 0xffd9c4, intensity: 0.45, position: [700, 150, -200] }, evening: { color: 0xff9a5c, intensity: 0.3, position: [700, 150, -200] } },
    ],
    env: { day: 0.38, evening: 0.16 },
    exposure: { day: 0.92, evening: 0.95 },
    onChange: () => wake(),
  });

  /* ---------- макарон: стоит на ребре, торцом к нам, чуть повёрнут — видно слои ---------- */
  const pos = new THREE.Group();      // место на полке
  const lean = new THREE.Group();     // покачивание и лёгкий поворот к зрителю
  const stand = new THREE.Group();    // ось макарона смотрит на камеру
  const spin = new THREE.Group();     // качение
  stand.rotation.x = Math.PI / 2;
  lean.rotation.y = -0.4;
  pos.add(lean); lean.add(stand); stand.add(spin);
  scene.add(pos);

  // мягкая тень на полке
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), color: 0x2b1911, transparent: true, depthWrite: false, opacity: 0.5 })
  );
  scene.add(shadow);

  /* ---------- раскладка: всё в пикселях страницы ---------- */
  let W = 1, H = 1, R = 50, floorY = 0, gapX = 0, minX = 0, maxX = 0, modelScale = 1, modelSize = null;

  function layout() {
    W = window.innerWidth; H = window.innerHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const dist = (H / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    camera.position.set(0, 0, dist);
    camera.near = dist * 0.2; camera.far = dist * 3;
    camera.updateProjectionMatrix();

    const fontSize = parseFloat(getComputedStyle(digits).fontSize);
    const zr = zero.getBoundingClientRect();
    floorY = baseMark.getBoundingClientRect().top;
    gapX = zr.left + zr.width / 2;
    // диаметр — высота цифры: макарон стоит вместо ноля
    R = fontSize * 0.34;
    minX = R + 8; maxX = W - R - 8;
    floorLine.style.setProperty('--floor', (floorY - document.getElementById('nf').getBoundingClientRect().top) + 'px');
    if (modelSize) {
      modelScale = (R * 2) / Math.max(modelSize.x, modelSize.z);
      spin.scale.setScalar(modelScale);
    }
    if (mode === 'home') s.x = gapX;
    s.x = Math.min(maxX, Math.max(minX, s.x));
    place();
    wake();
  }

  /* ---------- состояние и «физика» ---------- */
  // x — центр по горизонтали (px), y — высота над полкой, theta — угол качения, tilt — покачивание
  const s = { x: 0, y: 0, vx: 0, vy: 0, theta: 0, tilt: 0, vtilt: 0 };
  let mode = 'home';          // home — стоит в «0»; free — катается
  let ready = false, pushedOnce = false, introDone = false;

  function place() {
    pos.position.set(s.x - W / 2, H / 2 - (floorY - s.y - R), 0);
    spin.rotation.y = s.theta;
    lean.rotation.x = s.tilt;
    const lift = Math.min(1, s.y / (R * 2));
    shadow.position.set(s.x - W / 2, H / 2 - floorY, -R);
    shadow.scale.set(R * 2.3 * (1 - lift * 0.35), R * 0.34 * (1 - lift * 0.35), 1);
    shadow.material.opacity = (root.dataset.theme === 'evening' ? 0.75 : 0.42) * (1 - lift * 0.7);
  }

  // шаг симуляции; true — ещё что-то движется
  function step(dt) {
    const g = R * 22;
    if (mode === 'home') {
      s.x += (gapX - s.x) * Math.min(1, dt * 10);
      s.vx = 0;
    } else {
      s.vx *= Math.exp(-1.35 * dt);                 // трение качения
      s.x += s.vx * dt;
      if (s.x < minX) { s.x = minX; s.vx = -s.vx * 0.5; s.vtilt += 1.6; }
      if (s.x > maxX) { s.x = maxX; s.vx = -s.vx * 0.5; s.vtilt -= 1.6; }
    }
    // подскок
    if (s.y > 0 || s.vy > 0) {
      s.vy -= g * dt;
      s.y += s.vy * dt;
      if (s.y <= 0) {
        s.y = 0;
        s.vy = s.vy < -R * 3 ? -s.vy * 0.32 : 0;
        s.vtilt += 0.9;
      }
    }
    s.theta -= (s.vx * dt) / R;
    // покачивание на ребре — пружина с затуханием
    s.vtilt += (-70 * s.tilt - 7 * s.vtilt) * dt;
    s.tilt += s.vtilt * dt;

    const onFloor = s.y === 0 && s.vy === 0;
    if (mode === 'free' && onFloor && Math.abs(s.vx) < R * 0.15) s.vx = 0;
    // закатили обратно в «0» — встаёт на место
    if (mode === 'free' && introDone && onFloor && Math.abs(s.x - gapX) < R * 0.35 && Math.abs(s.vx) < R * 4) {
      mode = 'home';
      found();
    }
    if (mode === 'free' && !introDone && onFloor && s.vx === 0) {
      introDone = true;
      showPushNote();
    }
    const settling = Math.abs(s.tilt) > 0.002 || Math.abs(s.vtilt) > 0.01;
    return s.vx !== 0 || !onFloor || settling || (mode === 'home' && Math.abs(gapX - s.x) > 0.2);
  }

  /* ---------- подписи от руки ---------- */
  function showPushNote() {
    if (pushedOnce) return;
    const nw = pushNote.offsetWidth, nh = pushNote.offsetHeight;
    const left = Math.max(12, Math.min(W - nw - 12, s.x - R * 0.9 - nw * 0.7));
    const top = Math.max(12, floorY - R * 2 - nh - 4);
    pushNote.style.transform = `translate(${left}px, ${top}px)`;
    pushNote.classList.add('is-on');
  }
  let foundTimer = 0;
  function found() {
    const nw = foundNote.offsetWidth, nh = foundNote.offsetHeight;
    foundNote.style.transform = `translate(${gapX - nw / 2}px, ${Math.max(12, floorY - R * 2 - nh - 14)}px) rotate(-4deg)`;
    foundNote.classList.add('is-on');
    clearTimeout(foundTimer);
    foundTimer = setTimeout(() => foundNote.classList.remove('is-on'), 2600);
    s.vtilt += 1.2;
  }

  /* ---------- толчки: курсор, палец, щелчок ---------- */
  let px = -1e5, py = -1e5, pvx = 0, lastT = 0, cooldown = 0;
  const centerY = () => floorY - s.y - R;

  function push(kick) {
    if (!ready) return;
    const d = Math.hypot(px - s.x, py - centerY());
    if (d > R * (kick ? 1.15 : 1.05)) return;
    const now = performance.now();
    if (!kick && now < cooldown) return;
    cooldown = now + 140;
    const away = Math.sign(s.x - px) || 1;
    let v;
    if (kick) {
      v = away * R * 9;
      s.vy = R * 7;
    } else {
      // быстрый взмах передаёт свою скорость, медленное касание — лёгкий толчок
      v = Math.abs(pvx) > R * 2 && Math.sign(pvx) === away ? pvx * 0.9 : away * R * 5;
      if (Math.abs(v) > R * 12) s.vy = Math.max(s.vy, Math.min(Math.abs(v) * 0.16, R * 6));
    }
    s.vx = Math.max(-R * 26, Math.min(R * 26, v));
    s.vtilt -= away * 0.8;
    if (mode === 'home') { mode = 'free'; foundNote.classList.remove('is-on'); }
    introDone = true;
    if (!pushedOnce) { pushedOnce = true; pushNote.classList.remove('is-on'); }
    wake();
  }

  window.addEventListener('pointermove', e => {
    const dt = Math.max(8, e.timeStamp - lastT) / 1000;
    const vx = px < -1e4 ? 0 : (e.clientX - px) / dt;
    pvx = pvx * 0.4 + vx * 0.6;
    px = e.clientX; py = e.clientY; lastT = e.timeStamp;
    push(false);
  }, { passive: true });
  window.addEventListener('pointerdown', e => {
    px = e.clientX; py = e.clientY; pvx = 0; lastT = e.timeStamp;
    push(true);
  });
  window.addEventListener('pointerup', () => { pvx = 0; });

  /* ---------- отрисовка только когда что-то меняется ---------- */
  let raf = 0, last = 0;
  function frame(t) {
    const dt = Math.min(1 / 30, (t - last) / 1000);
    last = t;
    const moving = ready ? step(dt) : false;
    const lit = lighting.update(dt);
    place();
    renderer.render(scene, camera);
    raf = moving || lit ? requestAnimationFrame(frame) : 0;
  }
  function wake() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', layout);
  window.addEventListener('scroll', layout, { passive: true });
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    root.classList.remove('nf3d');
  });

  /* ---------- загрузка ---------- */
  loadMacaronModel(MODEL_LITE_URL).then(async ({ parts, maps, size }) => {
    const mat = new THREE.MeshStandardMaterial({
      map: maps.map,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: maps.roughnessMap,
      roughness: 0.82,
      metalness: 0,
      envMapIntensity: 0.9,
    });
    spin.add(makePartMesh(parts.bottom, mat), makePartMesh(parts.middle, mat), makePartMesh(parts.top, mat));
    modelSize = size;
    // шрифт мог догрузиться позже — меряем цифры, когда он точно на месте
    await document.fonts.ready;
    s.x = gapX;
    layout();
    try { await renderer.compileAsync(scene, camera); } catch { /* соберётся в первом кадре */ }
    ready = true;
    renderer.render(scene, camera);
    root.classList.add('nf3d');

    // постоял в «0» — и укатился вправо, на свободное место
    const target = gapX + (maxX - gapX) * 0.72;
    if (reduceMotion) {
      mode = 'free';
      s.x = target;
      introDone = true;
      place();
      wake();
      showPushNote();
      return;
    }
    setTimeout(() => {
      if (mode !== 'home' || introDone) return;   // уже толкнули сами
      mode = 'free';
      s.vtilt -= 1.4;
      s.vx = (target - s.x) * 1.35;   // при таком трении остановится как раз у цели
      wake();
    }, 1100);
  }).catch(err => {
    console.warn('404: model failed to load', err);
  });

  layout();
}

// мягкое пятно тени: радиальный градиент на маленьком холсте
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
