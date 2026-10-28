// Café Doux — 3D-сцена конструктора коробки.
// Грузится отдельно (см. box.js), когда раздел подходит к экрану: интерфейс работает и без неё.
// Коробка строится кодом (ячейки точно под 6 и 12 штук), макаронс — облегчённая модель,
// перекрашенная под вкус.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadMacaronModel, makeFlavorMaterial, makePartMesh, isLiteDevice, createThemeLighting, MODEL_LITE_URL, LUM_SHELL, LUM_CREAM } from './macaron-model.js';
import { FLAVORS } from './flavors.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* =========================================================
   3D-сцена
   ========================================================= */

// ctx: { stage, canvas, getState, spec, flavorById, onRemove, onReady }
export function createBoxScene(ctx) {
  const { stage, canvas, flavorById } = ctx;
  const spec = ctx.spec;
  const removeAt = i => ctx.onRemove(i);
  // облегчённый режим для телефонов и слабых устройств
  const lite = isLiteDevice();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lite ? 1.25 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 100);

  const key = new THREE.DirectionalLight(0xffe6c8, 2.4);
  key.position.set(-3, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  key.shadow.radius = 4;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const hemi = new THREE.HemisphereLight(0xfff4e4, 0x6b4a36, 0.7);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xffd9c4, 0.6);
  fill.position.set(4, 3, -2);
  scene.add(fill);

  // вечером — тёплая лампа; свет перетекает вместе с темой страницы
  let themeChanged = false;
  const lighting = createThemeLighting({
    renderer, scene,
    lights: [
      { light: key, day: { color: 0xffe6c8, intensity: 2.4, position: [-3, 7, 4] }, evening: { color: 0xffad66, intensity: 2.9, position: [-4, 5, 3] } },
      { light: hemi, day: { color: 0xfff4e4, ground: 0x6b4a36, intensity: 0.7 }, evening: { color: 0x7a4e34, ground: 0x120a06, intensity: 0.32 } },
      { light: fill, day: { color: 0xffd9c4, intensity: 0.6, position: [4, 3, -2] }, evening: { color: 0xff9a5c, intensity: 0.25, position: [4, 3, -2] } },
    ],
    env: { day: 0.5, evening: 0.18 },
    exposure: { day: 1.05, evening: 1.0 },
    onChange: () => { themeChanged = true; },
  });

  /* ---------- материалы ---------- */
  const kraftTex = makeKraftTexture();
  const kraft = new THREE.MeshStandardMaterial({ map: kraftTex, roughness: 0.92, metalness: 0 });
  const kraftDark = new THREE.MeshStandardMaterial({ map: kraftTex, color: 0xd9c2a2, roughness: 0.92 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xF6EEE2, roughness: 0.85, side: THREE.DoubleSide });
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });

  /* ---------- размеры (единицы: диаметр макарона ≈ 1) ---------- */
  const PITCH = 1.34, CUP_R = 0.56, CUP_H = 0.24, TRAY_Y = 0.34, WALL_H = 0.6, WALL_T = 0.07, PAD = 0.2;

  const boxGroup = new THREE.Group();
  scene.add(boxGroup);
  const macGroup = new THREE.Group();
  scene.add(macGroup);

  let slotPos = [];       // позиции ячеек (x, z)
  let proxies = [];       // невидимые цилиндры для клика
  let slotObjs = [];      // макароны в ячейках
  let model = null;
  let macScale = 1, macHalfH = 0.3;
  const matCache = {};

  /* ---------- коробка ---------- */
  function roundedRect(w, d, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  // форма в плоскости XY → лежит на полу и вытягивается вверх
  function slab(shape, depth, y) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 48 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  }
  function pleatedCup() {
    const g = new THREE.CylinderGeometry(CUP_R, CUP_R * 0.84, CUP_H, 120, 1, true);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + Math.sin(a * 30) * 0.018;          // гофра бумажной формочки
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    g.computeVertexNormals();
    const bottom = new THREE.CircleGeometry(CUP_R * 0.84, 48);
    bottom.rotateX(-Math.PI / 2);
    bottom.translate(0, -CUP_H / 2 + 0.002, 0);
    return [g, bottom];
  }
  const [cupWallGeo, cupBottomGeo] = pleatedCup();

  function buildBox() {
    boxGroup.clear();
    proxies = [];
    const { cols, rows } = spec();
    const innerW = cols * PITCH + PAD * 2;
    const innerD = rows * PITCH + PAD * 2;
    const outerW = innerW + WALL_T * 2, outerD = innerD + WALL_T * 2;

    slotPos = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        slotPos.push(new THREE.Vector2((c - (cols - 1) / 2) * PITCH, (r - (rows - 1) / 2) * PITCH));
      }
    }

    // дно и стенки из крафта
    const floor = new THREE.Mesh(slab(roundedRect(outerW, outerD, 0.12), 0.05, 0), kraftDark);
    floor.receiveShadow = true;
    const wallShape = roundedRect(outerW, outerD, 0.12);
    wallShape.holes.push(roundedRect(innerW, innerD, 0.06));
    const walls = new THREE.Mesh(slab(wallShape, WALL_H, 0), kraft);
    walls.castShadow = walls.receiveShadow = true;

    // вкладыш с отверстиями
    const trayShape = roundedRect(innerW, innerD, 0.06);
    slotPos.forEach(p => {
      const hole = new THREE.Path();
      hole.absarc(p.x, -p.y, CUP_R, 0, Math.PI * 2, true);
      trayShape.holes.push(hole);
    });
    const tray = new THREE.Mesh(slab(trayShape, 0.025, TRAY_Y - 0.025), paper);
    tray.receiveShadow = true;
    boxGroup.add(floor, walls, tray);

    // бумажные формочки и невидимые цели для клика
    slotPos.forEach((p, i) => {
      const cup = new THREE.Mesh(cupWallGeo, paper);
      const bottom = new THREE.Mesh(cupBottomGeo, paper);
      cup.position.set(p.x, TRAY_Y - CUP_H / 2, p.y);
      bottom.position.copy(cup.position);
      cup.receiveShadow = bottom.receiveShadow = true;
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(CUP_R, CUP_R, 1.2, 16), proxyMat);
      proxy.position.set(p.x, TRAY_Y + 0.2, p.y);
      proxy.userData.slot = i;
      proxies.push(proxy);
      boxGroup.add(cup, bottom, proxy);
    });

    // тень — по размеру коробки
    const sc = key.shadow.camera;
    const half = Math.max(outerW, outerD) * 0.75;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 0.5; sc.far = 20;
    sc.updateProjectionMatrix();

    frameCamera(outerW, outerD);
  }

  function frameCamera(w, d) {
    const aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
    camera.aspect = aspect;
    const elev = THREE.MathUtils.degToRad(52);
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const radius = 0.5 * Math.hypot(w, d) + 0.25;
    // коробка лежит под углом, её проекция заметно меньше описанной сферы — подходим ближе
    const dist = radius / Math.sin(Math.min(vfov, hfov) / 2) * 0.74;
    const target = new THREE.Vector3(0, 0.2, 0.15);
    camera.position.set(0, target.y + Math.sin(elev) * dist, target.z + Math.cos(elev) * dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }

  /* ---------- макароны ---------- */
  function materialsFor(id) {
    if (!matCache[id]) {
      const f = flavorById[id];
      // в коробке скорлупки матовее, чем в первом экране: без «пластикового» блеска
      matCache[id] = {
        shell: makeFlavorMaterial(model.maps, f.shell, LUM_SHELL, { clearcoat: 0.08, roughness: 0.88, sheen: 0.35 }, lite),
        cream: makeFlavorMaterial(model.maps, f.cream, LUM_CREAM, { clearcoat: 0.05, roughness: 0.75, sheen: 0.25 }, lite),
      };
    }
    return matCache[id];
  }

  function makeMacaron(id) {
    const { shell, cream } = materialsFor(id);
    const g = new THREE.Group();
    for (const [part, mat] of [['bottom', shell], ['middle', cream], ['top', shell]]) {
      const m = makePartMesh(model.parts[part], mat);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    g.scale.setScalar(macScale);
    return g;
  }

  const restY = () => TRAY_Y - CUP_H + 0.03 + macHalfH;

  // анимации: { obj, from, to, t, dur, delay, kind }
  const anims = [];
  let dirty = true;

  function dropIn(i, id, delay = 0) {
    if (!model) return;               // модель ещё грузится — расставим при готовности
    removeObj(i, true);
    const obj = makeMacaron(id);
    const p = slotPos[i];
    const spinY = Math.random() * Math.PI * 2;
    obj.position.set(p.x, restY() + (reduceMotion ? 0 : 2.6), p.y);
    obj.rotation.set(reduceMotion ? 0 : 0.5, spinY, reduceMotion ? 0 : -0.3);
    macGroup.add(obj);
    slotObjs[i] = obj;
    if (reduceMotion) { obj.position.y = restY(); dirty = true; return; }
    anims.push({ obj, kind: 'drop', t: -delay, dur: 0.75, spinY });
    dirty = true;
  }

  function liftOut(i) {
    const obj = slotObjs[i];
    if (!obj) return;
    slotObjs[i] = null;
    if (reduceMotion) { macGroup.remove(obj); dirty = true; return; }
    anims.push({ obj, kind: 'lift', t: 0, dur: 0.38, y0: obj.position.y });
    dirty = true;
  }

  function removeObj(i) {
    const obj = slotObjs[i];
    if (obj) { macGroup.remove(obj); slotObjs[i] = null; }
  }

  function placeAllInstantly() {
    macGroup.clear();
    anims.length = 0;
    slotObjs = [];
    ctx.getState().slots.forEach((id, i) => {
      if (!id) return;
      const obj = makeMacaron(id);
      obj.position.set(slotPos[i].x, restY(), slotPos[i].y);
      obj.rotation.y = (i * 1.7) % (Math.PI * 2);
      macGroup.add(obj);
      slotObjs[i] = obj;
    });
    dirty = true;
  }

  function rebuild(animated) {
    buildBox();
    if (!model) return;
    if (!animated || reduceMotion) { placeAllInstantly(); return; }
    // при смене размера макароны «перепрыгивают» в новые ячейки
    macGroup.clear();
    anims.length = 0;
    slotObjs = [];
    ctx.getState().slots.forEach((id, i) => { if (id) dropIn(i, id, i * 0.05); });
  }

  const easeOutBack = t => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

  function stepAnims(dt) {
    for (let k = anims.length - 1; k >= 0; k--) {
      const a = anims[k];
      a.t += dt;
      if (a.t < 0) continue;
      const u = Math.min(1, a.t / a.dur);
      if (a.kind === 'drop') {
        const y = restY();
        a.obj.position.y = y + 2.6 * (1 - easeOutBack(u));
        a.obj.rotation.x = 0.5 * (1 - u) * (1 - u);
        a.obj.rotation.z = -0.3 * (1 - u) * (1 - u);
      } else {
        a.obj.position.y = a.y0 + 1.4 * u * u;
        a.obj.scale.setScalar(macScale * (1 - u * 0.6));
        a.obj.traverse(o => { if (o.material) o.visible = u < 0.98; });
        if (u >= 1) macGroup.remove(a.obj);
      }
      if (u >= 1) anims.splice(k, 1);
    }
  }

  /* ---------- наведение и клик ---------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = -1;

  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(proxies, false)[0];
    const i = hit ? hit.object.userData.slot : -1;
    return i >= 0 && slotObjs[i] ? i : -1;
  }
  canvas.addEventListener('pointermove', e => {
    const i = pick(e);
    if (i === hovered) return;
    hovered = i;
    canvas.classList.toggle('is-hover', i >= 0);
    dirty = true;
  });
  canvas.addEventListener('pointerleave', () => { hovered = -1; canvas.classList.remove('is-hover'); dirty = true; });
  canvas.addEventListener('click', e => {
    const i = pick(e);
    if (i >= 0) { hovered = -1; canvas.classList.remove('is-hover'); removeAt(i); }
  });

  /* ---------- размер холста ---------- */
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const { cols, rows } = spec();
    frameCamera(cols * PITCH + PAD * 2 + WALL_T * 2, rows * PITCH + PAD * 2 + WALL_T * 2);
    dirty = true;
  }
  new ResizeObserver(resize).observe(stage);

  /* ---------- цикл: рисуем только когда что-то меняется ---------- */
  let visible = false;
  const clock = new THREE.Clock();
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!visible) return;

    // наведённый макарон чуть приподнимается
    let moving = anims.length > 0;
    if (lighting.update(dt) || themeChanged) { moving = true; themeChanged = false; }
    slotObjs.forEach((obj, i) => {
      if (!obj || anims.some(a => a.obj === obj)) return;
      const target = restY() + (i === hovered ? 0.14 : 0);
      const d = target - obj.position.y;
      if (Math.abs(d) > 0.001) { obj.position.y += d * Math.min(1, dt * 12); moving = true; }
    });
    if (anims.length) stepAnims(dt);
    if (moving || dirty) { renderer.render(scene, camera); dirty = false; }
  }

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) dirty = true;
  }, { rootMargin: '100px 0px' }).observe(stage);

  // видеокарта может «потерять» контекст — возвращаем запасной вид
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    canvas.classList.remove('is-ready');
    document.documentElement.classList.remove('box3d-ready');
  });

  buildBox();
  resize();
  loadMacaronModel(MODEL_LITE_URL).then(async m => {
    model = m;
    const diameter = Math.max(m.size.x, m.size.z);
    macScale = (CUP_R * 2 * 0.9) / diameter;
    macHalfH = (m.size.y * macScale) / 2;
    placeAllInstantly();
    // шейдеры всех вкусов собираем заранее и в фоне — без рывка при первом нажатии
    FLAVORS.forEach(f => materialsFor(f.id));
    const warm = new THREE.Group();
    FLAVORS.forEach(f => warm.add(makeMacaron(f.id)));
    warm.position.y = -50;
    scene.add(warm);
    try { await renderer.compileAsync(scene, camera); } catch { /* соберутся при первом кадре */ }
    scene.remove(warm);
    dirty = true;
    requestAnimationFrame(() => {
      canvas.classList.add('is-ready');
      document.documentElement.classList.add('box3d-ready');
      if (ctx.onReady) ctx.onReady();
    });
  }).catch(err => console.warn('Box: model failed to load', err));
  tick();

  return { dropIn, liftOut, rebuild };
}

/* =========================================================
   Крафт-текстура: тёплый картон с волокнами
   ========================================================= */
function makeKraftTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#C79F6E';
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i] += n; img.data[i + 1] += n * 0.85; img.data[i + 2] += n * 0.6;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 900; i++) {
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '90,60,30' : '235,210,170'},${0.08 + Math.random() * 0.12})`;
    g.lineWidth = 0.6 + Math.random();
    const x = Math.random() * 512, y = Math.random() * 512, l = 6 + Math.random() * 22, a = Math.random() * Math.PI;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.5, 1.5);
  return t;
}
