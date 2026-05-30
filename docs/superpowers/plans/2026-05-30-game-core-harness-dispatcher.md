# Game Core Harness Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `packages/game-core` Harness the real turn distribution architecture by introducing a typed dispatcher, command events, contract enforcement, fallback handling, and structured diagnostics.

**Architecture:** `GameEventBus` remains the event log and notification bus. A new `HarnessDispatcher` runs command events with a single authoritative Agent result, writes trace entries, enforces `ArtifactContract`, and falls back deterministically on AI/contract failures. `resolveTurnHarness()` becomes a thin turn orchestrator that advances `TurnContext` only from dispatcher command results.

**Tech Stack:** TypeScript, existing `@murder-loop-ai/shared` types, existing Zod contracts, existing Fastify route tests via `tsx`.

---

## File Structure

- Create `packages/game-core/src/events/HarnessDispatcher.ts`
  - Owns `runCommand()`, `emitNotification()`, command-to-agent routing, trace collection, fallback behavior, and result selection.
- Modify `packages/game-core/src/events/AgentRegistry.ts`
  - Clone agent registrations on register, expose `runAgent()`, and enforce contracts around handler/fallback calls.
- Modify `packages/game-core/src/events/EventBus.ts`
  - Keep `emit()` for notifications, add optional lifecycle/error metadata helpers only if needed by dispatcher.
- Modify `packages/game-core/src/events/eventTypes.ts`
  - Add `NarrationRequested` and command result typing helpers.
- Modify `packages/game-core/src/contracts/narrator.contract.ts`
  - Make Narrator output contract match `{ actionNarration, ambientNarration }`.
- Modify `packages/game-core/src/loop/resolveTurn.ts`
  - Use `HarnessDispatcher` results instead of direct fallback/core function calls inside `resolveTurnHarness()`.
- Create `packages/game-core/src/events/HarnessDispatcher.test.ts`
  - Tests dispatcher command result selection, fallback after AI failure, and contract failure handling.
- Create `packages/game-core/src/loop/resolveTurnHarness.test.ts`
  - Tests that harness flow consumes Agent results and produces trace.
- Modify `packages/game-core/package.json`
  - Add a `test` script using `tsx`.
- Modify `apps/server/src/routes/harnessTurn.ts`
  - Return diagnostics from `resolveTurnHarness()` once game-core exposes them.
- Modify `apps/server/src/routes/harnessTurn.test.ts`
  - Keep route test aligned with game-core harness trace names.

---

## Task 1: Add Game Core Test Runner

**Files:**
- Modify: `packages/game-core/package.json`

- [ ] **Step 1: Add test script**

Change `packages/game-core/package.json` scripts to:

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "test": "tsx src/events/HarnessDispatcher.test.ts && tsx src/loop/resolveTurnHarness.test.ts"
}
```

- [ ] **Step 2: Run test command before tests exist**

Run:

```bash
npm run test -w @murder-loop-ai/game-core
```

Expected: fails because the test files do not exist. This confirms the command is wired to the intended files.

---

## Task 2: Define Dispatcher Command Types

**Files:**
- Modify: `packages/game-core/src/events/eventTypes.ts`

- [ ] **Step 1: Write the command typing patch**

Add `NarrationRequested` to `GameEventType`:

```ts
| 'NarrationRequested'
```

Add this payload:

```ts
NarrationRequested: {
  plan: ActionPlan;
  playerResult: TurnResolution['playerResult'];
  killerResult: TurnResolution['killerResult'];
  state: GameState;
};
```

Add command result types:

```ts
export interface GameCommandResults {
  PlayerActionSubmitted: ActionPlan;
  ActionParsed: TurnResolution['playerResult'];
  RulesApplied: KillerStrategy;
  KillerActed: TurnResolution['killerResult'];
  NarrationRequested: {
    actionNarration: Narration;
    ambientNarration: Narration;
  };
  NarrationDone: {
    score: unknown;
    passed: boolean;
    violations: string[];
    moodSignal?: string;
  };
  TurnCompleted: unknown;
}

