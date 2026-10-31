const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'jump',
  ShiftLeft: 'grab', ShiftRight: 'grab', KeyK: 'grab', KeyJ: 'grab',
};
// 누르는 순간 한 번만 처리하는 키
const ACTIONS = { KeyR: 'respawn', Escape: 'pause', KeyP: 'pause', KeyC: 'camera', KeyM: 'mute' };

export class Input {
  constructor() {
    this.state = { left: false, right: false, up: false, down: false, jump: false, grab: false };
    // 프레임 사이에 눌렀다 뗀 짧은 탭도 놓치지 않도록 눌림을 래치한다
    this.pressed = { left: false, right: false, up: false, down: false, jump: false, grab: false };
    this.handlers = {};
    this.enabled = true;
    this.touchHeld = new Map();

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = KEYMAP[e.code];
      if (k) {
        if (this.enabled) e.preventDefault();
        if (!e.repeat) this.pressed[k] = true;
        this.state[k] = true;
      }
      const a = ACTIONS[e.code];
      if (a && !e.repeat) this.emit(a);
    });
    window.addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (k) this.state[k] = false;
    });
    window.addEventListener('blur', () => this.clear());
  }

  on(action, fn) { this.handlers[action] = fn; }
  emit(action) { this.handlers[action]?.(); }
  clear() {
    for (const k in this.state) this.state[k] = false;
    for (const k in this.pressed) this.pressed[k] = false;
  }

  /** 지난 호출 이후 새로 눌린 키를 돌려주고 래치를 비운다 */
  consumePresses(out) {
    for (const k in this.pressed) {
      out[k] = this.pressed[k];
      this.pressed[k] = false;
    }
    return out;
  }

  /** data-key 속성을 가진 터치 버튼을 연결한다 */
  bindTouch(root) {
    for (const el of root.querySelectorAll('[data-key]')) {
      const k = el.dataset.key;
      const down = (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        el.classList.add('on');
        this.pressed[k] = true;
        this.state[k] = true;
      };
      const up = (e) => {
        e.preventDefault();
        el.classList.remove('on');
        this.state[k] = false;
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }
  }
}
