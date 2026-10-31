import * as THREE from 'three';
import { TRACKS, getTrack, buildCourse } from './tracks.js';
import { Game, formatTime } from './game.js';
import { Locker } from './locker.js';
import { SnowAudio } from './audio.js';
import { Input } from './input.js';
import {
  BOARD_TYPES, BOARD_OPTIONS, DEFAULT_LOADOUT, PALETTE, RIDER_OPTIONS,
  loadLoadout, randomLoadout, saveLoadout,
} from './customize.js';
import { storage } from './util.js';

const $ = (id) => document.getElementById(id);
const RECORDS_KEY = 'powderline.records.v1';
const TRACK_KEY = 'powderline.track';

function fatal(msg) {
  $('loading-text').textContent = msg;
  document.querySelector('#loading .spinner')?.remove();
}

const canvas = $('c');
const coarse = matchMedia('(pointer: coarse)').matches;
const quality = coarse || Math.min(innerWidth, innerHeight) < 560 ? 'low' : 'high';

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
} catch (err) {
  console.error(err);
  fatal('WebGL을 초기화할 수 없습니다. 하드웨어 가속을 켜거나 다른 브라우저를 사용해 주세요.');
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const hud = {
  root: $('hud'), time: $('hud-time'), score: $('hud-score'), combo: $('hud-combo'), speed: $('hud-speed'),
  gates: $('hud-gates'), progress: $('hud-progress'), charge: $('hud-charge'), trick: $('trick'),
  msg: $('hud-msg'), countdown: $('countdown'),
};
const audio = new SnowAudio();
const input = new Input();
input.bindTouch($('touch'));
if (coarse) document.body.classList.add('touch-device');

let loadout = loadLoadout();
let trackId = getTrack(storage.get(TRACK_KEY)).id;
let records = loadRecords();

/** 손상되었거나 다른 형식인 저장값은 버린다 */
function loadRecords() {
  const raw = storage.get(RECORDS_KEY);
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const t of TRACKS) {
    const r = raw[t.id];
    if (r && Number.isFinite(r.bestTime) && Number.isFinite(r.bestScore)) {
      out[t.id] = { bestTime: r.bestTime, bestScore: r.bestScore, runs: Number.isFinite(r.runs) ? r.runs : 1 };
    }
  }
  return out;
}

const game = new Game(renderer, { audio, input, hud, quality });
let locker = null;

// ── 화면 전환 ──────────────────────────────────────────
const screens = {
  main: $('screen-main'), tracks: $('screen-tracks'), locker: $('screen-locker'),
  controls: $('screen-controls'), pause: $('screen-pause'), results: $('screen-results'),
};
let screen = 'loading';
let modalReturn = 'main';

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
  hud.root.classList.toggle('hidden', !(name === 'play' || name === 'pause'));
  screen = name;
  input.enabled = name === 'play';
  document.body.dataset.screen = name;
  if (name !== 'play') input.clear();
  if (locker) locker.active = name === 'locker';
  if (name === 'main') refreshMain();
  if (name === 'tracks') renderTracks();
  if (name === 'locker') {
    ensureLocker();
    renderLocker();
  }
}

function go(target) {
  audio.init();
  if (target === 'back') return show(modalReturn);
  if (target === 'controls') modalReturn = screen === 'loading' ? 'main' : screen;
  if (target === 'main' || target === 'tracks') {
    if (screen === 'locker') {
      saveLoadout(loadout);
      game.setLoadout(loadout);
    }
    if (game.mode !== 'attract') game.startAttract();
  }
  show(target);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-go]');
  if (btn) go(btn.dataset.go);
});

// ── 기록 ───────────────────────────────────────────────
function bestOf(id) {
  return records[id] || {};
}

function refreshMain() {
  const t = getTrack(trackId);
  $('main-track-name').textContent = `${t.name} · ${'◆'.repeat(t.difficulty)}${'◇'.repeat(3 - t.difficulty)}`;
  const b = bestOf(t.id);
  $('main-track-best').textContent = b.bestTime
    ? `최고 기록 ${formatTime(b.bestTime)} · 최고 점수 ${b.bestScore.toLocaleString('en-US')}`
    : '아직 기록이 없어요';
}

// ── 트랙 선택 ──────────────────────────────────────────
const trackStats = Object.fromEntries(
  TRACKS.map((t) => {
    const c = buildCourse(t);
    return [t.id, { gates: c.gates.length, kickers: c.kickers.length }];
  }),
);

