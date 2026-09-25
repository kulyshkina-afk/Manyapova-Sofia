// Живой фон: 3D-поле из травинок (WebGL2, без библиотек).
// Небо и холмы, целиком покрытые травой, которая качается от ветра и расходится от курсора.
// Если WebGL2 нет или включено «уменьшить анимацию» — остаётся картинка из CSS.
(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.querySelector('.bg__grass');
  if (!canvas) return;
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) return;

  // ---------- цвета сцены (сняты с исходной фотографии) ----------
  const SKY_TOP = [0.39, 0.49, 0.63];
  const SKY_HORIZON = [0.78, 0.82, 0.83];
  const FOG = [0.62, 0.72, 0.62];
  const SUN = (() => { const v = [0.1, 0.6, 0.8]; const l = Math.hypot(...v); return v.map((c) => c / l); })();

  // ---------- рельеф: волнистые холмы, дальше — выше (одинаково в JS и шейдерах) ----------
  const TERRAIN_GLSL = `
    float terrain(vec2 p) {
      float d = -p.y;
      float a = 0.15 + smoothstep(2.0, 20.0, d) * 3.0;
      return a * (0.5 * sin(p.x * 0.13 + 0.7) * cos(d * 0.11 + 0.3)
                + 0.3 * sin(p.x * 0.27 - d * 0.17 + 2.0)
                + 0.2 * sin(p.x * 0.07 + d * 0.05 + 1.0))
           + smoothstep(30.0, 70.0, d) * 1.6;
    }`;
  const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
  const terrain = (x, z) => {
    const d = -z;
    const a = 0.15 + smooth(2, 20, d) * 3.0;
    return a * (0.5 * Math.sin(x * 0.13 + 0.7) * Math.cos(d * 0.11 + 0.3)
              + 0.3 * Math.sin(x * 0.27 - d * 0.17 + 2.0)
              + 0.2 * Math.sin(x * 0.07 + d * 0.05 + 1.0))
         + smooth(30, 70, d) * 1.6;
  };

  const NOISE_GLSL = `
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }`;

  // освещённость склона: солнце сверху-спереди, склоны к зрителю светлее, впадины темнее
  const LIGHT_GLSL = `
    float slopeLight(vec2 p, vec3 sun) {
      float e = 0.15;
      vec3 n = normalize(vec3(terrain(p - vec2(e, 0.0)) - terrain(p + vec2(e, 0.0)), 2.0 * e,
                              terrain(p - vec2(0.0, e)) - terrain(p + vec2(0.0, e))));
      return max(dot(n, sun), 0.0);
    }`;

  // ---------- шейдеры ----------
  const skyVS = `#version 300 es
    in vec2 aPos; out vec2 vUv;
    void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const skyFS = `#version 300 es
    precision highp float;
    in vec2 vUv; out vec4 o;
    uniform vec3 uTop; uniform vec3 uHorizon;
    void main() {
      float k = smoothstep(0.3, 1.0, vUv.y);
      o = vec4(mix(uHorizon, uTop, pow(k, 0.9)), 1.0);
    }`;

  const groundVS = `#version 300 es
    in vec2 aXZ;
    uniform mat4 uViewProj; uniform vec3 uEye; uniform vec3 uSun;
    out vec3 vWorld; out float vLight; out float vFog;
    ${TERRAIN_GLSL}
    ${LIGHT_GLSL}
    void main() {
      vec3 p = vec3(aXZ.x, terrain(aXZ), aXZ.y);
      vLight = slopeLight(aXZ, uSun);
      vFog = clamp(1.0 - exp(-length(p - uEye) * 0.011), 0.0, 0.6);
      vWorld = p;
      gl_Position = uViewProj * vec4(p, 1.0);
    }`;
  const groundFS = `#version 300 es
    precision highp float;
    in vec3 vWorld; in float vLight; in float vFog; out vec4 o;
    uniform vec3 uFog;
    ${NOISE_GLSL}
    void main() {
      // земля между травинками — густая тень травы
      float n = noise(vWorld.xz * 2.0) * 0.6 + noise(vWorld.xz * 7.0) * 0.4;
      vec3 c = mix(vec3(0.24, 0.34, 0.1), vec3(0.45, 0.57, 0.22), n);
      c *= 0.7 + 0.4 * vLight;
      o = vec4(mix(c, uFog, vFog), 1.0);
    }`;

  const bladeVS = `#version 300 es
    in vec2 aVert;   // x: высота по травинке 0..1, y: сторона -1..1
    in vec4 aInst;   // x, z, случайные r1, r2
    uniform mat4 uViewProj; uniform vec3 uEye; uniform float uTime; uniform vec3 uSun;
    uniform vec4 uMouse; // x, z точки под курсором, сила, радиус
    out vec3 vColor; out float vFog;
    ${TERRAIN_GLSL}
    ${LIGHT_GLSL}
    void main() {
      float t = aVert.x;
      float side = aVert.y;
      vec2 base = aInst.xy;
      float r1 = aInst.z;
      float r2 = aInst.w;

      // вдали травинки крупнее, чтобы холмы были покрыты травой, а не голой землёй
      float d = -base.y;
      float s = pow(max(1.0, d / 5.0), 0.65);
      float H = mix(0.14, 0.34, r1 * r1) * s;
      float W = mix(0.008, 0.015, r2) * s;
      float ang = r2 * 6.2831 + r1 * 3.0;
      vec2 face = vec2(cos(ang), sin(ang));

      // ветер: медленные порывы бегут по полю + собственное покачивание травинок
      float gust = sin(uTime * 0.45 + base.x * 0.12 + base.y * 0.08) * 0.5 + 0.5;
      gust *= sin(uTime * 0.23 - base.x * 0.05 + 1.3) * 0.3 + 0.7;
      float sway = sin(uTime * 1.6 + base.x * 0.7 + base.y * 0.4 + r1 * 6.28) * 0.5
                 + sin(uTime * 2.7 + base.x * 1.3 + r2 * 6.28) * 0.25;
      vec2 wind = vec2(0.85, 0.35) * (0.08 + 0.34 * gust + 0.12 * sway);

      // курсор: травинки расходятся в стороны
      vec2 dm = base - uMouse.xy;
      float dist = length(dm);
      float f = (1.0 - smoothstep(0.0, uMouse.w, dist)) * uMouse.z;
      vec2 push = dist > 0.0001 ? dm / dist * f * 1.1 : vec2(0.0);

      // пушистость: травинки растут веером в разные стороны
      vec2 tipOff = (wind + push + face * (0.1 + 0.25 * r1)) * H;
      float k = min(length(tipOff) / H, 0.92);
      vec2 off = tipOff * t * t;
      float y = t * H * sqrt(1.0 - k * k * t);
      vec2 perp = vec2(-face.y, face.x) * side * W * (1.0 - t * 0.85);
      vec3 p = vec3(base.x + off.x + perp.x, terrain(base) + y, base.y + off.y + perp.y);

      // цвет: тёмное основание, сочная середина, светлые блестящие кончики
      float light = slopeLight(base, uSun);
      vec3 dark = vec3(0.19, 0.27, 0.07);
      vec3 tip = mix(vec3(0.52, 0.65, 0.24), vec3(0.7, 0.76, 0.42), r2 * r2);
      vec3 c = mix(dark, tip, pow(t, 1.2));
      c *= 0.7 + 0.4 * light;
      c *= 0.85 + 0.25 * r1;
      c *= 1.0 + 0.15 * gust * t;   // наклонённая трава ловит свет
      c *= 1.0 - 0.2 * f * t;       // примятая — чуть темнее

      vFog = clamp(1.0 - exp(-length(p - uEye) * 0.011), 0.0, 0.6);
      vColor = c;
      gl_Position = uViewProj * vec4(p, 1.0);
    }`;
  const bladeFS = `#version 300 es
    precision highp float;
    in vec3 vColor; in float vFog; out vec4 o;
    uniform vec3 uFog;
    void main() { o = vec4(mix(vColor, uFog, vFog), 1.0); }`;

  // ягнёнок — картинка на плоскости, повёрнутой к камере. Рисуется на отдельном прозрачном
  // слое поверх карточек; низ плавно растворяется, будто ножки скрыты в траве
  const sheepVS = `#version 300 es
    in vec2 aCorner;
    uniform mat4 uViewProj; uniform vec3 uEye;
    uniform vec3 uPos; uniform vec2 uSize; uniform float uFlip; uniform float uGround;
    out vec2 vUv; out float vFog; out float vAbove;
    void main() {
      vec3 p = uPos + vec3((aCorner.x - 0.5) * uSize.x, aCorner.y * uSize.y, 0.0);
      vUv = vec2(uFlip > 0.0 ? 1.0 - aCorner.x : aCorner.x, 1.0 - aCorner.y);
      vFog = clamp(1.0 - exp(-length(p - uEye) * 0.011), 0.0, 0.6);
      vAbove = (p.y - uGround) / uSize.y;
      gl_Position = uViewProj * vec4(p, 1.0);
    }`;
  const sheepFS = `#version 300 es
    precision highp float;
    in vec2 vUv; in float vFog; in float vAbove; out vec4 o;
    uniform sampler2D uTex; uniform vec3 uFog;
    void main() {
      vec4 c = texture(uTex, vUv);
      c *= smoothstep(0.0, 0.14, vAbove);
      if (c.a < 0.02) discard;
      o = vec4(mix(c.rgb, uFog * c.a, vFog * 0.7), c.a); // цвета уже умножены на прозрачность
    }`;
  const program = (vsSrc, fsSrc, g = gl) => {
    const make = (type, src) => {
      const s = g.createShader(type);
      g.shaderSource(s, src);
      g.compileShader(s);
      return g.getShaderParameter(s, g.COMPILE_STATUS) ? s : null;
    };
    const vs = make(g.VERTEX_SHADER, vsSrc);
    const fs = make(g.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const p = g.createProgram();
    g.attachShader(p, vs);
    g.attachShader(p, fs);
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) return null;
    const uniforms = {};
    const n = g.getProgramParameter(p, g.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = g.getActiveUniform(p, i).name;
      uniforms[name] = g.getUniformLocation(p, name);
    }
    return { p, u: uniforms };
  };
  const sky = program(skyVS, skyFS);
  const ground = program(groundVS, groundFS);
  const blades = program(bladeVS, bladeFS);
  if (!sky || !ground || !blades) return;

  const attrib = (prog, name, data, size, g = gl) => {
    const buf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
    const loc = g.getAttribLocation(prog.p, name);
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, size, g.FLOAT, false, 0, 0);
  };

  // небо — прямоугольник на весь экран
  const skyVao = gl.createVertexArray();
  gl.bindVertexArray(skyVao);
  attrib(sky, 'aPos', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2);

  // земля — сетка, частая вблизи и редкая вдали
  const groundVao = gl.createVertexArray();
  gl.bindVertexArray(groundVao);
  const NX = 140;
  const NZ = 150;
  const gv = new Float32Array((NX + 1) * (NZ + 1) * 2);
  for (let j = 0, k = 0; j <= NZ; j++) {
    const z = -(0.5 + 79.5 * Math.pow(j / NZ, 1.6));
    for (let i = 0; i <= NX; i++) {
      gv[k++] = -110 + (220 * i) / NX;
      gv[k++] = z;
    }
  }
  attrib(ground, 'aXZ', gv, 2);
  const gi = new Uint16Array(NX * NZ * 6);
  for (let j = 0, k = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      const b = a + NX + 1;
      gi.set([a, b, a + 1, a + 1, b, b + 1], k);
      k += 6;
    }
  }
  const gib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gi, gl.STATIC_DRAW);

  // травинка — полоска из 4 сегментов с острым кончиком
  const SEG = 4;
  const bv = [];
  for (let i = 0; i < SEG; i++) bv.push(i / SEG, -1, i / SEG, 1);
  bv.push(1, 0);
  const BLADE_VERTS = SEG * 2 + 1;
  const bladeVao = gl.createVertexArray();
  gl.bindVertexArray(bladeVao);
  attrib(blades, 'aVert', new Float32Array(bv), 2);
  const instLoc = gl.getAttribLocation(blades.p, 'aInst');
  const instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.enableVertexAttribArray(instLoc);
  gl.vertexAttribPointer(instLoc, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(instLoc, 1);

  gl.bindVertexArray(null);

  // ---------- слой ягнёнка поверх карточек ----------
  const lambCanvas = document.querySelector('.lamb-layer');
  const lgl = lambCanvas && lambCanvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
  const sheepProg = lgl && program(sheepVS, sheepFS, lgl);
  const sheepVao = sheepProg && lgl.createVertexArray();
  // ягнёнок из Figma (картинка с прозрачным фоном)
  const LAMB = { src: 'assets/lamb-3.png', aspect: 318 / 512, size: 0.85, sink: 0.35, ready: false };
  if (sheepProg) {
    lgl.bindVertexArray(sheepVao);
    attrib(sheepProg, 'aCorner', new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2, lgl);
    lgl.bindVertexArray(null);
    LAMB.tex = lgl.createTexture();
    const img = new Image();
    img.onload = () => {
      lgl.bindTexture(lgl.TEXTURE_2D, LAMB.tex);
      lgl.pixelStorei(lgl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      lgl.texImage2D(lgl.TEXTURE_2D, 0, lgl.RGBA, lgl.RGBA, lgl.UNSIGNED_BYTE, img);
      lgl.generateMipmap(lgl.TEXTURE_2D);
      lgl.texParameteri(lgl.TEXTURE_2D, lgl.TEXTURE_MIN_FILTER, lgl.LINEAR_MIPMAP_LINEAR);
      lgl.texParameteri(lgl.TEXTURE_2D, lgl.TEXTURE_WRAP_S, lgl.CLAMP_TO_EDGE);
      lgl.texParameteri(lgl.TEXTURE_2D, lgl.TEXTURE_WRAP_T, lgl.CLAMP_TO_EDGE);
      LAMB.ready = true;
    };
    img.src = LAMB.src;
  }

  // ---------- камера ----------
  const EYE_H = 1.0;
  const PITCH = 0.1; // смотрим чуть вверх — неба больше, холмы у нижней трети
  const eye = [0, EYE_H + terrain(0, 0), 0];
  const fwd = [0, Math.sin(PITCH), -Math.cos(PITCH)];
  const right = [1, 0, 0];
  const up = [0, Math.cos(PITCH), Math.sin(PITCH)];
  let viewProj = new Float32Array(16);
  let aspect = 1;
  let tanHalf = Math.tan((40 * Math.PI) / 360);

  const buildViewProj = () => {
    const fovy = aspect < 1 ? 50 : 40;
    tanHalf = Math.tan((fovy * Math.PI) / 360);
    const f = 1 / tanHalf;
    const near = 0.05;
    const far = 250;
    const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
    const z = fwd.map((c) => -c);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const view = [
      right[0], up[0], z[0], 0,
      right[1], up[1], z[1], 0,
      right[2], up[2], z[2], 0,
      -dot(right, eye), -dot(up, eye), -dot(z, eye), 1,
    ];
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += proj[k * 4 + r] * view[c * 4 + k];
        out[c * 4 + r] = s;
      }
    }
    viewProj = out;
  };

  // ---------- травинки: от ног до самого горизонта ----------
  // вдали их реже, но они крупнее — поэтому холмы покрыты травой целиком
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const MAX_BLADES = small ? 100000 : 240000;
  let bladeCount = MAX_BLADES;
  let builtAspect = 0;
  const buildBlades = () => {
    builtAspect = aspect;
    const d0 = 2.5;
    const d1 = 72;
    const P = 0.35; // распределение по дальности: плотность ~ d^-0.65
    const a0 = Math.pow(d0, P);
    const a1 = Math.pow(d1, P);
    const spread = tanHalf * aspect * 1.15;
    const data = new Float32Array(MAX_BLADES * 4);
    for (let i = 0; i < MAX_BLADES; i++) {
      const d = Math.pow(a0 + Math.random() * (a1 - a0), 1 / P);
      const half = d * spread + 1;
      data[i * 4] = (Math.random() * 2 - 1) * half;
      data[i * 4 + 1] = -d;
      data[i * 4 + 2] = Math.random();
      data[i * 4 + 3] = Math.random();
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (sheepProg) {
      lambCanvas.width = canvas.width;
      lambCanvas.height = canvas.height;
      lgl.viewport(0, 0, lambCanvas.width, lambCanvas.height);
    }
    aspect = w / h;
    buildViewProj();
    if (aspect > builtAspect * 1.1 || aspect < builtAspect * 0.6) buildBlades();
  };

  // ---------- курсор: луч из камеры до земли ----------
  let tx = -10, ty = -10, mx = -10, my = -10;
  let active = 0, strength = 0;
  const mouseWorld = [1e4, 1e4, 1.5];
  window.addEventListener('pointermove', (e) => {
    tx = e.clientX / window.innerWidth;
    ty = e.clientY / window.innerHeight;
    if (mx < -1) { mx = tx; my = ty; }
    active = 1;
  }, { passive: true });
  document.addEventListener('mouseleave', () => { active = 0; });
  window.addEventListener('blur', () => { active = 0; });

  // точка на земле под экранной координатой (0..1), или null, если там небо
  const castRay = (sx, sy) => {
    const nx = sx * 2 - 1;
    const ny = 1 - sy * 2;
    const dir = [0, 1, 2].map((i) => fwd[i] + nx * tanHalf * aspect * right[i] + ny * tanHalf * up[i]);
    const len = Math.hypot(...dir);
    for (let s = 0.2; s < 90; s += 0.05 + s * 0.015) {
      const x = eye[0] + (dir[0] / len) * s;
      const y = eye[1] + (dir[1] / len) * s;
      const z = eye[2] + (dir[2] / len) * s;
      if (y < terrain(x, z)) return [x, z];
    }
    return null;
  };

  const castMouse = () => {
    const hit = castRay(mx, my);
    if (!hit) { mouseWorld[0] = mouseWorld[1] = 1e4; return; }
    mouseWorld[0] = hit[0];
    mouseWorld[1] = hit[1];
    mouseWorld[2] = 1.5 * Math.pow(Math.max(1, -hit[1] / 5), 0.65); // вдали круг больше, как и травинки
  };

  // ---------- ягнята: клик по свободной траве ----------
  const sheep = [];
  const SHEEP_LIFE = 12;
  let lambDirty = false; // нужно ещё раз очистить слой после ухода последнего ягнёнка
  document.addEventListener('click', (e) => {
    if (!sheepProg) return;
    if (e.target.closest('a, button, .card, .profile, .topbar, .drawer, .drawer-overlay')) return;
    const hit = castRay(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    if (!hit) return;
    const d = -hit[1];
    sheep.push({
      x: hit[0],
      z: hit[1],
      size: LAMB.size * Math.pow(Math.max(1, d / 5), 0.5),
      flip: Math.random() < 0.5 ? 1 : -1,
      born: performance.now() / 1000,
      phase: Math.random() * 6.28,
    });
    if (sheep.length > 10) sheep.shift();
  });
  const easeOutBack = (t) => { const c1 = 1.70158; return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

  // ---------- кадр ----------
  gl.clearColor(...FOG, 1);
  const start = performance.now();
  let frames = 0;
  let slowFrames = 0;
  let last = start;
  let shown = false;

  const frame = (now) => {
    // слабый компьютер — рисуем меньше травинок
    const dt = now - last;
    last = now;
    if (frames > 10 && frames < 130 && dt > 26) slowFrames++;
    if (frames === 130 && slowFrames > 60) bladeCount = Math.round(bladeCount * 0.5);
    frames++;

    mx += (tx - mx) * 0.12;
    my += (ty - my) * 0.12;
    strength += (active - strength) * 0.08;
    active *= 0.985;
    castMouse();
    const time = (now - start) / 1000;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(sky.p);
    gl.uniform3fv(sky.u.uTop, SKY_TOP);
    gl.uniform3fv(sky.u.uHorizon, SKY_HORIZON);
    gl.bindVertexArray(skyVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(ground.p);
    gl.uniformMatrix4fv(ground.u.uViewProj, false, viewProj);
    gl.uniform3fv(ground.u.uEye, eye);
    gl.uniform3fv(ground.u.uSun, SUN);
    gl.uniform3fv(ground.u.uFog, FOG);
    gl.bindVertexArray(groundVao);
    gl.drawElements(gl.TRIANGLES, gi.length, gl.UNSIGNED_SHORT, 0);

    gl.useProgram(blades.p);
    gl.uniformMatrix4fv(blades.u.uViewProj, false, viewProj);
    gl.uniform3fv(blades.u.uEye, eye);
    gl.uniform3fv(blades.u.uSun, SUN);
    gl.uniform1f(blades.u.uTime, time);
    gl.uniform4f(blades.u.uMouse, mouseWorld[0], mouseWorld[1], strength, mouseWorld[2]);
    gl.uniform3fv(blades.u.uFog, FOG);
    gl.bindVertexArray(bladeVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, BLADE_VERTS, bladeCount);

    // ягнята на верхнем слое: выпрыгивают из травы, покачиваются и прячутся обратно
    if (sheepProg && (sheep.length || lambDirty)) {
      lambDirty = sheep.length > 0;
      const nowS = now / 1000;
      lgl.clearColor(0, 0, 0, 0);
      lgl.clear(lgl.COLOR_BUFFER_BIT);
      if (LAMB.ready) {
        lgl.enable(lgl.BLEND);
        lgl.blendFunc(lgl.ONE, lgl.ONE_MINUS_SRC_ALPHA);
        lgl.useProgram(sheepProg.p);
        lgl.uniformMatrix4fv(sheepProg.u.uViewProj, false, viewProj);
        lgl.uniform3fv(sheepProg.u.uEye, eye);
        lgl.uniform3fv(sheepProg.u.uFog, FOG);
        lgl.activeTexture(lgl.TEXTURE0);
        lgl.bindTexture(lgl.TEXTURE_2D, LAMB.tex);
        lgl.uniform1i(sheepProg.u.uTex, 0);
        lgl.bindVertexArray(sheepVao);
        // дальние рисуем первыми, чтобы ближние оказались сверху
        const order = sheep.slice().sort((a, b) => a.z - b.z);
        for (const s of order) {
          const age = nowS - s.born;
          const rise = easeOutBack(Math.min(age / 0.7, 1));
          const q = Math.max(0, Math.min((age - SHEEP_LIFE) / 0.6, 1));
          const hide = rise * (1 - q * q);
          const bob = Math.sin(age * 2.2 + s.phase) * 0.012 * s.size;
          const groundY = terrain(s.x, s.z);
          const y = groundY - s.size * LAMB.sink - s.size * (1 - hide) + bob;
          lgl.uniform3f(sheepProg.u.uPos, s.x, y, s.z);
          lgl.uniform1f(sheepProg.u.uGround, groundY);
          lgl.uniform2f(sheepProg.u.uSize, s.size * LAMB.aspect, s.size);
          lgl.uniform1f(sheepProg.u.uFlip, s.flip);
          lgl.drawArrays(lgl.TRIANGLE_STRIP, 0, 4);
        }
      }
      for (let i = sheep.length - 1; i >= 0; i--) {
        if (nowS - sheep[i].born > SHEEP_LIFE + 0.6) sheep.splice(i, 1);
      }
    }

    if (!shown) { shown = true; canvas.classList.add('is-ready'); }
    requestAnimationFrame(frame);
  };

  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
