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
  const SKY_TOP = [0.2, 0.47, 0.86];
  const SKY_HORIZON = [0.9, 0.95, 1.0];
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
    uniform float uNight; uniform float uTime; uniform float uAspect;
    uniform vec2 uWeather; // дождь, снег (0..1)
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      // у горизонта почти белое, выше быстро набирает синеву
      float k = smoothstep(0.36, 1.0, vUv.y);
      vec3 day = mix(uHorizon, uTop, pow(k, 0.75));
      vec3 night = mix(vec3(0.1, 0.15, 0.3), vec3(0.02, 0.04, 0.12), pow(k, 0.6));
      // дождь — серое небо, снег — светлое, молочное
      day = mix(day, mix(vec3(0.74, 0.77, 0.8), vec3(0.45, 0.5, 0.57), pow(k, 0.7)), uWeather.x);
      day = mix(day, mix(vec3(0.66, 0.73, 0.83), vec3(0.42, 0.51, 0.66), pow(k, 0.7)), uWeather.y);
      night = mix(night, night * 1.6 + 0.03, max(uWeather.x, uWeather.y));
      float clearSky = 1.0 - 0.85 * max(uWeather.x, uWeather.y);
      vec3 c = mix(day, night, uNight);
      // звёзды: по одной в части клеток сетки, каждая мерцает в своём ритме
      vec2 g = vec2(vUv.x * uAspect, vUv.y) * 42.0;
      vec2 cell = floor(g);
      float h = hash(cell);
      vec2 off = vec2(hash(cell + 7.3), hash(cell + 3.1)) - 0.5;
      float d = length(fract(g) - 0.5 - off * 0.6);
      float star = step(0.88, h) * smoothstep(0.09, 0.0, d);
      float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
      c += vec3(1.0, 0.97, 0.9) * star * twinkle * uNight * clearSky * smoothstep(0.42, 0.6, vUv.y);
      o = vec4(c, 1.0);
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
    uniform vec3 uFog; uniform float uNight; uniform float uCover;
    ${NOISE_GLSL}
    void main() {
      // земля между травинками — густая тень травы
      float n = noise(vWorld.xz * 2.0) * 0.6 + noise(vWorld.xz * 7.0) * 0.4;
      vec3 c = mix(vec3(0.24, 0.34, 0.1), vec3(0.45, 0.57, 0.22), n);
      c *= 0.7 + 0.4 * vLight;
      c = mix(c, mix(vec3(0.6, 0.69, 0.84), vec3(0.97, 0.98, 1.0), smoothstep(0.35, 0.95, vLight)), uCover * 0.94); // сугробы
      c = mix(c, c * vec3(0.22, 0.32, 0.55), uNight);
      o = vec4(mix(c, uFog, vFog), 1.0);
    }`;

  const bladeVS = `#version 300 es
    in vec2 aVert;   // x: высота по травинке 0..1, y: сторона -1..1
    in vec4 aInst;   // x, z, случайные r1, r2
    uniform mat4 uViewProj; uniform vec3 uEye; uniform float uTime; uniform vec3 uSun;
    uniform vec4 uMouse; // x, z точки под курсором, сила, радиус
    uniform vec4 uMow;   // скошенная полоса: z середины, полуширина, x косилки, сила 0..1
    uniform float uGale; // сильный порыв ветра 0..1
    uniform float uNight;
    uniform float uRain;  // дождь 0..1
    uniform float uCover; // сколько снега уже легло 0..1
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
      // там, где проехала косилка, трава короткая
      float strip = 1.0 - smoothstep(uMow.y * 0.85, uMow.y, abs(base.y - uMow.x));
      float cut = strip * (1.0 - smoothstep(uMow.z - 0.3, uMow.z, base.x)) * uMow.w;
      H *= 1.0 - 0.86 * cut;
      H *= 1.0 - 0.3 * uCover;      // под снегом трава приминается
      float ang = r2 * 6.2831 + r1 * 3.0;
      vec2 face = vec2(cos(ang), sin(ang));

      // ветер: медленные порывы бегут по полю + собственное покачивание травинок
      float gust = sin(uTime * 0.45 + base.x * 0.12 + base.y * 0.08) * 0.5 + 0.5;
      gust *= sin(uTime * 0.23 - base.x * 0.05 + 1.3) * 0.3 + 0.7;
      float sway = sin(uTime * 1.6 + base.x * 0.7 + base.y * 0.4 + r1 * 6.28) * 0.5
                 + sin(uTime * 2.7 + base.x * 1.3 + r2 * 6.28) * 0.25;
      vec2 wind = vec2(0.85, 0.35) * (0.08 + 0.34 * gust + 0.12 * sway);
      // порыв: трава ложится по ветру и дрожит
      wind += vec2(1.0, 0.2) * uGale * (0.8 + 0.25 * sin(uTime * 8.0 - base.x * 1.3 + r1 * 2.0));

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
      c *= 1.0 + 0.3 * cut;         // свежескошенная — заметно светлее
      // дождь: трава темнеет, мокрые кончики поблёскивают
      c *= 1.0 - 0.3 * uRain;
      c += vec3(0.12, 0.16, 0.15) * uRain * pow(t, 3.0) * (0.55 + 0.45 * sin(uTime * 5.0 + r1 * 30.0));
      // снег: кончики белеют первыми, потом всё поле
      float snowTip = smoothstep(0.0, 1.0, uCover * 1.9 - (1.0 - t) * 0.9 + (r2 - 0.5) * 0.25);
      c = mix(c, mix(vec3(0.62, 0.71, 0.86), vec3(0.98, 0.99, 1.0), smoothstep(0.35, 0.95, light)), snowTip);
      c = mix(c, c * vec3(0.22, 0.32, 0.55), uNight);

      vFog = clamp(1.0 - exp(-length(p - uEye) * 0.011), 0.0, 0.6);
      vColor = c;
      gl_Position = uViewProj * vec4(p, 1.0);
    }`;
  const bladeFS = `#version 300 es
    precision highp float;
    in vec3 vColor; in float vFog; out vec4 o;
    uniform vec3 uFog;
    void main() { o = vec4(mix(vColor, uFog, vFog), 1.0); }`;

  // спрайт — картинка на плоскости, повёрнутой к камере (скрепка, её зрачки, косилка).
  // Рисуется на отдельном прозрачном слое поверх карточек; низ плавно растворяется в траве
  const spriteVS = `#version 300 es
    in vec2 aCorner;
    uniform mat4 uViewProj; uniform vec3 uEye;
    uniform vec3 uPos; uniform vec2 uSize; uniform float uGround; uniform float uFade;
    uniform vec2 uPivot; uniform float uRot;
    out vec2 vUv; out float vFog; out float vAbove;
    void main() {
      // uPos — мировая точка опоры (uPivot в долях картинки), вокруг неё спрайт можно наклонить
      vec2 l = (aCorner - uPivot) * uSize;
      float cs = cos(uRot), sn = sin(uRot);
      vec3 p = uPos + vec3(l.x * cs - l.y * sn, l.x * sn + l.y * cs, 0.0);
      vUv = vec2(aCorner.x, 1.0 - aCorner.y);
      vFog = clamp(1.0 - exp(-length(p - uEye) * 0.011), 0.0, 0.6);
      vAbove = (p.y - uGround) / uFade;
      gl_Position = uViewProj * vec4(p, 1.0);
    }`;
  const spriteFS = `#version 300 es
    precision highp float;
    in vec2 vUv; in float vFog; in float vAbove; out vec4 o;
    uniform sampler2D uTex; uniform vec3 uFog; uniform float uDim;
    void main() {
      vec4 c = texture(uTex, vUv);
      c.rgb *= uDim;
      c *= smoothstep(0.0, 1.0, vAbove);
      if (c.a < 0.02) discard;
      o = vec4(mix(c.rgb, uFog * c.a, vFog * 0.5), c.a); // цвета уже умножены на прозрачность
    }`;  const program = (vsSrc, fsSrc, g = gl) => {
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

  // светлячки — светящиеся точки, которые ночью летают над травой
  const flies = program(`#version 300 es
    in vec4 aFly;   // x, z, фаза, скорость
    uniform mat4 uViewProj; uniform float uTime; uniform float uNight; uniform float uPx;
    out float vGlow;
    ${TERRAIN_GLSL}
    void main() {
      float ph = aFly.z;
      vec2 b = aFly.xy + vec2(sin(uTime * 0.35 * aFly.w + ph), cos(uTime * 0.27 * aFly.w + ph * 1.7)) * 0.9;
      float y = terrain(b) + 0.35 + 0.25 * sin(uTime * 0.6 * aFly.w + ph * 2.3);
      vec4 cp = uViewProj * vec4(b.x, y, b.y, 1.0);
      gl_Position = cp;
      vGlow = uNight * (0.3 + 0.7 * pow(0.5 + 0.5 * sin(uTime * 1.7 * aFly.w + ph * 5.0), 2.0));
      gl_PointSize = clamp(uPx * 0.18 / cp.w, 3.0, 30.0);
    }`, `#version 300 es
    precision highp float;
    in float vGlow; out vec4 o;
    void main() {
      float a = smoothstep(1.0, 0.0, length(gl_PointCoord - 0.5) * 2.0);
      a *= a;
      o = vec4(vec3(0.85, 1.0, 0.45) * a * vGlow, a * vGlow);
    }`);
  // осадки — процедурный слой на весь экран: косые струи дождя и медленные хлопья снега
  const precip = program(`#version 300 es
    in vec2 aPos; out vec2 vUv;
    void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`, `#version 300 es
    precision highp float;
    in vec2 vUv; out vec4 o;
    uniform float uTime; uniform float uAspect; uniform vec2 uWeather; // дождь, снег
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float rainLayer(vec2 uv, float scale, float speed, float seed) {
      uv.x += uv.y * 0.22;                       // наклон струй
      uv.y += uTime * speed;
      uv *= vec2(scale * uAspect, scale * 0.22);  // вытянутые клетки — длинные капли
      vec2 id = floor(uv);
      vec2 f = fract(uv);
      float x = 0.15 + 0.7 * hash(id * 1.7 + seed);
      float line = smoothstep(0.035, 0.0, abs(f.x - x));
      float len = smoothstep(0.0, 0.2, f.y) * smoothstep(1.0, 0.45, f.y);
      return line * len * step(0.4, hash(id + seed));
    }
    float snowLayer(vec2 uv, float scale, float speed, float seed) {
      uv.y += uTime * speed;
      uv.x += sin(uTime * 0.5 + uv.y * 5.0 + seed) * 0.02;
      uv *= vec2(scale * uAspect, scale);
      vec2 id = floor(uv);
      vec2 f = fract(uv) - 0.5;
      vec2 off = vec2(hash(id + seed), hash(id * 1.3 + seed + 2.0)) - 0.5;
      float r = 0.07 + 0.09 * hash(id + seed + 5.0);
      return smoothstep(r, r * 0.25, length(f - off * 0.6)) * step(0.4, hash(id + seed + 9.0));
    }
    void main() {
      float rain = 0.0;
      if (uWeather.x > 0.01) {
        rain = rainLayer(vUv, 26.0, 1.5, 1.0) * 0.5 + rainLayer(vUv, 40.0, 1.9, 7.0) * 0.38 + rainLayer(vUv, 60.0, 2.4, 13.0) * 0.26;
      }
      float snow = 0.0;
      if (uWeather.y > 0.01) {
        snow = snowLayer(vUv, 9.0, 0.09, 3.0) + snowLayer(vUv, 15.0, 0.13, 11.0) * 0.8 + snowLayer(vUv, 24.0, 0.18, 17.0) * 0.6;
      }
      float a = clamp(rain * uWeather.x * 0.75 + snow * uWeather.y * 0.95, 0.0, 1.0);
      vec3 col = mix(vec3(0.84, 0.9, 0.96), vec3(1.0), step(0.001, snow * uWeather.y));
      o = vec4(col, a);
    }`);
  const FLY_COUNT = 80;
  const flyVao = flies && gl.createVertexArray();
  if (flies) {
    const fd = new Float32Array(FLY_COUNT * 4);
    for (let i = 0; i < FLY_COUNT; i++) {
      const d = 3 + Math.pow(Math.random(), 1.6) * 30;
      fd[i * 4] = (Math.random() * 2 - 1) * (d * 0.9 + 1);
      fd[i * 4 + 1] = -d;
      fd[i * 4 + 2] = Math.random() * 6.28;
      fd[i * 4 + 3] = 0.7 + Math.random() * 0.8;
    }
    gl.bindVertexArray(flyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, fd, gl.STATIC_DRAW);
    const flyLoc = gl.getAttribLocation(flies.p, 'aFly');
    gl.enableVertexAttribArray(flyLoc);
    gl.vertexAttribPointer(flyLoc, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

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

  // ---------- слой скрепки-помощника поверх карточек ----------
  const layerCanvas = document.querySelector('.lamb-layer');
  const lgl = layerCanvas && layerCanvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
  const spriteProg = lgl && program(spriteVS, spriteFS, lgl);
  const spriteVao = spriteProg && lgl.createVertexArray();

  const makeTexture = (source) => {
    const tex = lgl.createTexture();
    lgl.bindTexture(lgl.TEXTURE_2D, tex);
    lgl.pixelStorei(lgl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    lgl.texImage2D(lgl.TEXTURE_2D, 0, lgl.RGBA, lgl.RGBA, lgl.UNSIGNED_BYTE, source);
    lgl.generateMipmap(lgl.TEXTURE_2D);
    lgl.texParameteri(lgl.TEXTURE_2D, lgl.TEXTURE_MIN_FILTER, lgl.LINEAR_MIPMAP_LINEAR);
    lgl.texParameteri(lgl.TEXTURE_2D, lgl.TEXTURE_WRAP_S, lgl.CLAMP_TO_EDGE);
    lgl.texParameteri(lgl.TEXTURE_2D, lgl.TEXTURE_WRAP_T, lgl.CLAMP_TO_EDGE);
    return tex;
  };

  // скрепка из Figma: брови нарисованы на картинке, зрачки рисуются отдельно и следят за курсором.
  // Координаты глаз — в долях картинки (от левого верхнего угла), размеры — в долях её высоты
  const CLIP = {
    src: 'assets/clip.png',
    aspect: 352 / 640,
    size: 0.6,       // высота в мире у переднего края поля
    sink: 0.12,      // какая часть снизу всегда скрыта в траве
    eyes: [[0.216, 0.2885], [0.6849, 0.3563]],
    eyeR: 0.11,
    pupilR: 0.036,
    tex: null,
    ready: false,
  };
  let pupilTex = null;
  let umbrellaTex = null;
  let hatTex = null;
  const HAT_ASPECT = 256 / 220;
  const UMBRELLA_ASPECT = 491 / 512;
  let mowerTex = null;
  const MOWER_ASPECT = 512 / 439;

  if (spriteProg) {
    lgl.bindVertexArray(spriteVao);
    attrib(spriteProg, 'aCorner', new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2, lgl);
    lgl.bindVertexArray(null);

    const img = new Image();
    img.onload = () => { CLIP.tex = makeTexture(img); CLIP.ready = true; };
    img.src = CLIP.src;

    // зрачок с бликом
    const pc = document.createElement('canvas');
    pc.width = pc.height = 96;
    const px = pc.getContext('2d');
    px.fillStyle = '#151517';
    px.beginPath(); px.arc(48, 48, 44, 0, Math.PI * 2); px.fill();
    px.fillStyle = 'rgba(255,255,255,0.92)';
    px.beginPath(); px.arc(33, 31, 11, 0, Math.PI * 2); px.fill();
    pupilTex = makeTexture(pc);

    // газонокосилка — 3D-картинка из Figma, едет вправо
    const mowerImg = new Image();
    mowerImg.onload = () => { mowerTex = makeTexture(mowerImg); };
    mowerImg.src = 'assets/mower.png';

    // зонтик — прозрачный голубой, 3D-картинка из Figma
    const umbrellaImg = new Image();
    umbrellaImg.onload = () => { umbrellaTex = makeTexture(umbrellaImg); };
    umbrellaImg.src = 'assets/umbrella.png';
    // вязаная шапка с помпоном
    const hc = document.createElement('canvas');
    hc.width = 256;
    hc.height = 220;
    const h = hc.getContext('2d');
    h.fillStyle = '#e5484d';
    h.beginPath(); h.moveTo(34, 178); h.bezierCurveTo(34, 60, 222, 60, 222, 178); h.closePath(); h.fill();
    h.strokeStyle = 'rgba(0,0,0,0.1)'; h.lineWidth = 4;                          // вязка
    for (let x = 62; x < 210; x += 22) { h.beginPath(); h.moveTo(x, 172); h.quadraticCurveTo(x - (128 - x) * 0.12, 120, 128 + (x - 128) * 0.45, 78); h.stroke(); }
    h.fillStyle = '#fff';
    h.beginPath(); h.moveTo(46, 160); h.arcTo(232, 160, 232, 206, 22); h.arcTo(232, 206, 24, 206, 22);
    h.arcTo(24, 206, 24, 160, 22); h.arcTo(24, 160, 232, 160, 22); h.closePath(); h.fill();        // отворот
    h.beginPath(); h.arc(128, 52, 34, 0, Math.PI * 2); h.fill();                // помпон
    h.fillStyle = 'rgba(0,0,0,0.06)';
    h.beginPath(); h.arc(136, 60, 26, 0, Math.PI * 2); h.fill();
    hatTex = makeTexture(hc);
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
    if (spriteProg) {
      layerCanvas.width = canvas.width;
      layerCanvas.height = canvas.height;
      lgl.viewport(0, 0, layerCanvas.width, layerCanvas.height);
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
    const sc = clip.screen;
    const overClip = clip.level > 0.5 && Math.abs(e.clientX - sc.x) < sc.w / 2 + 12 && e.clientY > sc.top - 8 && e.clientY < sc.top + sc.h;
    document.body.style.cursor = overClip && e.target === document.body ? 'pointer' : '';
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

  // ---------- скрепка-помощник: состояния, облачко с меню, косилка ----------
  const easeOutBack = (t) => { const c1 = 1.70158; return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const PEEK = 0.6;   // «перископ»: над травой только глаза и брови
  const clip = {
    x: 0, z: -5, scale: 1,
    level: 0,          // 0 — в траве, PEEK — выглядывает, 1 — вылезла целиком
    tween: null,       // { from, to, t0, dur, back }
    sweepUntil: 0,     // пока «оглядывается», зрачки водит сценарий, а не курсор
    hopAt: -10,        // момент радостного прыжка
    queue: [],         // отложенные шаги сценария: { at, run }
    screen: { x: 0, top: 0, w: 0 },
  };
  const mow = { active: false, t0: 0, dur: 4.6, zc: 0, hw: 0, x0: 0, x1: 0, x: 0, amount: 0, doneAt: 0, scale: 1 };
  const nowSec = () => performance.now() / 1000;
  const later = (delay, run) => clip.queue.push({ at: nowSec() + delay, run });
  const tweenTo = (to, dur, back = false) => { clip.tween = { from: clip.level, to, t0: nowSec(), dur, back }; };

  // пункты меню, сверху вниз
  const MENU = [
    { label: 'Сменить погоду', action: 'weather' },
    { label: 'Включить ночь', action: 'night' },
    { label: 'Подуть', action: 'wind' },
    { label: 'Покосить траву', action: 'mow' },
  ];
  // ночь и порыв ветра
  const night = { on: false, k: 0, button: null };
  // погода: rain и snow плавно идут к 0 или 1, cover — сколько снега уже легло на траву
  const weather = { mode: 'clear', rain: 0, snow: 0, cover: 0 };
  const gale = { t0: -100, dur: 3.8, k: 0 };
  const ACTIONS = {
    mow: () => startMow(),
    night: () => {
      night.on = !night.on;
      night.button.textContent = night.on ? 'Включить день' : 'Включить ночь';
    },
    // ясно ↔ дождь. Снег пока выключен: чтобы вернуть, добавить сюда третий шаг 'snow'
    weather: () => {
      weather.mode = weather.mode === 'clear' ? 'rain' : 'clear';
      // в снег стеклянные плашки темнеют, чтобы белый текст на них читался
      document.body.classList.toggle('is-snow', weather.mode === 'snow');
    },
    wind: () => {
      if (gale.k > 0.01 || mow.active) return;
      gale.t0 = nowSec();
      say('Ф-ф-фух!', false);
      later(gale.dur, showMenu);
      // карточки слегка качает
      document.body.classList.add('is-gale');
      setTimeout(() => document.body.classList.remove('is-gale'), gale.dur * 1000);
    },
  };
  // интерфейс скрепки: действия стоят столбиком сбоку от неё, каждое на своей стеклянной плашке;
  // клик по скрепке открывает и закрывает меню. Реплики — плашка над головой.
  // Всё это обычный HTML, чтобы текст был чётким
  let bubble = null;   // плашка с репликой
  let pie = null;      // круг действий
  let closeBtn = null; // маленький крестик рядом со скрепкой: спрятать её в траву
  const pieItems = [];
  let pieOpen = false;
  const setPie = (open) => {
    pieOpen = open;
    if (pie) pie.classList.toggle('is-open', open);
    if (open && bubble) bubble.hidden = true;
  };
  const togglePie = () => { if (!mow.active) setPie(!pieOpen); };
  if (spriteProg) {
    bubble = document.createElement('div');
    bubble.className = 'clip-bubble';
    bubble.hidden = true;
    pie = document.createElement('div');
    pie.className = 'clip-pie';
    MENU.forEach((item) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'clip-pie__item';
      b.textContent = item.label;
      if (item.action === 'night') night.button = b;
      b.addEventListener('click', () => ACTIONS[item.action]());
      pie.appendChild(b);
      pieItems.push(b);
    });
    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'clip-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Спрятать скрепку в траву');
    closeBtn.hidden = true;
    closeBtn.addEventListener('click', () => hideClip());
    document.body.append(pie, bubble, closeBtn);
  }
  const say = (text) => {
    if (!bubble) return;
    setPie(false);
    bubble.textContent = text;
    bubble.hidden = false;
  };
  const showMenu = () => setPie(true);
  const quiet = () => { if (bubble) bubble.hidden = true; }; // убрать реплику, меню не открывать
  function hideClip() {
    clip.queue.length = 0;
    setPie(false);
    if (bubble) bubble.hidden = true;
    tweenTo(0, 0.35);
  }
  // вылезти в точке (x, z): сначала перископ и оглядеться, потом целиком и показать меню
  const popUp = (x, z, then, size) => {
    clip.queue.length = 0;
    setPie(false);
    if (bubble) bubble.hidden = true;
    const rise = () => {
      clip.x = x;
      clip.z = z;
      clip.scale = Math.pow(Math.max(1, -z / 5), 0.5);
      clip.size = size || CLIP.size * clip.scale;
      tweenTo(PEEK, 0.45, true);
      clip.sweepUntil = nowSec() + 1.7;
      later(1.7, () => tweenTo(1, 0.5, true));
      later(2.3, then || showMenu);
    };
    if (clip.level > 0.05) { tweenTo(0, 0.25); later(0.3, rise); } else rise();
  };
  // свободная трава под карточками: скрепка, облачко и след косилки стараются жить там,
  // чтобы не закрывать кейсы
  const layoutEl = document.querySelector('.layout');
  const freeTop = () => (layoutEl ? Math.min(layoutEl.getBoundingClientRect().bottom, window.innerHeight) : window.innerHeight * 0.8);
  // сколько экранных пикселей в одной мировой единице высоты в точке (x, z)
  const pxPerUnit = (x, z) => {
    const y = terrain(x, z);
    return Math.abs(toScreen(x, y, z)[1] - toScreen(x, y + 1, z)[1]) || 1;
  };
  // место по умолчанию — правый нижний угол
  const defaultSpot = () => castRay(0.906, 0.928) || castRay(0.5, 0.95) || [2, -4.5];

  function startMow() {
    if (mow.active) return;
    // полоса ложится в свободную траву под карточками и занимает её почти целиком,
    // чтобы след был хорошо виден
    const H = window.innerHeight;
    const ft = freeTop();
    const room = H - ft;
    const far = room >= 60 ? castRay(0.5, (ft + room * 0.12) / H) : null;
    const near = room >= 60 ? castRay(0.5, (ft + room * 0.8) / H) : null;
    if (far && near) {
      mow.zc = (far[1] + near[1]) / 2;
      mow.hw = Math.min(Math.max(Math.abs(far[1] - near[1]) / 2, 0.35), 3);
    } else {
      mow.zc = clip.z - 0.4 * clip.scale;
      mow.hw = 0.6 * clip.scale;
    }
    mow.scale = Math.pow(Math.max(1, -mow.zc / 5), 0.5);
    // косилка ростом примерно с полосу
    mow.h = far && near ? Math.min(room * 0.95, 140) / pxPerUnit(0, mow.zc) : 0.45 * mow.scale;
    const half = -mow.zc * tanHalf * aspect + 1.2;
    mow.x0 = -half;
    mow.x1 = half;
    mow.x = mow.x0;
    mow.t0 = nowSec();
    mow.amount = 1;
    mow.active = true;
    mow.doneAt = 0;
    say('Кошу…', false);
  }

  if (spriteProg) {
    document.addEventListener('click', (e) => {
      if (e.target.closest('a, button, .card, .profile, .topbar, .drawer, .drawer-overlay, .clip-bubble')) return;
      // клик по самой скрепке открывает или закрывает меню
      const s = clip.screen;
      if (clip.level > 0.5 && Math.abs(e.clientX - s.x) < s.w / 2 + 12 && e.clientY > s.top - 8 && e.clientY < s.top + s.h) {
        togglePie();
        return;
      }
      const hit = castRay(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
      if (hit && !mow.active) popUp(hit[0], hit[1]);
    });
    // скопировали почту — радуется в любой момент
    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-copy-email]')) return;
      const wasHidden = clip.level < 0.05 && !clip.tween;
      const cheer = () => {
        clip.hopAt = nowSec();
        say('Ждём письмо!', false);
        later(3, wasHidden ? hideClip : quiet);
      };
      if (wasHidden) { const s = defaultSpot(); popUp(s[0], s[1], cheer); } else { clip.queue.length = 0; tweenTo(1, 0.3, true); cheer(); }
    });
    // сама появляется через 5 секунд (на телефоне — только по тапу на траву)
    if (window.innerWidth > 640) {
      setTimeout(() => { if (clip.level < 0.05 && !clip.tween) { const s = defaultSpot(); popUp(s[0], s[1]); } }, 5000);
    }
  }

  // мировая точка → экранные пиксели
  const toScreen = (x, y, z) => {
    const m = viewProj;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(cx / cw * 0.5 + 0.5) * window.innerWidth, (0.5 - cy / cw * 0.5) * window.innerHeight];
  };
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

    // ночь наступает и уходит плавно; порыв ветра — быстро налетает, держится и стихает
    night.k += ((night.on ? 1 : 0) - night.k) * Math.min(1, dt / 600);
    const gt = now / 1000 - gale.t0;
    gale.k = gt < 0.4 ? gt / 0.4 : gt < 2.4 ? 1 : gt < gale.dur ? 1 - (gt - 2.4) / (gale.dur - 2.4) : 0;
    // погода: дождь и снег сменяют друг друга плавно; снег ложится медленно, тает быстрее
    const sec = Math.min(dt / 1000, 0.1);
    weather.rain += ((weather.mode === 'rain' ? 1 : 0) - weather.rain) * Math.min(1, sec * 1.6);
    weather.snow += ((weather.mode === 'snow' ? 1 : 0) - weather.snow) * Math.min(1, sec * 1.6);
    weather.cover = Math.min(1, Math.max(0, weather.cover + (weather.mode === 'snow' ? sec / 9 : -sec / 3.5)));
    const fog = FOG.map((c, i) => {
      let v = c + ([0.6, 0.65, 0.69][i] - c) * weather.rain;
      v += ([0.7, 0.77, 0.87][i] - v) * Math.max(weather.snow, weather.cover);
      return v + ([0.06, 0.09, 0.2][i] - v) * night.k;
    });

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(sky.p);
    gl.uniform3fv(sky.u.uTop, SKY_TOP);
    gl.uniform3fv(sky.u.uHorizon, SKY_HORIZON);
    gl.uniform1f(sky.u.uNight, night.k);
    gl.uniform1f(sky.u.uTime, time);
    gl.uniform1f(sky.u.uAspect, aspect);
    gl.uniform2f(sky.u.uWeather, weather.rain, weather.snow);
    gl.bindVertexArray(skyVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(ground.p);
    gl.uniformMatrix4fv(ground.u.uViewProj, false, viewProj);
    gl.uniform3fv(ground.u.uEye, eye);
    gl.uniform3fv(ground.u.uSun, SUN);
    gl.uniform3fv(ground.u.uFog, fog);
    gl.uniform1f(ground.u.uNight, night.k);
    gl.uniform1f(ground.u.uCover, weather.cover);
    gl.bindVertexArray(groundVao);
    gl.drawElements(gl.TRIANGLES, gi.length, gl.UNSIGNED_SHORT, 0);

    gl.useProgram(blades.p);
    gl.uniformMatrix4fv(blades.u.uViewProj, false, viewProj);
    gl.uniform3fv(blades.u.uEye, eye);
    gl.uniform3fv(blades.u.uSun, SUN);
    gl.uniform1f(blades.u.uTime, time);
    gl.uniform4f(blades.u.uMouse, mouseWorld[0], mouseWorld[1], strength, mouseWorld[2]);
    gl.uniform4f(blades.u.uMow, mow.zc, mow.hw, mow.x, mow.amount);
    gl.uniform3fv(blades.u.uFog, fog);
    gl.uniform1f(blades.u.uGale, gale.k);
    gl.uniform1f(blades.u.uNight, night.k);
    gl.uniform1f(blades.u.uRain, weather.rain);
    gl.uniform1f(blades.u.uCover, weather.cover);
    gl.bindVertexArray(bladeVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, BLADE_VERTS, bladeCount);

    if (flies && night.k > 0.01) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.useProgram(flies.p);
      gl.uniformMatrix4fv(flies.u.uViewProj, false, viewProj);
      gl.uniform1f(flies.u.uTime, time);
      gl.uniform1f(flies.u.uNight, night.k);
      gl.uniform1f(flies.u.uPx, canvas.height / 2 / tanHalf);
      gl.bindVertexArray(flyVao);
      gl.drawArrays(gl.POINTS, 0, FLY_COUNT);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    if (precip && (weather.rain > 0.01 || weather.snow > 0.01)) {
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(precip.p);
      gl.uniform1f(precip.u.uTime, time);
      gl.uniform1f(precip.u.uAspect, aspect);
      gl.uniform2f(precip.u.uWeather, weather.rain, weather.snow);
      gl.bindVertexArray(skyVao); // тот же прямоугольник на весь экран
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    }

    // ---------- скрепка, зрачки и косилка на верхнем слое ----------
    if (spriteProg) {
      const nowS = now / 1000;
      // сценарий и анимация подъёма
      for (let i = clip.queue.length - 1; i >= 0; i--) {
        if (clip.queue[i].at <= nowS) { const step = clip.queue.splice(i, 1)[0]; step.run(); }
      }
      if (clip.tween) {
        const tw = clip.tween;
        const k = Math.min((nowS - tw.t0) / tw.dur, 1);
        clip.level = tw.from + (tw.to - tw.from) * (tw.back ? easeOutBack(k) : k * k * (3 - 2 * k));
        if (k >= 1) clip.tween = null;
      }
      // косилка едет слева направо, потом трава понемногу отрастает
      if (mow.active) {
        const k = Math.min((nowS - mow.t0) / mow.dur, 1);
        mow.x = mow.x0 + (mow.x1 - mow.x0) * k;
        if (k >= 1) { mow.active = false; mow.doneAt = nowS; say('Готово. Ровненько!', false); later(2.2, showMenu); }
      } else if (mow.doneAt && nowS - mow.doneAt > 15) {
        mow.amount = Math.max(0, 1 - (nowS - mow.doneAt - 15) / 3);
        if (mow.amount === 0) mow.doneAt = 0;
      }

      lgl.clearColor(0, 0, 0, 0);
      lgl.clear(lgl.COLOR_BUFFER_BIT);
      const visible = clip.level > 0.01 && CLIP.ready;
      if (visible || mow.active) {
        lgl.enable(lgl.BLEND);
        lgl.blendFunc(lgl.ONE, lgl.ONE_MINUS_SRC_ALPHA);
        lgl.useProgram(spriteProg.p);
        lgl.uniformMatrix4fv(spriteProg.u.uViewProj, false, viewProj);
        lgl.uniform3fv(spriteProg.u.uEye, eye);
        lgl.uniform3fv(spriteProg.u.uFog, fog);
        lgl.uniform1f(spriteProg.u.uDim, 1 - 0.45 * night.k);
        lgl.activeTexture(lgl.TEXTURE0);
        lgl.uniform1i(spriteProg.u.uTex, 0);
        lgl.bindVertexArray(spriteVao);
      }
      // по умолчанию опора — середина нижнего края, без наклона
      const drawSprite = (tex, x, y, z, w, h, groundY, fade, rot = 0, pu = 0.5, pv = 0) => {
        lgl.bindTexture(lgl.TEXTURE_2D, tex);
        lgl.uniform3f(spriteProg.u.uPos, x, y, z);
        lgl.uniform2f(spriteProg.u.uSize, w, h);
        lgl.uniform2f(spriteProg.u.uPivot, pu, pv);
        lgl.uniform1f(spriteProg.u.uRot, rot);
        lgl.uniform1f(spriteProg.u.uGround, groundY);
        lgl.uniform1f(spriteProg.u.uFade, fade);
        lgl.drawArrays(lgl.TRIANGLE_STRIP, 0, 4);
      };

      let mowerScreen = null;
      const mowerY = mow.active ? terrain(mow.x, mow.zc) : 0;
      const mowerH = mow.h || 0.4 * mow.scale;
      if (mow.active) mowerScreen = toScreen(mow.x, mowerY + mowerH * 0.5, mow.zc);

      const drawMower = () => mowerTex && drawSprite(mowerTex, mow.x, mowerY - mowerH * 0.1, mow.zc, mowerH * MOWER_ASPECT, mowerH, mowerY, 0.14 * mowerH);
      if (mow.active && mow.zc <= clip.z) drawMower();

      if (visible) {
        const size = clip.size || CLIP.size * clip.scale;
        const w = size * CLIP.aspect;
        const groundY = terrain(clip.x, clip.z);
        const hopT = nowS - clip.hopAt;
        const hop = hopT < 0.9 ? Math.abs(Math.sin(hopT * Math.PI / 0.3)) * (1 - hopT / 0.9) * 0.22 * size : 0;
        const bob = Math.sin(nowS * 2.2) * 0.01 * size;
        // level 0 — верх картинки на уровне земли, level 1 — скрыта только нижняя часть (sink)
        const baseY = groundY - size * (CLIP.sink + (1 - CLIP.sink) * (1 - clip.level)) + bob + hop;
        const fade = 0.12 * size;
        const blown = gale.k * 0.07 * size;

        // в дождь скрепка держит зонтик: крючок ручки висит на её правом «усике», трость уходит
        // за глаз, купол наклонён над головой. Зонт рисуется раньше скрепки, то есть позади неё,
        // вырастает из «руки» вместе с погодой, чуть покачивается и клонится по ветру
        if (weather.rain > 0.02 && umbrellaTex) {
          const s = easeOutBack(Math.min(weather.rain * 1.15, 1));
          const uw = 1.95 * w * s;
          const uh = uw / UMBRELLA_ASPECT;
          const tilt = 0.25 + Math.sin(nowS * 1.3) * 0.025 - gale.k * 0.42;
          drawSprite(umbrellaTex, clip.x + blown + 0.425 * w, baseY + 0.525 * size, clip.z, uw, uh, groundY, fade, tilt, 0.455, 0.075);
        }

        drawSprite(CLIP.tex, clip.x + blown, baseY, clip.z, w, size, groundY, fade);

        // зрачки: смотрят на курсор (или на косилку, или оглядываются по сценарию)
        const pr = CLIP.pupilR * size;
        CLIP.eyes.forEach(([u, v]) => {
          const ex = clip.x + blown + (u - 0.5) * w;
          const ey = baseY + (1 - v) * size;
          const es = toScreen(ex, ey, clip.z);
          let dx, dy;
          if (nowS < clip.sweepUntil) {
            dx = Math.sin((clip.sweepUntil - nowS) * 4.2) * 200;
            dy = -30;
          } else if (gale.k > 0.05) {
            dx = 300;
            dy = -20;
          } else if (mowerScreen) {
            dx = mowerScreen[0] - es[0];
            dy = mowerScreen[1] - es[1];
          } else {
            dx = mx * window.innerWidth - es[0];
            dy = my * window.innerHeight - es[1];
          }
          const dist = Math.hypot(dx, dy) || 1;
          const reach = Math.min(dist / 220, 1) * (CLIP.eyeR - CLIP.pupilR) * 0.8 * size;
          const px2 = ex + (dx / dist) * reach;
          const py2 = ey - (dy / dist) * reach;
          drawSprite(pupilTex, px2, py2 - pr, clip.z, pr * 2, pr * 2, groundY, fade);
        });

        // в снег на скрепке шапка, вырастает вместе с погодой
        if (weather.snow > 0.02) {
          const s = easeOutBack(Math.min(weather.snow * 1.15, 1));
          const hw = 0.82 * w * s;
          drawSprite(hatTex, clip.x + blown + 0.03 * w, baseY + size * 0.885, clip.z, hw, hw / HAT_ASPECT, groundY, fade);
        }

        // положение на экране — для облачка
        // без покачивания и прыжка, чтобы пункты меню стояли неподвижно, а не плавали вместе со скрепкой
        const restY = baseY - bob - hop + size;
        const top = toScreen(clip.x, restY, clip.z);
        const edge = toScreen(clip.x + w / 2, restY, clip.z);
        clip.screen.x = top[0];
        clip.screen.top = top[1];
        clip.screen.w = (edge[0] - top[0]) * 2;
        clip.screen.h = clip.screen.w / CLIP.aspect;
      }

      if (mow.active && mow.zc > clip.z) drawMower();

      // интерфейс вокруг головы скрепки: реплика и круг действий
      if (bubble) {
        if (!visible && !clip.tween) { bubble.hidden = true; if (pieOpen) setPie(false); }
        const cx = clip.screen.x;
        const headY = clip.screen.top + clip.screen.h * 0.3;
        // крестик — справа от головы, пока скрепка стоит целиком
        closeBtn.hidden = !(visible && clip.level > 0.9 && !clip.tween && !mow.active);
        if (!closeBtn.hidden) {
          closeBtn.style.transform = 'translate(' + Math.round(cx + clip.screen.w * 0.5 + 4) + 'px, ' + Math.round(clip.screen.top + 14) + 'px) translate(0, -50%)';
        }
        if (!bubble.hidden && visible) {
          // под дождём реплика поднимается над зонтиком
          const lift = 18 + Math.min(weather.rain, 1) * clip.screen.h * 0.54;
          // место задаётся свойством translate, чтобы scale при появлении рос от самой плашки
          bubble.style.translate = `calc(${Math.round(cx)}px - 50%) calc(${Math.round(clip.screen.top - lift)}px - 100%)`;
        }
        if (pieOpen && visible) {
          // как в макете: пункты стоят столбиком сбоку от скрепки, слегка дугой —
          // крайние ближе к ней, средние дальше. Если слева нет места — уходят вправо
          const s = clip.screen.h / 166;               // макет рассчитан на скрепку высотой 166 px
          const half = clip.screen.w / 2;
          const toLeft = cx - half - 190 > 12;
          const gaps = [11, 41, 41, 6];
          pieItems.forEach((b, i) => {
            const gap = gaps[i % gaps.length] * s;
            const x = toLeft ? cx - half - gap : cx + half + gap;
            const y = clip.screen.top + i * 50.5 * s;
            b.style.translate = `calc(${Math.round(x)}px - ${toLeft ? '100%' : '0%'}) calc(${Math.round(y)}px - 50%)`;
          });
        }
      }
    }    if (!shown) { shown = true; canvas.classList.add('is-ready'); }
    requestAnimationFrame(frame);
  };

  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
