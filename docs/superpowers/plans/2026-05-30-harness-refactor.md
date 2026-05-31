# Harness 架构改造 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 murder-loop-ai 从线性管道重构为 EventBus + AgentRegistry + ArtifactContract 的 Harness 架构

**Architecture:** EventBus 事件总线驱动 Agent 协作，每个 Agent 有独立的产物契约和 fallback 实现，导演拆为两阶段（同步硬守卫 + 异步软评分），知识卡片系统按 Agent 定制上下文，声明式规则引擎替代硬编码 guard

**Tech Stack:** TypeScript, XState (已有), better-sqlite3 (新增), Zod (已有), React + Vite (已有), Fastify (已有)

**分配说明:** 每个任务标注了 `[A]` `[B]` `[共享]`，A/B 可并行。共享任务需要顺序执行或一起做。

---

## Phase A：核心骨架 — EventBus + Agent 体系

> **目标:** EventBus 跑通，7 个 Agent 封装完毕，替代 resolveTurn 管道。**这是所有后续工作的基础，必须最先完成。**

### 环境准备

- [ ] **[共享] Step 1: 安装 vitest 测试框架**

```bash
cd packages/game-core && npm install -D vitest
```

在 `packages/game-core/package.json` 增加：
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

---

### Task A1: 事件类型定义

**Files:** `packages/game-core/src/events/eventTypes.ts`

- [ ] **[A] Step 1: 创建事件类型文件**

```typescript
// packages/game-core/src/events/eventTypes.ts
import type { ActionPlan, GameState, KillerStrategy, Narration, TurnResolution } from '@murder-loop-ai/shared';

/** 游戏中所有事件类型 */
export type GameEventType =
  | 'PlayerActionSubmitted'
  | 'ActionParsed'
  | 'RulesApplied'
  | 'KillerActed'
  | 'NarrationDone'
  | 'NarrationRewriteRequested'
  | 'HighRiskScenarioDetected'
  | 'TurnCompleted'
  | 'GamePhaseChanged'
  | 'DeathTriggered'
  | 'SurvivalTriggered'
  | 'LoopRewound';

/** 每个事件类型的 payload */
export interface GameEventPayloads {
  PlayerActionSubmitted: { input: string; state: GameState };
  ActionParsed: { plan: ActionPlan; state: GameState };
  RulesApplied: { playerResult: TurnResolution['playerResult'] };
  KillerActed: { killerStrategy: KillerStrategy; state: GameState };
  NarrationDone: { narration: Narration; state: GameState };
  NarrationRewriteRequested: { reason: string; previousNarration: Narration };
  HighRiskScenarioDetected: { scenario: string; state: GameState };
  TurnCompleted: { finalState: GameState; moodSignal?: string };
  GamePhaseChanged: { from: string; to: string; state: GameState };
  DeathTriggered: { state: GameState; cause: string };
  SurvivalTriggered: { state: GameState; endingId: string };
  LoopRewound: { state: GameState; previousRun: number };
}

export interface GameEvent<T extends GameEventType = GameEventType> {
  type: T;
  payload: GameEventPayloads[T];
  timestamp: number;
  /** 触发此事件的上一个事件ID，用于追踪事件链 */
  parentId?: string;
  /** 唯一ID */
  id: string;
}

export type EventHandler<T extends GameEventType = GameEventType> = (
  event: GameEvent<T>
) => Promise<unknown> | unknown;
```

- [ ] **[A] Step 2: 验证编译**

```bash
cd packages/game-core && npm run typecheck
```

---

### Task A2: EventBus 实现

**Files:** `packages/game-core/src/events/EventBus.ts`

- [ ] **[A] Step 1: 实现 EventBus**

```typescript
// packages/game-core/src/events/EventBus.ts
import type { EventHandler, GameEvent, GameEventType } from './eventTypes';

interface Subscription {
  event: GameEventType;
  handler: EventHandler;
  priority: number;
}

interface EventLogEntry {
  event: GameEvent;
  results: unknown[];
  durationMs: number;
}

export class GameEventBus {
  private subscriptions: Subscription[] = [];
  private eventLog: EventLogEntry[] = [];
  private readonly maxLogSize: number;
  private idCounter = 0;

  constructor(maxLogSize = 500) {
    this.maxLogSize = maxLogSize;
  }

  subscribe(
    event: GameEventType,
    handler: EventHandler,
    priority = 50
  ): () => void {
    const sub: Subscription = { event, handler, priority };
    this.subscriptions.push(sub);
    this.subscriptions.sort((a, b) => a.priority - b.priority);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
    };
  }

  async emit<T extends GameEventType>(
    type: T,
    payload: GameEvent<T>['payload'],
    parentId?: string
  ): Promise<unknown[]> {
    const event: GameEvent = {
      type,
      payload,
      timestamp: performance.now(),
      parentId,
      id: `evt-${++this.idCounter}-${type}`,
    };

    const handlers = this.subscriptions
      .filter((s) => s.event === type)
      .sort((a, b) => a.priority - b.priority);

    const startTime = performance.now();
    const results: unknown[] = [];

    for (const sub of handlers) {
      try {
        results.push(await sub.handler(event as GameEvent));
      } catch (error) {
        results.push({ error });
      }
    }

    this.addToLog(event, results, performance.now() - startTime);
    return results;
  }

  getEventLog(): ReadonlyArray<EventLogEntry> {
    return this.eventLog;
  }

  getRecentEvents(count = 20): ReadonlyArray<EventLogEntry> {
    return this.eventLog.slice(-count);
  }

  clearLog(): void {
    this.eventLog = [];
  }

  private addToLog(event: GameEvent, results: unknown[], durationMs: number) {
    this.eventLog.push({ event, results, durationMs });
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }
  }
}
```

