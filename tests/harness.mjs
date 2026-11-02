// Node에서 게임 로직을 돌리기 위한 최소 DOM/오디오/입력 대역.
// 렌더링은 하지 않고 Game.step()으로 물리만 진행한다.

const noop = () => {};
/** 어떤 속성을 읽어도 호출 가능한 noop을 돌려주는 캔버스 2D 컨텍스트 대역 */
const ctx2d = new Proxy(
  {},
  {
    get: (_, key) => {
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
      return noop;
    },
    set: () => true,
  },
);

if (!globalThis.document) {
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
  };
}

const el = () => ({
  textContent: '',
  innerHTML: '',
  className: '',
  offsetWidth: 0,
  style: {},
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
});

const { Game } = await import('../src/game.js');
const { getTrack, TRACKS } = await import('../src/tracks.js');
const { DEFAULT_LOADOUT } = await import('../src/customize.js');

export { TRACKS, getTrack };

export function makeGame({ easy = false, track = 'pine', loadout = {} } = {}) {
  const input = {
    state: { left: false, right: false, up: false, down: false, jump: false, grab: false },
    clear() { for (const k in this.state) this.state[k] = false; },
    consumePresses(out) { for (const k in this.state) out[k] = false; return out; },
  };
  const hud = {};
  for (const k of ['root', 'time', 'score', 'combo', 'speed', 'gates', 'progress', 'charge', 'trick', 'msg', 'countdown', 'queue']) hud[k] = el();
  const audio = new Proxy({}, { get: () => noop });
  const g = new Game({ toneMappingExposure: 1, render: noop }, { audio, input, hud, quality: 'low' });
  g.load(getTrack(track), { ...DEFAULT_LOADOUT, ...loadout });
  g.setEasy(easy);
  g.mode = 'ride';
  return g;
}

/** 결정적 의사난수 (테스트 재현성) */
export function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export const DT = 1 / 120;

/** 쉬운 조작 탭을 흉내 낸다: 해당 프레임에만 tap 플래그를 세우고 처리 */
export function tap(g, keys) {
  for (const k in g.tap) g.tap[k] = !!keys[k];
  g.handleEasyTaps();
  for (const k in g.tap) g.tap[k] = false;
}

/** 킥커 앞에서 출발해 첫 착지(또는 넘어짐)까지 진행. onAir(g)는 공중에서 매 스텝 호출 */
export function jumpTrial(g, s0, speed, onAir = noop, x = 0) {
  g.spawnAt(s0, speed);
  if (x) {
    g.p.x += x;
    g.p.y = g.course.height(g.p.x, s0);
  }
  const ctl = g.ctl;
  let took = false;
  let snapshot = null;
  for (let i = 0; i < 120 * 12; i++) {
    for (const k in ctl) ctl[k] = false;
    if (!g.grounded && !g.crashed) {
      took = true;
      onAir(g);
      snapshot = { air: g.airTime, spin: g.spin, flip: g.flip };
    }
    g.step(DT);
    if (took && (g.grounded || g.crashed)) return { ...snapshot, crashed: g.crashed };
  }
  return null;
}
