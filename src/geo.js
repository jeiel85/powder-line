import * as THREE from 'three';

/**
 * 여러 지오메트리를 하나로 합친다(인스턴싱용). 각 항목에 단색 color 또는
 * 정점별 색을 정하는 colorFn(position, normal, outColor)를 줄 수 있다.
 */
export function mergeColored(parts) {
  const pos = [], nor = [], col = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  for (const { geo, color, colorFn } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const gp = g.attributes.position, gn = g.attributes.normal;
    for (let i = 0; i < gp.count; i++) {
      p.fromBufferAttribute(gp, i);
      n.fromBufferAttribute(gn, i);
      if (colorFn) colorFn(p, n, c);
      else c.set(color);
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** 정점을 방사 방향으로 흔들어 매끈한 프리미티브를 유기적인 모양으로 만든다 */
export function jitter(geo, amount, rng, keepBottom = false) {
  const pos = geo.attributes.position;
  if (keepBottom) geo.computeBoundingBox();
  const seen = new Map();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (keepBottom && v.y <= geo.boundingBox?.min.y + 1e-4) continue;
    // 같은 위치의 정점은 같은 양만큼 움직여 틈이 생기지 않게 한다
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 1 + (rng() * 2 - 1) * amount);
    const k = seen.get(key);
    pos.setXYZ(i, v.x * k, v.y * (1 + (k - 1) * 0.4), v.z * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** 모서리가 둥근 상자 (부츠·바인딩 베이스용) */
export function roundedBox(w, h, d, r, seg = 3) {
  const shape = new THREE.Shape();
  const x = -w / 2 + r, y = -d / 2 + r, ww = w - 2 * r, dd = d - 2 * r;
  shape.moveTo(x, y - r);
  shape.lineTo(x + ww, y - r);
  shape.quadraticCurveTo(x + ww + r, y - r, x + ww + r, y);
  shape.lineTo(x + ww + r, y + dd);
  shape.quadraticCurveTo(x + ww + r, y + dd + r, x + ww, y + dd + r);
  shape.lineTo(x, y + dd + r);
  shape.quadraticCurveTo(x - r, y + dd + r, x - r, y + dd);
  shape.lineTo(x - r, y);
  shape.quadraticCurveTo(x - r, y - r, x, y - r);
  const bevel = Math.min(r, h / 2) * 0.9;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, h - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.6,
    bevelSegments: seg,
    curveSegments: seg * 2,
  });
  // 압출 방향(z)을 높이(y)로 돌리고 가운데 정렬
  geo.rotateX(-Math.PI / 2);
  geo.center();
  geo.computeVertexNormals();
  return geo;
}