- [ ] **[A] Step 2: 验证编译**

```bash
cd packages/game-core && npm run typecheck
```

---

### Task A3: ArtifactContract

**Files:** `packages/game-core/src/contracts/ArtifactContract.ts`

- [ ] **[A] Step 1: 实现契约基类**

```typescript
// packages/game-core/src/contracts/ArtifactContract.ts
import type { ZodSchema } from 'zod';

export interface ArtifactContract<I = unknown, O = unknown> {
  /** 语义版本，不匹配时拒绝传递 */
  version: string;
  /** 输入 schema */
  input: ZodSchema<I>;
  /** 输出 schema */
  output: ZodSchema<O>;
  /** 是否在传递前校验 */
  validate: boolean;
}

export class ContractViolationError extends Error {
  constructor(
    public contractName: string,
    public direction: 'input' | 'output',
    message: string
  ) {
    super(`[${contractName}] ${direction} violation: ${message}`);
    this.name = 'ContractViolationError';
  }
}

/** 代理一个函数，在执行前后校验契约 */
export function enforce<I, O>(
  contract: ArtifactContract<I, O>,
  fn: (input: I) => Promise<O> | O,
  contractName: string
): (input: I) => Promise<O> {
  return async (input: I): Promise<O> => {
    if (contract.validate) {
      const inputResult = contract.input.safeParse(input);
      if (!inputResult.success) {
        throw new ContractViolationError(
          contractName,
          'input',
          inputResult.error.message
        );
      }
    }

    const output = await fn(input);

    if (contract.validate) {
      const outputResult = contract.output.safeParse(output);
      if (!outputResult.success) {
        throw new ContractViolationError(
          contractName,
          'output',
          outputResult.error.message
        );
      }
    }

    return output;
  };
}
```

- [ ] **[A] Step 2: 验证编译**

```bash
cd packages/game-core && npm run typecheck
```

---

### Task A4: Agent 契约定义

**Files:** `packages/game-core/src/contracts/parser.contract.ts`, `killer.contract.ts`, `narrator.contract.ts`, `director.contract.ts`

- [ ] **[B] Step 1: 定义 Parser 契约**

```typescript
// packages/game-core/src/contracts/parser.contract.ts
import { z } from 'zod';
import type { ArtifactContract } from './ArtifactContract';

export const actionPlanSchema = z.object({
  summary: z.string(),
  intents: z.array(z.object({
    intent: z.string(),
    target: z.string().optional(),
    detail: z.string().optional(),
  })),
  tone: z.enum(['cautious', 'decisive', 'deceptive', 'desperate', 'neutral']),
  timeCost: z.number().min(0).max(30),
  noiseLevel: z.enum(['silent', 'low', 'medium', 'high', 'extreme']),
});

export const parserContract: ArtifactContract = {
  version: '1.0.0',
  input: z.object({
    input: z.string(),
    state: z.any(),
  }) as z.ZodSchema,
  output: actionPlanSchema as z.ZodSchema,
  validate: true,
};
```

- [ ] **[B] Step 2: 定义 Killer 契约**

```typescript
// packages/game-core/src/contracts/killer.contract.ts
import { z } from 'zod';
import type { ArtifactContract } from './ArtifactContract';

export const killerStrategySchema = z.object({
  type: z.enum([
    'wait', 'text_probe', 'soft_knock', 'landlord_check',
    'fake_police_pressure', 'spare_key_entry', 'power_cut',
    'window_route', 'lure_linyue', 'retreat',
    'frame_player', 'destroy_evidence', 'message_reply',
  ]),
  priority: z.number().min(0).max(10),
  description: z.string(),
  events: z.array(z.string()).optional(),
  knownInfo: z.array(z.string()).optional(),
});

export const killerContract: ArtifactContract = {
  version: '1.0.0',
  input: z.any() as z.ZodSchema,
  output: killerStrategySchema as z.ZodSchema,
  validate: true,
};
```

- [ ] **[B] Step 3: 定义 Narrator 契约**

```typescript
// packages/game-core/src/contracts/narrator.contract.ts
import { z } from 'zod';
import type { ArtifactContract } from './ArtifactContract';

export const narrationSchema = z.object({
  title: z.string(),
  text: z.string(),
  tone: z.enum(['neutral', 'memory', 'clue', 'threat', 'death', 'win', 'system']),
});

export const narratorContract: ArtifactContract = {
  version: '1.0.0',
  input: z.any() as z.ZodSchema,
  output: narrationSchema as z.ZodSchema,
  validate: true,
};
```

- [ ] **[B] Step 4: 定义 Director 契约**

