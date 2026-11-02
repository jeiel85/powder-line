import * as THREE from 'three';
import { mulberry32, smoothstep } from './util.js';
import { jitter, mergeColored } from './geo.js';

/** 반복 타일되는 설면 미세 요철 노멀맵 (랜덤 높이장을 순환 블러로 부드럽게) */
let snowNormal = null;
function getSnowNormal() {
  if (snowNormal) return snowNormal;
  const N = 256;
  const rng = mulberry32(99);
  const noise = new Float32Array(N * N).map(() => rng());
  const blur = (src, r, sx, sy) => {
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += src[((y + k * sy + N) % N) * N + ((x + k * sx + N) % N)];
        out[y * N + x] = sum / (2 * r + 1);
      }
    return out;
  };
  // 가로로 늘어진 바람 자국(사스트루기) 느낌을 위해 x 방향을 더 흐린다
  const coarse = blur(blur(noise, 6, 1, 0), 3, 0, 1);
  const fine = blur(blur(noise, 1, 1, 0), 1, 0, 1);
  const h = coarse.map((v, i) => v * 0.8 + fine[i] * 0.35);
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const k = 9;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)]) * k;
      const dy = (h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x]) * k;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * N + x) * 4;
      img.data[o] = (-dx / len * 0.5 + 0.5) * 255;
      img.data[o + 1] = (-dy / len * 0.5 + 0.5) * 255;
      img.data[o + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  snowNormal = new THREE.CanvasTexture(c);
  snowNormal.wrapS = snowNormal.wrapT = THREE.RepeatWrapping;
  snowNormal.anisotropy = 8;
  return snowNormal;
}

/**
 * 눈이 쌓인 층층 가문비나무. 각 층 윗면에만 눈을 얹는다.
 * quality 'low'(모바일 등)는 층·분할 수를 줄여 그루당 삼각형을 절반 이하로 낮춘다.
 */
export function treeGeometry(seed, quality = 'high') {
  const low = quality === 'low';
  const rng = mulberry32(seed);
  const green = new THREE.Color('#2f5d43');
  const dark = new THREE.Color('#1b3a2b');
  const snow = new THREE.Color('#f4f8ff');
  const parts = [];
  const tiers = low ? 4 : 5;
  const spacing = (0.92 * 4) / (tiers - 1); // 층 수와 무관하게 전체 높이는 같게
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const radius = 1.75 * (1 - t * 0.78);
    const height = (1.9 - t * 0.45) * (low ? 1.12 : 1);
    const y = 0.9 + i * spacing;
    const g = jitter(new THREE.ConeGeometry(radius, height, low ? 7 : 11, low ? 2 : 3), 0.13, rng);
    g.translate(0, y + height / 2, 0);
    const phase = rng() * 6;
    parts.push({
      geo: g,
      colorFn: (p, n, c) => {
        if (n.y < -0.3) return c.copy(dark);
        const frac = (p.y - y) / height;
        const wave = 0.5 + 0.5 * Math.sin(Math.atan2(p.z, p.x) * 5 + phase);
        const amount = smoothstep(0.32, 0.62, frac) * (0.55 + 0.45 * wave);
        return c.copy(green).lerp(dark, 1 - frac).lerp(snow, amount);
      },
    });
  }
  const top = new THREE.ConeGeometry(0.28, 0.7, low ? 6 : 8);
  top.translate(0, 0.9 + 5 * 0.92 + 0.6, 0);
  parts.push({ geo: top, color: snow });
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 1.4, low ? 5 : 7);
  trunk.translate(0, 0.7, 0);
  parts.push({ geo: trunk, color: '#4a3426' });
  return mergeColored(parts);
}

/** 윗면에 눈이 덮인 각진 바위 */
function rockGeometry(seed) {
  const rng = mulberry32(seed);
  const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.22, rng);
  const stone = new THREE.Color('#7d8693');
  const snow = new THREE.Color('#f2f6fd');
  return mergeColored([{ geo: g, colorFn: (p, n, c) => c.copy(stone).lerp(snow, smoothstep(0.45, 0.7, n.y)) }]);
}

let snowSprite = null;
function getSnowSprite() {
  if (snowSprite) return snowSprite;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  snowSprite = new THREE.CanvasTexture(c);
  return snowSprite;
}