function selectTrack(id) {
  if (id === trackId && game.track?.id === id) return;
  trackId = id;
  storage.set(TRACK_KEY, id);
  game.load(getTrack(id), loadout);
  game.startAttract();
}

function renderTracks() {
  const list = $('track-list');
  list.innerHTML = '';
  for (const t of TRACKS) {
    const st = trackStats[t.id];
    const b = bestOf(t.id);
    const card = document.createElement('button');
    card.className = `track-card${t.id === trackId ? ' selected' : ''}`;
    card.style.setProperty('--sky-top', t.env.skyTop);
    card.style.setProperty('--sky-bottom', t.env.skyBottom);
    card.innerHTML = `
      <div class="tc-art"><span class="tc-en">${t.en}</span></div>
      <div class="tc-body">
        <div class="tc-title"><h3>${t.name}</h3><span class="diff d${t.difficulty}">${['', '초급', '중급', '상급'][t.difficulty]}</span></div>
        <p>${t.desc}</p>
        <ul class="tc-meta">
          <li><b>${(t.length / 1000).toFixed(1)}km</b>길이</li>
          <li><b>${Math.round(Math.atan(t.slope) * 180 / Math.PI)}°</b>경사</li>
          <li><b>${st.kickers}</b>킥커</li>
          <li><b>${st.gates || '–'}</b>게이트</li>
        </ul>
        <div class="tc-best">${b.bestTime ? `🏆 ${formatTime(b.bestTime)} · ${b.bestScore.toLocaleString('en-US')}점` : '기록 없음'}</div>
      </div>`;
    card.addEventListener('click', () => {
      selectTrack(t.id);
      renderTracks();
    });
    card.addEventListener('dblclick', () => startRide());
    list.appendChild(card);
  }
  const ride = document.createElement('div');
  ride.className = 'track-actions';
  ride.innerHTML = '<button class="btn primary big">▶ 이 트랙으로 라이딩</button>';
  ride.querySelector('button').addEventListener('click', startRide);
  list.appendChild(ride);
}

// ── 꾸미기 ─────────────────────────────────────────────
let lockerTab = 'rider';

function ensureLocker() {
  if (locker) return;
  locker = new Locker(renderer, loadout);
  locker.resize(innerWidth, innerHeight);
  locker.active = true;
}

function updateLoadout(patch) {
  loadout = { ...loadout, ...patch };
  locker.setLoadout(loadout);
  saveLoadout(loadout);
  renderLocker();
}

function renderLocker() {
  const box = $('locker-options');
  box.innerHTML = '';
  const opts = lockerTab === 'rider' ? RIDER_OPTIONS : BOARD_OPTIONS;
  for (const opt of opts) {
    const row = document.createElement('div');
    row.className = 'opt';
    row.innerHTML = `<div class="opt-label">${opt.label}</div>`;
    const wrap = document.createElement('div');
    wrap.className = opt.type === 'color' ? 'swatches' : 'chips';
    if (opt.type === 'color') {
      for (const c of opt.palette || PALETTE) {
        const b = document.createElement('button');
        b.className = `swatch${loadout[opt.key] === c ? ' on' : ''}`;
        b.style.background = c;
        b.title = c;
        b.addEventListener('click', () => updateLoadout({ [opt.key]: c }));
        wrap.appendChild(b);
      }
    } else {
      for (const [id, label] of opt.choices) {
        const b = document.createElement('button');
        b.className = `chip${loadout[opt.key] === id ? ' on' : ''}`;
        b.textContent = label;
        b.addEventListener('click', () => updateLoadout({ [opt.key]: id }));
        wrap.appendChild(b);
      }
    }
    row.appendChild(wrap);
    box.appendChild(row);
    if (opt.key === 'boardType') {
      const bt = BOARD_TYPES[loadout.boardType];
      const info = document.createElement('div');
      info.className = 'board-info';
      info.innerHTML = `<p>${bt.desc}</p>${Object.entries(bt.stats)
        .map(([k, v]) => `<div class="bar"><span>${k}</span><i style="--v:${v / 5}"></i></div>`)
        .join('')}`;
      box.appendChild(info);
    }
  }
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    lockerTab = tab.dataset.tab;
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
    renderLocker();
  });
}
$('btn-random').addEventListener('click', () => updateLoadout({ ...randomLoadout(), stance: loadout.stance }));
$('btn-reset-look').addEventListener('click', () => updateLoadout({ ...DEFAULT_LOADOUT }));

