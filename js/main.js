// Café Doux — интерфейс: хедер, меню, появление при скролле
(function () {
  document.documentElement.classList.add('js');

  const header = document.getElementById('header');
  const nav = document.getElementById('nav');
  const burger = document.getElementById('burger');

  /* ---------- липкий хедер ---------- */
  function onScroll() {
    header.classList.toggle('is-scrolled', window.scrollY > 10);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  // первое чтение прокрутки — в следующем кадре, чтобы не пересчитывать вёрстку во время загрузки
  requestAnimationFrame(onScroll);

  /* ---------- вечерний режим ---------- */
  // Тема уже выбрана ранним скриптом в <head> (по времени или по сохранённому выбору).
  const root = document.documentElement;
  const toggle = document.getElementById('themeToggle');
  const metaTheme = document.querySelector('meta[name="theme-color"]');

  function syncToggle() {
    const evening = root.dataset.theme === 'evening';
    toggle.setAttribute('aria-pressed', String(evening));
    toggle.setAttribute('aria-label', evening ? 'Включить дневной режим' : 'Включить вечерний режим');
    metaTheme.content = evening ? '#1D1510' : '#EFE3CF';
  }

  function setTheme(theme) {
    root.dataset.theme = theme;
    syncToggle();
    // ручной выбор помним 12 часов — дальше снова решает время суток
    try { localStorage.setItem('cafedoux-theme', JSON.stringify({ theme, at: Date.now() })); } catch (e) {}
  }

  if (toggle) {
    syncToggle();
    toggle.addEventListener('click', () => {
      const next = root.dataset.theme === 'evening' ? 'day' : 'evening';
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!document.startViewTransition || reduce) {
        // запасной путь: плавная смена цветов
        root.classList.add('theme-fade');
        setTheme(next);
        setTimeout(() => root.classList.remove('theme-fade'), 600);
        return;
      }
      // новая тема «разливается» кругом из кнопки, как свет от зажжённой лампы
      const r = toggle.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      const transition = document.startViewTransition(() => setTheme(next));
      transition.ready.then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 750, easing: 'cubic-bezier(.16, 1, .3, 1)', pseudoElement: '::view-transition-new(root)' }
        );
      }).catch(() => {});
    });
  }

  /* ---------- мобильное меню ---------- */
  function setMenu(open) {
    nav.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    document.body.classList.toggle('menu-open', open);
  }
  burger.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));

  /* ---------- дата на «доске» витрины ---------- */
  const today = document.getElementById('today');
  if (today) {
    today.textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  /* ---------- появление при скролле ---------- */
  // лёгкий каскад внутри одной группы
  document.querySelectorAll('.products, .strip, .showcase__head, .places__list, .philosophy__text, .cta__content, .hero__text')
    .forEach(group => {
      group.querySelectorAll(':scope > .reveal, :scope > .reveal-img').forEach((el, i) => {
        el.style.setProperty('--d', (i * 0.1).toFixed(2) + 's');
      });
    });

  // Заголовки разделов выезжают по словам, каждое из-под своей «шторки».
  // Делим только по обычным пробелам: «за&nbsp;своим» остаётся одним куском, как и задумано в тексте.
  // Диктор читает заголовок целиком из aria-label, а не по кусочкам.
  document.querySelectorAll('.title.reveal, .cta__title.reveal').forEach(title => {
    title.setAttribute('aria-label', title.textContent.replace(/\s+/g, ' ').trim());
    let i = 0;
    const walk = node => {
      [...node.childNodes].forEach(child => {
        if (child.nodeType === 1) { walk(child); return; }
        if (child.nodeType !== 3) return;
        const frag = document.createDocumentFragment();
        child.textContent.split(/([ \t\r\n]+)/).forEach(part => {
          if (!part) return;
          if (/^[ \t\r\n]+$/.test(part)) { frag.append(' '); return; }
          const word = document.createElement('span');
          const inner = document.createElement('span');
          word.className = 'w';
          word.setAttribute('aria-hidden', 'true');
          inner.textContent = part;
          inner.style.setProperty('--i', i++);
          word.append(inner);
          frag.append(word);
        });
        child.replaceWith(frag);
      });
    };
    walk(title);
    title.classList.replace('reveal', 'split');
  });

  const revealEls = document.querySelectorAll('.reveal, .reveal-img, .split');

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('is-in'));
  }

  /* ---------- смена карточек в разборе макарона ---------- */
  const recipe = document.getElementById('recipe');
  const cards = [...document.querySelectorAll('.card')];
  const dots = [...document.querySelectorAll('.recipe__dots span')];
  if (recipe && cards.length) {
    let cardTicking = false;
    let current = -1;
    const syncCards = () => {
      const vh = window.innerHeight;
      const r = recipe.getBoundingClientRect();
      const travel = Math.max(1, r.height - vh);
      const p = Math.min(1, Math.max(0, -r.top / (travel * 0.75)));
      const i = p < 0.3 ? 0 : (p < 0.64 ? 1 : 2);
      if (i === current) return;
      current = i;
      cards.forEach((el, n) => el.classList.toggle('is-active', n === i));
      dots.forEach((el, n) => el.classList.toggle('is-active', n === i));
    };
    window.addEventListener('scroll', () => {
      if (cardTicking) return;
      cardTicking = true;
      requestAnimationFrame(() => { syncCards(); cardTicking = false; });
    }, { passive: true });
    window.addEventListener('resize', syncCards);
    requestAnimationFrame(syncCards);
  }

  /* ---------- параллакс фона финального CTA ---------- */
  const ctaImg = document.querySelector('.cta__bg img');
  const cta = document.querySelector('.cta');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (ctaImg && !reduce) {
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const r = cta.getBoundingClientRect();
        const p = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
        ctaImg.style.transform = `translate3d(0, ${(-8 + p * 10).toFixed(2)}%, 0)`;
        ticking = false;
      });
    }, { passive: true });
  }

  /* ---------- магнитные кнопки ---------- */
  // Только для мыши и без «уменьшения движения». Свой курсор сделан чистым CSS (картинка), скрипт ему не нужен.
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!finePointer || reduce) return;

  // Магнит: кнопка чуть тянется за курсором, стрелка — ещё чуть дальше.
  // Двигаем свойством translate: оно складывается с transform из :hover и :active, не ломая их.
  document.querySelectorAll('.hero__actions .btn, #boxSend, .cta .btn, #themeToggle').forEach(el => {
    const arrow = el.querySelector('.arrow');
    let x = 0, y = 0, tx = 0, ty = 0, raf = 0;
    const loop = () => {
      x += (tx - x) * 0.2;
      y += (ty - y) * 0.2;
      const done = Math.abs(tx - x) + Math.abs(ty - y) < 0.05;
      if (done) { x = tx; y = ty; }
      el.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
      if (arrow) arrow.style.translate = `${(x * 0.5).toFixed(2)}px ${(y * 0.5).toFixed(2)}px`;
      raf = done ? 0 : requestAnimationFrame(loop);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    el.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || el.disabled) return;
      const r = el.getBoundingClientRect();
      // центр кнопки без уже сделанного сдвига, иначе она «убегает»
      const cx = r.left + r.width / 2 - x, cy = r.top + r.height / 2 - y;
      tx = Math.max(-14, Math.min(14, (e.clientX - cx) * 0.3));
      ty = Math.max(-9, Math.min(9, (e.clientY - cy) * 0.4));
      kick();
    });
    el.addEventListener('pointerleave', () => { tx = ty = 0; kick(); });
  });
})();
