import * as THREE from 'three';
import { BOARD_TYPES, paintBoard } from './customize.js';
import { roundedBox } from './geo.js';

const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _perp = new THREE.Vector3();

const std = (color = '#ffffff', extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...extra });

/** 길이 1짜리 원통(위아래 반지름이 다름). placeBetween으로 늘려 팔다리로 쓴다 */
function segment(rTop, rBottom, mat, radial = 14) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, 1, radial, 1, false);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.userData.len = 1;
  return m;
}

function ball(r, mat, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

/** 메쉬(+y가 길이 방향)를 a→b 사이에 배치하고 길이를 맞춘다 */
function placeBetween(mesh, a, b, fromBase = false) {
  _d.subVectors(b, a);
  const dist = _d.length();
  if (dist < 1e-5) return;
  if (fromBase) mesh.position.copy(a);
  else mesh.position.copy(a).addScaledVector(_d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, _d.multiplyScalar(1 / dist));
  mesh.scale.y = dist / mesh.userData.len;
}

/** 2본 IK: root→end 사이 관절 위치를 bend 방향으로 구한다. */
function solveJoint(root, end, l1, l2, bend, out) {
  _d.subVectors(end, root);
  const dist = Math.min(_d.length(), l1 + l2 - 1e-3);
  _d.normalize();
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  _perp.copy(bend).addScaledVector(_d, -bend.dot(_d)).normalize();
  return out.copy(root).addScaledVector(_d, along).addScaledVector(_perp, h);
}

/**
 * 스노보드 상판 윤곽(사이드컷 + 둥근 노즈/테일)과 노즈·테일 라이즈를 가진 판.
 * 그룹: 0 = 윗면(그래픽), 1 = 바닥, 2 = 옆면(엣지)
 */
function boardGeometry(len, width) {
  const half = len / 2, R = width / 2, tip = 0.17, eff = half - tip;
  const sidecut = 0.022, th = 0.022, N = 20;
  const outline = [];
  const hw = (z) => R - sidecut * (1 - (z / eff) ** 2);
  for (let i = 0; i <= N; i++) { const z = eff - (2 * eff * i) / N; outline.push([hw(z), z]); }
  for (let i = 1; i < N; i++) { const a = (i / N) * Math.PI; outline.push([R * Math.cos(a), -eff - tip * Math.sin(a)]); }
  for (let i = 0; i <= N; i++) { const z = -eff + (2 * eff * i) / N; outline.push([-hw(z), z]); }
  for (let i = 1; i < N; i++) { const a = (i / N) * Math.PI; outline.push([-R * Math.cos(a), eff + tip * Math.sin(a)]); }
  const rise = (z) => (Math.abs(z) > eff ? ((Math.abs(z) - eff) / tip) ** 2 * 0.075 : 0);

  const pos = [], uv = [];
  const groups = [];
  const vtx = (x, y, z) => {
    pos.push(x, y, z);
    uv.push(x / width + 0.5, 1 - (z / len + 0.5));
  };
  const n = outline.length;
  for (const [y0, flip] of [[th, false], [0, true]]) {
    const start = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const [x1, z1] = outline[i], [x2, z2] = outline[(i + 1) % n];
      const a = [0, y0, 0], b = [x1, rise(z1) + y0, z1], c = [x2, rise(z2) + y0, z2];
      for (const p of flip ? [a, c, b] : [a, b, c]) vtx(...p);
    }
    groups.push([start, pos.length / 3 - start]);
  }
  const sideStart = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = outline[i], [x2, z2] = outline[(i + 1) % n];
    const t1 = [x1, rise(z1) + th, z1], t2 = [x2, rise(z2) + th, z2];
    const b1 = [x1, rise(z1), z1], b2 = [x2, rise(z2), z2];
    for (const p of [t1, b1, b2, t1, b2, t2]) vtx(...p);
  }
  groups.push([sideStart, pos.length / 3 - sideStart]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  groups.forEach(([s, c], i) => geo.addGroup(s, c, i));
  geo.computeVertexNormals();
  return geo;
}

const V = () => new THREE.Vector3();
const KNEE_BEND = new THREE.Vector3(1, 0, 0);
const ELBOW_BEND = new THREE.Vector3(-0.3, -1, 0).normalize();
const THIGH = 0.44, SHIN = 0.43, UPPER = 0.28, FORE = 0.27;

