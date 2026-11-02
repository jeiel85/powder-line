import { makeNoise, mulberry32, smoothstep } from './util.js';

/**
 * 트랙 정의. 좌표계: s = 출발점에서 내려온 거리(m), 월드 z = -s.
 * curve: [주파수, 진폭(m), 위상] 사인 합으로 코스 중심선이 좌우로 휜다.
 */
export const TRACKS = [
  {
    id: 'pine',
    name: '파인 밸리',
    en: 'PINE VALLEY',
    difficulty: 1,
    desc: '전나무 숲 사이로 흐르는 완만한 입문 코스. 슬라럼 게이트와 작은 킥커로 감을 잡아보세요.',
    length: 1100,
    width: 44,
    slope: 0.2,
    seed: 7,
    bumps: 1.0,
    curve: [[0.0045, 22, 0.3], [0.012, 7, 1.7]],
    kickers: [
      { s: 200, h: 1.8, len: 8 },
      { s: 430, h: 2.4, len: 9, x: -6 },
      { s: 640, h: 2.4, len: 9, x: 7 },
      { s: 880, h: 3.0, len: 10, w: 10 },
    ],
    gates: { start: 120, every: 70, offset: 0.24, width: 7 },
    trees: 1300,
    treesInside: 26,
    rocks: 24,
    rocksInside: 6,
    env: {
      time: 'day',
      skyTop: '#3d7fd8', skyBottom: '#d6ecff', fog: '#d3e5f5', fogNear: 80, fogFar: 600,
      sun: '#fff1d6', sunI: 2.1, sunDir: [0.4, 0.9, 0.5],
      hemiSky: '#cfe4ff', hemiGround: '#6d7d96', hemiI: 1.0,
      snowfall: 350, mountain: '#b9cbe2', exposure: 0.95,
    },
  },
  {
    id: 'glacier',
    name: '글레이셔 볼',
    en: 'GLACIER BOWL',
    difficulty: 2,
    desc: '노을이 지는 넓은 빙하 사면. 게이트 없이 거대한 킥커를 골라 타며 트릭 점수를 노리는 프리라이드 코스.',
    length: 1300,
    width: 70,
    slope: 0.26,
    seed: 21,
    bumps: 1.4,
    curve: [[0.003, 30, 0.5], [0.009, 10, 2.2]],
    kickers: [
      { s: 180, h: 2.6, len: 10, w: 11 },
      { s: 360, h: 3.4, len: 12, w: 12, x: -14 },
      { s: 365, h: 2.2, len: 9, w: 10, x: 14 },
      { s: 600, h: 4.0, len: 14, w: 14 },
      { s: 820, h: 3.0, len: 11, w: 11, x: -13 },
      { s: 825, h: 3.6, len: 13, w: 12, x: 13 },
      { s: 1060, h: 4.4, len: 15, w: 16 },
    ],
    gates: null,
    trees: 500,
    treesInside: 0,
    rocks: 70,
    rocksInside: 14,
    env: {
      time: 'sunset',
      skyTop: '#2a3f8f', skyBottom: '#ffb38a', fog: '#efc3b4', fogNear: 90, fogFar: 650,
      sun: '#ffc48a', sunI: 2.3, sunDir: [-0.55, 0.42, -0.6],
      hemiSky: '#ffd9c2', hemiGround: '#5a6b8f', hemiI: 0.95,
      snowfall: 0, mountain: '#d9b3b8', exposure: 1.0,
    },
  },
  {
    id: 'night',
    name: '미드나잇 쿨와르',
    en: 'MIDNIGHT COULOIR',
    difficulty: 3,
    desc: '가로등만 비추는 좁고 가파른 야간 협곡. 촘촘한 게이트와 눈보라 속에서 최고 기록에 도전하세요.',
    length: 1000,
    width: 32,
    slope: 0.3,
    seed: 33,
    bumps: 0.8,
    curve: [[0.006, 18, 1.1], [0.015, 6, 0.2]],
    kickers: [
      { s: 260, h: 2.2, len: 9 },
      { s: 520, h: 2.6, len: 10 },
      { s: 760, h: 3.0, len: 11 },
    ],
    gates: { start: 110, every: 55, offset: 0.28, width: 6.5 },
    trees: 1500,
    treesInside: 10,
    rocks: 30,
    rocksInside: 8,
    env: {
      time: 'night',
      skyTop: '#050a1a', skyBottom: '#1b2a4a', fog: '#16223a', fogNear: 40, fogFar: 300,
      sun: '#9fb6ff', sunI: 0.9, sunDir: [-0.3, 1, 0.4],
      hemiSky: '#5470b0', hemiGround: '#10151f', hemiI: 0.75,
      snowfall: 1400, mountain: '#2a3550', exposure: 1.1,
      lamps: true, stars: true,
    },
  },
];

export const getTrack = (id) => TRACKS.find((t) => t.id === id) || TRACKS[0];

