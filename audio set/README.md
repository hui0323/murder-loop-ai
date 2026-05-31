# 音频系统整合包

可安装的独立音频系统。文件夹驱动、清单发现、Howler.js 引擎、React 组件。

---

## 快速安装（推荐）

在整合包根目录运行：

```bash
node install.js <你的游戏项目根目录>
```

例如：
```bash
node install.js ../my-game
```

这会自动完成：
1. 复制 `audio-files/` → 项目的 `public/audio/repository/`
2. 复制 `engine/` → 项目的 `src/audio/`
3. 复制 `components/` → 项目的 `src/components/`
4. 复制 `scripts/` → 项目的 `scripts/`
5. 运行扫描脚本，生成 `manifest.json`

完成后按提示操作即可。

---

## 手动安装（如果自动脚本不适用）

### 第一步：安装 npm 依赖

在你的游戏项目根目录：

```bash
npm install howler
npm install -D @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe fluent-ffmpeg
```

### 第二步：放入音频文件

将 `audio-files/` 下所有文件夹复制到项目的**静态资源目录**，使浏览器可以访问：

```
你的项目/
└── public/
    └── audio/
        └── repository/
            ├── 敲门声/
            │   ├── 1.ogg
            │   └── 2.ogg
            ├── 来电铃声/
            ├── 背景雨声/
            │   └── 0_sleepy_times_rain_loop.wav
            ├── ...（共 49 个文件夹）
            └── manifest.json      ← 之后由脚本生成
```

### 第三步：复制引擎代码

将 `engine/` 下三个文件放入项目的音频模块目录：

```
你的项目/
└── src/
    └── audio/
        ├── engine.ts      ← 核心引擎
        ├── hooks.ts       ← React hooks
        └── mappings.ts    ← 音效映射表
```

**必须修改 `engine.ts` 中的路径常量**，使其指向第二步的静态资源路径：

```ts
// engine.ts 第 58 行
const REPO_BASE = '/audio/repository'; // ← 改成你项目的静态路径
```

例如 Vite 项目 `public/audio/repository/` → `REPO_BASE = '/audio/repository'`

### 第四步：复制 React 组件

将 `components/` 下的文件放入项目的组件目录：

```
你的项目/
└── src/
    └── components/
        ├── RainPlayer.tsx       ← 独立 BGM 播放器
        ├── VolumeControl.tsx    ← 音量控制面板
        └── AudioGate.tsx        ← 首次交互解锁门
```

### 第五步：复制脚本

将 `scripts/` 下三个 `.mjs` 文件放入项目根目录的 `scripts/` 文件夹。

### 第六步：生成 manifest

```bash
node scripts/scan-audio-repo.mjs public/audio/repository
```

---

## 集成到游戏代码

### 1. 入口文件（main.tsx / App.tsx）

```tsx
// 在 App 顶层挂载 RainPlayer（隐形，自动播放、自动恢复）
import { RainPlayer } from './components/RainPlayer';

function App() {
  return (
    <>
      <RainPlayer />
      {/* ... 其余 UI ... */}
    </>
  );
}
```

### 2. 首次交互解锁

```tsx
import { AudioGate } from './components/AudioGate';
import { audio } from './audio/engine';

function App() {
  const [audioReady, setAudioReady] = useState(false);

  return (
    <>
      {!audioReady && (
        <AudioGate onUnlock={() => setAudioReady(true)} />
      )}
      {/* ... */}
    </>
  );
}
```

### 3. 音量控制面板

```tsx
import { VolumeControl } from './components/VolumeControl';

function Header() {
  return (
    <header>
      <VolumeControl />
    </header>
  );
}
```

### 4. 游戏音效触发

```tsx
import { useGameAudio } from './audio/hooks';

function GameScreen({ gameState }) {
  useGameAudio({
    phase: gameState.phase,           // 游戏阶段
    threat: gameState.threat,         // 威胁值 0-100
    actionIntents: gameState.actions, // 玩家动作列表
    killerType: gameState.killerMove, // 环境/对手动作
    isCinematic: gameState.cutscene,  // 是否过场动画
    turnCompleted: gameState.turnEnd, // 回合是否结束
  });
}
```

---

## 配置音效映射

### soundConfig（engine.ts）— 音效 ID → 文件夹名

```ts
const soundConfig: Record<string, string> = {
  door_knock: '敲门声',       // ID 用英文，值为中文文件夹名
  phone_call: '来电铃声',
  // 添加你自己的映射...
};
```

### actionSfxMap（mappings.ts）— 玩家动作 → 音效

```ts
export const actionSfxMap: Record<string, string[]> = {
  open_door:        ['door_chain', 'door_open'],
  communicate:      ['phone_msg'],
  // 你的游戏动作...
};
```

### killerSfxMap（mappings.ts）— 环境/对手行为 → 音效

```ts
export const killerSfxMap: Record<string, string[]> = {
  door_knock:       ['door_knock'],
  power_cut:        ['power_cut'],
  // 你的环境事件...
};
```

