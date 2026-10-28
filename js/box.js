// Café Doux — конструктор коробки макаронс: состояние, интерфейс, заказ.
// 3D-сцена (box-scene.js) подгружается отдельно, когда раздел подходит к экрану.
// До этого и при любом сбое 3D коробка показана простой схемой — заказ собрать можно всегда.
import { FLAVORS, BOXES } from './flavors.js';

// username Telegram-аккаунта кофейни, куда приходят заказы (без @).
// Пока пусто — кнопка копирует заказ и подсказывает, что Telegram не подключён.
const TELEGRAM_USERNAME = '';
const STORAGE_KEY = 'cafedoux-box-v1';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);
const stage = $('boxStage');
const canvas = $('boxCanvas');
if (!stage || !canvas) throw new Error('Нет разметки конструктора');

const flavorById = Object.fromEntries(FLAVORS.map(f => [f.id, f]));
const rub = n => n.toLocaleString('ru-RU') + ' ₽';

/* =========================================================
   Состояние
   ========================================================= */

let state = loadState() || { size: 6, slots: Array(6).fill(null), note: '' };

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!s || !BOXES.some(b => b.size === s.size) || !Array.isArray(s.slots) || s.slots.length !== s.size) return null;
    s.slots = s.slots.map(id => (id && flavorById[id] ? id : null));
    s.note = typeof s.note === 'string' ? s.note.slice(0, 120) : '';
    return s;
  } catch { return null; }
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* приватный режим — не страшно */ }
}

const spec = () => BOXES.find(b => b.size === state.size);
const filled = () => state.slots.filter(Boolean).length;

/* =========================================================
   Интерфейс
   ========================================================= */

const flavorList = $('flavorList');
const slotList = $('slotList');
const live = $('boxLive');
const note = $('boxNote');
const sendBtn = $('boxSend');
const copyBtn = $('boxCopy');

const fallback = document.createElement('div');
fallback.className = 'box__fallback';
fallback.setAttribute('aria-hidden', 'true');
stage.appendChild(fallback);

const toast = document.createElement('p');
toast.className = 'box__toast';
toast.hidden = true;
sendBtn.closest('.box__summary').appendChild(toast);

FLAVORS.forEach(f => {
  const li = document.createElement('li');
  li.innerHTML = `
    <button type="button" class="flavor" data-id="${f.id}" aria-label="Положить в коробку: ${f.name}, ${f.ru}">
      <span class="flavor__dot" style="background:${f.swatch}"></span>
      <span class="flavor__name">${f.name}</span>
      <span class="flavor__ru">${f.ru}</span>
    </button>`;
  flavorList.appendChild(li);
});

flavorList.addEventListener('click', e => {
  const btn = e.target.closest('.flavor');
  if (btn) addFlavor(btn.dataset.id);
});
slotList.addEventListener('click', e => {
  const btn = e.target.closest('button[data-slot]');
  if (btn) removeAt(Number(btn.dataset.slot));
});
document.querySelectorAll('input[name="boxSize"]').forEach(r => {
  r.checked = Number(r.value) === state.size;
  r.addEventListener('change', () => setSize(Number(r.value)));
});
$('boxRandom').addEventListener('click', fillRandom);
$('boxClear').addEventListener('click', clearAll);
note.value = state.note;
note.addEventListener('input', () => { state.note = note.value; updateUI(); });
sendBtn.addEventListener('click', sendOrder);
copyBtn.addEventListener('click', () => copyOrder(false));

function announce(text) {
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = text; });
}

function updateUI() {
  const n = filled(), total = state.size, left = total - n;
  $('boxCounter').textContent = `${n} из ${total}`;
  $('boxStatus').textContent = left ? `Осталось выбрать ${left}` : 'Коробка собрана';
  $('boxPrice').textContent = rub(spec().price);
  $('boxNoteCount').textContent = `${note.value.length} / 120`;
  $('boxHint').hidden = n === 0;
  sendBtn.disabled = copyBtn.disabled = left > 0;
  toast.hidden = true;   // коробка изменилась — подсказка про прошлый заказ уже неактуальна
  flavorList.querySelectorAll('.flavor').forEach(b => { b.disabled = left === 0; });

  renderFallback();
  slotList.innerHTML = state.slots.map((id, i) => id
    ? `<li><button type="button" data-slot="${i}">Ячейка ${i + 1}: ${flavorById[id].name}. Убрать</button></li>`
    : `<li>Ячейка ${i + 1}: пусто</li>`).join('');
  saveState();
}