function textTexture(text, bg, fg, aspect) {
  const c = document.createElement('canvas');
  c.height = 128;
  c.width = Math.min(4096, Math.round(128 * aspect));
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (let x = 0; x < c.width; x += 64) g.fillRect(x, 0, 32, 10);
  g.font = '700 92px "Bebas Neue", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = fg;
  g.fillText(text, c.width / 2, c.height / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 보드 뒤로 튀는 눈 파티클 */
class Spray {
  constructor(count, color) {
    this.n = count;
    this.pos = new Float32Array(count * 3).fill(-1e5);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({
      size: 0.32, map: getSnowSprite(), transparent: true, depthWrite: false, color, opacity: 0.95,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }
  emit(p, v, count, spread, lift = 1.5) {
    for (let c = 0; c < count; c++) {
      const i = this.next++ % this.n;
      const o = i * 3;
      this.pos[o] = p.x + (Math.random() - 0.5) * 0.4;
      this.pos[o + 1] = p.y + Math.random() * 0.15;
      this.pos[o + 2] = p.z + (Math.random() - 0.5) * 0.4;
      this.vel[o] = v.x * 0.35 + (Math.random() - 0.5) * spread;
      this.vel[o + 1] = lift * (0.4 + Math.random()) + Math.random() * spread * 0.3;
      this.vel[o + 2] = v.z * 0.35 + (Math.random() - 0.5) * spread;
      this.life[i] = 0.35 + Math.random() * 0.45;
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      const o = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[o + 1] = -1e5;
        continue;
      }
      this.vel[o + 1] -= 7 * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/** 코스 데이터를 Three.js 씬 오브젝트로 만든다. */
export function buildWorld(course, quality = 'high') {
  const track = course.track;
  const env = track.env;
  const group = new THREE.Group();
  const half = course.half;
  const rng = mulberry32(track.seed + 5);

  // ── 지형 메쉬 (중심선을 따라 휘는 격자, 코스 안쪽은 촘촘하게) ──
  const W = half + 100;
  const us = [];
  const innerW = half + 6;
  const innerN = Math.round((innerW * 2) / (quality === 'low' ? 2 : 1.25));
  for (let i = 0; i <= innerN; i++) us.push(-innerW + (i * 2 * innerW) / innerN);
  const outerN = 16;
  for (let j = 1; j <= outerN; j++) {
    const t = j / outerN;
    const u = innerW + (W - innerW) * (t * t * 0.5 + t * 0.5);
    us.push(u, -u);
  }
  us.sort((a, b) => a - b);
  const nu = us.length;
  const s0 = -80, s1 = course.length + 140;
  const ds = quality === 'low' ? 1.5 : 1;
  const nr = Math.round((s1 - s0) / ds) + 1;
  const pos = new Float32Array(nu * nr * 3);
  const col = new Float32Array(nu * nr * 3);
  const cSnow = new THREE.Color('#f6f9ff');
  const cOff = new THREE.Color(env.time === 'sunset' ? '#e9dfe6' : '#dbe5f3');
  const cKick = new THREE.Color('#dcecff');
  const cLip = new THREE.Color('#3f97ff');
  const cTmp = new THREE.Color();
  for (let r = 0; r < nr; r++) {
    const s = s0 + r * ds;
    const c = course.center(s);
    for (let i = 0; i < nu; i++) {
      const u = us[i];
      const x = c + u;
      const o = (r * nu + i) * 3;
      pos[o] = x;
      pos[o + 1] = course.height(x, s);
      pos[o + 2] = -s;
      cTmp.copy(cSnow).lerp(cOff, smoothstep(half - 1, half + 14, Math.abs(u)));
      if (course.kickAt(u, s) > 0.02) {
        cTmp.lerp(cKick, 0.8);
        if (course.isLip(u, s)) cTmp.lerp(cLip, 0.75);
      }
      // 결승선/출발선 띠
      if (Math.abs(s - course.length) < 0.8 && Math.abs(u) < half) cTmp.set('#ff4a3d');
      if (Math.abs(s - 10) < 0.6 && Math.abs(u) < half) cTmp.set('#2a7bff');
      col[o] = cTmp.r;
      col[o + 1] = cTmp.g;
      col[o + 2] = cTmp.b;
    }
  }
  const idx = new Uint32Array((nr - 1) * (nu - 1) * 6);
  let k = 0;
  for (let r = 0; r < nr - 1; r++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = r * nu + i, b = a + 1, c = a + nu, d = c + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // 노멀맵용 월드 기준 UV (7m마다 반복)
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    uv[j] = pos[i] / 7;
    uv[j + 1] = pos[i + 2] / 7;
  }
  tGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  tGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  tGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    tGeo,
    new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.72, metalness: 0,
      normalMap: getSnowNormal(), normalScale: new THREE.Vector2(0.38, 0.38),
    }),
  );
  terrain.receiveShadow = true;
  group.add(terrain);

  // ── 나무 (인스턴싱) ──
  // 모양이 다른 3종을 번갈아 써서 숲이 복제된 티가 덜 나게 한다
  const trees = course.trees;
  const VARIANTS = 3;
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true });
  const treeMeshes = Array.from({ length: VARIANTS }, (_, v) =>
    new THREE.InstancedMesh(treeGeometry(track.seed * 7 + v, quality), treeMat, Math.ceil(trees.length / VARIANTS)));
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const tp = new THREE.Vector3();
  const tint = new THREE.Color();
  const counts = new Array(VARIANTS).fill(0);
  const shade = env.time === 'night' ? 0.55 : 1;
  trees.forEach((t, i) => {
    const im = treeMeshes[i % VARIANTS];
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
    sc.set(t.sc, t.sc * (0.88 + (i % 5) * 0.06), t.sc);
    mtx.compose(tp.set(t.x, t.y, -t.s), q, sc);
    const n = counts[i % VARIANTS]++;
    im.setMatrixAt(n, mtx);
    // 정점 색(눈·잎)에 곱해지는 그루별 밝기·색조 차이
    tint.setHSL(0.3 + rng() * 0.1, 0.2, 0.5).multiplyScalar(2 * (0.82 + rng() * 0.18) * shade);
    im.setColorAt(n, tint);
  });
  treeMeshes.forEach((im, v) => {
    im.count = counts[v];
    im.castShadow = true;
    im.receiveShadow = quality !== 'low';
    group.add(im);
  });

  // ── 바위 ──
  const rocks = course.rocks;
  const rockM = new THREE.InstancedMesh(
    rockGeometry(track.seed + 11),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }),
    rocks.length,
  );
  const grey = new THREE.Color();
  rocks.forEach((r, i) => {
    // 윗면 눈이 위를 향하도록 기울기는 작게
    q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.4, r.rot, (rng() - 0.5) * 0.4));
    sc.set(r.sc * 1.25, r.sc * 0.75, r.sc);
    mtx.compose(tp.set(r.x, r.y, -r.s), q, sc);
    rockM.setMatrixAt(i, mtx);
    grey.setScalar((0.85 + rng() * 0.25) * (env.time === 'night' ? 0.6 : 1));
    rockM.setColorAt(i, grey);
  });
  rockM.castShadow = rockM.receiveShadow = true;
  group.add(rockM);

  // ── 경계 폴 / 가로등 ──
  const poleG = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6);
  poleG.translate(0, 0.8, 0);
  if (course.poles.length) {
    const poles = new THREE.InstancedMesh(poleG, new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.5 }), course.poles.length);
    course.poles.forEach((p, i) => {
      mtx.makeTranslation(p.x, p.y, -p.s);
      poles.setMatrixAt(i, mtx);
    });
    group.add(poles);
  }
  const lampLights = [];
  if (course.lamps.length) {
    const postG = new THREE.CylinderGeometry(0.08, 0.1, 5, 6);
    postG.translate(0, 2.5, 0);
    const posts = new THREE.InstancedMesh(postG, new THREE.MeshStandardMaterial({ color: '#2b313d', roughness: 0.6 }), course.lamps.length);
    const bulbG = new THREE.SphereGeometry(0.28, 10, 8);
    const bulbs = new THREE.InstancedMesh(bulbG, new THREE.MeshBasicMaterial({ color: '#ffe2a8' }), course.lamps.length);
    course.lamps.forEach((l, i) => {
      mtx.makeTranslation(l.x, l.y, -l.s);
      posts.setMatrixAt(i, mtx);
      mtx.makeTranslation(l.x - l.side * 0.6, l.y + 5.05, -l.s);
      bulbs.setMatrixAt(i, mtx);
    });
    posts.castShadow = true;
    group.add(posts, bulbs);
    // 라이더 근처 가로등에만 실제 광원을 붙인다
    for (let i = 0; i < 6; i++) {
      const pl = new THREE.PointLight('#ffd08a', 60, 30, 1.6);
      group.add(pl);
      lampLights.push(pl);
    }
  }

  // ── 슬라럼 게이트 ──
  const gateObjs = course.gates.map((g) => {
    const color = g.side > 0 ? '#ff3b4a' : '#2f6bff';
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, side: THREE.DoubleSide, emissive: color, emissiveIntensity: env.time === 'night' ? 0.6 : 0.1 });
    const grp = new THREE.Group();
    const flags = [];
    const rings = [];
    const ringMat = new THREE.MeshBasicMaterial({ color: '#7dffb0' });
    for (const sx of [-1, 1]) {
      const x = g.x + (sx * g.w) / 2;
      const y = course.height(x, g.s);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6), mat);
      pole.position.set(x, y + 0.95, -g.s);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.55), mat);
      flag.position.set(x - sx * 0.4, y + 1.55, -g.s);
      pole.castShadow = flag.castShadow = true;
      // 통과 표시: 색 말고 모양으로도 구분되도록 폴 위에 고리를 띄운다
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 8, 20), ringMat);
      ring.position.set(x, y + 2.25, -g.s);
      ring.visible = false;
      grp.add(pole, flag, ring);
      flags.push(flag);
      rings.push(ring);
    }
    group.add(grp);
    return { gate: g, mat, flags, rings };
  });

  // ── 킥커 측면 마커 ──
  const coneG = new THREE.ConeGeometry(0.22, 0.6, 8);
  coneG.translate(0, 0.3, 0);
  const coneMat = new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.5, emissive: '#ff7a1a', emissiveIntensity: env.time === 'night' ? 0.5 : 0.05 });
  for (const kk of course.kickers) {
    for (const sx of [-1, 1]) {
      const s = kk.s + kk.len - 0.4;
      const x = course.center(s) + kk.x + sx * (kk.w / 2 + 0.4);
      const cone = new THREE.Mesh(coneG, coneMat);
      cone.position.set(x, course.height(x, s), -s);
      group.add(cone);
    }
  }

  // ── 출발/결승 아치 ──
  const arch = (s, text, bg) => {
    const c = course.center(s);
    const span = half * 0.9;
    const postMat = new THREE.MeshStandardMaterial({ color: '#1d2230', roughness: 0.6 });
    for (const sx of [-1, 1]) {
      const x = c + sx * span;
      const y = course.height(x, s);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), postMat);
      p.position.set(x, y + 3.5, -s);
      p.castShadow = true;
      group.add(p);
    }
    const yMid = course.height(c, s);
    const banH = 1.8;
    const ban = new THREE.Mesh(
      new THREE.PlaneGeometry(span * 2, banH),
      new THREE.MeshBasicMaterial({ map: textTexture(text, bg, '#ffffff', (span * 2) / banH), side: THREE.DoubleSide, fog: true }),
    );
    ban.position.set(c, yMid + 7 - banH / 2, -s);
    group.add(ban);
  };
  arch(10, `${track.en} · START`, '#1f5fd6');
  arch(course.length, 'FINISH', '#e3352b');

  // ── 하늘 / 원경 산 / 별 ──
  const sunDir = new THREE.Vector3(...env.sunDir).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1600, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(env.skyTop) },
        bottom: { value: new THREE.Color(env.skyBottom) },
        sunDir: { value: sunDir },
        sunCol: { value: new THREE.Color(env.sun) },
        night: { value: env.time === 'night' ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float night;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y * 1.5 + 0.1, 0.0, 1.0);
          vec3 c = mix(bottom, top, pow(h, 0.75));
          float d = max(dot(normalize(vDir), sunDir), 0.0);
          float disc = smoothstep(0.9993, 0.9997, d);
          float glow = pow(d, mix(18.0, 60.0, night)) * mix(0.55, 0.25, night);
          c += sunCol * (glow + disc * mix(1.4, 0.9, night));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -10;
  group.add(sky);

  // 원경 산: 각진 능선 + 높이에 따라 눈 덮인 정상
  const rockCol = new THREE.Color(env.mountain).multiplyScalar(0.62);
  const snowCol = new THREE.Color(env.mountain).lerp(new THREE.Color('#ffffff'), 0.65);
  const peakParts = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + rng() * 0.1;
    const r = 1000 + rng() * 250;
    const h = 160 + rng() * 340;
    // 밑면은 열어 두고 지평선 아래로 충분히 내려 산이 떠 보이지 않게 한다
    const g = jitter(new THREE.ConeGeometry(h * (0.8 + rng() * 0.5), h, 8 + Math.floor(rng() * 4), 5, true), 0.16, rng, true);
    g.rotateY(rng() * Math.PI);
    g.translate(Math.cos(a) * r, h / 2 - 230, Math.sin(a) * r);
    const line = 0.45 + rng() * 0.2;
    peakParts.push({
      geo: g,
      colorFn: (p, n, c) => {
        const frac = (p.y + 230) / h;
        const snowy = smoothstep(line - 0.08, line + 0.04, frac + n.y * 0.25);
        return c.copy(rockCol).lerp(snowCol, snowy);
      },
    });
  }
  const mountains = new THREE.Mesh(
    mergeColored(peakParts),
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, fog: false }),
  );
  group.add(mountains);

  let stars = null;
  if (env.stars) {
    const n = 900;
    const sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = rng() * Math.PI * 2;
      const y = 0.08 + rng() * 0.92;
      const rr = Math.sqrt(1 - y * y);
      sp[i * 3] = Math.cos(th) * rr * 1400;
      sp[i * 3 + 1] = y * 1400;
      sp[i * 3 + 2] = Math.sin(th) * rr * 1400;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, color: '#dfe8ff', fog: false, depthWrite: false }));
    group.add(stars);
  }

  // ── 내리는 눈 ──
  let snow = null;
  const SNOW_BOX = 70;
  if (env.snowfall > 0) {
    const n = quality === 'low' ? Math.floor(env.snowfall / 2) : env.snowfall;
    const sp = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) sp[i] = (rng() - 0.5) * SNOW_BOX;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    snow = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, map: getSnowSprite(), transparent: true, depthWrite: false, color: '#ffffff', opacity: 0.9 }));
    snow.frustumCulled = false;
    group.add(snow);
  }

  const spray = new Spray(quality === 'low' ? 300 : 700, env.time === 'night' ? '#c8d6ff' : '#ffffff');
  group.add(spray.points);

  // ── 조명 ──
  const hemi = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemiI);
  const sun = new THREE.DirectionalLight(env.sun, env.sunI);
  sun.castShadow = true;
  const smSize = quality === 'low' ? 1024 : 2048;
  sun.shadow.mapSize.set(smSize, smSize);
  const sc2 = sun.shadow.camera;
  sc2.left = -30; sc2.right = 30; sc2.top = 30; sc2.bottom = -30; sc2.near = 1; sc2.far = 200;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  group.add(hemi, sun, sun.target);

  let time = 0;

  return {
    group, spray, gateObjs,
    setGateState(i, state) {
      const o = gateObjs[i];
      if (!o) return;
      const passed = state === 'passed';
      const c = passed ? '#2fd36b' : '#7a808c';
      o.mat.color.set(c);
      o.mat.emissive.set(c);
      // 통과 = 고리 표시, 놓침 = 깃발이 사라진다 (색각과 무관하게 구분 가능)
      for (const r of o.rings) r.visible = passed;
      for (const f of o.flags) f.visible = passed;
    },
    resetGates() {
      for (const o of gateObjs) {
        const c = o.gate.side > 0 ? '#ff3b4a' : '#2f6bff';
        o.mat.color.set(c);
        o.mat.emissive.set(c);
        for (const r of o.rings) r.visible = false;
        for (const f of o.flags) f.visible = true;
      }
    },
    update(dt, camera, focus) {
      time += dt;
      sky.position.copy(camera.position);
      if (stars) stars.position.copy(camera.position);
      mountains.position.set(camera.position.x, camera.position.y, camera.position.z);
      sun.position.copy(focus).addScaledVector(sunDir, 80);
      sun.target.position.copy(focus);
      if (snow) {
        const arr = snow.geometry.attributes.position.array;
        const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
        const hb = SNOW_BOX / 2;
        for (let i = 0; i < arr.length; i += 3) {
          arr[i] += Math.sin(time * 0.7 + i) * 0.4 * dt + 0.6 * dt;
          arr[i + 1] -= (1.6 + (i % 7) * 0.12) * dt;
          arr[i + 2] += 0.3 * dt;
          if (arr[i] - cx > hb) arr[i] -= SNOW_BOX; else if (arr[i] - cx < -hb) arr[i] += SNOW_BOX;
          if (arr[i + 1] - cy > hb) arr[i + 1] -= SNOW_BOX; else if (arr[i + 1] - cy < -hb) arr[i + 1] += SNOW_BOX;
          if (arr[i + 2] - cz > hb) arr[i + 2] -= SNOW_BOX; else if (arr[i + 2] - cz < -hb) arr[i + 2] += SNOW_BOX;
        }
        snow.geometry.attributes.position.needsUpdate = true;
      }
      if (lampLights.length) {
        const s = -focus.z;
        const near = course.lamps
          .filter((l) => l.s > s - 30 && l.s < s + 70)
          .sort((a, b) => Math.abs(a.s - s - 15) - Math.abs(b.s - s - 15));
        lampLights.forEach((pl, i) => {
          const l = near[i];
          if (l) {
            pl.visible = true;
            pl.position.set(l.x - l.side * 0.6, l.y + 4.6, -l.s);
          } else pl.visible = false;
        });
      }
      spray.update(dt);
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m.map && m.map !== snowSprite) m.map.dispose();
            if (m.normalMap && m.normalMap !== snowNormal) m.normalMap.dispose();
            m.dispose();
          }
        }
        if (o.dispose && o.isLight) o.dispose();
      });
    },
  };
}