/**
 * 스노보더. 몸 로컬 좌표에서 레귤러 스탠스 라이더는 +x를 바라보고
 * 보드는 z축(노즈 = -z)을 따라 놓인다. 구피는 x축 미러링으로 표현한다.
 *
 * 계층: root(위치·지면 정렬·yaw) → carve(기울기·브레이크 회전) → air(스핀·플립, 무게중심 피벗) → inner
 */
export class Rider {
  constructor(loadout) {
    this.root = new THREE.Group();
    this.carve = new THREE.Group();
    this.air = new THREE.Group();
    this.inner = new THREE.Group();
    this.air.position.y = 0.8;
    this.inner.position.y = -0.8;
    this.root.add(this.carve);
    this.carve.add(this.air);
    this.air.add(this.inner);

    const both = { side: THREE.DoubleSide };
    this.m = {
      jacket: std('#fff', { roughness: 0.62 }),
      sleeve: std('#fff', { roughness: 0.62 }),
      pants: std('#fff', { roughness: 0.85 }),
      head: std('#fff', { roughness: 0.35, metalness: 0.05 }),
      lens: std('#fff', { metalness: 0.9, roughness: 0.08, ...both }),
      gloves: std('#fff', { roughness: 0.8 }),
      neck: std('#fff', { roughness: 0.9 }),
      skin: std('#e9b896', { roughness: 0.6 }),
      boot: std('#2a2e38', { roughness: 0.7 }),
      sole: std('#121418', { roughness: 0.9 }),
      binding: std('#fff', { roughness: 0.45, ...both }),
      boardBase: std('#fff', { roughness: 0.35, ...both }),
      boardTop: std('#fff', { roughness: 0.4, ...both }),
      boardEdge: std('#9aa3b0', { roughness: 0.3, metalness: 0.7, ...both }),
      strap: std('#15171c', { ...both }),
      hair: std('#3b2a20', { roughness: 0.95 }),
      trim: std('#1b1e26', { roughness: 0.6, ...both }),
    };
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 128;
    this.boardCanvas.height = 512;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    this.boardTex.anisotropy = 4;
    this.m.boardTop.map = this.boardTex;

    this.board = new THREE.Group();
    this.inner.add(this.board);
    this.buildBody();

    this.pose = { crouch: 0, tuck: 0, lean: 0, grab: 0, brake: 0, headYaw: 1.2, bodyYaw: 0, armsUp: 0 };
    this.grabType = 'indy';
    this.loadout = null;
    this.setLoadout(loadout);
    this.update(0, {});
  }