```typescript
// packages/game-core/src/contracts/director.contract.ts
import { z } from 'zod';
import type { ArtifactContract } from './ArtifactContract';

export const directorOutputSchema = z.object({
  score: z.object({
    pacing: z.number().min(0).max(10),
    infoLeak: z.number().min(0).max(10),
    ruleConsistency: z.number().min(0).max(10),
    prose: z.number().min(0).max(10),
  }),
  passed: z.boolean(),
  violations: z.array(z.string()),
  moodSignal: z.string().optional(),
});

export const directorContract: ArtifactContract = {
  version: '1.0.0',
  input: z.any() as z.ZodSchema,
  output: directorOutputSchema as z.ZodSchema,
  validate: true,
};
```

- [ ] **[B] Step 5: 验证编译**

```bash
cd packages/game-core && npm run typecheck
```

---

### Task A5: AgentRegistry

**Files:** `packages/game-core/src/events/AgentRegistry.ts`

- [ ] **[A] Step 1: 实现 Agent 注册中心**

```typescript
// packages/game-core/src/events/AgentRegistry.ts
import type { ArtifactContract } from '../contracts/ArtifactContract';
import type { GameEventBus } from './EventBus';
import type { EventHandler, GameEventType } from './eventTypes';

export type AgentId = 'parser' | 'killer' | 'narrator' | 'director' | 'npc' | 'rule' | 'ui-adapter';

export type AgentHandler = (input: unknown, state: unknown) => Promise<unknown> | unknown;

export interface AgentRegistration {
  id: AgentId;
  subscriptions: { event: GameEventType; priority: number }[];
  contract: ArtifactContract;
  /** 完整版实现（调用 AI） */
  handler: AgentHandler;
  /** Demo/fallback 实现（纯本地规则） */
  fallback: AgentHandler;
  /** 当前使用哪个实现 */
  mode: 'ai' | 'fallback';
}

export class AgentRegistry {
  private agents = new Map<AgentId, AgentRegistration>();
  private bus: GameEventBus;
  private unsubscribers: (() => void)[] = [];

  constructor(bus: GameEventBus) {
    this.bus = bus;
  }

  register(agent: AgentRegistration): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent "${agent.id}" is already registered`);
    }
    this.agents.set(agent.id, agent);

    for (const sub of agent.subscriptions) {
      const unsubscribe = this.bus.subscribe(
        sub.event,
        this.createHandler(agent),
        sub.priority
      );
      this.unsubscribers.push(unsubscribe);
    }
  }

  getAgent(id: AgentId): AgentRegistration | undefined {
    return this.agents.get(id);
  }

  setMode(id: AgentId, mode: 'ai' | 'fallback'): void {
    const agent = this.agents.get(id);
    if (agent) agent.mode = mode;
  }

  /** 一键切换所有 Agent 为 fallback（Demo 模式） */
  setAllFallback(): void {
    for (const agent of this.agents.values()) {
      agent.mode = 'fallback';
    }
  }

  listAgents(): ReadonlyArray<{ id: AgentId; mode: string; subscriptions: number }> {
    return Array.from(this.agents.values()).map((a) => ({
      id: a.id,
      mode: a.mode,
      subscriptions: a.subscriptions.length,
    }));
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.agents.clear();
  }

  private createHandler(agent: AgentRegistration): EventHandler {
    return async (event) => {
      const fn = agent.mode === 'ai' ? agent.handler : agent.fallback;
      return fn(event.payload, event);
    };
  }
}
```

- [ ] **[A] Step 2: 验证编译**

```bash
cd packages/game-core && npm run typecheck
```

---

### Task A6: 适配现有逻辑为 Agent（7个 Agent）

**Files:** `packages/game-core/src/agents/*.ts`

这个任务将现有的 fallback 函数封装为 Agent handler。

- [ ] **[A] Step 1-3: ParserAgent + RuleAgent**

```typescript
// packages/game-core/src/agents/ParserAgent.ts
import { fallbackParseAction } from '../actions/fallbackParser';
import type { AgentRegistration } from '../events/AgentRegistry';
import { parserContract } from '../contracts/parser.contract';

export const ParserAgent: AgentRegistration = {
  id: 'parser',
  subscriptions: [{ event: 'PlayerActionSubmitted', priority: 10 }],
  contract: parserContract,
  handler: async (input: unknown) => {
    // AI 调用：由服务端 adapter 注入
    throw new Error('AI handler not injected — use server adapter');
  },
  fallback: async (input: unknown) => {
    const { input: text } = input as { input: string };
    return fallbackParseAction(text);
  },
  mode: 'fallback',
};
```

```typescript
// packages/game-core/src/agents/RuleAgent.ts
import { applyPlayerActions } from '../rules/applyPlayerActions';
import { applyKillerStrategy } from '../killer/applyKillerStrategy';
import type { AgentRegistration } from '../events/AgentRegistry';
import type { ActionPlan, GameState, KillerStrategy } from '@murder-loop-ai/shared';

export const RuleAgent: AgentRegistration = {
  id: 'rule',
  subscriptions: [
    { event: 'ActionParsed', priority: 20 },
    { event: 'KillerActed', priority: 60 },
  ],
  contract: { version: '1.0.0', input: null as never, output: null as never, validate: false },
  handler: async (input: unknown) => {
    // RuleAgent 没有 AI handler，始终用 fallback
    return RuleAgent.fallback(input);
  },
  fallback: async (input: unknown, event) => {
    const payload = input as Record<string, unknown>;
    if (event?.type === 'ActionParsed') {
      return applyPlayerActions(payload.state as GameState, payload.plan as ActionPlan);
    }
    if (event?.type === 'KillerActed') {
      return applyKillerStrategy(payload.state as GameState, payload.killerStrategy as KillerStrategy);
    }
    return null;
  },
  mode: 'fallback',
};
```

- [ ] **[B] Step 4-5: KillerAgent + NarratorAgent**

```typescript
// packages/game-core/src/agents/KillerAgent.ts
import { chooseFallbackKillerStrategy } from '../killer/fallbackStrategy';
import type { AgentRegistration } from '../events/AgentRegistry';
import { killerContract } from '../contracts/killer.contract';

export const KillerAgent: AgentRegistration = {
  id: 'killer',
  subscriptions: [{ event: 'RulesApplied', priority: 30 }],
  contract: killerContract,
  handler: async () => {
    throw new Error('AI handler not injected — use server adapter');
  },
  fallback: async (input: unknown) => {
    const { state } = input as { state: import('@murder-loop-ai/shared').GameState };
    return chooseFallbackKillerStrategy(state);
  },
  mode: 'fallback',
};
```

```typescript
// packages/game-core/src/agents/NarratorAgent.ts
import { createFallbackActionNarration, createFallbackAmbientNarration } from '../narration/fallbackNarration';
import type { AgentRegistration } from '../events/AgentRegistry';
import { narratorContract } from '../contracts/narrator.contract';
import type { TurnResolution } from '@murder-loop-ai/shared';

export const NarratorAgent: AgentRegistration = {
  id: 'narrator',
  subscriptions: [{ event: 'KillerActed', priority: 70 }],
  contract: narratorContract,
  handler: async () => {
    throw new Error('AI handler not injected — use server adapter');
  },
  fallback: async (input: unknown) => {
    const { playerResult, killerResult } = input as {
      playerResult: TurnResolution['playerResult'];
      killerResult: TurnResolution['killerResult'];
    };
    return {
      actionNarration: createFallbackActionNarration(playerResult ?? killerResult),
      ambientNarration: createFallbackAmbientNarration(playerResult ?? killerResult, killerResult),
    };
  },
  mode: 'fallback',
};
```

- [ ] **[A] Step 6-7: DirectorAgent + UIAdapterAgent**

```typescript
// packages/game-core/src/agents/DirectorAgent.ts
import type { AgentRegistration } from '../events/AgentRegistry';
import { directorContract } from '../contracts/director.contract';

export const DirectorAgent: AgentRegistration = {
  id: 'director',
  subscriptions: [
    { event: 'NarrationDone', priority: 80 },
    { event: 'HighRiskScenarioDetected', priority: 15 },
  ],
  contract: directorContract,
  handler: async () => {
    throw new Error('AI handler not injected — use server adapter');
  },
  fallback: async () => ({
    score: { pacing: 7, infoLeak: 10, ruleConsistency: 10, prose: 6 },
    passed: true,
    violations: [],
    moodSignal: '你感觉这一次的判断还算稳妥。',
  }),
  mode: 'fallback',
};
```

```typescript
// packages/game-core/src/agents/UIAdapterAgent.ts
import type { AgentRegistration } from '../events/AgentRegistry';
import type { GameState } from '@murder-loop-ai/shared';

export const UIAdapterAgent: AgentRegistration = {
  id: 'ui-adapter',
  subscriptions: [{ event: 'TurnCompleted', priority: 100 }],
  contract: { version: '1.0.0', input: null as never, output: null as never, validate: false },
  handler: async () => ({}),
  fallback: async (input: unknown) => {
    const { finalState, moodSignal } = input as { finalState: GameState; moodSignal?: string };
    return {
      time: finalState.run,
      location: '青荷公寓 503 室',
      phase: finalState.phase,
      clues: finalState.clues,
      ending: finalState.ending,
      deathTitle: finalState.deathTitle,
      deathSummary: finalState.deathSummary,
      deathMethod: finalState.deathMethod,
      storyLog: finalState.log
        ?.filter((n) => n.channel !== 'system')
        .map((n) => ({
          id: n.id,
          type: n.channel === 'action' ? 'narration' : 'ambient',
          content: `${n.title ? `**${n.title}**\n\n` : ''}${n.text}`,
        })) ?? [],
      moodSignal,
    };
  },
  mode: 'fallback',
};
```

- [ ] **[共享] Step 8: 验证编译**

```bash
cd packages/game-core && npm run typecheck
```

---

### Task A7: 重写 resolveTurn 为事件发射器

**Files:** `packages/game-core/src/loop/resolveTurn.ts`

- [ ] **[共享] Step 1: 重写 resolveTurn**

```typescript
// packages/game-core/src/loop/resolveTurn.ts
import type { TurnResolution } from '@murder-loop-ai/shared';
import { GameEventBus } from '../events/EventBus';
import { AgentRegistry } from '../events/AgentRegistry';
import { ParserAgent } from '../agents/ParserAgent';
import { RuleAgent } from '../agents/RuleAgent';
import { KillerAgent } from '../agents/KillerAgent';
import { NarratorAgent } from '../agents/NarratorAgent';
import { DirectorAgent } from '../agents/DirectorAgent';
import { UIAdapterAgent } from '../agents/UIAdapterAgent';

export { GameEventBus, AgentRegistry };
export { ParserAgent, RuleAgent, KillerAgent, NarratorAgent, DirectorAgent, UIAdapterAgent };

/** 创建并初始化完整的 Harness 系统 */
export function createHarness(aiAdapters?: Partial<Record<string, unknown>>) {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);

  // 注册所有 Agent
  registry.register(ParserAgent);
  registry.register(RuleAgent);
  registry.register(KillerAgent);
  registry.register(NarratorAgent);
  registry.register(DirectorAgent);
  registry.register(UIAdapterAgent);

  // 如果有 AI adapter，注入到对应 Agent
  if (aiAdapters) {
    if (aiAdapters.parseAction) {
      const parser = registry.getAgent('parser');
      if (parser) {
        parser.handler = aiAdapters.parseAction as (input: unknown) => Promise<unknown>;
        parser.mode = 'ai';
      }
    }
    if (aiAdapters.chooseKillerStrategy) {
      const killer = registry.getAgent('killer');
      if (killer) {
        killer.handler = aiAdapters.chooseKillerStrategy as (input: unknown) => Promise<unknown>;
        killer.mode = 'ai';
      }
    }
    if (aiAdapters.narrate) {
      const narrator = registry.getAgent('narrator');
      if (narrator) {
        narrator.handler = aiAdapters.narrate as (input: unknown) => Promise<unknown>;
        narrator.mode = 'ai';
      }
    }
  }

  return { bus, registry };
}

