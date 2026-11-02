// devDependency로 받은 three.js 빌드를 vendor/로 복사한다. three 버전을 올릴 때 실행.
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
copyFileSync(`${root}node_modules/three/build/three.module.js`, `${root}vendor/three.module.js`);
console.log('vendor/three.module.js 갱신 완료');
