import { mulberry32, storage } from './util.js';

export const PALETTE = [
  '#ff5a36', '#ffb000', '#ffe14d', '#3ddc84', '#00c2a8', '#21a6ff',
  '#3b5bff', '#8a4dff', '#ff4fa3', '#f4f6fb', '#9aa4b2', '#23262e',
];
export const LENS = ['#ff8a00', '#ffd500', '#36c3ff', '#7d5cff', '#ff3d7f', '#3ddc84', '#c0c8d6', '#1a1d24'];

/** 보드 종류별 물리 특성. stats는 UI 표시용 1~5 */
export const BOARD_TYPES = {
  park: {
    name: '파크', desc: '짧고 가벼워 스핀이 빠르고 팝이 좋습니다.',
    len: 1.46, spin: 7.6, flip: 5.8, turn: 1.25, grip: 6.5, drag: 1.08, pop: 1.12,
    stats: { 스핀: 5, 카빙: 3, 최고속도: 2, 점프: 5 },
  },
  all: {
    name: '올마운틴', desc: '어디서든 무난한 밸런스형 보드.',
    len: 1.56, spin: 6.2, flip: 5.0, turn: 1.05, grip: 7.2, drag: 1.0, pop: 1.0,
    stats: { 스핀: 4, 카빙: 4, 최고속도: 3, 점프: 3 },
  },
  free: {
    name: '프리라이드', desc: '길고 안정적이라 최고 속도와 카빙이 뛰어납니다.',
    len: 1.66, spin: 5.0, flip: 4.3, turn: 0.95, grip: 8.6, drag: 0.86, pop: 0.92,
    stats: { 스핀: 2, 카빙: 5, 최고속도: 5, 점프: 2 },
  },
};

export const PATTERNS = [
  ['solid', '솔리드'], ['stripes', '스트라이프'], ['gradient', '그라디언트'], ['flame', '플레임'],
  ['stars', '스타'], ['checker', '체커'], ['wave', '웨이브'], ['peaks', '피크'],
];

export const RIDER_OPTIONS = [
  { key: 'jacket', label: '재킷', type: 'color' },
  { key: 'sleeve', label: '소매', type: 'color' },
  { key: 'pants', label: '팬츠', type: 'color' },
  { key: 'headwear', label: '헤드기어', type: 'choice', choices: [['helmet', '헬멧'], ['beanie', '비니'], ['bare', '없음']] },
  { key: 'headColor', label: '헤드기어 색', type: 'color' },
  { key: 'lens', label: '고글 렌즈', type: 'color', palette: LENS },
  { key: 'gloves', label: '장갑', type: 'color' },
  { key: 'neck', label: '넥워머', type: 'color' },
];

export const BOARD_OPTIONS = [
  { key: 'boardType', label: '보드 종류', type: 'choice', choices: Object.entries(BOARD_TYPES).map(([k, v]) => [k, v.name]) },
  { key: 'pattern', label: '그래픽', type: 'choice', choices: PATTERNS },
  { key: 'boardBase', label: '베이스 색', type: 'color' },
  { key: 'boardAccent', label: '포인트 색', type: 'color' },
  { key: 'binding', label: '바인딩', type: 'color' },
  { key: 'stance', label: '스탠스', type: 'choice', choices: [['regular', '레귤러'], ['goofy', '구피']] },
];

export const DEFAULT_LOADOUT = {
  jacket: '#ff5a36', sleeve: '#23262e', pants: '#3b5bff',
  headwear: 'helmet', headColor: '#f4f6fb', lens: '#ff8a00',
  gloves: '#23262e', neck: '#ffe14d',
  boardType: 'all', pattern: 'peaks', boardBase: '#21a6ff', boardAccent: '#f4f6fb',
  binding: '#23262e', stance: 'regular',
};

