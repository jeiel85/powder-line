import * as THREE from 'three';
import { Rider } from './rider.js';
import { treeGeometry } from './world.js';

/** 라이더 꾸미기 화면용 미리보기 씬 */
export class Locker {
  constructor(renderer, loadout) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#9fc3ea');
    this.scene.fog = new THREE.Fog('#9fc3ea', 12, 40);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(0, 1.35, 6.4);
    this.camera.lookAt(0, 0.85, 0);

    const hemi = new THREE.HemisphereLight('#e6f2ff', '#6f7f99', 1.3);
    const key = new THREE.DirectionalLight('#fff4e0', 2.4);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 20 });
    const rim = new THREE.DirectionalLight('#9cc8ff', 1.4);
    rim.position.set(-4, 3, -4);
    this.scene.add(hemi, key, rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(30, 48),
      new THREE.MeshStandardMaterial({ color: '#f4f8ff', roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.35, 0.12, 48),
      new THREE.MeshStandardMaterial({ color: '#e3edfa', roughness: 0.6 }),
    );
    ped.position.y = 0.06;
    ped.receiveShadow = true;
    this.scene.add(floor, ped);

    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88 });
    const treeGeos = [treeGeometry(1), treeGeometry(2), treeGeometry(3)];
    for (let i = 0; i < 14; i++) {
      const a = Math.PI * (1.05 + (i / 13) * 0.9); // 카메라 반대편(뒤쪽 반원)에만 배치
      const r = 9 + (i % 3) * 3;
      const s = 0.9 + (i % 4) * 0.3;
      const t = new THREE.Mesh(treeGeos[i % 3], treeMat);
      t.scale.setScalar(s);
      t.rotation.y = i * 1.7;
      t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r - 4);
      t.castShadow = true;
      this.scene.add(t);
    }

    this.rider = new Rider(loadout);
    this.rider.root.position.y = 0.12;
    this.scene.add(this.rider.root);
    this.rot = -0.6;
    this.t = 0;
    this.dragging = false;
    this.lastX = 0;
    this.idle = 0;

    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.dragging = true;
      this.lastX = e.clientX;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.rot += (e.clientX - this.lastX) * 0.01;
      this.lastX = e.clientX;
      this.idle = 0;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    this.active = false;
  }

  setLoadout(lo) {
    this.rider.setLoadout(lo);
  }

  /** 꾸미기 패널에 가리지 않도록 화면 중심을 옮긴다 */
  resize(w, h) {
    this.camera.aspect = w / h;
    // 세로 화면에서는 뒤로 물러나 전신이 보이게 한다
    this.camera.position.set(0, 1.35, w / h < 0.8 ? 10.5 : 6.4);
    this.camera.lookAt(0, 0.85, 0);
    if (w > 820) this.camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else this.camera.setViewOffset(w, h, 0, h * 0.27, w, h);
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.t += dt;
    this.idle += dt;
    if (!this.dragging && this.idle > 1.5) this.rot += dt * 0.45;
    this.rider.root.rotation.y = this.rot;
    this.rider.update(dt, {
      crouch: 0.12 + Math.sin(this.t * 1.6) * 0.05,
      lean: Math.sin(this.t * 0.8) * 0.25,
      armsUp: 0.15,
      headYaw: 0.9,
    });
  }

  render() {
    this.renderer.toneMappingExposure = 1;
    this.renderer.render(this.scene, this.camera);
  }
}
