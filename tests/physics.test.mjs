import test from 'node:test';
import assert from 'node:assert/strict';
import { DT, TRACKS, jumpTrial, makeGame, rng, tap } from './harness.mjs';

const deg = (r) => Math.round((r * 180) / Math.PI);

test('세 트랙 모두 트릭 없이 자동 주행하면 넘어지지 않고 완주한다', () => {
  for (const t of TRACKS) {
    const g = makeGame({ track: t.id });
    g.spawnAt(2, 4);
    for (let i = 0; i < 120 * 240 && g.mode === 'ride'; i++) {
      g.autopilot();
      if (!g.grounded) for (const k in g.ctl) g.ctl[k] = false; // 공중 트릭 없이
      g.step(DT);
    }
    assert.equal(g.mode, 'finished', `${t.id} 완주 실패 (s=${(-g.p.z).toFixed(0)})`);
    assert.equal(g.crashes, 0, `${t.id}에서 ${g.crashes}회 넘어짐`);
    assert.ok(g.time > 30 && g.time < 150, `${t.id} 기록이 비정상: ${g.time}`);
  }
});

test('킥커 이륙: 립에서 충분히 떠오른다 (립 직전 법선 오염 회귀 방지)', () => {
  const g = makeGame();
  const r = jumpTrial(g, 175, 16);
  assert.ok(r.air > 1.5, `체공 ${r.air.toFixed(2)}초`);
  assert.equal(r.crashed, false);
});

test('프로 모드: 360 스핀과 백플립은 착지하고, 과회전은 넘어진다', () => {
  const g = makeGame();
  const spin = jumpTrial(g, 175, 16, (g) => { g.ctl.right = Math.abs(g.spin) < Math.PI * 2 - 0.75; });
  assert.equal(spin.crashed, false);
  assert.equal(Math.round(Math.abs(spin.spin) / Math.PI) * 180, 360);

  const flip = jumpTrial(g, 175, 16, (g) => { g.ctl.down = Math.abs(g.flip) < Math.PI * 2 - 0.8; });
  assert.equal(flip.crashed, false);

  const over = jumpTrial(g, 175, 16, (g) => { g.ctl.right = true; });
  assert.equal(over.crashed, true, `과회전 ${deg(over.spin)}°인데 착지 성공`);
});

test('쉬움 모드: 탭 횟수·타이밍을 무작위로 넣어도 넘어지지 않는다', () => {
  const g = makeGame({ easy: true });
  const rand = rng(7);
  const kickers = [[175, 16], [415, 17], [860, 18]];
  for (let trial = 0; trial < 40; trial++) {
    const [s0, sp] = kickers[trial % kickers.length];
    const taps = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({
      at: rand() * 1.8,
      key: ['left', 'right', 'up', 'down'][Math.floor(rand() * 4)],
      done: false,
    }));
    const x = trial % 3 === 1 ? -6 : 0; // 두 번째 킥커는 코스 왼쪽에 있다
    const r = jumpTrial(g, s0, sp, (g) => {
      for (const t of taps) if (!t.done && g.airTime >= t.at) { t.done = true; tap(g, { [t.key]: true }); }
    }, x);
    assert.equal(r.crashed, false, `trial ${trial}: 탭 ${taps.map((t) => t.key).join(',')} → spin ${deg(r.spin)}° flip ${deg(r.flip)}°`);
  }
});

test('쉬움 모드: 한 번 탭하면 정확히 360° 회전 후 착지한다', () => {
  const g = makeGame({ easy: true });
  let tapped = false;
  const r = jumpTrial(g, 175, 16, (g) => { if (!tapped && g.airTime > 0.1) { tapped = true; tap(g, { right: true }); } });
  assert.equal(r.crashed, false);
  assert.equal(deg(r.spin), 360);
});

test('쉬움 모드: 체공 예측 시간이 실제 착지 시점과 0.1초 이내로 맞는다', () => {
  const g = makeGame({ easy: true, track: 'glacier' });
  let predicted = null;
  const r = jumpTrial(g, 580, 19, (g) => { if (predicted === null && g.airTime > 0.05) predicted = g.airTime + g.timeToGround(); });
  assert.ok(Math.abs(predicted - r.air) < 0.1, `예측 ${predicted.toFixed(2)} vs 실제 ${r.air.toFixed(2)}`);
});

test('쉬움 모드는 나무에 부딪혀도 넘어지지 않고 감속하며, 프로 모드는 넘어진다', () => {
  for (const easy of [true, false]) {
    const g = makeGame({ easy });
    const c = g.course;
    const tree = c.trees.find((t) => Math.abs(t.dx) < c.half - 3 && t.s > 100);
    g.spawnAt(tree.s - 15, 12);
    g.p.x = tree.x;
    g.p.y = c.height(g.p.x, tree.s - 15);
    g.yaw = 0;
    g.v.set(0, 0, -12);
    let hit = false;
    for (let i = 0; i < 240; i++) {
      for (const k in g.ctl) g.ctl[k] = false;
      const before = g.v.length();
      g.step(DT);
      if (g.crashed || g.v.length() < before * 0.8) { hit = true; break; }
    }
    assert.ok(hit, '나무와 만나지 않음');
    assert.equal(g.crashed, !easy);
  }
});

test('역주행 시 지면 법선은 진행 방향 뒤쪽 차분을 쓴다', () => {
  const g = makeGame();
  const k = g.course.kickers[0];
  const s = k.s + k.len - 0.1; // 립 바로 앞
  const x = g.course.center(s);
  const down = g.course.grad(x, s, { x: 0, y: 0 }, 1).y;
  const up = g.course.grad(x, s, { x: 0, y: 0 }, -1).y;
  assert.ok(down > 0, '내리막 진행: 립 앞 램프 경사(오르막)를 봐야 함');
  assert.ok(up < down, '오르막 진행: 립 너머 낙차를 반영해야 함');
});
