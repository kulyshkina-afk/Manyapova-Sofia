(function () {
  var openLink = document.querySelector('a[href="#experience"]');
  var overlay = document.getElementById('experienceOverlay');
  var drawer = document.getElementById('experienceDrawer');
  var closeBtn = document.getElementById('experienceClose');

  if (!overlay || !drawer) return;

  function openDrawer(e) {
    if (e) e.preventDefault();
    overlay.classList.add('is-open');
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    overlay.classList.remove('is-open');
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  if (openLink) openLink.addEventListener('click', openDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });
})();
