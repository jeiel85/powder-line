import * as THREE from 'three';
import { buildCourse } from './tracks.js';
import { buildWorld } from './world.js';
import { Rider } from './rider.js';
import { BOARD_TYPES } from './customize.js';
import { clamp, damp, wrapPi } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const G = 9.81;
const GRAB_NAMES = { indy: 'Indy', method: 'Method', mute: 'Mute' };

export const formatTime = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

export class Game {
  constructor(renderer, { audio, input, hud, quality }) {
    this.renderer = renderer;
    this.audio = audio;
    this.input = input;
    this.hud = hud;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 4000);
    this.mode = 'idle';
    this.prevMode = null;
    this.onFinish = null;

    this.p = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.n = new THREE.Vector3(0, 1, 0);
    this.visN = new THREE.Vector3(0, 1, 0);
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camDir = new THREE.Vector3(0, 0, -1);
    this.camMode = 0;
    this.tumble = new THREE.Euler();
    this.tumbleVel = new THREE.Vector3();
    this.ctl = { left: false, right: false, up: false, down: false, jump: false, grab: false };
    this.auto = { plan: null };
    // 쉬운 조작: 탭 한 번으로 회전 완성, 착지 각도 자동 보정, 즉시 점프
    this.easy = true;
    this.prevIn = { left: false, right: false, up: false, down: false, jump: false };
    this.tap = { left: false, right: false, up: false, down: false, jump: false };
    this._pressed = {};
    this.lastBump = -1;
    this.bumpTimes = [];
    this.gradDir = 1;
    this.ttg = 4;
    this.ttgAge = 0;
    this.jumpQueued = false;
    this.spinTarget = 0;
    this.flipTarget = 0;
    this.grabbing = false;
    this._f = new THREE.Vector3();
    this._lat = new THREE.Vector3();
    this._gt = new THREE.Vector3();
    this._gr = new THREE.Vector2();
    this._t = new THREE.Vector3();
    this._qn = new THREE.Quaternion();
    this._qy = new THREE.Quaternion();
    this.hudCache = {};
    this.clock = 0;
  }

  // ── 로딩 ─────────────────────────────────────────────
  load(track, loadout) {
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    this.track = track;
    this.course = buildCourse(track);
    this.world = buildWorld(this.course, this.quality);
    this.scene.add(this.world.group);
    const env = track.env;
    this.scene.fog = new THREE.Fog(env.fog, env.fogNear, env.fogFar);
    this.scene.background = new THREE.Color(env.fog);
    this.renderer.toneMappingExposure = env.exposure;
    if (!this.rider) {
      this.rider = new Rider(loadout);
      this.rider.air.rotation.order = 'YXZ';
      this.scene.add(this.rider.root);
    }
    this.setLoadout(loadout);
    this.reset();
  }

  setLoadout(lo) {
    this.loadout = { ...lo };
    this.bt = BOARD_TYPES[lo.boardType];
    this.rider.setLoadout(lo);
  }

  reset() {
    this.spawnAt(2, 0);
    this.time = 0;
    this.penalty = 0;
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.gateIdx = 0;
    this.gatesPassed = 0;
    this.gatesMissed = 0;
    this.checkpoint = 2;
    this.crashes = 0;
    this.bestTrick = null;
    this.maxSpeed = 0;
    this.finishT = 0;
    this.finished = null;
    for (const g of this.course.gates) g.state = 'pending';
    this.world.resetGates();
    this.hud.trick.classList.remove('show');
    this.message('');
    this.snapCamera();
  }

  spawnAt(s, speed) {
    const c = this.course;
    const x = c.center(s);
    this.p.set(x, c.height(x, s), -s);
    this.yaw = c.yawAt(s);
    this.v.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(speed);
    this.grounded = true;
    this.crashed = false;
    this.crashT = 0;
    this.spin = this.flip = this.spinVel = this.flipVel = 0;
    this.airTime = this.grabTime = this.charge = 0;
    this.switch = false;
    this.takeoffSwitch = false;
    this.steerS = this.leanS = this.brakeS = this.skid = 0;
    this.landSquash = 0;
    this.tuck = false;
    this.grabType = 'indy';
    this.grabbing = false;
    this.jumpQueued = false;
    this.spinTarget = this.flipTarget = 0;
    this.bumpTimes = [];
    this.gradDir = 1;
    this.ttgAge = 0;
    this.sprayAcc = 0;
    this.tumble.set(0, 0, 0);
    this.normalAt(this.p, this.n);
    this.visN.copy(this.n);
  }

  // ── 모드 전환 ─────────────────────────────────────────
  startAttract() {
    this.reset();
    this.spawnAt(30, 9);
    this.mode = 'attract';
    this.snapCamera();
  }

  startRun() {
    this.reset();
    this.input.clear();
    this.mode = 'countdown';
    this.countdown = 3.999;
    this.lastBeep = 4;
  }

  pause() {
    if (this.mode === 'paused' || this.mode === 'attract' || this.mode === 'idle') return false;
    this.prevMode = this.mode;
    this.mode = 'paused';
    this.audio.silence();
    return true;
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.mode = this.prevMode;
  }

  manualRespawn() {
    if (this.mode !== 'ride' || this.crashed) return;
    this.spawnAt(this.checkpoint, 7);
    this.combo = 1;
    this.comboTimer = 0;
    this.message('체크포인트로 복귀', 'info', 1.2);
  }

  toggleCamera() {
    this.camMode = (this.camMode + 1) % 2;
  }

  // ── 지형 헬퍼 ─────────────────────────────────────────
  normalAt(p, out) {
    // 오르막(역주행) 방향으로 움직일 때는 차분 방향도 뒤집는다
    // |v.z|가 작을 때는 직전 방향을 유지해 부호가 바뀔 때마다 차분 방향이 깜빡이지 않게 한다
    if (this.v.z < -0.5) this.gradDir = 1;
    else if (this.v.z > 0.5) this.gradDir = -1;
    const g = this.course.grad(p.x, -p.z, this._gr, this.gradDir);
    // h(x, s), s = -z  →  dh/dz = -dh/ds
    return out.set(-g.x, 1, g.y).normalize();
  }

  forward(out) {
    return out.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  // ── 메인 업데이트 ─────────────────────────────────────
  update(dt) {
    if (!this.world) return;
    this.clock += dt;
    if (this.mode === 'paused') return;

    if (this.mode === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastBeep) {
        this.lastBeep = n;
        if (n > 0) {
          this.audio.beep(false);
          this.showCountdown(String(n));
        } else {
          this.audio.beep(true);
          this.showCountdown('GO!');
          this.mode = 'ride';
          this.forward(this._f);
          this.v.copy(this._f).multiplyScalar(4);
        }
      }
    }

    if (this.mode === 'ride' || this.mode === 'finished' || this.mode === 'attract') {
      this.readControls(dt);
      const steps = Math.min(16, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) this.step(h);
    }
    if (this.mode === 'finished') {
      this.finishT += dt;
      if (this.finishT > 2.6 && this.onFinish && this.finished && !this.finished.reported) {
        this.finished.reported = true;
        this.onFinish(this.finished);
      }
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 1;
    }
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.hud.msg.classList.remove('show');
    }

    this.updateVisuals(dt);
    this.updateCamera(dt);
    this.world.update(dt, this.camera, this.p);
    if (this.mode !== 'attract') this.updateHud();
    const sp = this.v.length();
    this.audio.update(this.mode === 'countdown' ? 0 : sp, this.crashed ? 0.6 : this.skid, this.grounded || this.crashed);
  }

  readControls(dt) {
    const c = this.ctl;
    if (this.mode === 'attract') return this.autopilot(dt);
    if (this.mode === 'finished') {
      c.left = c.right = c.up = c.jump = c.grab = false;
      c.down = this.finishT > 0.6;
      return;
    }
    Object.assign(c, this.input.state);
    const pressed = this.input.consumePresses(this._pressed);
    for (const k in this.tap) {
      this.tap[k] = (c[k] && !this.prevIn[k]) || pressed[k];
      this.prevIn[k] = c[k];
    }
    if (this.isEasy()) this.handleEasyTaps();
  }

  isEasy() {
    return this.easy && this.mode !== 'attract';
  }

  setEasy(on) {
    this.easy = on;
  }

  /** 쉬운 조작: 프레임마다 새로 눌린 키를 동작 예약으로 바꾼다 */
  handleEasyTaps() {
    const t = this.tap;
    if (this.crashed) return;
    if (this.grounded) {
      if (t.jump) this.jumpQueued = true;
      return;
    }
    if (t.left) this.spinTarget -= Math.PI * 2;
    if (t.right) this.spinTarget += Math.PI * 2;
    if (t.up) this.flipTarget -= Math.PI * 2;
    if (t.down) this.flipTarget += Math.PI * 2;
  }

  /**
   * 현재 탄도를 따라가며 지형과 처음 만나는 시점(초)을 찾는다.
   * 발밑 경사만 쓰면 킥커 낙차·급경사 변화 구간에서 착지 시점을 늦게 예측한다.
   */
  timeToGround() {
    const P = this.p, V = this.v, c = this.course;
    const step = 0.04;
    let x = P.x, y = P.y, z = P.z, vy = V.y;
    for (let t = step; t <= 4; t += step) {
      x += V.x * step;
      z += V.z * step;
      vy -= G * step;
      y += vy * step;
      if (y <= c.height(x, -z)) return t;
    }
    return 4;
  }

  /** 데모(메뉴 배경) 모드용 자동 주행 */
  autopilot() {
    const c = this.course, P = this.p, ctl = this.ctl;
    const s = -P.z;
    const sp = this.v.length();
    if (this.grounded) {
      this.auto.plan = null;
      const look = s + 12 + sp * 0.6;
      let tx = c.center(look);
      const g = c.gates[this.gateIdx];
      if (g && g.s - s < 40) tx = g.x;
      for (const k of c.kickers) {
        if (k.s > s - 2 && k.s - s < 70) {
          tx = c.center(k.s) + k.x;
          break;
        }
      }
      const desired = Math.atan2(tx - P.x, look - s);
      const err = wrapPi(desired - this.yaw);
      ctl.left = err < -0.05;
      ctl.right = err > 0.05;
      ctl.up = sp < 17 && Math.abs(err) < 0.2;
      ctl.down = sp > 25;
      ctl.jump = false;
      ctl.grab = false;
    } else {
      if (!this.auto.plan) {
        const r = Math.random();
        const dir = Math.random() < 0.5 ? -1 : 1;
        this.auto.plan = r < 0.35 ? { spin: Math.PI * 2, dir } : r < 0.6 ? { spin: Math.PI, dir, grab: true } : r < 0.8 ? { grab: true } : { flip: true };
      }
      const pl = this.auto.plan;
      ctl.left = ctl.right = ctl.up = ctl.down = false;
      if (pl.spin && Math.abs(this.spin) < pl.spin - 0.75) {
        if (pl.dir < 0) ctl.left = true;
        else ctl.right = true;
      }
      if (pl.flip && Math.abs(this.flip) < Math.PI * 2 - 0.8 && this.airTime > 0.1) ctl.down = true;
      ctl.grab = !!pl.grab && this.airTime > 0.15 && this.airTime < 0.9;
    }
  }

  step(dt) {
    if (this.crashed) return this.stepCrash(dt);
    const steer = (this.ctl.right ? 1 : 0) - (this.ctl.left ? 1 : 0);
    if (this.grounded) this.stepGround(dt, steer);
    else this.stepAir(dt, steer);
    if (this.crashed) return;

    const c = this.course, P = this.p;
    let s = -P.z;
    let dx = P.x - c.center(s);
    // 바깥 경계
    const limit = c.half + 85;
    if (Math.abs(dx) > limit) {
      P.x = c.center(s) + Math.sign(dx) * limit;
      this.v.x *= -0.3;
    }
    if (this.mode === 'ride') this.time += dt;
    this.maxSpeed = Math.max(this.maxSpeed, this.v.length());

    this.checkCollisions(s);
    if (this.crashed) return;
    // 쉬운 조작의 bump()가 위치를 옮겼을 수 있으므로 다시 읽는다
    s = -P.z;
    dx = P.x - c.center(s);
    this.checkGates(s);

    if (this.grounded && s - this.checkpoint > 40 && Math.abs(dx) < c.half - 2 &&
      !c.kickers.some((k) => s > k.s - 12 && s < k.s + k.len + 20)) {
      this.checkpoint = s;
    }

    if (this.mode === 'ride' && s >= c.length) this.finish();
    if (this.mode === 'attract' && s > c.length + 60) this.startAttract();
  }

  stepGround(dt, steer) {
    const P = this.p, V = this.v, N = this.n, bt = this.bt, ctl = this.ctl, c = this.course;
    this.normalAt(P, N);
    const speed = V.length();
    this.steerS = damp(this.steerS, steer, 10, dt);
    this.yaw += this.steerS * ((2.0 * bt.turn) / (1 + speed / 38)) * dt;

    const F = this.forward(this._f);
    F.addScaledVector(N, -F.dot(N)).normalize();
    V.addScaledVector(N, -V.dot(N));
    const GT = this._gt.set(0, -G, 0).addScaledVector(N, G * N.y);
    V.addScaledVector(GT, dt);

    const brake = ctl.down ? 1 : 0;
    let along = V.dot(F);
    if (along < -0.5) {
      // 뒤로 미끄러지면 스위치 스탠스로 전환
      this.yaw += Math.PI;
      this.switch = !this.switch;
      F.negate();
      along = -along;
    }
    const LAT = this._lat.copy(V).addScaledVector(F, -along);
    const lat = LAT.length();
    const k = Math.min(1, (brake ? 2.2 : bt.grip) * dt);
    const keep = brake ? 0 : 0.6; // 카빙 시 횡속도 일부를 진행 속도로 돌려준다
    V.copy(F).multiplyScalar(along + lat * k * keep).addScaledVector(LAT, 1 - k);
    this.skid = damp(this.skid, clamp(lat / 6 + brake * 0.8 * Math.min(1, speed / 6), 0, 1), 10, dt);

    const sp = V.length();
    // 쉬운 조작은 크게 꺾지 않을 때 자동으로 턱 자세를 잡는다
    this.tuck = this.isEasy() ? !brake && Math.abs(steer) < 0.5 : ctl.up && !brake;
    if (sp > 1e-3) {
      const mu = 0.035 + brake * 0.42;
      const drag = 0.0062 * bt.drag * (this.tuck ? 0.6 : 1);
      // 약 90km/h 이상에서는 추가 저항으로 최고 속도를 눌러 둔다
      const over = Math.max(0, sp - 25);
      const dec = mu * G * N.y + drag * sp * sp + over * over * 0.02;
      V.multiplyScalar(Math.max(0, sp - dec * dt) / sp);
    }

    if (this.isEasy()) {
      if (this.jumpQueued) {
        this.jumpQueued = false;
        V.addScaledVector(N, 5.6 * bt.pop);
        this.takeoff();
        this.audio.pop();
        P.addScaledVector(V, dt);
        return;
      }
    } else if (ctl.jump) {
      this.charge = Math.min(1, this.charge + dt * 1.6);
    } else if (this.charge > 0) {
      V.addScaledVector(N, (3.4 + this.charge * 3.6) * bt.pop);
      this.charge = 0;
      this.takeoff();
      this.audio.pop();
      P.addScaledVector(V, dt);
      return;
    }

    // 이동 전 위치의 킥커 높이 (립에서 떠오를 때 팝 보너스 계산용)
    const sOld = -P.z;
    const kickOld = c.kickAt(P.x - c.center(sOld), sOld);
    P.addScaledVector(V, dt);
    const h = c.height(P.x, -P.z);
    // 지면에 붙어 있었으므로 (P.y - h)/dt 는 지형 대비 상대 수직 속도와 같다
    const gap = P.y - h;
    if (gap > 0.35 || gap / dt > 2.2) {
      if (kickOld > 0.5) {
        // 킥커 립: 고정 팝 + 차지 중이던 알리를 합산
        V.y += 1.5 + kickOld * 0.5;
        if (this.charge > 0) {
          V.addScaledVector(N, this.charge * 3 * bt.pop);
          this.charge = 0;
          this.audio.pop();
        }
      }
      this.takeoff();
    } else P.y = h;
  }

  takeoff() {
    this.grounded = false;
    this.airTime = 0;
    this.grabTime = 0;
    this.spin = this.flip = this.spinVel = this.flipVel = 0;
    this.takeoffSwitch = this.switch;
    this.wasGrab = false;
    this.grabbing = false;
    this.jumpQueued = false;
    this.spinTarget = 0;
    this.flipTarget = 0;
  }

  stepAir(dt, steer) {
    const P = this.p, V = this.v, bt = this.bt, ctl = this.ctl;
    V.y -= G * dt;
    V.multiplyScalar(1 - 0.015 * dt);
    let autoGrab = false;
    if (this.isEasy()) {
      // 탄도 추적은 비싸므로 1/60초마다만 다시 계산하고 그 사이엔 경과 시간만 뺀다
      this.ttgAge -= dt;
      if (this.ttgAge <= 0) {
        this.ttg = this.timeToGround();
        this.ttgAge = 1 / 60;
      } else this.ttg -= dt;
      const tl = this.ttg;
      if (tl < 0.45) {
        // 착지 직전: 가장 가까운 착지 가능 각도(스핀 180°, 플립 360° 단위)로 목표를 접는다
        this.spinTarget = Math.round(this.spin / Math.PI) * Math.PI;
        this.flipTarget = Math.round(this.flip / (Math.PI * 2)) * Math.PI * 2;
      }
      this.spinVel = this.driveTo(this.spin, this.spinTarget, this.spinVel, bt.spin * 1.1, 26, dt);
      this.flipVel = this.driveTo(this.flip, this.flipTarget, this.flipVel, bt.flip * 1.1, 22, dt);
      autoGrab = this.airTime > 0.35 && tl > 0.3;
    } else {
      this.spinVel = damp(this.spinVel, steer * bt.spin, steer ? 6 : 9, dt);
      const fl = (ctl.down ? 1 : 0) - (ctl.up ? 1 : 0);
      this.flipVel = damp(this.flipVel, fl * bt.flip, fl ? 5 : 9, dt);
    }
    this.spin += this.spinVel * dt;
    this.flip += this.flipVel * dt;
    this.grabbing = ctl.grab || autoGrab;
    if (this.grabbing) {
      if (!this.wasGrab) {
        this.grabType = Math.abs(this.spinVel) > 1.5 ? 'indy' : Math.abs(this.flipVel) > 1.5 ? 'mute' : 'method';
      }
      this.grabTime += dt;
    }
    this.wasGrab = this.grabbing;
    this.airTime += dt;

    P.addScaledVector(V, dt);
    const h = this.course.height(P.x, -P.z);
    if (P.y <= h) {
      P.y = h;
      this.land();
    }
  }

  /** 목표 각도에서 감속해 멈추는 회전 속도 */
  driveTo(cur, target, vel, maxV, acc, dt) {
    const d = target - cur;
    const want = Math.sign(d) * Math.min(maxV, Math.sqrt(2 * acc * Math.abs(d)));
    return damp(vel, want, 14, dt);
  }

  land() {
    const P = this.p, V = this.v, N = this.n;
    this.normalAt(P, N);
    const vn = -V.dot(N);
    const rs = Math.abs(wrapPi(this.spin));
    const sErr = rs > Math.PI / 2 ? Math.PI - rs : rs;
    const fErr = Math.abs(wrapPi(this.flip));
    const easy = this.isEasy();
    const maxVn = easy ? 30 : 22;
    if (sErr > (easy ? 1.25 : 0.9) || fErr > (easy ? 1.3 : 0.95) || vn > maxVn) {
      this.doCrash(vn > maxVn ? '너무 세게 착지했어요!' : '착지 실패!');
      return;
    }
    V.addScaledVector(N, -V.dot(N));
    V.multiplyScalar(1 - Math.min(0.45, sErr * 0.45 + fErr * 0.3 + Math.max(0, vn - 8) * 0.012));

    const trick = this.evalTrick(sErr, fErr);
    // 공중 회전을 보드 방향에 합친다 (시각적으로 연속)
    this.yaw += this.spin;
    this.spin = this.flip = this.spinVel = this.flipVel = 0;
    const F = this.forward(this._f);
    if (F.x * V.x + F.z * V.z < 0) {
      this.yaw += Math.PI;
      this.switch = !this.switch;
    }
    this.grounded = true;
    this.grabbing = false;
    this.landSquash = Math.min(1, 0.3 + vn / 14);
    this.audio.land(Math.min(1, vn / 12));
    this.world.spray.emit(P, V, 18 + Math.floor(vn * 2), 3, 2);
    if (trick && this.mode !== 'countdown') this.awardTrick(trick);
  }

  evalTrick(sErr, fErr) {
    const deg = Math.round(Math.abs(this.spin) / Math.PI) * 180;
    const flips = Math.round(Math.abs(this.flip) / (Math.PI * 2));
    const grab = this.grabTime > 0.25;
    const air = this.airTime;
    if (!deg && !flips && !grab && air < 0.9) return null;
    let name = '';
    const goofy = this.loadout.stance === 'goofy';
    const frontside = (this.spin < 0) !== goofy !== this.takeoffSwitch;
    if (flips) {
      const mult = flips === 2 ? 'Double ' : flips >= 3 ? 'Triple ' : '';
      name = deg >= 360 ? `${mult}Cork ${deg}` : `${mult}${this.flip > 0 ? 'Backflip' : 'Frontflip'}`;
    } else if (deg >= 180) {
      name = `${frontside ? 'FS' : 'BS'} ${deg}`;
    }
    if (grab) name += (name ? ' ' : '') + GRAB_NAMES[this.grabType];
    if (!name) name = 'Big Air';
    if (this.takeoffSwitch) name = `Switch ${name}`;
    const perfect = sErr < 0.18 && fErr < 0.22;
    let pts = air * 120 + (deg / 180) * 280 + flips * 900 + Math.min(this.grabTime, 2) * 320;
    if (perfect) pts *= 1.25;
    return { name, pts: Math.round(pts), perfect, level: deg / 180 + flips * 2 };
  }

  awardTrick(t) {
    this.combo = this.comboTimer > 0 ? Math.min(5, this.combo + 1) : 1;
    this.comboTimer = 5;
    const total = t.pts * this.combo;
    if (this.mode === 'ride') {
      this.score += total;
      if (!this.bestTrick || total > this.bestTrick.pts) this.bestTrick = { name: t.name, pts: total };
    }
    this.audio.trick(Math.floor(t.level));
    const el = this.hud.trick;
    el.innerHTML = `<div class="tname">${t.name}</div><div class="tpts">+${t.pts}${this.combo > 1 ? ` <b>×${this.combo}</b>` : ''}</div>${t.perfect ? '<div class="tperfect">PERFECT LANDING</div>' : ''}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  doCrash(reason) {
    this.crashed = true;
    this.crashT = 0;
    this.grounded = false;
    this.crashes++;
    this.combo = 1;
    this.comboTimer = 0;
    this.v.multiplyScalar(0.55);
    this.tumble.set(this.flip, -this.spin, 0);
    this.tumbleVel.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 12);
    this.audio.crash();
    this.world.spray.emit(this.p, this.v, 70, 5, 3);
    if (this.mode !== 'attract') this.message(reason, 'bad', 1.6);
  }

  stepCrash(dt) {
    const P = this.p, V = this.v, c = this.course;
    this.crashT += dt;
    V.y -= G * dt;
    P.addScaledVector(V, dt);
    const h = c.height(P.x, -P.z);
    if (P.y < h) {
      P.y = h;
      this.normalAt(P, this.n);
      V.addScaledVector(this.n, -V.dot(this.n));
      V.multiplyScalar(1 - Math.min(1, 2.8 * dt));
      if (Math.random() < 0.3) this.world.spray.emit(P, V, 2, 2, 1);
    }
    this.tumble.x += this.tumbleVel.x * dt;
    this.tumble.y += this.tumbleVel.y * dt;
    this.tumble.z += this.tumbleVel.z * dt;
    this.tumbleVel.multiplyScalar(1 - Math.min(1, 1.6 * dt));
    if (this.mode === 'ride') this.time += dt;
    if (this.crashT > 1.7) {
      if (this.mode === 'attract') this.startAttract();
      else this.spawnAt(this.checkpoint, 7);
    }
  }

  checkCollisions(s) {
    const P = this.p;
    const key = Math.floor(s / 10);
    for (let b = key - 1; b <= key + 1; b++) {
      const list = this.course.buckets.get(b);
      if (!list) continue;
      for (const o of list) {
        const dx = P.x - o.x, ds = s - o.s;
        const rr = o.r + 0.3;
        if (dx * dx + ds * ds < rr * rr && P.y < o.top - 0.1) {
          if (this.isEasy()) this.bump(o, dx, ds, rr);
          else this.doCrash(o.kind === 'tree' ? '나무와 충돌!' : '바위와 충돌!');
          return;
        }
      }
    }
  }

  /** 쉬운 조작: 장애물에 넘어지는 대신 밀려나며 감속한다 */
  bump(o, dx, ds, rr) {
    const P = this.p, V = this.v;
    const d = Math.hypot(dx, ds);
    let nx, nz;
    if (d > 1e-4) {
      nx = dx / d;
      nz = -ds / d; // 월드 z = -s
    } else {
      // 장애물 중심과 겹치면 진행 반대 방향으로 밀어낸다(방향이 0이면 제자리에 갇힌다).
      // 속도도 거의 0이면 오르막(+z) 쪽으로 뺀다.
      const sp = Math.hypot(V.x, V.z);
      nx = sp > 1e-4 ? -V.x / sp : 0;
      nz = sp > 1e-4 ? -V.z / sp : 1;
    }
    P.x = o.x + nx * (rr + 0.05);
    P.z = -o.s + nz * (rr + 0.05);
    if (this.grounded) P.y = this.course.height(P.x, -P.z);
    const into = V.x * nx + V.z * nz;
    if (into < 0) {
      V.x -= nx * into * 1.3;
      V.z -= nz * into * 1.3;
    }
    V.multiplyScalar(0.6);
    // 정면으로 부딪히면 법선 성분만 남아 경사를 따라 같은 장애물로 계속 미끄러진다.
    // 접선 방향(가능하면 내리막 쪽, 아니면 라이더가 있던 쪽)으로 최소 속도를 줘서 비켜 가게 한다.
    let tx = -nz, tz = nx;
    const flip = Math.abs(tz) > 0.2 ? tz > 0 : Math.sign(tx) !== (dx >= 0 ? 1 : -1);
    if (flip) {
      tx = -tx;
      tz = -tz;
    }
    // 접선에 내리막(-z) 성분을 섞어 장애물을 돌아 내려가게 한다
    let ex = tx, ez = tz - 0.6;
    const el = Math.hypot(ex, ez);
    ex /= el;
    ez /= el;
    const vn = Math.max(0, V.x * nx + V.z * nz);
    const vt = Math.max(4, V.x * ex + V.z * ez);
    V.x = ex * vt + nx * vn;
    V.z = ez * vt + nz * vn;
    this.yaw = Math.atan2(ex, -ez);
    this.switch = false;
    // 그래도 짧은 시간에 여러 번 부딪히면 끼인 것으로 보고 체크포인트로 옮긴다
    this.bumpTimes = this.bumpTimes.filter((t) => this.clock - t < 2.5);
    this.bumpTimes.push(this.clock);
    if (this.bumpTimes.length >= 6) {
      this.spawnAt(this.checkpoint, 7);
      if (this.mode === 'ride') this.message('체크포인트로 복귀', 'info', 1.2);
      return;
    }
    if (this.clock - this.lastBump > 0.8) {
      this.lastBump = this.clock;
      this.audio.miss();
      this.world.spray.emit(P, V, 25, 3, 2);
      if (this.mode === 'ride') this.message(o.kind === 'tree' ? '나무를 스쳤어요! 감속' : '바위에 부딪혀 감속', 'bad', 1);
    }
  }

  checkGates(s) {
    const gates = this.course.gates;
    while (this.gateIdx < gates.length && s >= gates[this.gateIdx].s) {
      const g = gates[this.gateIdx];
      const ok = Math.abs(this.p.x - g.x) <= g.w / 2;
      g.state = ok ? 'passed' : 'missed';
      this.world.setGateState(this.gateIdx, g.state);
      if (this.mode === 'ride') {
        if (ok) {
          this.gatesPassed++;
          this.score += 150;
          this.audio.gate();
        } else {
          this.gatesMissed++;
          this.penalty += 3;
          this.audio.miss();
          this.message('게이트 놓침 +3초', 'bad', 1.1);
        }
      }
      this.gateIdx++;
    }
  }

  finish() {
    this.mode = 'finished';
    this.finishT = 0;
    const total = this.time + this.penalty;
    this.finished = {
      trackId: this.track.id,
      easy: this.easy,
      time: this.time,
      penalty: this.penalty,
      total,
      score: this.score,
      gatesPassed: this.gatesPassed,
      gatesTotal: this.course.gates.length,
      crashes: this.crashes,
      maxSpeed: this.maxSpeed * 3.6,
      bestTrick: this.bestTrick,
      reported: false,
    };
    this.audio.beep(true);
    this.message('FINISH!', 'good', 2.4);
  }

  // ── 시각 효과 ─────────────────────────────────────────
  updateVisuals(dt) {
    const R = this.rider, P = this.p, V = this.v;
    R.root.position.copy(P);
    const onGround = this.grounded && !this.crashed;
    this.visN.lerp(onGround ? this.n : UP, 1 - Math.exp(-12 * dt)).normalize();
    this._qn.setFromUnitVectors(UP, this.visN);
    this._qy.setFromAxisAngle(UP, -this.yaw);
    R.root.quaternion.copy(this._qn).multiply(this._qy);

    const sp = V.length();
    this.leanS = damp(this.leanS, onGround ? this.steerS * Math.min(1, sp / 8) : 0, 8, dt);
    this.brakeS = damp(this.brakeS, onGround && this.ctl.down && sp > 2 ? 1 : 0, 7, dt);
    R.carve.rotation.z = -this.leanS * 0.42;
    R.carve.rotation.y = -this.brakeS * 0.85;
    if (this.crashed) R.air.rotation.set(this.tumble.x, this.tumble.y, this.tumble.z);
    else R.air.rotation.set(this.flip, -this.spin, 0);

    this.landSquash = Math.max(0, this.landSquash - dt * 3);
    const inAir = !this.grounded && !this.crashed;
    R.update(dt, {
      crouch: Math.max(this.charge * 0.9, this.landSquash, inAir ? 0.3 : 0.08, this.crashed ? 0.7 : 0, this.mode === 'countdown' ? 0.25 : 0),
      tuck: onGround && this.tuck ? 1 : 0,
      lean: this.leanS,
      grab: inAir && this.grabbing ? 1 : 0,
      grabType: this.grabType,
      brake: this.brakeS,
      headYaw: this.switch ? -1.2 : 1.2,
      bodyYaw: this.switch ? Math.PI : 0,
      armsUp: inAir ? 0.6 : this.crashed ? 1 : 0,
    });

    if (onGround && sp > 4) {
      this.sprayAcc += (this.skid * 90 + sp * 0.9) * dt;
      const n = Math.floor(this.sprayAcc);
      if (n > 0) {
        this.sprayAcc -= n;
        this.world.spray.emit(P, V, Math.min(n, 12), 1.2 + this.skid * 2.5, 0.8 + this.skid * 1.6);
      }
    }
  }

  cameraTarget(out, look, sp) {
    const P = this.p;
    let dist = this.camMode === 0 ? 6.2 + sp * 0.06 : 3.4;
    let height = this.camMode === 0 ? 2.4 : 1.5;
    const dir = this._t.copy(this.camDir);
    if (this.mode === 'attract') {
      // 메뉴 배경: 측면을 오가는 시네마틱 카메라
      dir.applyAxisAngle(UP, Math.sin(this.clock * 0.18) * 1.2);
      dist = 8;
      height = 2.2;
    }
    out.copy(P).addScaledVector(dir, -dist);
    out.y += height;
    look.copy(P).addScaledVector(this.camDir, 3);
    look.y += 1.1;
  }

  snapCamera() {
    this.forward(this.camDir);
    this.cameraTarget(this.camPos, this.camLook, 0);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  updateCamera(dt) {
    const V = this.v;
    const sp = Math.hypot(V.x, V.z);
    if (!this.crashed) {
      const t = sp > 1.5 ? this._f.set(V.x / sp, 0, V.z / sp) : this.forward(this._f);
      this.camDir.lerp(t, 1 - Math.exp(-3 * dt)).normalize();
    }
    const desired = this._lat;
    const look = this._gt;
    this.cameraTarget(desired, look, sp);
    this.camPos.lerp(desired, 1 - Math.exp(-(this.mode === 'attract' ? 3 : 7) * dt));
    const ground = this.course.height(this.camPos.x, -this.camPos.z) + 1.0;
    if (this.camPos.y < ground) this.camPos.y = ground;
    this.camLook.lerp(look, 1 - Math.exp(-12 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    const fov = 60 + clamp(sp - 10, 0, 20) * 0.6;
    this.camera.fov = damp(this.camera.fov, fov, 3, dt);
    this.camera.updateProjectionMatrix();
  }

  // ── HUD ───────────────────────────────────────────────
  setText(key, el, text) {
    if (this.hudCache[key] === text) return;
    this.hudCache[key] = text;
    el.textContent = text;
  }

  updateHud() {
    const H = this.hud;
    this.setText('time', H.time, formatTime(this.time + this.penalty));
    this.setText('score', H.score, this.score.toLocaleString('en-US'));
    this.setText('speed', H.speed, String(Math.round(this.v.length() * 3.6)));
    let queue = '';
    if (this.isEasy() && !this.grounded && !this.crashed) {
      const deg = Math.round(Math.abs(this.spinTarget) / Math.PI) * 180;
      const flips = Math.round(Math.abs(this.flipTarget) / (Math.PI * 2));
      const flipName = this.flipTarget > 0 ? '백플립' : '프론트플립';
      queue = [deg ? `${deg}°` : '', flips ? `${flips > 1 ? `${flips}× ` : ''}${flipName}` : ''].filter(Boolean).join(' + ');
    }
    this.setText('queue', H.queue, queue);
    this.setText('combo', H.combo, this.combo > 1 && this.comboTimer > 0 ? `COMBO ×${this.combo}` : '');
    const gates = this.course.gates.length;
    const label = gates ? `게이트 ${this.gatesPassed}/${gates}` : '프리라이드';
    this.setText('gates', H.gates, this.easy ? `${label} · 쉬움` : label);
    const prog = clamp(-this.p.z / this.course.length, 0, 1);
    const pct = `${(prog * 100).toFixed(1)}%`;
    if (this.hudCache.prog !== pct) {
      this.hudCache.prog = pct;
      H.progress.style.width = pct;
    }
    const charge = this.charge > 0 ? `${Math.round(this.charge * 100)}%` : '0%';
    if (this.hudCache.charge !== charge) {
      this.hudCache.charge = charge;
      H.charge.style.width = charge;
    }
  }

  message(text, cls = 'info', dur = 1.5) {
    const el = this.hud.msg;
    if (!text) {
      el.classList.remove('show');
      this.msgT = 0;
      return;
    }
    el.textContent = text;
    el.className = `msg show ${cls}`;
    this.msgT = dur;
  }

  showCountdown(text) {
    const el = this.hud.countdown;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.toneMappingExposure = this.track.env.exposure;
    this.renderer.render(this.scene, this.camera);
  }
}