  buildBoard(len) {
    for (const c of [...this.board.children]) {
      c.geometry.dispose();
      this.board.remove(c);
    }
    const mesh = new THREE.Mesh(boardGeometry(len, 0.29), [this.m.boardTop, this.m.boardBase, this.m.boardEdge]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.board.add(mesh);
    this.board.position.y = 0.035;
  }

  buildBody() {
    const m = this.m;
    const body = (this.body = new THREE.Group());
    this.inner.add(body);
    const add = (mesh) => (body.add(mesh), mesh);

    // ── 바인딩 + 부츠 (발 위치 고정) ──
    this.feet = [new THREE.Vector3(0.0, 0.2, -0.24), new THREE.Vector3(0.0, 0.2, 0.24)];
    const plateG = roundedBox(0.3, 0.03, 0.18, 0.05);
    const bootG = roundedBox(0.31, 0.11, 0.13, 0.05);
    const soleG = roundedBox(0.32, 0.03, 0.14, 0.04);
    const cuffG = new THREE.CylinderGeometry(0.075, 0.072, 0.16, 14);
    const hbG = new THREE.CylinderGeometry(0.1, 0.11, 0.26, 14, 1, true, Math.PI * 1.5 - 1.05, 2.1);
    const strapG = new THREE.TorusGeometry(0.085, 0.016, 6, 14, Math.PI);
    for (const f of this.feet) {
      const plate = add(new THREE.Mesh(plateG, m.binding));
      plate.position.set(0, 0.07, f.z);
      plate.castShadow = true;
      const sole = add(new THREE.Mesh(soleG, m.sole));
      sole.position.set(0.02, 0.1, f.z);
      const boot = add(new THREE.Mesh(bootG, m.boot));
      boot.position.set(0.03, 0.16, f.z);
      boot.castShadow = true;
      const cuff = add(new THREE.Mesh(cuffG, m.boot));
      cuff.position.set(-0.005, 0.25, f.z);
      cuff.castShadow = true;
      const hb = add(new THREE.Mesh(hbG, m.binding));
      hb.position.set(0.02, 0.22, f.z);
      hb.rotation.z = 0.18;
      hb.castShadow = true;
      for (const sx of [0.1, -0.01]) {
        const strap = add(new THREE.Mesh(strapG, m.strap));
        strap.rotation.y = Math.PI / 2;
        strap.position.set(sx, sx > 0 ? 0.13 : 0.2, f.z);
        strap.scale.set(1, sx > 0 ? 0.7 : 1, 1);
      }
    }

    // ── 다리: 통 넓은 보드 팬츠 ──
    this.thighs = [add(segment(0.105, 0.088, m.pants)), add(segment(0.105, 0.088, m.pants))];
    this.shins = [add(segment(0.088, 0.1, m.pants)), add(segment(0.088, 0.1, m.pants))];
    this.knees = [add(ball(0.086, m.pants)), add(ball(0.086, m.pants))];
    this.pelvis = add(ball(0.16, m.pants, 0.9, 0.62, 1.1));

    // ── 상체: 회전체로 만든 패딩 재킷 ──
    const profile = [
      [0.0, -0.02], [0.155, -0.02], [0.175, 0.04], [0.19, 0.16], [0.205, 0.3],
      [0.2, 0.4], [0.17, 0.47], [0.1, 0.52], [0.0, 0.53],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    this.torso = add(new THREE.Mesh(new THREE.LatheGeometry(profile, 22), m.jacket));
    this.torso.userData.len = 0.5;
    this.torso.castShadow = true;
    // 토르소 자식은 몸통 길이 스케일을 함께 받는다
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.025, 8, 24), m.trim);
    hem.rotation.x = Math.PI / 2;
    hem.position.y = 0.0;
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.44, 0.016), m.trim);
    zip.position.set(0.2, 0.25, 0);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.125, 0.09, 18, 1, true), m.jacket);
    collar.position.y = 0.53;
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 6, 24, Math.PI), m.trim);
    yoke.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    yoke.position.y = 0.4;
    this.torso.add(hem, zip, collar, yoke);
    this.torso.scale.set(0.82, 1, 1.18);

    // ── 팔: 퍼프 소매 + 벙어리장갑 ──
    this.shoulderBalls = [0, 1].map(() => add(ball(0.08, m.sleeve)));
    this.uppers = [add(segment(0.08, 0.07, m.sleeve)), add(segment(0.08, 0.07, m.sleeve))];
    this.elbows = [add(ball(0.07, m.sleeve)), add(ball(0.07, m.sleeve))];
    this.lowers = [add(segment(0.07, 0.062, m.sleeve)), add(segment(0.07, 0.062, m.sleeve))];
    this.cuffs = [0, 1].map(() => {
      const c = add(new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.05, 12), m.gloves));
      c.castShadow = true;
      return c;
    });
    this.hands = [0, 1].map(() => {
      const h = new THREE.Group();
      const palm = ball(0.065, m.gloves, 1, 0.8, 1.25);
      const thumb = ball(0.03, m.gloves);
      thumb.position.set(0.04, 0.02, 0);
      h.add(palm, thumb);
      return add(h);
    });
    this.neckMesh = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.12, 16), m.neck));
    this.neckMesh.castShadow = true;

    // ── 머리: 로컬 +x가 얼굴 방향 ──
    const head = (this.head = new THREE.Group());
    body.add(head);
    const face = ball(0.112, m.skin, 0.95, 1.05, 0.92);
    head.add(face);
    // 넥워머가 턱까지 올라온다
    const gaiter = new THREE.Mesh(new THREE.SphereGeometry(0.117, 16, 10, 0, Math.PI * 2, Math.PI * 0.7, Math.PI * 0.3), m.neck);
    head.add(gaiter);
    const nose = ball(0.022, m.skin, 1, 1.2, 0.9);
    nose.position.set(0.108, -0.01, 0);
    head.add(nose);

    this.helmet = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.142, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), m.head);
    shell.scale.set(1.06, 1.02, 1.0);
    shell.castShadow = true;
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.145, 18, 6, Math.PI - 0.7, 1.4, Math.PI * 0.42, 0.12), m.head);
    visor.scale.set(1.1, 1, 1);
    const ventG = new THREE.BoxGeometry(0.07, 0.012, 0.018);
    for (const vz of [-0.045, 0, 0.045]) {
      const vent = new THREE.Mesh(ventG, m.trim);
      vent.position.set(0.0, 0.142, vz);
      this.helmet.add(vent);
    }
    const ear = new THREE.CylinderGeometry(0.038, 0.038, 0.018, 14);
    for (const ez of [-1, 1]) {
      const pad = new THREE.Mesh(ear, m.trim);
      pad.rotation.x = Math.PI / 2;
      pad.position.set(-0.01, -0.02, ez * 0.128);
      this.helmet.add(pad);
    }
    this.helmet.add(shell, visor);
    this.helmet.position.y = 0.015;

    this.beanie = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), m.head);
    cap.scale.set(1, 1.12, 1);
    cap.position.y = 0.03;
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.028, 8, 24), m.head);
    rib.rotation.x = Math.PI / 2;
    rib.position.y = 0.035;
    const pom = ball(0.05, m.head);
    pom.position.y = 0.19;
    this.beanie.add(cap, rib, pom);

    this.hair = new THREE.Group();
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.122, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m.hair);
    hairCap.position.set(-0.01, 0.012, 0);
    const bangs = new THREE.Mesh(new THREE.SphereGeometry(0.124, 12, 6, Math.PI - 0.8, 1.6, Math.PI * 0.3, 0.25), m.hair);
    bangs.position.y = 0.01;
    this.hair.add(hairCap, bangs);
    head.add(this.helmet, this.beanie, this.hair);

    // 고글: 프레임 띠 + 반사 렌즈 + 스트랩
    this.goggles = new THREE.Group();
    // CylinderGeometry는 theta=π/2에서 +x(얼굴 방향)를 향한다
    const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.122, 0.085, 24, 1, true, Math.PI / 2 - 1.0, 2.0), m.trim);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.133, 0.127, 0.066, 24, 1, true, Math.PI / 2 - 0.88, 1.76), m.lens);
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.124, 0.124, 0.04, 24, 1, true, Math.PI / 2 + 1.0, Math.PI * 2 - 2.0), m.strap);
    this.goggles.add(frame, lens, strap);
    head.add(this.goggles);

    this.j = {
      hip: [V(), V()], knee: [V(), V()], hipC: V(), chest: V(),
      sh: [V(), V()], el: [V(), V()], hand: [V(), V()], tmp: V(), tmp2: V(),
    };
  }

  setLoadout(lo) {
    const prev = this.loadout;
    this.loadout = { ...lo };
    const m = this.m;
    m.jacket.color.set(lo.jacket);
    m.sleeve.color.set(lo.sleeve);
    m.pants.color.set(lo.pants);
    m.head.color.set(lo.headColor);
    m.lens.color.set(lo.lens);
    m.lens.emissive.set(lo.lens).multiplyScalar(0.3);
    m.gloves.color.set(lo.gloves);
    m.neck.color.set(lo.neck);
    m.binding.color.set(lo.binding);
    m.boardBase.color.set(lo.boardBase).multiplyScalar(0.55);
    this.helmet.visible = lo.headwear === 'helmet';
    this.beanie.visible = lo.headwear === 'beanie';
    this.hair.visible = lo.headwear === 'bare';
    // 눈높이에 맞추고, 헬멧일 때는 챙 아래로 살짝 들어가게 한다
    this.goggles.position.y = lo.headwear === 'helmet' ? -0.012 : -0.005;
    this.goggles.scale.setScalar(lo.headwear === 'helmet' ? 1.08 : 1.0);
    this.body.scale.x = lo.stance === 'goofy' ? -1 : 1;
    if (!prev || prev.boardType !== lo.boardType) this.buildBoard(BOARD_TYPES[lo.boardType].len);
    this.repaintBoard();
  }

  repaintBoard() {
    const ctx = this.boardCanvas.getContext('2d');
    paintBoard(ctx, this.boardCanvas.width, this.boardCanvas.height, this.loadout);
    this.boardTex.needsUpdate = true;
  }

  /** 목표 포즈로 부드럽게 이동 후 관절 배치 */
  update(dt, target) {
    const P = this.pose;
    const k = dt > 0 ? 1 - Math.exp(-12 * dt) : 1;
    for (const key in P) if (target[key] !== undefined) P[key] += (target[key] - P[key]) * k;
    // 스위치 전환은 보드 yaw와 동시에 π만큼 바뀌어 상쇄되므로 보간하지 않는다
    if (target.bodyYaw !== undefined) P.bodyYaw = target.bodyYaw;
    if (target.grabType) this.grabType = target.grabType;

    const J = this.j;
    const crouch = Math.max(P.crouch, P.tuck * 0.85, P.grab);
    const hipY = 0.92 - crouch * 0.34;
    const hipX = -0.05 - crouch * 0.05 + P.lean * 0.05;
    for (let i = 0; i < 2; i++) {
      J.hip[i].set(hipX, hipY, i === 0 ? -0.12 : 0.12);
      solveJoint(J.hip[i], this.feet[i], THIGH, SHIN, KNEE_BEND, J.knee[i]);
      placeBetween(this.thighs[i], J.hip[i], J.knee[i]);
      placeBetween(this.shins[i], J.knee[i], this.feet[i]);
      this.knees[i].position.copy(J.knee[i]);
    }
    J.hipC.set(hipX, hipY + 0.02, 0);
    this.pelvis.position.copy(J.hipC);
    J.chest.set(
      hipX + 0.07 + crouch * 0.2 + P.tuck * 0.12 + P.lean * 0.1,
      hipY + 0.5 - crouch * 0.08 - P.tuck * 0.06,
      0,
    );
    J.tmp.copy(J.hipC).y += 0.02;
    placeBetween(this.torso, J.tmp, J.chest, true);
    // 목·머리는 몸통 끝(어깨선)을 따라간다
    _d.subVectors(J.chest, J.tmp).normalize();
    this.neckMesh.position.copy(J.chest).addScaledVector(_d, 0.04);
    this.neckMesh.quaternion.setFromUnitVectors(UP, _d);
    this.head.position.copy(J.chest).addScaledVector(_d, 0.165);
    this.head.position.x += 0.02;
    this.head.rotation.y = P.headYaw;

    // 손 목표
    const lean = P.lean;
    const up = P.armsUp * 0.45;
    const hands = J.hand;
    hands[0].set(0.18 + lean * 0.14, hipY + 0.08 + up - Math.abs(lean) * 0.08, -0.55);
    hands[1].set(0.02 + lean * 0.14, hipY - 0.02 + up, 0.5);
    if (P.tuck > 0.01) {
      J.tmp.set(0.44, hipY + 0.06, -0.12);
      J.tmp2.set(0.44, hipY + 0.04, 0.1);
      hands[0].lerp(J.tmp, P.tuck);
      hands[1].lerp(J.tmp2, P.tuck);
    }
    if (P.grab > 0.01) {
      const t = this.grabType;
      if (t === 'indy') hands[1].lerp(J.tmp.set(0.15, 0.12, 0.04), P.grab);
      else if (t === 'method') hands[0].lerp(J.tmp.set(-0.16, 0.13, -0.02), P.grab);
      else hands[0].lerp(J.tmp.set(0.15, 0.12, -0.06), P.grab);
    }
    for (let i = 0; i < 2; i++) {
      J.sh[i].set(J.chest.x - 0.03, J.chest.y - 0.04, i === 0 ? -0.2 : 0.2);
      this.shoulderBalls[i].position.copy(J.sh[i]);
      solveJoint(J.sh[i], hands[i], UPPER, FORE, ELBOW_BEND, J.el[i]);
      placeBetween(this.uppers[i], J.sh[i], J.el[i]);
      placeBetween(this.lowers[i], J.el[i], hands[i]);
      this.elbows[i].position.copy(J.el[i]);
      this.hands[i].position.copy(hands[i]);
      this.hands[i].quaternion.copy(this.lowers[i].quaternion);
      this.cuffs[i].position.copy(J.el[i]).lerp(hands[i], 0.82);
      this.cuffs[i].quaternion.copy(this.lowers[i].quaternion);
    }

    this.body.rotation.y = P.bodyYaw;
  }

  dispose() {
    const geos = new Set();
    this.root.traverse((o) => {
      if (o.isMesh) geos.add(o.geometry);
    });
    for (const g of geos) g.dispose();
    for (const mat of Object.values(this.m)) mat.dispose();
    this.boardTex.dispose();
  }
}