const ALL_OPTIONS = [...RIDER_OPTIONS, ...BOARD_OPTIONS];
const HEX = /^#[0-9a-f]{6}$/i;
const KEY = 'powderline.loadout.v1';

export function sanitizeLoadout(obj) {
  const out = { ...DEFAULT_LOADOUT };
  if (!obj || typeof obj !== 'object') return out;
  for (const opt of ALL_OPTIONS) {
    const v = obj[opt.key];
    if (typeof v !== 'string') continue;
    if (opt.type === 'color' && HEX.test(v)) out[opt.key] = v.toLowerCase();
    if (opt.type === 'choice' && opt.choices.some(([id]) => id === v)) out[opt.key] = v;
  }
  return out;
}

export const loadLoadout = () => sanitizeLoadout(storage.get(KEY));
export const saveLoadout = (lo) => storage.set(KEY, lo);

export function randomLoadout() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const out = {};
  for (const opt of ALL_OPTIONS) {
    out[opt.key] = opt.type === 'color' ? pick(opt.palette || PALETTE) : pick(opt.choices)[0];
  }
  out.stance = 'regular';
  return sanitizeLoadout(out);
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function star(ctx, x, y, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/** 보드 윗면 그래픽. 캔버스 위쪽이 노즈(-z) 방향이다. */
export function paintBoard(ctx, w, h, lo) {
  const base = lo.boardBase, acc = lo.boardAccent;
  ctx.save();
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = acc;
  ctx.strokeStyle = acc;
  switch (lo.pattern) {
    case 'stripes':
      for (let y = -h; y < h * 2; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(w, y - 46); ctx.lineTo(w, y - 20); ctx.lineTo(0, y + 26);
        ctx.fill();
      }
      break;
    case 'gradient': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, base); g.addColorStop(1, acc);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'flame':
      for (let i = 0; i < 7; i++) {
        const x0 = (i / 6) * w;
        const tip = h * (0.25 + ((i * 37) % 5) * 0.08);
        ctx.beginPath();
        ctx.moveTo(x0 - 26, h);
        ctx.bezierCurveTo(x0 - 30, h * 0.75, x0 + 20, h * 0.6, x0 + 4, tip);
        ctx.bezierCurveTo(x0 + 34, h * 0.55, x0 + 30, h * 0.8, x0 + 26, h);
        ctx.fill();
      }
      break;
    case 'stars': {
      const rng = mulberry32(42);
      for (let i = 0; i < 26; i++) star(ctx, rng() * w, rng() * h, 6 + rng() * 14, rng() * 6);
      break;
    }
    case 'checker': {
      const size = 32;
      for (let y = 0; y < h / size; y++)
        for (let x = 0; x < w / size; x++) if ((x + y) % 2 === 0) ctx.fillRect(x * size, y * size, size, size);
      break;
    }
    case 'wave':
      ctx.lineWidth = 9;
      for (let k = 0; k < 7; k++) {
        ctx.beginPath();
        for (let y = 0; y <= h; y += 8) ctx.lineTo(w / 2 + Math.sin(y * 0.035 + k * 0.9) * 40, y);
        ctx.globalAlpha = 0.25 + (k % 3) * 0.25;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    case 'peaks':
      ctx.beginPath();
      ctx.arc(w * 0.62, h * 0.36, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, h * 0.62); ctx.lineTo(w * 0.3, h * 0.42); ctx.lineTo(w * 0.5, h * 0.55);
      ctx.lineTo(w * 0.78, h * 0.3); ctx.lineTo(w, h * 0.5); ctx.lineTo(w, h); ctx.lineTo(0, h);
      ctx.fill();
      break;
    default:
      break;
  }
  // 로고와 테두리
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = '700 34px "Bebas Neue", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.9;
  const ref = lo.pattern === 'solid' ? base : acc;
  ctx.fillStyle = luminance(ref) > 0.6 ? '#1b1e26' : '#ffffff';
  ctx.fillText('POWDER LINE', 0, 0);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
}