export type GameCommandType = keyof GameCommandResults & GameEventType;
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck -w @murder-loop-ai/game-core
```

Expected: typecheck may fail until later tasks wire `NarrationRequested`; failures should mention missing event payload usage, not syntax errors.

---

## Task 3: Test Dispatcher Command Behavior

**Files:**
- Create: `packages/game-core/src/events/HarnessDispatcher.test.ts`

- [ ] **Step 1: Write failing tests**

Create:

```ts
import assert from 'node:assert/strict';
import { z } from 'zod';
import { GameEventBus } from './EventBus';
import { AgentRegistry, type AgentRegistration } from './AgentRegistry';
import { HarnessDispatcher } from './HarnessDispatcher';

const baseContract = {
  version: '1.0.0',
  input: z.any(),
  output: z.object({ value: z.string() }),
  validate: true,
};

function createAgent(overrides: Partial<AgentRegistration>): AgentRegistration {
  return {
    id: 'parser',
    subscriptions: [{ event: 'PlayerActionSubmitted', priority: 10 }],
    contract: baseContract,
    handler: async () => ({ value: 'ai' }),
    fallback: async () => ({ value: 'fallback' }),
    mode: 'ai',
    ...overrides,
  };
}

async function testCommandUsesPrimaryAgentResult() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  registry.register(createAgent({}));
  const dispatcher = new HarnessDispatcher(bus, registry);

  const result = await dispatcher.runCommand('PlayerActionSubmitted', {
    input: 'look around',
    state: {} as never,
  });

  assert.deepEqual(result, { value: 'ai' });
  assert.equal(dispatcher.getTrace()[0].agentId, 'parser');
  assert.equal(dispatcher.getTrace()[0].source, 'ai');
}

async function testCommandFallsBackWhenAiThrows() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  registry.register(createAgent({
    handler: async () => {
      throw new Error('ai down');
    },
  }));
  const dispatcher = new HarnessDispatcher(bus, registry);

  const result = await dispatcher.runCommand('PlayerActionSubmitted', {
    input: 'look around',
    state: {} as never,
  });

  assert.deepEqual(result, { value: 'fallback' });
  assert.equal(dispatcher.getTrace()[0].source, 'fallback');
  assert.match(dispatcher.getTrace()[0].warnings[0], /ai down/);
}

async function testCommandRejectsInvalidFallbackOutput() {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  registry.register(createAgent({
    handler: async () => {
      throw new Error('ai down');
    },
    fallback: async () => ({ wrong: true }),
  }));
  const dispatcher = new HarnessDispatcher(bus, registry);

  await assert.rejects(
    () => dispatcher.runCommand('PlayerActionSubmitted', {
      input: 'look around',
      state: {} as never,
    }),
    /output violation/,
  );
}

await testCommandUsesPrimaryAgentResult();
await testCommandFallsBackWhenAiThrows();
await testCommandRejectsInvalidFallbackOutput();
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm run test -w @murder-loop-ai/game-core
```

Expected: fails because `./HarnessDispatcher` does not exist.

---

## Task 4: Implement HarnessDispatcher

**Files:**
- Create: `packages/game-core/src/events/HarnessDispatcher.ts`
- Modify: `packages/game-core/src/events/AgentRegistry.ts`

- [ ] **Step 1: Add AgentRegistry helpers**

Add imports:

```ts
import { enforce } from '../contracts/ArtifactContract';
```

Add a clone helper near the top:

```ts
function cloneAgent(agent: AgentRegistration): AgentRegistration {
  return {
    ...agent,
    subscriptions: agent.subscriptions.map((subscription) => ({ ...subscription })),
  };
}
```

Change `register(agent)` so it stores the clone:

```ts
const registered = cloneAgent(agent);
this.agents.set(registered.id, registered);