/** 新的 resolveTurn — 发射事件并由 EventBus 驱动全流程 */
export async function resolveTurn(
  state: import('@murder-loop-ai/shared').GameState,
  input: string,
  harness: ReturnType<typeof createHarness>
): Promise<{
  plan: unknown;
  results: unknown[];
  finalState: import('@murder-loop-ai/shared').GameState;
  eventLog: ReadonlyArray<unknown>;
}> {
  const { bus } = harness;

  // 发射 PlayerActionSubmitted → 事件链自动驱动后续流程
  const results = await bus.emit('PlayerActionSubmitted', { input, state });

  // 在事件处理过程中，State 已被修改。从事件日志提取最终状态。
  const eventLog = bus.getEventLog();
  const turnCompletedEvent = [...eventLog].reverse().find(
    (e) => e.event.type === 'TurnCompleted'
  );
  const finalState = (turnCompletedEvent?.event.payload as { finalState: unknown })?.finalState as import('@murder-loop-ai/shared').GameState;

  return {
    plan: null, // 由事件日志中的 ActionParsed 事件提供
    results,
    finalState: finalState ?? state,
    eventLog: eventLog.map((e) => ({
      type: e.event.type,
      durationMs: Math.round(e.durationMs),
    })),
  };
}
```

- [ ] **[共享] Step 2: 验证编译**

```bash
cd packages/game-core && npm run typecheck
```

---

### Task A8: 在 XState 状态机中集成 EventBus

**Files:** `packages/game-core/src/machines/gamePhaseMachine.ts` (修改)

- [ ] **[A] Step 1: 修改状态机，增加事件发射 action**

在现有 `gamePhaseMachine` 的每个状态转换中，增加一个 action 来发射 `GamePhaseChanged` 事件。但为了保持向后兼容，先用最小改动——在 `resolveTurn` 中手动调用状态机，后续 Phase 再深度集成。

**当前决定：暂不改动 gamePhaseMachine，保持 XState 独立运行。** GamePhaseChanged 事件由 resolveTurn 在检测到 phase 变化时手动发射。

---

### Task A9: 路径检查 — 保证现有路由能工作

**Files:** `apps/server/src/routes/frontendAdapter.ts` (修改)

- [ ] **[共享] Step 1: 更新 frontendAdapter 使用新架构**

在 `apps/server/src/routes/frontendAdapter.ts` 中，将旧的 `resolveTurn(state, input, aiAdapters)` 调用改为先创建 harness，再调用新的 `resolveTurn`。

```typescript
// 旧代码：
// const result = await resolveTurn(coreState, actionText, aiAdapters);

