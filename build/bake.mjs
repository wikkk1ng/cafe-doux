// Подготовка модели макарона для сайта — всё, что раньше считалось в браузере у каждого посетителя:
//   1) упрощение сетки;
//   2) перенос трансформации узла в вершины;
//   3) поиск собственной оси макарона (PCA) и выравнивание её по Y, центрирование;
//   4) разрез на три части: нижняя половинка, крем, крышечка (по высоте и радиусу);
//   5) сжатые текстуры и meshopt.
// Результат: один меш с тремя примитивами [bottom, middle, top] на общих вершинах;
// размеры и границы крема записаны в extras сцены (в three.js — scene.userData).
//
// node bake.mjs <вход.glb> <выход.glb> <папка текстур> <доля треугольников> <допуск упрощения>
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import jpeg from 'jpeg-js';

const [input, output, texDir = 'tex2', ratio = '0.07', error = '0.0006'] = process.argv.slice(2);

// Границы крема — те же, что были в браузере (замерены по текстуре и радиусу модели Hunyuan3D)
const CREAM_LOW = 0.386;
const CREAM_HIGH = 0.508;
const CREAM_MAX_RADIUS = 0.915;

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const root = doc.getRoot();

await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Number(ratio), error: Number(error) }));

const node = root.listNodes().find(n => n.getMesh());
const prim = node.getMesh().listPrimitives()[0];
const posAcc = prim.getAttribute('POSITION');
const nrmAcc = prim.getAttribute('NORMAL');
const pos = posAcc.getArray();
const nrm = nrmAcc ? nrmAcc.getArray() : null;
const idx = prim.getIndices().getArray();
const vCount = pos.length / 3;

/* ---------- 1. трансформация узла → в вершины ---------- */
const W = node.getWorldMatrix();   // column-major 4×4
for (let i = 0; i < vCount; i++) {
  const x = pos[i*3], y = pos[i*3+1], z = pos[i*3+2];
  pos[i*3]   = W[0]*x + W[4]*y + W[8]*z  + W[12];
  pos[i*3+1] = W[1]*x + W[5]*y + W[9]*z  + W[13];
  pos[i*3+2] = W[2]*x + W[6]*y + W[10]*z + W[14];
  if (nrm) {
    const a = nrm[i*3], b = nrm[i*3+1], c = nrm[i*3+2];
    let nx = W[0]*a + W[4]*b + W[8]*c, ny = W[1]*a + W[5]*b + W[9]*c, nz = W[2]*a + W[6]*b + W[10]*c;
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm[i*3] = nx / l; nrm[i*3+1] = ny / l; nrm[i*3+2] = nz / l;
  }
}
node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);

/* ---------- 2. ось макарона (PCA) и выравнивание по Y ---------- */
let cx = 0, cy = 0, cz = 0;
for (let i = 0; i < vCount; i++) { cx += pos[i*3]; cy += pos[i*3+1]; cz += pos[i*3+2]; }
cx /= vCount; cy /= vCount; cz /= vCount;
const cov = [[0,0,0],[0,0,0],[0,0,0]];
for (let i = 0; i < vCount; i++) {
  const d = [pos[i*3]-cx, pos[i*3+1]-cy, pos[i*3+2]-cz];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += d[a]*d[b];
}
const mul = (m, v) => [0,1,2].map(a => m[a][0]*v[0] + m[a][1]*v[1] + m[a][2]*v[2]);
const unit = v => { const l = Math.hypot(...v) || 1; return v.map(c => c / l); };
let v = unit([0.3, 0.9, 0.2]);
for (let i = 0; i < 200; i++) v = unit(mul(cov, v));
const lam = v.reduce((s, c, a) => s + c * mul(cov, v)[a], 0);
const shifted = [0,1,2].map(a => [0,1,2].map(b => (a === b ? lam : 0) - cov[a][b]));
let axis = unit([0.1, 0.2, 0.9]);
for (let i = 0; i < 300; i++) axis = unit(mul(shifted, axis));
if (axis[1] < 0) axis = axis.map(c => -c);

// поворот, переводящий axis в (0,1,0): формула Родрига
const [ax, ay, az] = axis;
const k = [az, 0, -ax];                       // axis × Y
const s = Math.hypot(...k), c = ay;
let R = [[1,0,0],[0,1,0],[0,0,1]];
if (s > 1e-6) {
  const [kx, ky, kz] = k.map(x => x / s);
  const K = [[0,-kz,ky],[kz,0,-kx],[-ky,kx,0]];
  const K2 = [0,1,2].map(i => [0,1,2].map(j => K[i][0]*K[0][j] + K[i][1]*K[1][j] + K[i][2]*K[2][j]));
  R = [0,1,2].map(i => [0,1,2].map(j => (i === j ? 1 : 0) + s*K[i][j] + (1 - c)*K2[i][j]));
}
const rot = (arr, i) => {
  const x = arr[i*3], y = arr[i*3+1], z = arr[i*3+2];
  arr[i*3]   = R[0][0]*x + R[0][1]*y + R[0][2]*z;
  arr[i*3+1] = R[1][0]*x + R[1][1]*y + R[1][2]*z;
  arr[i*3+2] = R[2][0]*x + R[2][1]*y + R[2][2]*z;
};
for (let i = 0; i < vCount; i++) { rot(pos, i); if (nrm) rot(nrm, i); }