for (const sub of registered.subscriptions) {
  const unsubscribe = this.bus.subscribe(sub.event, this.createHandler(registered), sub.priority);
  this.unsubscribers.push(unsubscribe);
}
```

Add:

```ts
async runAgent(agent: AgentRegistration, payload: unknown, event?: GameEvent): Promise<unknown> {
  const fn = agent.mode === 'ai' ? agent.handler : agent.fallback;
  const guarded = enforce(agent.contract, fn as (input: unknown) => Promise<unknown> | unknown, agent.id);
  return guarded(payload);
}

async runFallback(agent: AgentRegistration, payload: unknown, event?: GameEvent): Promise<unknown> {
  const guarded = enforce(agent.contract, agent.fallback as (input: unknown) => Promise<unknown> | unknown, agent.id);
  return guarded(payload);
}
```

Update `createHandler()`:

```ts
private createHandler(agent: AgentRegistration): EventHandler {
  return async (event: GameEvent) => this.runAgent(agent, event.payload, event);
}
```

- [ ] **Step 2: Create HarnessDispatcher**

Create:

```ts
import type { AgentId, AgentRegistration, AgentRegistry } from './AgentRegistry';
import type { GameEventBus } from './EventBus';
import type { GameCommandResults, GameCommandType, GameEvent } from './eventTypes';

const commandAgents: Record<GameCommandType, AgentId> = {
  PlayerActionSubmitted: 'parser',
  ActionParsed: 'rule',
  RulesApplied: 'killer',
  KillerActed: 'rule',
  NarrationRequested: 'narrator',
  NarrationDone: 'director',
  TurnCompleted: 'ui-adapter',
};

export interface HarnessTraceEntry {
  eventType: string;
  agentId: AgentId;
  source: 'ai' | 'fallback' | 'deterministic';
  durationMs: number;
  warnings: string[];
}

export class HarnessDispatcher {
  private trace: HarnessTraceEntry[] = [];

  constructor(
    private readonly bus: GameEventBus,
    private readonly registry: AgentRegistry,
  ) {}

  async runCommand<T extends GameCommandType>(
    type: T,
    payload: GameEvent<T>['payload'],
    parentId?: string,
  ): Promise<GameCommandResults[T]> {
    const agentId = commandAgents[type];
    const agent = this.registry.getAgent(agentId);
    if (!agent) {
      throw new Error(`No agent registered for command "${type}"`);
    }

    const event = this.bus.createEvent(type, payload, parentId);
    const startedAt = performance.now();
    const warnings: string[] = [];

    try {
      const result = await this.registry.runAgent(agent, payload, event);
      this.recordTrace(type, agent, startedAt, warnings, agent.mode === 'ai' ? 'ai' : 'deterministic');
      this.bus.recordEvent(event, [result], performance.now() - startedAt);
      return result as GameCommandResults[T];
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
      if (agent.mode !== 'ai') {
        this.recordTrace(type, agent, startedAt, warnings, 'deterministic');
        this.bus.recordEvent(event, [{ __error: error }], performance.now() - startedAt);
        throw error;
      }

      const fallbackResult = await this.registry.runFallback(agent, payload, event);
      this.recordTrace(type, agent, startedAt, warnings, 'fallback');
      this.bus.recordEvent(event, [fallbackResult], performance.now() - startedAt);
      return fallbackResult as GameCommandResults[T];
    }
  }

  async emitNotification<T extends string>(
    type: T,
    payload: unknown,
    parentId?: string,
  ): Promise<unknown[]> {
    return this.bus.emit(type as never, payload as never, parentId);
  }

  getTrace(): ReadonlyArray<HarnessTraceEntry> {
    return this.trace;
  }

