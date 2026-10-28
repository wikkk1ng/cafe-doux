// Café Doux — загрузка 3D-модели макарона.
// Всё тяжёлое (выравнивание оси, центрирование, разрез на слои) сделано заранее
// скриптом build/bake.mjs: в файле уже лежат три части [bottom, middle, top],
// а размеры и границы крема записаны в scene.userData. Браузеру остаётся только загрузить.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// пути считаются от самого модуля, чтобы модель находилась с любой страницы
export const MODEL_URL = new URL('../assets/macaron-v2.glb', import.meta.url).href;
// облегчённая версия (21 тыс. полигонов, текстуры 1024) — для коробки, телефонов и слабых устройств
export const MODEL_LITE_URL = new URL('../assets/macaron-lite.glb', import.meta.url).href;

const cache = new Map();

// { parts: { bottom, middle, top } — каждая { geometry, matrix }, maps, size, yLow, yHigh, creamRadius }
export function loadMacaronModel(url = MODEL_URL) {
  if (cache.has(url)) return cache.get(url);
  const promise = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(url, gltf => {
      const meta = gltf.scene.userData || {};
      const root = gltf.scene.getObjectByName('macaron');
      if (!root || !Array.isArray(meta.parts)) { reject(new Error('Модель не подготовлена: запустите build/bake.mjs')); return; }

      // Сжатые вершины хранятся вместе с трансформацией узла — её переносим в матрицу части
      gltf.scene.updateMatrixWorld(true);
      const meshes = [];
      root.traverse(o => { if (o.isMesh) meshes.push(o); });
      const parts = {};
      meta.parts.forEach((name, i) => {
        parts[name] = { geometry: meshes[i].geometry, matrix: meshes[i].matrixWorld.clone() };
      });

      const m = meshes[0].material;
      resolve({
        parts,
        maps: { map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap },
        size: new THREE.Vector3().fromArray(meta.size),
        yLow: meta.yLow,
        yHigh: meta.yHigh,
        creamRadius: meta.creamRadius,
      });
    }, undefined, reject);
  });
  cache.set(url, promise);
  // при ошибке даём шанс повторить загрузку позже
  promise.catch(() => cache.delete(url));
  return promise;
}

// меш части модели с правильной матрицей (в координатах подготовленной модели)
export function makePartMesh(part, material) {
  const mesh = new THREE.Mesh(part.geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(part.matrix);
  return mesh;
}

/* ---------- перекраска под вкус ---------- */
// Средняя яркость текстуры (в линейном цвете): у розовой скорлупки ~0.50, у крема ~0.64.
// Перекраска сохраняет светотень текстуры (яркость относительно средней) и заменяет цвет.
export const LUM_SHELL = 0.5;
export const LUM_CREAM = 0.64;

// tint — цвет вкуса (hex, sRGB) или null, чтобы оставить исходную текстуру.
// lite: true — простой материал без лака и бархатного отлива (телефоны и слабые устройства)
export function makeFlavorMaterial(maps, tint, lumRef, extra = {}, lite = false) {
  const common = {
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: maps.roughnessMap,
    roughness: 0.82,
    metalness: 0,
    envMapIntensity: 0.9,
  };
  let mat;
  if (lite) {
    const { clearcoat, clearcoatRoughness, sheen, sheenRoughness, sheenColor, ...rest } = extra;
    mat = new THREE.MeshStandardMaterial({ ...common, ...rest });
  } else {
    mat = new THREE.MeshPhysicalMaterial({
      ...common,
      clearcoat: 0.22,
      clearcoatRoughness: 0.55,
      sheen: 0.5,
      sheenRoughness: 0.7,
      sheenColor: tint ? new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.5) : new THREE.Color(0xffd9cf),
      ...extra,
    });
  }
  if (!tint) return mat;

  const color = new THREE.Color(tint);   // хранится в линейном пространстве
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTint = { value: new THREE.Vector3(color.r, color.g, color.b) };
    shader.uniforms.uLumRef = { value: lumRef };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform vec3 uTint;
uniform float uLumRef;
void main() {`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float flavorLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = uTint * clamp(flavorLum / uLumRef, 0.0, 1.6);`);
  };
  mat.customProgramCacheKey = () => 'flavor-' + tint + '-' + lumRef + (lite ? '-lite' : '');
  return mat;
}

/* ---------- уровень устройства ---------- */
// Телефон, планшет или слабый компьютер — облегчённый режим: лёгкая модель, простые материалы,
// меньше разрешение рендера и тени.
export function isLiteDevice() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.matchMedia('(max-width: 860px)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  return coarse || narrow || cores <= 4 || memory <= 4;
}

/* ---------- дневной и вечерний свет ---------- */
// Плавно ведёт освещение 3D-сцены за темой страницы (data-theme на <html>).
// lights: [{ light, day: { color, intensity, position?, ground? }, evening: {…} }]
// env / exposure: { day, evening } — яркость окружения и экспозиция.
export function createThemeLighting({ renderer, scene, lights, env, exposure, onChange }) {
  const root = document.documentElement;
  const isEvening = () => root.dataset.theme === 'evening';
  let mix = isEvening() ? 1 : 0;
  let target = mix;
  const prepared = lights.map(({ light, day, evening }) => ({
    light,
    day, evening,
    cDay: new THREE.Color(day.color), cEve: new THREE.Color(evening.color),
    gDay: day.ground !== undefined ? new THREE.Color(day.ground) : null,
    gEve: evening.ground !== undefined ? new THREE.Color(evening.ground) : null,
  }));
  const lerp = (a, b, t) => a + (b - a) * t;

  function apply() {
    const t = mix * mix * (3 - 2 * mix);   // плавный старт и финиш
    for (const p of prepared) {
      p.light.color.lerpColors(p.cDay, p.cEve, t);
      p.light.intensity = lerp(p.day.intensity, p.evening.intensity, t);
      if (p.gDay) p.light.groundColor.lerpColors(p.gDay, p.gEve, t);
      if (p.day.position) p.light.position.set(...p.day.position.map((v, i) => lerp(v, p.evening.position[i], t)));
    }
    scene.environmentIntensity = lerp(env.day, env.evening, t);
    renderer.toneMappingExposure = lerp(exposure.day, exposure.evening, t);
  }

  new MutationObserver(() => {
    target = isEvening() ? 1 : 0;
    if (onChange) onChange();
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  apply();

  return {
    // вызывать каждый кадр; true — свет ещё меняется (нужна перерисовка)
    update(dt) {
      if (mix === target) return false;
      const step = dt / 0.8;
      mix = target > mix ? Math.min(target, mix + step) : Math.max(target, mix - step);
      apply();
      return true;
    },
  };
}
