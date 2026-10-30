// Прототип ретро-рабочего стола: меню «Пуск», окна, часы в трее, копирование почты
// и прогресс чтения в окне кейса
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let zTop = 20; // z-index последнего поднятого окна
  window.clipSpotLift = 40; // скрепка появляется на 40 px выше, чем на живом сайте


  // часы в трее — время Петербурга
  const clock = $('[data-clock]');
  if (clock) {
    const fmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
    const tick = () => { clock.textContent = fmt.format(new Date()); };
    tick();
    setInterval(tick, 15000);
  }

  // меню «Пуск»
  const startBtn = $('.start');
  const menu = $('.startmenu');
  const setMenu = (open) => {
    if (!menu) return;
    menu.hidden = !open;
    startBtn.setAttribute('aria-expanded', String(open));
  };
  if (startBtn && menu) {
    startBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden); });
    document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.startmenu')) setMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
    $$('.startmenu a, .startmenu button').forEach((el) => el.addEventListener('click', () => setMenu(false)));
  }

  // окна: открыть / закрыть, кнопка на панели задач
  const syncTask = (id) => {
    const w = document.getElementById(id);
    const t = $(`[data-task="${id}"]`);
    if (t && w) { t.hidden = w.hidden; }
  };
  $$('[data-open]').forEach((el) => el.addEventListener('click', (e) => {
    e.preventDefault();
    const w = document.getElementById(el.dataset.open);
    if (!w) return;
    w.hidden = false;
    // новое окно открывается каскадом поверх «Обо мне», как в Windows: чуть правее и ниже, выше всех окон
    const about = document.getElementById('w-about');
    if (w !== about && about && !about.hidden && window.innerWidth > 760) {
      const a = about.getBoundingClientRect();
      const tb = $('.taskbar') ? $('.taskbar').offsetHeight : 0;
      const x = Math.min(a.left + 48, window.innerWidth - w.offsetWidth - 8);
      const y = Math.max(8, Math.min(a.top + 36, window.innerHeight - tb - w.offsetHeight - 8));
      Object.assign(w.style, { position: 'fixed', left: `${x}px`, top: `${y}px`, margin: '0', transform: 'none' });
    }
    w.style.zIndex = String(++zTop);
    w.style.animation = 'none'; void w.offsetWidth; w.style.animation = '';
    syncTask(w.id);
    const t = $(`[data-task="${w.id}"]`);
    if (t) t.classList.add('is-active');
  }));
  $$('[data-close]').forEach((el) => el.addEventListener('click', () => {
    const w = el.closest('.win');
    if (!w) return;
    w.hidden = true;
    syncTask(w.id);
  }));
  // свернуть: окно прячется, а кнопка на панели задач остаётся — по ней окно возвращается
  $$('[data-min]').forEach((el) => el.addEventListener('click', () => {
    const w = el.closest('.win');
    if (!w) return;
    w.hidden = true;
    const t = $(`[data-task="${w.id}"]`);
    if (t) t.classList.remove('is-active');
  }));
  $$('[data-task]').forEach((t) => {
    syncTask(t.dataset.task);
    t.addEventListener('click', () => {
      const w = document.getElementById(t.dataset.task);
      if (!w) return;
      w.hidden = !w.hidden;
      t.classList.toggle('is-active', !w.hidden);
    });
  });
  // окна рабочего стола можно таскать за заголовок, как в Windows. Окно кейса стоит на месте
  $$('.win:not(.win--doc) .win__title').forEach((bar) => {
    const w = bar.closest('.win');
    bar.style.touchAction = 'none';
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, a')) return;
      e.preventDefault(); // иначе браузер начинает выделять текст в окне
      // переводим окно в координаты экрана: так его можно двигать где угодно, не завися от раскладки
      const r = w.getBoundingClientRect();
      Object.assign(w.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, margin: '0', transform: 'none', zIndex: String(++zTop) });
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      try { bar.setPointerCapture(e.pointerId); } catch {}
      const move = (ev) => {
        // заголовок не уводим за края экрана и под панель задач
        const tb = $('.taskbar') ? $('.taskbar').offsetHeight : 0;
        const x = Math.min(Math.max(ev.clientX - dx, 60 - r.width), window.innerWidth - 60);
        const y = Math.min(Math.max(ev.clientY - dy, 0), window.innerHeight - tb - bar.offsetHeight);
        w.style.left = `${x}px`;
        w.style.top = `${y}px`;
      };
      const up = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
    // клик по любому месту окна поднимает его наверх
    w.addEventListener('pointerdown', () => { w.style.zIndex = String(++zTop); });
  });

  // развернуть окно кейса на всю ширину (скрепка тогда оказывается поверх окна)
  $$('[data-max]').forEach((b) => b.addEventListener('click', () => b.closest('.win').classList.toggle('is-max')));

  // копирование почты: grass.js сам заметит клик по [data-copy-email] и обрадуется
  $$('[data-copy-email]').forEach((b) => b.addEventListener('click', async () => {
    const email = b.dataset.copyEmail;
    let ok = false;
    try { await navigator.clipboard.writeText(email); ok = true; } catch {}
    if (!ok) { window.location.href = `mailto:${email}`; return; }
    const label = b.querySelector('[data-copy-label]');
    if (label) {
      // в подписи может быть разметка (разный текст для XP и спокойного вида) — возвращаем её целиком
      const was = label.innerHTML;
      label.textContent = 'Скопировано';
      setTimeout(() => { label.innerHTML = was; }, 1600);
    }
  }));

  // «Режим сна» в меню «Пуск» включает ночь через меню скрепки
  $$('[data-night]').forEach((b) => b.addEventListener('click', () => {
    const item = $$('.clip-pie__item').find((i) => /ночь|день/i.test(i.textContent));
    if (item) item.click();
  }));

  // окно кейса: прогресс чтения в строке состояния и текущий раздел в левой панели
  const doc = $('.doc');
  if (doc) {
    const progress = $('[data-progress]');
    const links = $$('.pane__body a[href^="#"]');
    const sections = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);

    // прокрутка документа к элементу. Картинки выше него грузятся «лениво» и без них высота
    // ещё не известна, поэтому сначала догружаем их, иначе прокрутка промахнётся
    const scrollDocTo = async (el) => {
      const before = $$('img', doc).filter((i) => i.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      before.forEach((i) => { i.loading = 'eager'; });
      await Promise.all(before.map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
      doc.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' });
    };

    // скрепка в кейсе: в конце предлагает следующий кейс (один раз за визит)
    let endAsked = false;
    const askNext = () => {
      if (endAsked || !window.clipAsk || !doc.dataset.next) return;
      endAsked = true;
      const next = new URL(doc.dataset.next, document.baseURI).href;
      window.clipAsk('Дочитали! Открыть следующий кейс?', [
        { label: 'Открыть следующий кейс', onClick: () => { location.href = next; } },
      ], 14);
    };

    // стопка слайдов: насколько следующий слайд наехал на текущий
    const stack = $$('.feature', doc);
    const onStack = () => stack.slice(0, -1).forEach((f, i) => {
      const a = f.getBoundingClientRect();
      const cover = 1 - (stack[i + 1].getBoundingClientRect().top - a.top) / a.height;
      f.style.setProperty('--cover', Math.min(1, Math.max(0, cover)).toFixed(3));
    });

    const onScroll = () => {
      onStack();
      const max = doc.scrollHeight - doc.clientHeight;
      const share = max > 0 ? doc.scrollTop / max : 1;
      if (progress) progress.textContent = `Прочитано ${Math.round(share * 100)}%`;
      let cur = sections[0];
      for (const s of sections) if (s.offsetTop - doc.scrollTop < doc.clientHeight * 0.35) cur = s;
      links.forEach((a) => a.classList.toggle('is-current', cur && a.getAttribute('href') === `#${cur.id}`));
      if (share > 0.97 && max > 0) askNext();
    };
    doc.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    // ссылки на разделы прокручивают сам документ, а не страницу
    links.forEach((a) => a.addEventListener('click', (e) => {
      const s = document.getElementById(a.getAttribute('href').slice(1));
      if (!s) return;
      e.preventDefault();
      scrollDocTo(s);
    }));

  }
})();
