import { Howl } from 'howler';

let masterVolume = 0.85;
let sfxVolume = 0.8;
let bgmVolume = 0.65;
let muted = false;
let rainLevel: 'muffled' | 'normal' | 'loud' = 'normal';
let initialized = false;

// Sound ID → Chinese folder name
const soundConfig: Record<string, string> = {
  door_lock:       '锁门声',
  door_scratch:    '门锁刮擦声',
  door_knock:      '敲门声',
  door_chain:      '门链声',
  door_open:       '开门声',
  key_insert:      '钥匙插入声',
  phone_msg:       '短信提示音',
  phone_call:      '来电铃声',
  phone_shutter:   '拍照快门声',
  phone_tap:       '触屏点击声',
  phone_dial:      '拨号音',
  footstep_near:   '近处脚步声',
  footstep_far:    '远处脚步声',
  footstep_leave:  '脚步远离声',
  elevator_echo:   '电梯回声',
  power_cut:       '断电声',
  light_hum:       '电流底噪声',
  chair_drag:      '拖动家具声',
  curtain_slide:   '窗帘滑动声',
  closet_open:     '衣柜开关声',
  water_tank:      '水箱检查声',
  bottle_cap:      '拧瓶盖声',
  clue_new:        '新线索提示音',
  threat_up:       '威胁警告音',
  window_scrape:   '窗户刮擦声',
  awning_drip:     '雨棚滴水声',
  voice_dongxine:  '人声短语',
  hallway_hum:     '楼道底噪声',
  pipe_water:      '管道水流声',
  tv_murmur:       '隔壁电视声',
  heartbeat_fast:  '快速心跳声',
  heartbeat_slow:  '缓慢心跳声',
  silence_tense:   '紧张沉默底噪',
  metal_hit:       '金属撞击声',
  knife_slash:     '刀具声',
  glass_break:     '玻璃破碎声',
  alarm_sound:     '警报声',
  ui_error_sfx:    'UI错误提示音',
  ui_success_sfx:  'UI成功提示音',
};

// Pool: sound ID → Howl instances (one per file variant)
const soundPool = new Map<string, Howl[]>();
// BGM instance
let bgmInstance: Howl | null = null;

// CHANGE THIS to match your project's static asset path to the audio-files directory
const REPO_BASE = '/audio/repository';

function sfxEffectiveVolume(): number {
  return sfxVolume * masterVolume;
}

function rainLevelMultiplier(): number {
  switch (rainLevel) {
    case 'muffled': return 0.5;
    case 'normal':  return 0.85;
    case 'loud':    return 1.0;
  }
}

function bgmEffectiveVolume(): number {
  return bgmVolume * masterVolume * rainLevelMultiplier();
}

async function init() {
  if (initialized) return;
  try {
    const resp = await fetch(`${REPO_BASE}/manifest.json`);
    const manifest: Record<string, string[]> = await resp.json();

    for (const [soundId, folderName] of Object.entries(soundConfig)) {
      const files = manifest[folderName];
      if (!files || files.length === 0) continue;

      const howls = files.map(file => {
        const src = `${REPO_BASE}/${encodeURIComponent(folderName)}/${encodeURIComponent(file)}`;
        return new Howl({
          src: [src],
          volume: sfxEffectiveVolume(),
          preload: true,
        });
      });
      soundPool.set(soundId, howls);
    }

    // BGM: first file from 背景雨声
    const bgmFiles = manifest['背景雨声'];
    if (bgmFiles && bgmFiles.length > 0) {
      const bgmSrc = `${REPO_BASE}/${encodeURIComponent('背景雨声')}/${encodeURIComponent(bgmFiles[0])}`;
      bgmInstance = new Howl({
        src: [bgmSrc],
        volume: bgmEffectiveVolume(),
        loop: true,
        preload: true,
      });
    }

    initialized = true;
  } catch (err) {
    console.warn('[audio] Failed to load manifest, audio disabled:', err);
  }
}

function pickHowl(name: string): Howl | null {
  const pool = soundPool.get(name);
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function applyAllSfxVolume() {
  const v = sfxEffectiveVolume();
  for (const howls of soundPool.values()) {
    for (const h of howls) h.volume(v);
  }
}

function applyBgmVolume() {
  if (bgmInstance) bgmInstance.volume(bgmEffectiveVolume());
}

export const audio = {
  async init() {
    await init();
  },

  playSfx(name: string) {
    if (muted) return;
    const h = pickHowl(name);
    if (h) h.play();
  },

  playAmbient(name: string) {
    if (muted) return;
    const h = pickHowl(name);
    if (h) {
      // Ambients play once, not looped (looping handled by game logic)
      h.loop(false);
      h.play();
    }
  },

  // ---- BGM ----
  startBgm() {
    if (muted || !bgmInstance) return;
    if (!bgmInstance.playing()) {
      bgmInstance.volume(0);
      bgmInstance.play();
      bgmInstance.fade(0, bgmEffectiveVolume(), 3000);
    }
  },

  stopBgm() {
    if (!bgmInstance) return;
    bgmInstance.fade(bgmInstance.volume() as number, 0, 2000);
    setTimeout(() => bgmInstance?.stop(), 2000);
  },

  setRainLevel(level: 'muffled' | 'normal' | 'loud') {
    if (rainLevel === level) return;
    rainLevel = level;
    if (!muted && bgmInstance?.playing()) {
      bgmInstance.fade(bgmInstance.volume() as number, bgmEffectiveVolume(), 1500);
    }
  },

  // ---- Volume ----
  setMasterVolume(v: number) {
    masterVolume = v;
    if (muted) return;
    applyAllSfxVolume();
    applyBgmVolume();
  },

  setSfxVolume(v: number) {
    sfxVolume = v;
    if (muted) return;
    applyAllSfxVolume();
  },

  setBgmVolume(v: number) {
    bgmVolume = v;
    if (muted) return;
    applyBgmVolume();
  },

  getMasterVolume() { return masterVolume; },
  getSfxVolume() { return sfxVolume; },
  getBgmVolume() { return bgmVolume; },

  mute() {
    muted = true;
    for (const howls of soundPool.values()) {
      for (const h of howls) h.volume(0);
    }
    if (bgmInstance) bgmInstance.volume(0);
  },

  unmute() {
    muted = false;
    applyAllSfxVolume();
    applyBgmVolume();
  },

  isMuted() { return muted; },

  unlock() {
    // Create AudioContext early while user gesture is active, so Howler
    // instances created later by init() inherit a running context.
    const H = Howler as any;
    if (!H.ctx) {
      H.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (H.ctx.state === 'suspended') {
      H.ctx.resume();
    }
    // Play a silent buffer to fully unlock the context on iOS/Safari
    const ctx = H.ctx as AudioContext;
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  },

  destroy() {
    for (const howls of soundPool.values()) {
      for (const h of howls) h.unload();
    }
    soundPool.clear();
    if (bgmInstance) bgmInstance.unload();
    bgmInstance = null;
    initialized = false;
  },
};
