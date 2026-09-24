(() => {
  const el = document.querySelector('[data-clock]');
  if (!el) return;
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
  const tick = () => {
    const now = new Date();
    el.textContent = fmt.format(now);
    el.dateTime = now.toISOString();
    setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  };
  tick();
})();

(() => {
  const btn = document.querySelector('[data-copy-email]');
  if (!btn) return;
  const label = btn.querySelector('[data-copy-label]');
  const email = btn.dataset.copyEmail;
  let timer;
  const legacyCopy = () => {
    const ta = document.createElement('textarea');
    ta.value = email;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  };
  btn.addEventListener('click', async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(email);
      copied = true;
    } catch {
      copied = legacyCopy();
    }
    if (!copied) {
      window.location.href = `mailto:${email}`;
      return;
    }
    label.textContent = 'Скопировано';
    clearTimeout(timer);
    timer = setTimeout(() => { label.textContent = 'Email'; }, 1600);
  });
})();