// 新代码：
import { createHarness, resolveTurn } from '@murder-loop-ai/game-core';

const harness = createHarness(aiAdapters);
const result = await resolveTurn(coreState, actionText, harness);
```

- [ ] **[共享] Step 2: 验证完整流程**

```bash
npm run dev
# 浏览器打开 http://127.0.0.1:5178/
# 输入行动，确认游戏正常运转
```

---

## Phase B：上下文工程 + 护栏规则（A/B 并行）

> **目标:** 知识卡片系统上线 + 声明式规则引擎替代硬编码 guard。
> **并行策略:** [A] 做护栏规则（Task B1-B2），[B] 做知识卡片+ContextBuilder（Task B3-B5），互不依赖。

### Task B1: 规则引擎 [A]

**Files:** `packages/game-core/src/guards/guardEngine.ts`

- [ ] **[A] Step 1: 实现规则引擎**

```typescript
// packages/game-core/src/guards/guardEngine.ts
import type { GameState } from '@murder-loop-ai/shared';
import type { GameEvent } from '../events/eventTypes';

export type GuardViolation = 'reject' | 'warn' | 'rewrite';

export interface GuardRule {
  id: string;
  on: string;
  when?: string;
  check: (event: GameEvent, state: GameState) => boolean;
  violation: GuardViolation;
  description: string;
}

