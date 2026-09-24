(() => {
  const DESIGN_WIDTH = 1360;
  const root = document.documentElement;
  const update = () => {
    const w = window.innerWidth;
    const pad = Math.min(40, Math.max(16, w * 0.03));
    const scale = w > 1024 && w < 1440 ? Math.min(1, (w - 2 * pad) / DESIGN_WIDTH) : 1;
    root.style.setProperty('--layout-scale', String(scale));
  };
  update();
  window.addEventListener('resize', update);
})();