// ── 플레이 ─────────────────────────────────────────────
function startRide() {
  audio.init();
  if (game.track?.id !== trackId) game.load(getTrack(trackId), loadout);
  game.setLoadout(loadout);
  game.startRun();
  show('play');
}

$('btn-play').addEventListener('click', startRide);
$('btn-again').addEventListener('click', startRide);
$('btn-restart').addEventListener('click', startRide);
$('btn-resume').addEventListener('click', () => {
  game.resume();
  show('play');
});
$('btn-cp').addEventListener('click', () => {
  game.resume();
  show('play');
  game.manualRespawn();
});
$('btn-quit').addEventListener('click', () => go('main'));
$('btn-pause').addEventListener('click', () => togglePause());

function togglePause() {
  if (screen === 'play') {
    if (game.pause()) show('pause');
  } else if (screen === 'pause') {
    game.resume();
    show('play');
  }
}

input.on('pause', togglePause);
input.on('respawn', () => screen === 'play' && game.manualRespawn());
input.on('camera', () => screen === 'play' && game.toggleCamera());
input.on('mute', toggleMute);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'play' && game.pause()) show('pause');
});

game.onFinish = (r) => {
  const prev = bestOf(r.trackId);
  const newTime = !prev.bestTime || r.total < prev.bestTime;
  const newScore = prev.bestScore === undefined || r.score > prev.bestScore;
  records[r.trackId] = {
    bestTime: newTime ? r.total : prev.bestTime,
    bestScore: newScore ? r.score : prev.bestScore,
    runs: (prev.runs || 0) + 1,
  };
  storage.set(RECORDS_KEY, records);
  const t = getTrack(r.trackId);
  $('res-track').textContent = t.name;
  $('res-time').textContent = formatTime(r.total);
  $('res-time-badge').textContent = newTime ? 'NEW BEST' : r.penalty ? `페널티 +${r.penalty}초 포함` : '';
  $('res-score').textContent = r.score.toLocaleString('en-US');
  $('res-score-badge').textContent = newScore && r.score > 0 ? 'NEW BEST' : '';
  $('res-gates').textContent = r.gatesTotal ? `${r.gatesPassed} / ${r.gatesTotal}` : '–';
  $('res-speed').textContent = `${Math.round(r.maxSpeed)} km/h`;
  $('res-crashes').textContent = String(r.crashes);
  $('res-trick').textContent = r.bestTrick ? `${r.bestTrick.name} (${r.bestTrick.pts.toLocaleString('en-US')})` : '–';
  const b = records[r.trackId];
  $('res-best').textContent = `이 트랙 최고 기록 ${formatTime(b.bestTime)} · 최고 점수 ${b.bestScore.toLocaleString('en-US')} · ${b.runs}회 완주`;
  show('results');
};

// ── 소리 / 전체화면 ────────────────────────────────────
function syncMute() {
  $('btn-mute').textContent = audio.muted ? '🔇' : '🔊';
}
function toggleMute() {
  audio.init();
  audio.setMuted(!audio.muted);
  syncMute();
}
$('btn-mute').addEventListener('click', toggleMute);
$('btn-fs').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch((err) => console.warn('전체화면 실패', err));
});
syncMute();

// ── 루프 ───────────────────────────────────────────────
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  game.resize(w, h);
  locker?.resize(w, h);
}
addEventListener('resize', resize);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (screen === 'locker' && locker) {
    locker.update(dt);
    locker.render();
  } else {
    game.update(dt);
    game.render();
  }
  requestAnimationFrame(frame);
}

async function boot() {
  // 보드 그래픽·배너에 웹폰트를 쓰므로 잠시 기다린다(실패해도 대체 폰트로 진행)
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 2000))]);
  resize();
  game.load(getTrack(trackId), loadout);
  game.startAttract();
  $('loading').classList.add('hidden');

  // 딥링크: ?track=glacier&screen=locker|tracks|play
  const q = new URLSearchParams(location.search);
  if (q.get('track')) selectTrack(getTrack(q.get('track')).id);
  const s = q.get('screen');
  if (s === 'play') startRide();
  else if (s === 'locker' || s === 'tracks' || s === 'controls') show(s);
  else show('main');
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  fatal(`게임을 시작하지 못했습니다: ${err.message}`);
});

// 콘솔 디버깅용 핸들
window.powderline = { game, get loadout() { return loadout; } };