export interface GuardResult {
  ruleId: string;
  passed: boolean;
  violation?: GuardViolation;
  timestamp: number;
}

export function evaluateRules(
  rules: GuardRule[],
  event: GameEvent,
  state: GameState
): GuardResult[] {
  return rules
    .filter((rule) => rule.on === event.type)
    .map((rule) => {
      try {
        const passed = rule.check(event, state);
        return {
          ruleId: rule.id,
          passed,
          violation: passed ? undefined : rule.violation,
          timestamp: performance.now(),
        };
      } catch {
        return {
          ruleId: rule.id,
          passed: false,
          violation: 'reject' as GuardViolation,
          timestamp: performance.now(),
        };
      }
    });
}
```

### Task B2: 内置护栏规则 [A]

**Files:** `packages/game-core/src/guards/builtinRules.ts`

- [ ] **[A] Step 2: 定义内置规则**

```typescript
// packages/game-core/src/guards/builtinRules.ts
import type { GuardRule } from './guardEngine';
import { killerKnowledge } from '../killer/knowledge';

export const builtinRules: GuardRule[] = [
  {
    id: 'no-killer-omniscience',
    on: 'KillerActed',
    description: '凶手不能使用它不应该知道的信息',
    check: (event, state) => {
      const payload = event.payload as { killerStrategy?: { knownInfo?: string[] } };
      const knownInfo = payload.killerStrategy?.knownInfo ?? [];
      const allowed = killerKnowledge(state);
      return knownInfo.every((info) => allowed.includes(info));
    },
    violation: 'reject',
  },
  {
    id: 'no-ambient-append-on-reply',
    on: 'NarrationDone',
    description: 'message_reply 路径下环境段不应凭空追加威胁',
    check: (event) => {
      const payload = event.payload as { narration?: { text: string } };
      const text = payload.narration?.text ?? '';
      const forbidden = ['敲门声', '脚步声', '断电', '窗外'];
      return !forbidden.some((word) => text.includes(word));
    },
    violation: 'rewrite',
  },
  {
    id: 'no-fake-police-auto-entry',
    on: 'KillerActed',
    description: '门已加固时假警察不能直接进入',
    check: (event, state) => {
      const payload = event.payload as { killerStrategy?: { type: string } };
      if (payload.killerStrategy?.type === 'fake_police_pressure' && state.doorReinforced) {
        return false;
      }
      return true;
    },
    violation: 'reject',
  },
];
```

---

### Task B3: 知识卡片结构 [B]

**Files:** `packages/content/knowledge/` 目录下的 JSON 文件

- [ ] **[B] Step 1: 故事圣经卡片**

```json
// packages/content/knowledge/story-bible/characters.json
{
  "沈知夏": {
    "role": "主角",
    "description": "刚搬入青荷公寓503室的年轻女性，因被送错的包裹卷入危险",
    "relations": { "林越": "前男友", "陈怀民": "房东/凶手" }
  },
  "陈怀民": {
    "role": "凶手",
    "description": "青荷公寓房东，地下转运链关键人物",
    "secrets": ["控制转运链", "包裹中含犯罪证据", "有备用钥匙"],
    "methods": ["短信试探", "假装维修", "假警察", "备用钥匙", "断电", "窗户路线"]
  },
  "林越": {
    "role": "救援变量",
    "description": "沈知夏前男友，不是凶手，但可能成为风险点",
    "phases": ["不知情", "收到照片", "担心", "报警", "赶来公寓", "危险", "安全"]
  }
}
```

- [ ] **[B] Step 2: 房间知识卡片**

```json
// packages/content/knowledge/room-503/layout.json
{
  "name": "青荷公寓 503 室",
  "rooms": [
    { "name": "玄关", "features": ["入户门", "鞋柜"], "hidingSpots": [] },
    { "name": "客厅", "features": ["窗户", "茶几", "椅子", "行李箱"], "hidingSpots": ["窗帘后", "茶几下方"] },
    { "name": "卫生间", "features": ["马桶", "水箱", "洗手台"], "hidingSpots": ["水箱内", "洗手台下方柜子"] },
    { "name": "卧室", "features": ["床", "衣柜", "床头柜"], "hidingSpots": ["衣柜深处", "床底"] }
  ],
  "entryPoints": ["入户门", "客厅窗户"],
  "soundTravel": { "玄关": ["客厅"], "客厅": ["玄关", "卧室", "卫生间"], "卧室": ["客厅"], "卫生间": ["客厅"] }
}
```

---

### Task B4: ContextBuilder [B]

**Files:** `packages/game-core/src/context/ContextBuilder.ts`

- [ ] **[B] Step 1: 实现上下文构建器**

```typescript
// packages/game-core/src/context/ContextBuilder.ts
import type { GameState } from '@murder-loop-ai/shared';
import type { AgentId } from '../events/AgentRegistry';
import { killerKnowledge } from '../killer/knowledge';