/* ---------- 3. центрирование ---------- */
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < vCount; i++) for (let a = 0; a < 3; a++) { const x = pos[i*3+a]; if (x < min[a]) min[a] = x; if (x > max[a]) max[a] = x; }
const ctr = [0,1,2].map(a => (min[a] + max[a]) / 2);
for (let i = 0; i < vCount; i++) for (let a = 0; a < 3; a++) pos[i*3+a] -= ctr[a];
const size = [0,1,2].map(a => max[a] - min[a]);
posAcc.setArray(pos);
if (nrm) nrmAcc.setArray(nrm);

/* ---------- 4. разрез на три части ---------- */
// Шаг 1 — грубая разметка. Крем — то, что лежит в полосе по высоте и светлое по текстуре:
// у крема отношение зелёного к красному 0.6–0.9 (края затенены), у розовой юбочки ≈ 0.53, у стыка ≈ 0.42.
// Шаг 2 — сглаживание: треугольник переходит к части, к которой принадлежит большинство соседей.
// Шаг 3 — островки: мелкие оторванные кусочки отходят к соседней части.
const yLow = -size[1] / 2 + size[1] * CREAM_LOW;
const yHigh = -size[1] / 2 + size[1] * CREAM_HIGH;
let rMax = 0;
for (let i = 0; i < vCount; i++) rMax = Math.max(rMax, Math.hypot(pos[i*3], pos[i*3+2]));
const rCut = rMax * CREAM_MAX_RADIUS;
const yMid = (yLow + yHigh) / 2;
const triCount = idx.length / 3;
const label = new Uint8Array(triCount);

// текстура цвета — чтобы видеть, крем под треугольником или юбочка
const baseImg = jpeg.decode(fs.readFileSync(`${texDir}/base.jpg`), { useTArray: true });
const uvAcc = prim.getAttribute('TEXCOORD_0');
const uv = uvAcc.getArray();
const uvScale = uvAcc.getNormalized() ? (uv instanceof Uint16Array ? 65535 : 255) : 1;
function creamAt(u, v) {
  const x = Math.min(baseImg.width - 1, Math.max(0, Math.round((u / uvScale) * (baseImg.width - 1))));
  const y = Math.min(baseImg.height - 1, Math.max(0, Math.round((v / uvScale) * (baseImg.height - 1))));
  const i = (y * baseImg.width + x) * 4;
  const r = baseImg.data[i], g = baseImg.data[i + 1], b = baseImg.data[i + 2];
  // крем со своими тёплыми затенёнными краями: зелёный/красный 0.6–0.9 и синего меньше, чем зелёного.
  // Светло-розовая кромка юбочки тоже бывает 0.6+, но у неё синего больше зелёного — её отсекаем.
  return g / Math.max(r, 1) > 0.58 && b < g * 0.98;
}
// полоса по высоте чуть шире прежней — цвет сам отсечёт лишнее
const bandLow = yLow - size[1] * 0.03, bandHigh = yHigh + size[1] * 0.03;

for (let t = 0; t < triCount; t++) {
  const a = idx[t*3], b = idx[t*3+1], d = idx[t*3+2];
  const x = (pos[a*3] + pos[b*3] + pos[d*3]) / 3;
  const y = (pos[a*3+1] + pos[b*3+1] + pos[d*3+1]) / 3;
  const z = (pos[a*3+2] + pos[b*3+2] + pos[d*3+2]) / 3;
  const r = Math.hypot(x, z);
  const u = (uv[a*2] + uv[b*2] + uv[d*2]) / 3, v = (uv[a*2+1] + uv[b*2+1] + uv[d*2+1]) / 3;
  const inBand = y >= bandLow && y <= bandHigh && r < rMax * 0.97 && creamAt(u, v);
  label[t] = inBand ? 1 : (y < yMid ? 0 : 2);
}
const rough = [0, 0, 0];
for (let t = 0; t < triCount; t++) rough[label[t]]++;

// соседство треугольников по общим рёбрам (вершины сварены по позиции — швы UV не мешают)
const q = 1e5, keyOf = new Map(), weldId = new Int32Array(vCount);
let uniq = 0;
for (let i = 0; i < vCount; i++) {
  const k = Math.round(pos[i*3]*q) + ',' + Math.round(pos[i*3+1]*q) + ',' + Math.round(pos[i*3+2]*q);
  let id = keyOf.get(k); if (id === undefined) { id = uniq++; keyOf.set(k, id); } weldId[i] = id;
}
const edgeOwner = new Map();
const nbr = Array.from({ length: triCount }, () => []);
for (let t = 0; t < triCount; t++) {
  for (let e = 0; e < 3; e++) {
    const v1 = weldId[idx[t*3 + e]], v2 = weldId[idx[t*3 + (e + 1) % 3]];
    const key = v1 < v2 ? v1 * 4194304 + v2 : v2 * 4194304 + v1;
    const other = edgeOwner.get(key);
    if (other === undefined) edgeOwner.set(key, t);
    else { nbr[t].push(other); nbr[other].push(t); }
  }
}

