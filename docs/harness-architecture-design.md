# murder-loop-ai Harness 架构改造设计文档

> **版本**: v1.0 | **日期**: 2026-05-30 | **状态**: 设计完成，待实现

---

## 0. 一句话总结

将 murder-loop-ai 从**线性 AI 调用管道**重构为 **Harness Engineering（约束工程）架构**——通过 EventBus 事件总线、Agent 注册中心、产物契约（ArtifactContract）和七层约束体系，让 AI 角色之间形成真正的有机协作，同时保持系统可靠、可审计、可诊断。

---

## 1. 项目背景与改造目标

### 1.1 当前项目

《murder-loop-ai》是一款多 AI 协作驱动的悬疑时间循环互动小说游戏。玩家通过自然语言输入行动，系统用规则引擎维护世界事实，由行动解析 AI、凶手 AI、叙事 AI、NPC 模块和评分系统共同推动悬疑生存循环。

- 仓库：`https://github.com/hui0323/murder-loop-ai`
- 技术栈：TypeScript Monorepo（React + Vite 前端 / Fastify 后端 / game-core 规则包）
- 当前状态：可运行的 MVP 原型，核心文字循环闭环已跑通

### 1.2 当前架构的核心问题

```
玩家输入 → AI解析 → 规则执行 → 凶手AI → 规则校验 → 叙事AI → 导演评分 → 前端
```

这是一个**线性管道**。每个步骤只知道自己上一步的输出，AI 角色之间通过共享内存传参，没有标准化的通信协议。具体痛点：

| 问题 | 表现 |
|------|------|
| 管道耦合 | 所有逻辑塞在 `resolveTurn()` 一个函数里，加新角色/步骤需要改核心 |
| 无产物契约 | Agent 之间靠函数参数传数据，没有版本化的输入/输出 schema |
| 上下文 ad-hoc | 每个 AI 的 prompt 临时拼凑，没有结构化的知识注入和边界过滤 |
| 护栏硬编码 | `message_reply` 等守卫规则散落在代码各处，不是声明式规则引擎 |
| 缺少诊断 | 没有回合复盘、Agent 决策日志、根因分析工具 |
| 前端巨型组件 | `App.tsx` 承担了太多状态管理职责 |

### 1.3 改造目标

1. **完整性**：Harness 七层架构全部搭建（每层 MVP 级别，但必须跑通）
2. **有机联系**：AI 角色之间通过 EventBus + ArtifactContract 通信，支持多 Agent 协商
3. **可诊断**：每回合输出结构化诊断数据，前端新增调试面板
4. **双版本**：完整版（接 AI API，无大小限制）+ 互动空间 Demo（≤8MB，离线 fallback）
5. **前端不动**：当前前端已有良好沉浸感，本次改造**不改前端视觉**

---

## 2. Harness Engineering 核心概念

> **Agent = Model + Harness**
>
> AI 模型是马，Harness 是引导这匹马走向正确方向的缰绳和马具。
> 核心思想：不优化模型本身，而是构建一个可靠、可控、可审计的运行环境。

### 2.1 四大核心设计要素

| 要素 | 说明 | 本项目现状 |
|------|------|-----------|
| ① 角色边界 | 每个 Agent 只做一件事 | ✅ 已有（Parser/Killer/Narrator/Director） |
| ② 状态机 | 定义流程走向，防止跳步 | ✅ 已有（XState gamePhaseMachine） |
| ③ 产物契约 | Agent 间用文件/契约传递，不靠内存 | 🔴 缺失（核心改造点） |
| ④ 护栏规则 | 明确禁止清单，防止越权 | 🟡 部分（硬编码，需声明式改造） |

### 2.2 七层技术架构

```
第1层  项目搭建层    标准化环境、编码规范、AGENTS.md
第2层  上下文工程层   动态信息管理、知识卡片、信息边界、LRU缓存
第3层  约束与防护层   声明式规则引擎、输入验证、输出过滤
第4层  多Agent架构层  EventBus + AgentRegistry + ArtifactContract
第5层  评估与反馈层   质量保障(硬守卫) + 软评分(异步+2秒超时)
第6层  长时间任务层   SQLite持久化、存档/读档、AI决策日志
第7层  诊断工具层     回合复盘、Agent决策可视化、调试面板
```

---

## 3. 核心架构设计（第4层 — 骨架）

### 3.1 从管道到事件驱动