interface KnowledgeCard {
  [key: string]: unknown;
}

interface AgentContext {
  staticKnowledge: Record<string, KnowledgeCard>;
  dynamicState: Partial<GameState>;
  instruction: string;
}

export class ContextBuilder {
  private knowledgeCache = new Map<string, KnowledgeCard>();
  private readonly maxCacheSize = 50;

  async build(agent: AgentId, state: GameState): Promise<AgentContext> {
    const staticKnowledge = await this.loadKnowledge(agent);
    const filteredState = this.applyBoundary(agent, state);

    return {
      staticKnowledge,
      dynamicState: filteredState,
      instruction: this.getInstruction(agent),
    };
  }

  private async loadKnowledge(agent: AgentId): Promise<Record<string, KnowledgeCard>> {
    // 加载知识卡片（根据 Agent 角色选择性地加载）
    const cards: Record<string, KnowledgeCard> = {};

    // 所有 Agent 都需要故事圣经
    cards.characters = await this.loadCard('story-bible/characters');
    cards.timeline = await this.loadCard('story-bible/timeline');

    // Agent 专属卡片
    if (agent === 'parser') {
      cards.roomLayout = await this.loadCard('room-503/layout');
      cards.roomItems = await this.loadCard('room-503/items');
    }
    if (agent === 'killer') {
      cards.roomLayout = await this.loadCard('room-503/layout');
      cards.hidingSpots = await this.loadCard('room-503/hiding-spots');
    }
    if (agent === 'narrator') {
      cards.roomLayout = await this.loadCard('room-503/layout');
      cards.socialRules = await this.loadCard('rules/social');
    }

    return cards;
  }

  private applyBoundary(agent: AgentId, state: GameState): Partial<GameState> {
    if (agent === 'killer') {
      // 凶手只能看到它已知的信息
      const known = killerKnowledge(state);
      const { clues, ...rest } = state;
      return {
        ...rest,
        clues: clues?.filter((c) => known.includes(c.id)) ?? [],
      } as Partial<GameState>;
    }
    // 其他 Agent 可以看到完整状态
    return state;
  }

  private getInstruction(agent: AgentId): string {
    const instructions: Record<AgentId, string> = {
      parser: '解析玩家的自然语言输入为结构化行动。识别意图、目标、细节。',
      killer: '你扮演凶手陈怀民。你只能在已知信息范围内行动。不能开上帝视角。',
      narrator: '你将游戏事件转化为悬疑小说风格的叙事。保持紧张感，但不要捏造事实。',
      director: '评估叙事质量。检查规则一致性和信息泄露。给出氛围信号。',
      npc: '扮演NPC角色回复玩家。保持角色一致性。',
      rule: '执行游戏规则逻辑。',
      'ui-adapter': '将游戏状态适配为前端可用的格式。',
    };
    return instructions[agent] ?? '';
  }

  private async loadCard(name: string): Promise<KnowledgeCard> {
    if (this.knowledgeCache.has(name)) {
      return this.knowledgeCache.get(name)!;
    }
    // 动态 import 知识卡片 JSON
    try {
      const card = await import(`@murder-loop-ai/content/knowledge/${name}.json`) as { default: KnowledgeCard };
      this.cacheCard(name, card.default);
      return card.default;
    } catch {
      return {};
    }
  }

  private cacheCard(name: string, card: KnowledgeCard): void {
    this.knowledgeCache.set(name, card);
    if (this.knowledgeCache.size > this.maxCacheSize) {
      const firstKey = this.knowledgeCache.keys().next().value;
      if (firstKey) this.knowledgeCache.delete(firstKey);
    }
  }
}
```

- [ ] **[B] Step 2: 验证编译**

```bash
cd packages/game-core && npm run typecheck
```

---

## Phase C：导演两阶段（[A] 做）

> **目标:** 硬守卫同步拦截 + 软评分异步+超时。
> 本 Phase 依赖 Phase A 的 DirectorAgent，可在 A 完成后立即开始。

### Task C1: 硬守卫实现 [A]

**Files:** `packages/game-core/src/scoring/hardGuard.ts`

```typescript
// packages/game-core/src/scoring/hardGuard.ts
import type { Narration } from '@murder-loop-ai/shared';
import { builtinRules } from '../guards/builtinRules';
import { evaluateRules } from '../guards/guardEngine';

export interface HardGuardResult {
  passed: boolean;
  violations: string[];
  action: 'pass' | 'block' | 'rewrite';
}

export function runHardGuard(
  narration: Narration,
  state: unknown
): HardGuardResult {
  // Phase 1: 纯规则检查（<5ms，不调用 AI）
  const violations: string[] = [];

  // 检查1：叙事文本是否为空
  if (!narration.text || narration.text.trim().length === 0) {
    violations.push('narration-empty');
  }

  // 检查2：是否包含禁止的上帝视角词汇
  const godModePatterns = [
    '沈知夏不知道的是',
    '陈怀民暗自',
    '命运早已注定',
  ];
  for (const pattern of godModePatterns) {
    if (narration.text.includes(pattern)) {
      violations.push(`god-mode: ${pattern}`);
    }
  }

  // 检查3：标题和文本色调是否匹配
  if (narration.tone === 'death' && !narration.text.includes('23:47')) {
    // 死亡叙事应包含时间标记，缺失则是可疑的
    violations.push('death-tone-no-timestamp');
  }

  if (violations.length > 0) {
    return { passed: false, violations, action: 'rewrite' };
  }

  return { passed: true, violations: [], action: 'pass' };
}
```

### Task C2: 软评分实现 [A]

**Files:** `packages/game-core/src/scoring/softScorer.ts`

```typescript
// packages/game-core/src/scoring/softScorer.ts
import type { Narration } from '@murder-loop-ai/shared';