// сглаживание границы: несколько проходов «как у большинства соседей»
let flips = 0;
for (let pass = 0; pass < 4; pass++) {
  const next = label.slice();
  for (let t = 0; t < triCount; t++) {
    const c = [0, 0, 0];
    for (const n of nbr[t]) c[label[n]]++;
    const best = c.indexOf(Math.max(...c));
    if (best !== label[t] && c[best] >= 2) { next[t] = best; flips++; }
  }
  label.set(next);
}

// островки: связные куски части меньше 1.5% её размера отходят к соседней части
let islands = 0, islandTris = 0;
const seen = new Uint8Array(triCount);
const sizeOf = [0, 0, 0];
for (let t = 0; t < triCount; t++) sizeOf[label[t]]++;
for (let t = 0; t < triCount; t++) {
  if (seen[t]) continue;
  const lab = label[t], comp = [t], around = [0, 0, 0];
  seen[t] = 1;
  for (let i = 0; i < comp.length; i++) {
    for (const n of nbr[comp[i]]) {
      if (label[n] === lab) { if (!seen[n]) { seen[n] = 1; comp.push(n); } }
      else around[label[n]]++;
    }
  }
  if (comp.length < sizeOf[lab] * 0.015) {
    around[lab] = -1;
    const to = around.indexOf(Math.max(...around));
    for (const c of comp) label[c] = to;
    islands++; islandTris += comp.length;
  }
}

const buckets = [[], [], []];
const creamRadii = [];
for (let t = 0; t < triCount; t++) {
  const a = idx[t*3], b = idx[t*3+1], d = idx[t*3+2];
  buckets[label[t]].push(a, b, d);
  if (label[t] === 1) {
    const x = (pos[a*3] + pos[b*3] + pos[d*3]) / 3, z = (pos[a*3+2] + pos[b*3+2] + pos[d*3+2]) / 3;
    creamRadii.push(Math.hypot(x, z));
  }
}
creamRadii.sort((p, q2) => p - q2);
const creamRadius = creamRadii[Math.floor(creamRadii.length / 2)];
// где прослойка на самом деле начинается и заканчивается (по вершинам крема, без крайних выбросов)
const creamYs = [];
for (const v of buckets[1]) creamYs.push(pos[v*3+1]);
creamYs.sort((p, q2) => p - q2);
const cutLow = creamYs[Math.floor(creamYs.length * 0.005)];
const cutHigh = creamYs[Math.floor(creamYs.length * 0.995)];
console.log('разрез:', { грубо: rough, сглажено_треугольников: flips, островков: islands, в_них_треугольников: islandTris });

const mesh = node.getMesh();
const material = prim.getMaterial();
const attrs = prim.listSemantics().map(sem => [sem, prim.getAttribute(sem)]);
mesh.removePrimitive(prim);
const names = ['bottom', 'middle', 'top'];
buckets.forEach((list, i) => {
  const ia = doc.createAccessor(names[i] + '-indices').setType('SCALAR').setArray(new Uint32Array(list)).setBuffer(root.listBuffers()[0]);
  const p = doc.createPrimitive().setIndices(ia).setMaterial(material);
  for (const [sem, acc] of attrs) p.setAttribute(sem, acc);
  mesh.addPrimitive(p);
});
mesh.setName('macaron');
node.setName('macaron');
prim.dispose();

root.getDefaultScene().setExtras({
  parts: names,
  size, yLow: cutLow, yHigh: cutHigh, creamRadius,
});

/* ---------- 5. текстуры и сжатие ---------- */
const tex = (name, file) => doc.createTexture(name).setImage(fs.readFileSync(`${texDir}/${file}`)).setMimeType('image/jpeg').setURI(file);
const base = tex('base', 'base.jpg'), normal = tex('normal', 'normal.jpg'), mr = tex('mr', 'mr.jpg');
material.setBaseColorTexture(base).setNormalTexture(normal).setMetallicRoughnessTexture(mr)
  .setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1);

doc.createExtension(EXTMeshoptCompression).setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await doc.transform(prune(), dedup(), quantize(), reorder({ encoder: MeshoptEncoder }));
await io.write(output, doc);

console.log(output.split('/').pop(), {
  triangles: idx.length / 3,
  parts: buckets.map((b, i) => `${names[i]} ${b.length / 3}`),
  axisTiltDeg: +(Math.acos(axis[1]) * 180 / Math.PI).toFixed(2),
  size: size.map(x => +x.toFixed(4)), cutLow: +cutLow.toFixed(4), cutHigh: +cutHigh.toFixed(4), creamRadius: +creamRadius.toFixed(4),
  MB: +(fs.statSync(output).size / 1e6).toFixed(2),
});
