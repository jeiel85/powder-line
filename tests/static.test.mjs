import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));

test('index.html importmap이 src/의 모든 모듈을 캐시 무효화 대상으로 등록한다', () => {
  const html = read('index.html').toString();
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  const modules = readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.js') && f !== 'main.js');
  for (const f of modules) {
    assert.equal(map[`./src/${f}`], `./src/${f}?v=__BUILD__`, `importmap에 src/${f} 누락`);
  }
  assert.equal(map.three, './vendor/three.module.js?v=__BUILD__');
  assert.match(html, /src="src\/main\.js\?v=__BUILD__"/);
  assert.match(html, /href="style\.css\?v=__BUILD__"/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/, '런타임이 CDN에 의존하면 안 됨');
});

test('vendor/three.module.js가 devDependency three와 같은 파일이다', () => {
  const vendored = read('vendor/three.module.js');
  const pkg = read('node_modules/three/build/three.module.js');
  assert.ok(vendored.equals(pkg), 'npm run vendor 로 다시 복사하세요');
});