export interface SoftScoreResult {
  score: { pacing: number; infoLeak: number; ruleConsistency: number; prose: number };
  moodSignal: string;
}

const MOOD_SIGNALS = {
  high: [
    '你感觉自己的判断越来越清晰。',
    '每一个细节都像拼图一样归位。',
    '林越的短信让你稍微安心了一些。',
  ],
  medium: [
    '房间里某种无形的压迫感在增强。',
    '你开始注意到更多之前忽略的细节。',
    '时间在安静中流逝，每一秒都很沉重。',
  ],
  low: [
    '你的手心微微出汗，一种说不清的焦虑笼罩着你。',
    '你感觉有什么重要的东西被遗漏了。',
  ],
};

export async function runSoftScore(
  narration: Narration,
  aiScoreFn?: (narration: Narration) => Promise<SoftScoreResult['score']>
): Promise<SoftScoreResult> {
  const TIMEOUT_MS = 2000;

  let score: SoftScoreResult['score'];

  if (aiScoreFn) {
    try {
      score = await Promise.race([
        aiScoreFn(narration),
        new Promise<SoftScoreResult['score']>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
        ),
      ]);
    } catch {
      // 超时 → 使用默认评分，下回合改进
      score = { pacing: 6, infoLeak: 10, ruleConsistency: 10, prose: 6 };
    }
  } else {
    // 无 AI → fallback 评分
    score = { pacing: 6, infoLeak: 10, ruleConsistency: 10, prose: 6 };
  }

  // 根据评分生成氛围信号
  const avgScore = (score.pacing + score.infoLeak + score.ruleConsistency + score.prose) / 4;
  const signalPool = avgScore > 7 ? MOOD_SIGNALS.high : avgScore > 4 ? MOOD_SIGNALS.medium : MOOD_SIGNALS.low;
  const moodSignal = signalPool[Math.floor(Math.random() * signalPool.length)];

  return { score, moodSignal };
}
```

---

## Phase D：持久化 + 诊断（A/B 并行）

> **并行策略:** [A] 做 SQLite 持久化（Task D1-D2），[B] 做诊断面板（Task D3-D4），互不依赖。

### Task D1: StoreAdapter 接口 + SQLite [A]

**Files:** `packages/game-core/src/store/`

```typescript
// packages/game-core/src/store/StoreAdapter.ts
export interface StoreAdapter {
  save(key: string, data: unknown): Promise<void> | void;
  load<T = unknown>(key: string): Promise<T | null> | T | null;
  delete(key: string): Promise<void> | void;
}
```

完整版用 `better-sqlite3` 实现，Demo 版用 localStorage 实现。具体文件参考设计文档第6层。

### Task D2: AI 决策日志 [A]

**Files:** `packages/game-core/src/store/decisionLog.ts`

记录每回合每个 Agent 的输入、输出、耗时、采用 handler 还是 fallback。

### Task D3: 诊断报告生成 [B]

**Files:** `packages/game-core/src/diagnostics/TurnReport.ts`

从 EventBus.getEventLog() 生成结构化回合报告：事件时间线、每个 Agent 的耗时、护栏触发记录。

### Task D4: 前端调试面板 [B]

**Files:** `apps/web/src/components/DebugPanel/`

通过 `?debug=1` URL 参数开启。显示：事件时间线、Agent 决策日志、导演评分详情、护栏触发记录。

---

## Phase E：收尾

- [ ] **[共享]** 编写根目录和每个 package 的 `AGENTS.md`
- [ ] **[共享]** 端到端测试：`npm run dev` 验证完整流程
- [ ] **[共享]** 类型检查全项目：`npm run typecheck`

---

## 分配总览

| Phase | 任务 | 负责人 | 预估时间 |
|-------|------|--------|---------|
| Phase A | Task A1-A3 (eventTypes, EventBus, Contract) | A | 1.5h |
| Phase A | Task A4 (4个Agent契约) | B | 1h |
| Phase A | Task A5-A7 (AgentRegistry, Agents, resolveTurn) | A | 2h |
| Phase A | Task A6 step 4-5 (Killer+Narrator Agent) | B | 0.5h |
| Phase A | Task A9 (路径检查+验证) | 共享 | 0.5h |
| Phase B | Task B1-B2 (护栏规则引擎) | A | 1h |
| Phase B | Task B3-B4 (知识卡片+ContextBuilder) | B | 1.5h |
| Phase C | Task C1-C2 (导演两阶段) | A | 1h |
| Phase D | Task D1-D2 (SQLite+决策日志) | A | 1.5h |
| Phase D | Task D3-D4 (诊断报告+调试面板) | B | 1.5h |
| Phase E | 文档+测试 | 共享 | 0.5h |
