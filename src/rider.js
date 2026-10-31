import * as THREE from 'three';
import { BOARD_TYPES, paintBoard } from './customize.js';

const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _perp = new THREE.Vector3();

const std = (color = '#ffffff', extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...extra });

function limb(radius, length, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), mat);
  m.castShadow = true;
  m.userData.len = length + radius * 2;
  return m;
}

/** 캡슐을 a→b 사이에 배치. stretch면 길이를 맞춰 늘린다. */
function placeBetween(mesh, a, b, stretch = false) {
  _d.subVectors(b, a);
  const dist = _d.length();
  if (dist < 1e-5) return;
  mesh.position.copy(a).addScaledVector(_d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, _d.multiplyScalar(1 / dist));
  if (stretch) mesh.scale.set(1, dist / mesh.userData.len, 1);
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

const V = () => new THREE.Vector3();
const KNEE_BEND = new THREE.Vector3(1, 0, 0);
const ELBOW_BEND = new THREE.Vector3(-0.25, -1, 0).normalize();

/**
 * 프리미티브로 만든 스노보더. 몸 로컬 좌표에서 레귤러 스탠스 라이더는 +x를 바라보고
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

    this.m = {
      jacket: std(), sleeve: std(), pants: std(), head: std('#fff', { roughness: 0.4 }),
      lens: std('#fff', { metalness: 0.85, roughness: 0.15 }), gloves: std(), neck: std(),
      skin: std('#efc3a0', { roughness: 0.6 }), boot: std('#1d2027'), binding: std(),
      boardBase: std(), boardTop: std('#fff', { roughness: 0.45 }), boardNose: std(),
      strap: std('#15171c'), hair: std('#3b2a20', { roughness: 0.9 }),
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
    const w = 0.29, th = 0.028, r = w / 2, mid = len - w;
    const b = this.m.boardBase;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, th, mid), [b, b, this.m.boardTop, b, b, b]);
    body.castShadow = true;
    this.board.add(body);
    const capMats = [b, this.m.boardNose, b];
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(r, r, th, 20, 1, false, Math.PI / 2, Math.PI), capMats);
    nose.position.z = -mid / 2;
    nose.rotation.x = 0.22;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(r, r, th, 20, 1, false, -Math.PI / 2, Math.PI), capMats);
    tail.position.z = mid / 2;
    tail.rotation.x = -0.22;
    nose.castShadow = tail.castShadow = true;
    this.board.add(nose, tail);
    this.board.position.y = 0.045;
  }

  buildBody() {
    const m = this.m;
    const body = (this.body = new THREE.Group());
    this.inner.add(body);
    const add = (mesh) => (body.add(mesh), mesh);

    this.feet = [new THREE.Vector3(0.02, 0.16, -0.24), new THREE.Vector3(0.02, 0.16, 0.24)];
    for (const f of this.feet) {
      const boot = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.12), m.boot));
      boot.position.set(0.02, 0.12, f.z);
      boot.castShadow = true;
      const bind = add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.15), m.binding));
      bind.position.set(0, 0.075, f.z);
      const hb = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.14), m.binding));
      hb.position.set(-0.13, 0.17, f.z);
      hb.rotation.z = -0.25;
    }
    this.thighs = [add(limb(0.078, 0.3, m.pants)), add(limb(0.078, 0.3, m.pants))];
    this.shins = [add(limb(0.066, 0.3, m.pants)), add(limb(0.066, 0.3, m.pants))];
    this.pelvis = add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), m.pants));
    this.pelvis.scale.set(0.9, 0.75, 1.15);
    this.pelvis.castShadow = true;
    this.torso = add(limb(0.17, 0.3, m.jacket));
    this.torso.scale.z = 1.12;
    this.uppers = [add(limb(0.056, 0.18, m.sleeve)), add(limb(0.056, 0.18, m.sleeve))];
    this.lowers = [add(limb(0.05, 0.18, m.sleeve)), add(limb(0.05, 0.18, m.sleeve))];
    this.shoulderBalls = [0, 1].map(() => {
      const s = add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), m.jacket));
      s.castShadow = true;
      return s;
    });
    this.hands = [0, 1].map(() => {
      const h = add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), m.gloves));
      h.scale.set(1, 0.9, 1.15);
      h.castShadow = true;
      return h;
    });
    this.neckMesh = add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.12, 14), m.neck));

    // 머리: 로컬 +x가 얼굴 방향
    const head = (this.head = new THREE.Group());
    body.add(head);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 14), m.skin);
    face.castShadow = true;
    head.add(face);
    this.helmet = new THREE.Mesh(new THREE.SphereGeometry(0.142, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), m.head);
    this.helmet.scale.set(1.04, 1, 1.06);
    this.helmet.position.y = 0.01;
    this.helmet.castShadow = true;
    this.beanie = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.132, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), m.head);
    cap.position.y = 0.035;
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.134, 0.134, 0.055, 20), m.head);
    cuff.position.y = 0.035;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), m.head);
    pom.position.y = 0.18;
    this.beanie.add(cap, cuff, pom);
    this.hair = new THREE.Mesh(new THREE.SphereGeometry(0.126, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m.hair);
    this.hair.position.set(-0.01, 0.012, 0);
    head.add(this.helmet, this.beanie, this.hair);

    this.goggles = new THREE.Group();
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.146, 0.146, 0.072, 18, 1, true, Math.PI / 2 - 0.85, 1.7),
      m.lens,
    );
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.138, 0.013, 6, 28), m.strap);
    strap.rotation.x = Math.PI / 2;
    this.goggles.add(lens, strap);
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
    m.lens.emissive.set(lo.lens).multiplyScalar(0.25);
    m.gloves.color.set(lo.gloves);
    m.neck.color.set(lo.neck);
    m.binding.color.set(lo.binding);
    m.boardBase.color.set(lo.boardBase).multiplyScalar(0.7);
    m.boardNose.color.set(lo.boardAccent);
    this.helmet.visible = lo.headwear === 'helmet';
    this.beanie.visible = lo.headwear === 'beanie';
    this.hair.visible = lo.headwear === 'bare';
    this.goggles.position.y = lo.headwear === 'helmet' ? 0.045 : 0.03;
    this.goggles.scale.setScalar(lo.headwear === 'helmet' ? 1.04 : 0.97);
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
    const hipY = 0.9 - crouch * 0.34;
    const hipX = -0.04 - crouch * 0.05 + P.lean * 0.05;
    for (let i = 0; i < 2; i++) {
      J.hip[i].set(hipX, hipY, i === 0 ? -0.11 : 0.11);
      solveJoint(J.hip[i], this.feet[i], 0.456, 0.432, KNEE_BEND, J.knee[i]);
      placeBetween(this.thighs[i], J.hip[i], J.knee[i]);
      placeBetween(this.shins[i], J.knee[i], this.feet[i], true);
    }
    J.hipC.set(hipX, hipY + 0.02, 0);
    this.pelvis.position.copy(J.hipC);
    J.chest.set(
      hipX + 0.07 + crouch * 0.2 + P.tuck * 0.12 + P.lean * 0.1,
      hipY + 0.5 - crouch * 0.08 - P.tuck * 0.06,
      0,
    );
    J.tmp.copy(J.hipC).y += 0.08;
    placeBetween(this.torso, J.tmp, J.chest);
    this.neckMesh.position.set(J.chest.x + 0.02, J.chest.y + 0.19, 0);
    this.head.position.set(J.chest.x + 0.03, J.chest.y + 0.33, 0);
    this.head.rotation.y = P.headYaw;

    // 손 목표
    const lean = P.lean;
    const up = P.armsUp * 0.45;
    const hands = J.hand;
    hands[0].set(0.16 + lean * 0.14, hipY + 0.06 + up - Math.abs(lean) * 0.08, -0.56);
    hands[1].set(0.02 + lean * 0.14, hipY - 0.04 + up, 0.5);
    if (P.tuck > 0.01) {
      J.tmp.set(0.42, hipY + 0.08, -0.12);
      J.tmp2.set(0.42, hipY + 0.06, 0.1);
      hands[0].lerp(J.tmp, P.tuck);
      hands[1].lerp(J.tmp2, P.tuck);
    }
    if (P.grab > 0.01) {
      const t = this.grabType;
      if (t === 'indy') hands[1].lerp(J.tmp.set(0.14, 0.15, 0.04), P.grab);
      else if (t === 'method') hands[0].lerp(J.tmp.set(-0.15, 0.16, -0.02), P.grab);
      else hands[0].lerp(J.tmp.set(0.14, 0.15, -0.06), P.grab);
    }
    for (let i = 0; i < 2; i++) {
      J.sh[i].set(J.chest.x - 0.01, J.chest.y + 0.1, i === 0 ? -0.2 : 0.2);
      this.shoulderBalls[i].position.copy(J.sh[i]);
      solveJoint(J.sh[i], hands[i], 0.29, 0.28, ELBOW_BEND, J.el[i]);
      placeBetween(this.uppers[i], J.sh[i], J.el[i]);
      placeBetween(this.lowers[i], J.el[i], hands[i], true);
      this.hands[i].position.copy(hands[i]);
    }

    this.body.rotation.y = P.bodyYaw;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    for (const mat of Object.values(this.m)) mat.dispose();
    this.boardTex.dispose();
  }
}