  private recordTrace(
    eventType: string,
    agent: AgentRegistration,
    startedAt: number,
    warnings: string[],
    source: HarnessTraceEntry['source'],
  ) {
    this.trace.push({
      eventType,
      agentId: agent.id,
      source,
      warnings,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}
```

- [ ] **Step 3: Add EventBus event construction helpers**

In `EventBus.ts`, add:

```ts
createEvent<T extends GameEventType>(
  type: T,
  payload: GameEvent<T>['payload'],
  parentId?: string,
): GameEvent<T> {
  return {
    type,
    payload,
    timestamp: performance.now(),
    parentId,
    id: `evt-${++this.idCounter}-${type}`,
  } as GameEvent<T>;
}

recordEvent(event: GameEvent, results: unknown[], durationMs: number): void {
  this.addToLog(event, results, durationMs);
}
```

Then update `emit()` to use `createEvent()` instead of constructing the event inline.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm run test -w @murder-loop-ai/game-core
```

Expected: dispatcher tests pass; `resolveTurnHarness.test.ts` still does not exist and may fail until Task 5 creates it.

---

## Task 5: Test resolveTurnHarness Uses Dispatcher Results

**Files:**
- Create: `packages/game-core/src/loop/resolveTurnHarness.test.ts`

- [ ] **Step 1: Write failing integration test**

Create:

```ts
import assert from 'node:assert/strict';
import { createInitialGameState } from '../state/createInitialState';
import { createHarness, resolveTurnHarness } from './resolveTurn';

async function testResolveTurnHarnessReturnsTraceAndFinalState() {
  const state = createInitialGameState();
  const harness = createHarness();

  const resolution = await resolveTurnHarness(state, 'check the package', harness);

  assert.equal(resolution.plan.raw, 'check the package');
  assert.ok(resolution.finalState.log.length > state.log.length);
  assert.ok(resolution.actionNarration?.text || resolution.narration.text);
  assert.ok(harness.dispatcher.getTrace().some((entry) => entry.eventType === 'PlayerActionSubmitted'));
  assert.ok(harness.dispatcher.getTrace().some((entry) => entry.eventType === 'NarrationRequested'));
}

await testResolveTurnHarnessReturnsTraceAndFinalState();
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test -w @murder-loop-ai/game-core
```

Expected: fails because `createHarness()` does not expose `dispatcher`, and `resolveTurnHarness()` does not run `NarrationRequested`.

---

## Task 6: Refactor resolveTurnHarness To Use Dispatcher

**Files:**
- Modify: `packages/game-core/src/loop/resolveTurn.ts`
- Modify: `packages/game-core/src/contracts/narrator.contract.ts`
- Modify: `packages/game-core/src/agents/NarratorAgent.ts`

- [ ] **Step 1: Fix Narrator contract output**

In `narrator.contract.ts`, define:

```ts
export const narrationPairSchema = z.object({
  actionNarration: narrationSchema,
  ambientNarration: narrationSchema,
});

export const narratorContract: ArtifactContract = {
  version: '1.0.0',
  input: z.any() as z.ZodSchema,
  output: narrationPairSchema as z.ZodSchema,
  validate: true,
};
```

- [ ] **Step 2: Make NarratorAgent subscribe to NarrationRequested**

Change:

```ts
subscriptions: [{ event: 'NarrationRequested', priority: 70 }],
```

Keep fallback returning only:

```ts
return {
  actionNarration: sanitizeNarration(rawAction),
  ambientNarration: sanitizeNarration(rawAmbient),
};
```

- [ ] **Step 3: Expose dispatcher from createHarness**

Import:

```ts
import { HarnessDispatcher } from '../events/HarnessDispatcher';
```

In `createHarness()`:

```ts
const dispatcher = new HarnessDispatcher(bus, registry);
return { bus, registry, dispatcher };
```

- [ ] **Step 4: Replace manual calls in resolveTurnHarness**

Use this shape:

```ts
const ctx: TurnContext = { input, state: { ...state } };

const plan = await harness.dispatcher.runCommand('PlayerActionSubmitted', {
  input,
  state: ctx.state,
});
ctx.plan = plan;

const playerResult = await harness.dispatcher.runCommand('ActionParsed', {
  plan,
  state: ctx.state,
});
ctx.playerResult = playerResult;
ctx.state = playerResult.state;
const playerLogId = ctx.state.log[ctx.state.log.length - 1]?.id;

const killerStrategy = ctx.state.ending
  ? chooseFallbackKillerStrategy(ctx.state)
  : await harness.dispatcher.runCommand('RulesApplied', { playerResult });
ctx.killerStrategy = killerStrategy;

const killerResult = ctx.state.ending
  ? { ...playerResult, text: '', title: '对抗结束', tone: 'system' as const, addedClues: [], timePassed: 0, threatDelta: 0, events: [] }
  : await harness.dispatcher.runCommand('KillerActed', {
      killerStrategy,
      playerResult,
      state: ctx.state,
    });
ctx.killerResult = killerResult;
ctx.state = killerResult.state;
const killerLogId = ctx.state.ending ? undefined : ctx.state.log[ctx.state.log.length - 1]?.id;

const narrationPair = await harness.dispatcher.runCommand('NarrationRequested', {
  plan,
  playerResult,
  killerResult,
  state: ctx.state,
});
const actionNarration = sanitizeNarration(narrationPair.actionNarration);
const ambientNarration = sanitizeNarration(narrationPair.ambientNarration);

const directorResult = await harness.dispatcher.runCommand('NarrationDone', {
  actionNarration,
  ambientNarration,
  state: ctx.state,
});
ctx.directorResult = directorResult;
```

Keep final log replacement and return shape unchanged.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test -w @murder-loop-ai/game-core
npm run typecheck -w @murder-loop-ai/game-core
```

Expected: both pass.

---

## Task 7: Surface Dispatcher Diagnostics Through Server Route

**Files:**
- Modify: `apps/server/src/routes/harnessTurn.ts`
- Modify: `apps/server/src/routes/harnessTurn.test.ts`

- [ ] **Step 1: Update server route trace mapping**

Change default harness trace extraction to:

```ts
const trace = harness.dispatcher.getTrace().map((entry) => ({
  taskId: entry.eventType,
  source: entry.source,
  warnings: entry.warnings,
  durationMs: entry.durationMs,
}));
```

- [ ] **Step 2: Update route test expected trace**

Keep test expecting:

```ts
assert.equal(body.coordination.trace[0].taskId, 'PlayerActionSubmitted');
```

Add:

```ts
assert.equal(body.coordination.trace[0].source, 'game-core-harness');
```

only if the injected fake harness still returns that source. Do not assert game-core real source in the route injection test.

- [ ] **Step 3: Run server tests**

Run:

```bash
npm run test -w @murder-loop-ai/server
npm run typecheck -w @murder-loop-ai/server
```

Expected: both pass.

---

## Task 8: Verify Whole Workspace

**Files:**
- No source changes.

- [ ] **Step 1: Search for deleted package references**

Run:

```bash
$pattern = '@murder-loop-ai/' + 'harness|packages/' + 'harness|createTurn' + 'Harness|KillerStrategy' + 'Judgement'
rg $pattern -n .
```

Expected: no output.

- [ ] **Step 2: Run full typecheck**

Run:

```bash
npm run typecheck
```

Expected: all workspaces pass.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm run test -w @murder-loop-ai/game-core
npm run test -w @murder-loop-ai/server
```

Expected: both pass.

---

## Self-Review

- Spec coverage: This plan implements方案二 by adding a dispatcher, command events, authoritative Agent results, fallback handling, contract enforcement, and diagnostics.
- Scope check: ContextBuilder, GuardEngine, Director soft scoring, persistence, and frontend DebugPanel are intentionally left for follow-up plans because they depend on this dispatch foundation.
- Placeholder scan: No task uses TBD/TODO placeholders.
- Type consistency: `HarnessDispatcher`, `GameCommandType`, `GameCommandResults`, and trace fields are consistently named across tasks.