### ambientByPhase（mappings.ts）— 游戏阶段 → 氛围音效

```ts
export const ambientByPhase: Record<string, string> = {
  intro:            'silence_tense',
  investigating:    'hallway_hum',
  // 你的游戏阶段...
};
```

---

## 日常操作

### 更换/添加音频文件后

每次修改 `audio-files/` 中的音频文件（添加、删除、替换），**必须**重新生成 manifest：

```bash
node scripts/scan-audio-repo.mjs public/audio/repository
```

manifest.json 是前端引擎发现音效的唯一途径，不更新则无法识别新文件。

### 给长音效加渐弱

```bash
node scripts/apply-fadeout.mjs public/audio/repository
```

自动对 >= 2 秒的音频末尾添加指数衰减渐弱（2-3s→0.4s, 3-5s→0.6s, 5-10s→1.0s, 10-30s→1.5s, 30s+→2.0s）。

### 从长音频生成无缝循环 BGM

```bash
node scripts/create-rain-loop.mjs <你的长音频文件>
```

从 FLAC/WAV 中提取 60s 循环片段，交叉淡入淡出消除接缝。输出到 `public/audio/`。

### 添加新音效类别

1. 在 `audio-files/` 下新建中文命名文件夹，放入音频文件
2. 在 `engine.ts` 的 `soundConfig` 中添加：`new_sound: '新文件夹名'`
3. 在 `mappings.ts` 中将 `new_sound` 关联到游戏动作/事件
4. 运行 `node scripts/scan-audio-repo.mjs public/audio/repository`

### 替换 BGM

将新的雨声/背景音文件放入 `audio-files/背景雨声/`，确保它是文件夹中字母序排第一的文件（如 `0_xxx.wav`），然后重新生成 manifest。

---

## 技术栈

| 层 | 技术 |
|---|------|
| 浏览器音频引擎 | Howler.js 2.2.x — Web Audio API 封装 |
| BGM 持续播放 | HTML5 Audio 元素（独立于 Web Audio，不受 autoplay 策略限制） |
| 音频处理 | ffmpeg + ffprobe（无缝循环、渐弱、时长检测） |
| 前端框架 | React 18+ |
| 清单扫描 | Node.js ESM 脚本 |
| 格式支持 | .wav .mp3 .ogg .flac .m4a .aac .webm |

---

## 架构

```
用户操作 → 后端解析 → { actionIntents, killerType }
                              ↓
hooks.ts: useGameAudio  →  mappings.ts 查找音效名
                              ↓
engine.ts: playSfx()    →  soundPool 随机选变体 → Howl.play()
                              ↓
                         Web Audio API 输出
```

BGM 独立线路：

```
RainPlayer.tsx → HTML5 <audio> 标签 → 独立音频通道
    ↑
    音量同步 ← VolumeControl 左滑块 ← audio.getBgmVolume()
    静音同步 ← VolumeControl 静音按钮 ← audio.isMuted()
    自动恢复 ← 每 500ms 轮询，暂停则自动续播
```

---

## 音量架构

```
masterVolume (总控, 默认 0.85)
    ├── bgmVolume (BGM 滑块, 默认 0.65) → RainPlayer HTML5 Audio
    └── sfxVolume (SFX 滑块, 默认 0.8) → Howl 池中全部 SFX
```

---

## 验证清单

安装完成后，逐项确认：

- [ ] `public/audio/repository/manifest.json` 存在且包含所有文件夹
- [ ] 浏览器访问 `http://localhost:xxxx/audio/repository/manifest.json` 返回 JSON
- [ ] 浏览器访问 `http://localhost:xxxx/audio/repository/敲门声/1.ogg` 返回音频（200, audio/ogg）
- [ ] TypeScript 编译无错误（`npx tsc --noEmit`）
- [ ] 打开页面 → 点击任意处 → 雨声开始循环播放
- [ ] 拖动 BGM 滑块 → 雨声大小变化
- [ ] 拖动 SFX 滑块 → 触发一个游戏动作 → 音效大小变化
- [ ] 点击静音按钮 → 雨声和音效同时静音

---

## 故障排除

**雨声不播放**
- 检查 `public/audio/repository/背景雨声/` 下是否有 `0_` 开头的文件
- 检查 manifest.json 中 `背景雨声` 数组的第一项是否是该文件
- 确认 VolumeControl 没有处于静音状态
- 确认左滑块（Music 图标）音量不为 0

**音效不触发**
- 确认 `actionIntents` / `killerType` 中传的值在 `actionSfxMap` / `killerSfxMap` 中有对应的映射
- 检查对应的中文文件夹中是否有音频文件
- 检查 manifest.json 中对应的文件夹条目是否包含文件
- 打开浏览器控制台，看是否有 `[audio]` 前缀的警告

**manifest 不更新**
- 确认运行脚本时传入的路径正确
- 确认 Node.js 版本 >= 18

**编译错误**
- 确认 `howler` 已安装：`npm ls howler`
- 确认 `@types/howler` 存在：`ls node_modules/@types/howler`