/* ---------- действия ---------- */

function addFlavor(id) {
  const i = state.slots.indexOf(null);
  if (i === -1) { announce('Коробка уже заполнена'); return; }
  state.slots[i] = id;
  scene3d.dropIn(i, id);
  updateUI();
  const left = state.size - filled();
  announce(`${flavorById[id].name} — в ячейку ${i + 1}. ${left ? 'Осталось ' + left : 'Коробка собрана'}`);
}

function removeAt(i) {
  const id = state.slots[i];
  if (!id) return;
  state.slots[i] = null;
  scene3d.liftOut(i);
  updateUI();
  announce(`${flavorById[id].name} убран из ячейки ${i + 1}`);
}

function setSize(size) {
  if (size === state.size) return;
  // уже выбранные вкусы переезжают в новую коробку по порядку
  const chosen = state.slots.filter(Boolean).slice(0, size);
  state.size = size;
  state.slots = Array.from({ length: size }, (_, i) => chosen[i] || null);
  scene3d.rebuild(true);
  updateUI();
  announce(`Коробка на ${size} штук`);
}

function fillRandom() {
  let delay = 0;
  state.slots.forEach((id, i) => {
    if (id) return;
    const pick = FLAVORS[Math.floor(Math.random() * FLAVORS.length)].id;
    state.slots[i] = pick;
    scene3d.dropIn(i, pick, delay);
    delay += reduceMotion ? 0 : 0.09;
  });
  updateUI();
  announce('Коробка собрана случайными вкусами');
}

function clearAll() {
  state.slots.forEach((id, i) => { if (id) scene3d.liftOut(i); });
  state.slots = state.slots.map(() => null);
  updateUI();
  announce('Коробка очищена');
}

/* ---------- заказ ---------- */

function orderText() {
  const counts = {};
  state.slots.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
  const lines = FLAVORS.filter(f => counts[f.id]).map(f => `• ${f.name} — ${counts[f.id]} шт.`);
  const parts = [
    `Здравствуйте! Хочу заказать коробку макаронс на ${state.size} штук:`,
    ...lines,
  ];
  if (state.note.trim()) parts.push('', `Подпись на открытку: «${state.note.trim()}»`);
  parts.push('', `Итого: ${spec().price.toLocaleString('ru-RU')} ₽`);
  return parts.join('\n');
}

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  announce(text);
}

async function copyOrder(fromSend) {
  const text = orderText();
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    // запасной путь для старых браузеров и http без прав на буфер
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (fromSend) showToast(ok ? 'Telegram пока не подключён — заказ скопирован, его можно вставить в любой мессенджер.' : 'Не получилось скопировать заказ.');
  else showToast(ok ? 'Заказ скопирован.' : 'Не получилось скопировать заказ.');
}

function sendOrder() {
  if (!TELEGRAM_USERNAME) { copyOrder(true); return; }
  const url = `https://t.me/${TELEGRAM_USERNAME}?text=${encodeURIComponent(orderText())}`;
  window.open(url, '_blank', 'noopener');
  showToast('Открываем Telegram — останется нажать «Отправить».');
}

/* =========================================================
   Запасной вид и ленивая загрузка 3D
   ========================================================= */

// пока 3D нет — действия просто обновляют схему коробки
let scene3d = { dropIn() {}, liftOut() {}, rebuild() {} };

function renderFallback() {
  const { cols } = spec();
  fallback.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  fallback.innerHTML = state.slots.map(id => id
    ? `<span style="background:${flavorById[id].swatch}"></span>`
    : '<span class="is-empty"></span>').join('');
}

// Быстрая проверка без создания WebGL-контекста (создание стоит сотни миллисекунд на телефоне).
// Если WebGL всё же не заработает, box-scene.js упадёт при создании сцены — и останется схема.
const webglAvailable = () => 'WebGLRenderingContext' in window;

updateUI();

// ?no3d — проверить, как сайт выглядит без WebGL
if (webglAvailable() && !location.search.includes('no3d')) {
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    import('./box-scene.js').then(m => {
      scene3d = m.createBoxScene({
        stage, canvas, flavorById,
        getState: () => state,
        spec,
        onRemove: removeAt,
      });
    }).catch(err => console.warn('3D коробки не запустилось', err));
  }, { rootMargin: '400px 0px' });
  io.observe(stage);
}
