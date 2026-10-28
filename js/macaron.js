// Café Doux — запуск 3D первого экрана.
// Сначала страница показывается целиком (текст, картинка-заглушка макарона в той же позе, что и 3D),
// и только потом подгружается тяжёлая часть: three.js, модель, освещение.
//  • компьютеры — когда браузер освободится после загрузки;
//  • телефоны и слабые устройства — при первой прокрутке или касании: первый экран там статичен,
//    заглушку от 3D не отличить, а разбор на слои всё равно начинается с прокрутки.
// Если WebGL недоступен или загрузка сорвалась — остаётся картинка, сайт работает как обычно.

// Быстрая проверка без создания WebGL-контекста (создание стоит сотни миллисекунд на телефоне).
// Если WebGL всё же не заработает, hero-scene.js упадёт при создании сцены — и останется картинка.
const webglAvailable = () => 'WebGLRenderingContext' in window;

// то же определение, что isLiteDevice() в macaron-model.js (здесь без импорта, чтобы файл был крошечным)
function liteDevice() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  return matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 860px)').matches || cores <= 4 || memory <= 4;
}

let started = false;
function start() {
  if (started) return;
  started = true;
  import('./hero-scene.js').catch(err => console.warn('3D первого экрана не запустилось', err));
}

function startOnInteraction() {
  // страницу открыли уже прокрученной (вернулись назад, якорная ссылка) — грузим сразу
  if (window.scrollY > 40) { start(); return; }
  const events = ['scroll', 'wheel', 'touchstart', 'pointerdown', 'keydown', 'pointermove'];
  const go = () => { events.forEach(e => removeEventListener(e, go)); start(); };
  events.forEach(e => addEventListener(e, go, { passive: true, once: true }));
}

// ?no3d — проверить, как сайт выглядит без WebGL; ?poster — служебная отрисовка заглушки
if (webglAvailable() && !location.search.includes('no3d')) {
  const whenIdle = cb => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 2000 }) : setTimeout(cb, 200));
  const kick = () => {
    if (location.search.includes('poster')) start();
    else if (liteDevice()) startOnInteraction();
    else whenIdle(start);
  };
  if (document.readyState === 'complete') kick();
  else addEventListener('load', kick, { once: true });
}