**旧架构：**
```
resolveTurn(state, input) {
  plan = await parseAction(input)
  playerResult = applyRules(state, plan)
  killerStrategy = await chooseKillerStrategy(state)
  killerResult = applyKillerStrategy(state, killerStrategy)
  narration = await narrate(context)
  score = await scoreRun(narration)
  return finalState
}
```

**新架构：**
```
EventBus.emit(PlayerActionSubmitted)
  → ParserAgent 订阅 → 产出 ActionPlan
  → EventBus.emit(ActionParsed)
  → RuleAgent 订阅 → 产出 RuleResult
  → EventBus.emit(RulesApplied)
  → KillerAgent 订阅 → 产出 KillerStrategy
  → RuleAgent 校验 KillerStrategy
  → EventBus.emit(KillerActed)
  → NarratorAgent 订阅 → 产出 Narration
  → DirectorAgent Phase1 同步硬守卫检查
  → EventBus.emit(NarrationDone)
  → UIAdapterAgent 立即渲染给玩家
  → DirectorAgent Phase2 异步软评分（2秒超时）
```

### 3.2 三大核心组件

#### GameEventBus（~150行）

```typescript
class GameEventBus {
  // 注册处理器
  subscribe(event: GameEventType, handler: EventHandler, priority: number): void

  // 发射事件（同步执行所有处理器，按优先级排序）
  emit(event: GameEvent): Promise<EventResult[]>

  // 异步发射（不阻塞主流程）
  emitAsync(event: GameEvent): void

  // 生命周期钩子
  onBeforeHandle(callback): void
  onAfterHandle(callback): void
  onError(callback): void

  // 事件日志（环形缓冲区，最近500条）
  getEventLog(): EventLogEntry[]
}
```

设计原则：
- **同步优先**：游戏逻辑需要确定性，默认同步执行
- **关键节点异步**：AI 调用走异步，通过 `emitAsync` 发射
- **优先级排序**：同事件的多个处理器按 priority (1-100) 有序执行
- **事件日志**：所有事件自动记录到环形缓冲区，供诊断层消费

#### AgentRegistry

```typescript
interface AgentRegistration {
  id: 'parser' | 'killer' | 'narrator' | 'director' | 'npc' | 'rule';

  // 订阅的事件 + 优先级
  subscriptions: { event: GameEventType; priority: number }[];

  // 产物契约
  contract: ArtifactContract;

  // 双实现：AI（完整版）+ fallback（Demo）
  handler: AgentHandler;    // AI 调用
  fallback: AgentHandler;   // 离线规则

  // 能力声明
  capabilities: Capability[];
}
```

#### ArtifactContract（产物契约）

```typescript
interface ArtifactContract {
  version: string;        // 语义版本，不匹配时拒绝传递
  input: ZodSchema;       // 输入必须满足的 schema
  output: ZodSchema;      // 输出必须满足的 schema
  validate: boolean;      // 是否在传递前校验（默认 true）
}
```

Agent 之间**不共享可变内存**，只通过带版本号的契约传递数据。契约版本不匹配 → 拒绝接收，防止 Agent 升级后破坏下游。

### 3.3 事件类型定义

```typescript
type GameEventType =
  | 'PlayerActionSubmitted'   // 玩家输入了行动
  | 'ActionParsed'            // 行动解析完成
  | 'RulesApplied'            // 规则系统执行完毕
  | 'KillerActed'             // 凶手策略已执行
  | 'NarrationDone'           // 叙事生成完成
  | 'NarrationRewriteRequested' // 导演要求重写叙事
  | 'HighRiskScenarioDetected'  // 高风险场景（报警核验等）
  | 'TurnCompleted'           // 回合结束
  | 'GamePhaseChanged'        // 游戏阶段切换
  | 'DeathTriggered'          // 玩家死亡
  | 'SurvivalTriggered'       // 玩家生还
  | 'LoopRewound'             // 时间循环回溯
```

### 3.4 高风险场景 Agent 协商

当检测到高风险场景时（报警核验、假警察、证据提交），触发多 Agent 并行判断 → 导演仲裁：

```
HighRiskScenarioDetected
  ├─ RuleAgent:     "门锁状态=已加固，假警察无法直接进入"
  ├─ KillerAgent:   "假警察应尝试施压，威胁逮捕令"
  ├─ NarratorAgent: "门外传来不耐烦的催促声..."
  └─ DirectorAgent 仲裁: 采纳 RuleAgent + KillerAgent
      → 输出：假警察施压事件 + 玩家获得"核实身份"线索
```

---