/** 트랙 정의로부터 높이 함수와 배치 오브젝트를 만든다. */
export function buildCourse(track) {
  const noise = makeNoise(track.seed);
  const half = track.width / 2;
  const L = track.length;
  const slope = track.slope;
  const kickers = (track.kickers || []).map((k) => ({ x: 0, w: 9, ...k }));

  const center = (s) => {
    const r = smoothstep(0, 150, s);
    let c = 0;
    for (const [f, a, p] of track.curve) c += a * (Math.sin(f * s + p) - Math.sin(p));
    return c * r;
  };

  // 결승선 이후에는 경사가 완만해져 자연스럽게 멈춘다
  const base = (s) => {
    if (s <= L) return -s * slope;
    const u = s - L;
    if (u <= 40) return -(L * slope + slope * (u - (0.4 * u * u) / 40));
    return -(L * slope + slope * 24 + (u - 40) * 0.2 * slope);
  };

  const KICK_DROP = 2.5;
  const kickAt = (dx, s) => {
    let best = 0;
    for (const k of kickers) {
      const ds = s - k.s;
      if (ds < 0 || ds > k.len + KICK_DROP) continue;
      const across = 1 - smoothstep(k.w / 2 - 1.2, k.w / 2 + 0.3, Math.abs(dx - k.x));
      if (across <= 0) continue;
      let h;
      if (ds <= k.len) {
        const t = ds / k.len;
        h = k.h * t * t;
      } else {
        h = k.h * (1 - (ds - k.len) / KICK_DROP);
      }
      h *= across;
      if (h > best) best = h;
    }
    return best;
  };
  const isLip = (dx, s) =>
    kickers.some((k) => s >= k.s + k.len - 0.9 && s <= k.s + k.len && Math.abs(dx - k.x) < k.w / 2 - 0.6);

  const height = (x, s) => {
    const dx = x - center(s);
    const adx = Math.abs(dx);
    const groom = 1 - smoothstep(half - 4, half + 12, adx);
    let y = base(s);
    const calm = smoothstep(-10, 60, s);
    y += (noise(x * 0.022, s * 0.022) * 3.2 * (1 - 0.65 * groom) + noise(x * 0.08 + 31.7, s * 0.08) * 0.45) *
      track.bumps * calm;
    const out = Math.max(0, adx - half);
    y += out * 0.32 + out * out * 0.011;
    y += kickAt(dx, s);
    return y;
  };

  /**
   * dh/dx, dh/ds (수치 미분). s 방향은 진행 방향의 뒤쪽 차분을 써서(dir: +1 내리막, -1 오르막),
   * 킥커 립 바로 앞에서 법선이 립 너머 낙차에 오염되어 이륙 속도를 깎지 않게 한다.
   */
  const grad = (x, s, out, dir = 1) => {
    const e = 0.25;
    out.x = (height(x + e, s) - height(x - e, s)) / (2 * e);
    out.y = dir >= 0
      ? (height(x, s) - height(x, s - 2 * e)) / (2 * e)
      : (height(x, s + 2 * e) - height(x, s)) / (2 * e);
    return out;
  };

  // ── 게이트 ──
  const gates = [];
  if (track.gates) {
    const g = track.gates;
    let side = 1;
    for (let s = g.start; s < L - 60; s += g.every) {
      if (kickers.some((k) => s > k.s - 30 && s < k.s + k.len + 30)) continue;
      gates.push({ s, x: center(s) + side * half * g.offset, w: g.width, side, state: 'pending' });
      side = -side;
    }
  }

  const rng = mulberry32(track.seed * 9301 + 49297);
  const nearFeature = (dx, s) =>
    s < 40 ||
    kickers.some((k) => s > k.s - 25 && s < k.s + k.len + 35 && Math.abs(dx - k.x) < k.w / 2 + 6) ||
    gates.some((g) => Math.abs(g.s - s) < 9) ||
    (s > L - 25 && s < L + 15);

  const place = (count, insideCount, make) => {
    const list = [];
    for (let i = 0; i < count; i++) {
      const s = -60 + rng() * (L + 180);
      const side = rng() < 0.5 ? -1 : 1;
      const dx = side * (half + 1.5 + Math.pow(rng(), 0.8) * 90);
      list.push(make(dx, s));
    }
    let placed = 0;
    for (let tries = 0; placed < insideCount && tries < 5000; tries++) {
      const s = 40 + rng() * (L - 60);
      const dx = (rng() * 2 - 1) * (half - 2);
      if (Math.abs(dx) < 7 || nearFeature(dx, s)) continue;
      list.push(make(dx, s));
      placed++;
    }
    return list;
  };

  const trees = place(track.trees, track.treesInside, (dx, s) => {
    const x = center(s) + dx;
    const sc = 0.75 + rng() * 0.9;
    const y = height(x, s) - 0.25;
    return { kind: 'tree', x, s, y, sc, r: 0.55 * sc, top: y + 5.6 * sc, rot: rng() * Math.PI * 2, dx };
  });
  const rocks = place(track.rocks, track.rocksInside, (dx, s) => {
    const x = center(s) + dx;
    const sc = 0.6 + rng() * 1.2;
    const y = height(x, s) - 0.15 * sc;
    return { kind: 'rock', x, s, y, sc, r: 0.95 * sc, top: y + 0.8 * sc, rot: rng() * Math.PI * 2, dx };
  });

  const lamps = [];
  const poles = [];
  for (let s = 10; s < L + 40; s += track.env.lamps ? 40 : 24) {
    for (const side of [-1, 1]) {
      const x = center(s) + side * (half + (track.env.lamps ? 2.5 : 0.8));
      (track.env.lamps ? lamps : poles).push({ x, s, y: height(x, s), side });
    }
  }

  // 충돌 판정용 버킷(10m 단위)
  const buckets = new Map();
  for (const o of [...trees, ...rocks]) {
    if (Math.abs(o.dx) > half + 12) continue;
    const key = Math.floor(o.s / 10);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  }

  return {
    track, half, length: L, kickers, gates, trees, rocks, lamps, poles, buckets,
    center, height, grad, kickAt, isLip,
    /** s 지점의 코스 진행 방향(yaw) */
    yawAt(s) {
      const dc = (center(s + 1) - center(s - 1)) / 2;
      return Math.atan2(dc, 1);
    },
  };
}