## 4. 七层实施方案

### 第1层：项目搭建层

**目标**：新开发者看 AGENTS.md 就能理解架构并开始开发。

**改动**：
- 根目录新增 `AGENTS.md`（架构索引地图）
- `packages/*/AGENTS.md`（每个包的开发指南）
- `package.json` 增加 `demo` 构建脚本

### 第2层：上下文工程层（关键升级）

**目标**：每个 Agent 从结构化的知识卡片系统中按需加载上下文，而非 ad-hoc 拼凑 prompt。

**知识卡片结构**：
```
packages/content/knowledge/
├─ story-bible/          # 故事圣经
│   ├─ timeline.json     # 事件时间线
│   ├─ characters.json   # 角色信息（沈知夏/陈怀民/林越/警察）
│   └─ factions.json     # 组织关系（转运链/警方）
├─ room-503/             # 青荷公寓503室
│   ├─ layout.json       # 房间布局
│   ├─ items.json        # 物品清单
│   └─ hiding-spots.json # 可藏匿位置
├─ rules/                # 规则知识
│   ├─ physics.json      # 物理规则（门窗开关、声音传播）
│   └─ social.json       # 社交规则（报警流程、警察核验）
└─ agent-contexts/       # 按 Agent 定制
    ├─ parser.context.json
    ├─ killer.context.json
    ├─ narrator.context.json
    └─ director.context.json
```

**ContextBuilder 服务**：
```typescript
class ContextBuilder {
  build(agent: AgentId, state: GameState): AgentContext {
    // 1. 加载该 Agent 的静态知识卡片
    // 2. 合并动态游戏状态
    // 3. 应用信息边界过滤（凶手不能看到它不该知道的信息）
    // 4. LRU 缓存 + 智能截断（控制 token 消耗）
  }
}
```

关键实现：凶手 Agent 的 context 自动过滤掉"玩家把包裹藏在哪里"等信息——除非凶手通过合理途径发现了。

### 第3层：约束与防护层

**目标**：把散落在代码里的 guard 逻辑统一为声明式规则引擎。

**规则引擎**：
```json
{
  "rules": [
    {
      "id": "no-killer-omniscience",
      "on": "KillerActed",
      "check": "killerStrategy.knownInfo ⊆ killerKnowledge(state)",
      "violation": "reject"
    },
    {
      "id": "no-ambient-append-on-reply",
      "on": "NarrationDone",
      "when": "actionPlan.type === 'message_reply'",
      "check": "!ambientNarration.hasNewThreat()",
      "violation": "rewrite"
    },
    {
      "id": "no-fake-police-auto-entry",
      "on": "KillerActed",
      "when": "state.doorReinforced === true && killerStrategy.type === 'fake_police_entry'",
      "check": "false",
      "violation": "reject"
    }
  ]
}
```

三种违规处理：
- **reject**：直接拦截，使用 fallback 替代
- **warn**：记录警告但放行（供诊断）
- **rewrite**：触发重写流程

### 第4层：多 Agent 架构层（核心新建）

已在第3节详述。核心组件：EventBus + AgentRegistry + ArtifactContract + 7个 Agent 实现。

### 第5层：评估与反馈层

**目标**：质量保障（底线）+ 玩家氛围反馈（亮点）。

#### Phase 1：硬守卫（同步，<5ms）

不调用 AI，纯规则匹配：
- 规则一致性：叙事是否违反游戏事实？
- 信息泄露：凶手是否开了上帝视角？

通过 → 叙事立即显示给玩家。不通过 → 拦截，用 fallback 替换问题段落。

#### Phase 2：软评分（异步，2-5秒，2秒超时）

调用 AI 评分：
- 文笔质量：是否机械/重复/平淡？
- 节奏评估：紧张感是否合适？

**2秒超时机制**：如果 AI 评分在 2 秒内返回 → 本回合即可重写优化。超时 → 降级为异步，评分结果指导下回合 Prompt。

#### 玩家氛围反馈

不对玩家显示数值评分，而是输出 `moodSignal` 字段：
- "你感觉自己的判断越来越清晰，但房间里的压迫感也在增强"
- "林越的短信让你稍微安心了一些"

### 第6层：长时间任务层

**目标**：持久化存档、AI 决策日志、路线回放。

完整版使用 SQLite（better-sqlite3），Demo 版使用 localStorage，通过 `StoreAdapter` 接口统一。

```typescript
interface StoreAdapter {
  save(key: string, data: unknown): void;
  load(key: string): unknown | null;
  delete(key: string): void;
  list(prefix: string): string[];
}
```

### 第7层：诊断工具层

**目标**：前端新增调试面板（按 ` 键或 URL 参数 `?debug=1` 开启）。

**面板内容**：事件时间线（每步耗时）、Agent 决策记录（输入/输出/耗时/AI还是fallback）、导演评分详情、护栏触发记录、上下文构建快照、凶手知识边界可视化。

---

## 5. 完整文件改动清单

### 新建文件

```
# 第1层：项目搭建
AGENTS.md
packages/*/AGENTS.md (5个文件)

# 第2层：上下文工程
packages/content/knowledge/ (整个目录，约10个JSON)
packages/game-core/src/context/ContextBuilder.ts
packages/game-core/src/context/knowledgeLoader.ts
packages/game-core/src/context/boundaryFilter.ts

# 第3层：约束与防护
packages/game-core/src/guards/guardRegistry.ts
packages/game-core/src/guards/guardEngine.ts
packages/game-core/src/guards/guard-rules.json

# 第4层：多Agent架构（核心）
packages/game-core/src/events/EventBus.ts
packages/game-core/src/events/eventTypes.ts
packages/game-core/src/events/AgentRegistry.ts
packages/game-core/src/contracts/ArtifactContract.ts
packages/game-core/src/contracts/parser.contract.ts
packages/game-core/src/contracts/killer.contract.ts
packages/game-core/src/contracts/narrator.contract.ts
packages/game-core/src/contracts/director.contract.ts
packages/game-core/src/agents/ParserAgent.ts
packages/game-core/src/agents/RuleAgent.ts
packages/game-core/src/agents/KillerAgent.ts
packages/game-core/src/agents/NarratorAgent.ts
packages/game-core/src/agents/DirectorAgent.ts
packages/game-core/src/agents/NpcAgent.ts
packages/game-core/src/agents/UIAdapterAgent.ts

# 第5层：评估与反馈
packages/game-core/src/scoring/hardGuard.ts
packages/game-core/src/scoring/softScorer.ts
packages/game-core/src/scoring/moodSignal.ts

# 第6层：持久化
packages/game-core/src/store/db.ts
packages/game-core/src/store/saveLoad.ts
packages/game-core/src/store/decisionLog.ts
packages/game-core/src/store/replayStore.ts
packages/game-core/src/store/StoreAdapter.ts

# 第7层：诊断
packages/game-core/src/diagnostics/TurnReport.ts
packages/game-core/src/diagnostics/DecisionTracer.ts
apps/web/src/components/DebugPanel/ (5个组件)
```

### 修改文件

```
packages/game-core/src/index.ts                    # 新增导出
packages/game-core/src/loop/resolveTurn.ts         # 重写为事件发射器
packages/game-core/src/machines/gamePhaseMachine.ts # 集成EventBus
apps/server/src/index.ts                           # 注册Agent + 启动EventBus
apps/server/src/routes/frontendAdapter.ts          # 改为通过EventBus获取结果
apps/web/src/App.tsx                               # 事件驱动的状态更新
package.json                                       # 新增demo构建脚本
```

### 不改的文件

```
apps/web/src/components/StoryPanel.tsx   # 保持现有沉浸式体验
apps/web/src/components/InputArea.tsx    # 保持
apps/web/src/components/Sidebar.tsx      # 保持（仅新增DebugPanel入口）
apps/web/src/components/Header.tsx       # 保持
apps/web/src/components/Cinematic*.tsx   # 保持
packages/content/                        # 已有内容不变，只新增knowledge目录
```

---

## 6. 实现顺序（分阶段）

### Phase A：核心骨架（第4层）
**目标**：EventBus + AgentRegistry + ArtifactContract 跑通，替代 resolveTurn 管道。

1. 实现 `EventBus`（纯 TypeScript，不依赖任何库）
2. 实现 `AgentRegistry`
3. 实现 `ArtifactContract` 基类和各 Agent 契约
4. 将现有 `resolveTurn` 的每个步骤封装为独立 Agent
5. 用事件流替代管道调用，验证闭环能跑通

**验证**：`npm run dev` 后，输入行动，游戏正常运转。

### Phase B：上下文 + 护栏（第2、3层）
**目标**：知识卡片系统 + 声明式规则引擎上线。

6. 创建知识卡片 JSON 文件
7. 实现 `ContextBuilder` + `boundaryFilter`
8. 实现 `guardEngine` + `guard-rules.json`
9. 将现有硬编码守卫迁移为声明式规则

**验证**：凶手 AI 不知道玩家藏起来的证据位置；message_reply 规则被规则引擎执行而非硬编码。

### Phase C：导演两阶段（第5层）
**目标**：硬守卫同步拦截 + 软评分异步+超时。

10. 实现 `hardGuard.ts`（纯规则，<5ms）
11. 实现 `softScorer.ts`（AI 调用，2秒超时）
12. 实现 `moodSignal.ts`（评分 → 氛围文本）
13. 集成到 DirectorAgent

**验证**：规则违规被拦截；文笔评分 2 秒内返回可触发本回合重写；超时则异步指导下回合。

### Phase D：持久化 + 诊断（第6、7层）
**目标**：存档/读档 + AI 决策日志 + 调试面板。

14. 实现 `StoreAdapter` + SQLite 持久化
15. 实现 AI 决策日志和路线回放
16. 实现 `TurnReport` + `DecisionTracer`
17. 前端实现 `DebugPanel`（`?debug=1` 开启）

**验证**：刷新页面后游戏状态不丢失；调试面板可查看每回合的 Agent 决策详情。

### Phase E：项目搭建（第1层）+ 收尾
**目标**：文档 + 构建脚本。

18. 编写所有 `AGENTS.md`
19. 配置 Demo 构建脚本（8MB 压缩）
20. 端到端测试 + 修 bug

---

## 7. 8MB Demo 策略（概要）

完整版完成后，Demo 通过以下策略压缩：

- **去除 AI 调用**：所有 Agent 使用 fallback 实现，纯本地规则引擎
- **固定故事线**：预定义一条完整故事路径（最优结局路线）
- **静态资源压缩**：CSS 内联 + tree-shaking + brotli 压缩
- **去除调试面板**：诊断层不打包进 Demo
- **去除 SQLite**：Demo 使用 localStorage
- **图片资源**：Demo 可用少量 SVG/CSS 插画（完整版无图片）

Demo 的 EventBus + Agent 架构保持不变，只是每个 Agent 的 `handler` 替换为 `fallback`。

---

## 8. 技术约束与原则

1. **改动最小化**：不改前端视觉，不改已有内容包（story/room/clues）
2. **向后兼容**：现有的 `/api/frontend/resolve-action` 接口保持不变，内部实现改为 EventBus
3. **fallback 全链路**：每个 Agent 的 fallback 必须存在，保证无 AI API key 时仍可玩
4. **类型安全**：所有事件、契约、Agent 输入输出均有 TypeScript 类型 + Zod 校验
5. **不引入重型依赖**：EventBus 自研（~150行），不引入 RxJS/Bull/Redis 等
6. **每个 Agent 一个文件**：Agent 实现保持 ≤200 行，超出则拆分

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| EventBus 引入异步问题 | 游戏逻辑顺序错乱 | 默认同步执行，仅 AI 调用走异步；事件日志可回溯 |
| 重构破坏现有闭环 | 游戏跑不起来 | 每 Phase 完成后验证；保留旧 resolveTurn 代码直到新架构稳定 |
| 契约版本不匹配 | Agent 间通信失败 | 契约版本检查 + 明确的错误信息 + fallback 降级 |
| 2秒超时过短 | 导演评分经常超时 | 可配置超时时间；超时只影响本回合重写，不影响游戏进行 |
| 8MB Demo 装不下 | Demo 无法提交 | 从 Phase A 开始就关注包大小；tree-shaking + 压缩持续验证 |

---

## 10. 附录：与现有代码的对应关系

| 现有代码 | 新架构对应 |
|---------|-----------|
| `resolveTurn()` | `EventBus.emit(PlayerActionSubmitted)` |
| `fallbackParseAction()` | `ParserAgent.fallback` |
| `applyPlayerActions()` | `RuleAgent.handler / RuleAgent.fallback` |
| `chooseFallbackKillerStrategy()` | `KillerAgent.fallback` |
| `applyKillerStrategy()` | `RuleAgent` 校验阶段 |
| `createFallbackActionNarration()` | `NarratorAgent.fallback` |
| `buildNarrationContext()` | `ContextBuilder.build('narrator', state)` |
| `scoreRun()` | `DirectorAgent` (Phase 1 + Phase 2) |
| `frontendAdapterRoute` | `UIAdapterAgent` |
| `gamePhaseMachine` | 保持不变，EventBus 事件驱动状态转换 |
