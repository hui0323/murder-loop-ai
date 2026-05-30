import type {
  ActionPlan,
  AmbientResolution,
  GameState,
  KillerStrategy,
  Narration,
  NarrationContext,
  TurnResolution,
} from '@murder-loop-ai/shared';
import { fallbackParseAction } from '../actions/fallbackParser';
import { applyPlayerActions } from '../rules/applyPlayerActions';
import { chooseFallbackKillerStrategy } from '../killer/fallbackStrategy';
import { applyKillerStrategy } from '../killer/applyKillerStrategy';
import {
  createFallbackActionNarration,
  createFallbackAmbientNarration,
  sanitizeNarration,
} from '../narration/fallbackNarration';
import { buildNarrationContext } from '../narration/buildNarrationContext';
import { advanceAmbientTurn } from '../ambient/advanceAmbientTurn';
import { GameEventBus } from '../events/EventBus';
import { AgentRegistry } from '../events/AgentRegistry';
import { HarnessDispatcher } from '../events/HarnessDispatcher';
import { ParserAgent } from '../agents/ParserAgent';
import { RuleAgent } from '../agents/RuleAgent';
import { KillerAgent } from '../agents/KillerAgent';
import { NarratorAgent } from '../agents/NarratorAgent';
import { DirectorAgent } from '../agents/DirectorAgent';
import { NpcAgent } from '../agents/NpcAgent';
import { UIAdapterAgent } from '../agents/UIAdapterAgent';
import { SidebarAgent } from '../agents/SidebarAgent';

export { GameEventBus, AgentRegistry, HarnessDispatcher };
export { ParserAgent, RuleAgent, KillerAgent, NarratorAgent, DirectorAgent, NpcAgent, UIAdapterAgent, SidebarAgent };

// ============================================================================
// 向后兼容：保留旧的 AiAdapters 接口和 resolveTurn 函数
// ============================================================================

export interface AiAdapters {
  parseAction?: (input: string, state: GameState) => Promise<ActionPlan>;
  chooseKillerStrategy?: (
    state: GameState,
    plan?: ActionPlan,
    playerResult?: TurnResolution['playerResult'],
  ) => Promise<KillerStrategy>;
  narrate?: (
    context: NarrationContext,
    playerResult: TurnResolution['playerResult'],
    killerResult: TurnResolution['killerResult'],
    state: GameState,
  ) => Promise<Narration>;
  narrateAction?: (
    context: NarrationContext,
    playerResult: TurnResolution['playerResult'],
    killerResult: TurnResolution['killerResult'],
    state: GameState,
  ) => Promise<Narration>;
  narrateAmbient?: (
    context: NarrationContext,
    playerResult: TurnResolution['playerResult'],
    killerResult: TurnResolution['killerResult'],
    state: GameState,
  ) => Promise<Narration>;
}

function replaceLogEntry(
  state: GameState,
  id: string | undefined,
  patch: Partial<GameState['log'][number]>,
) {
  if (!id) return;
  const index = state.log.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  state.log[index] = { ...state.log[index], ...patch };
}

// ============================================================================
// 新架构：Harness 工厂 + 事件驱动的回合解析
// ============================================================================

/**
 * 回合上下文 — 在事件处理过程中累积中间结果。
 * 每个 Agent 在处理事件时读取/写入此上下文，
 * 替代旧架构中通过函数参数传递的临时变量。
 */
export interface TurnContext {
  /** 玩家原始输入 */
  input: string;
  /** 当前游戏状态（在处理过程中会变化） */
  state: GameState;
  /** 行动解析结果 */
  plan?: ActionPlan;
  /** 玩家行动执行结果 */
  playerResult?: TurnResolution['playerResult'];
  /** 凶手策略 */
  killerStrategy?: KillerStrategy;
  /** 凶手行动执行结果 */
  killerResult?: TurnResolution['killerResult'];
  /** 行动叙事 */
  actionNarration?: Narration;
  /** 环境叙事 */
  ambientNarration?: Narration;
  /** 叙事上下文 */
  narrationContext?: NarrationContext;
  /** 导演评分结果 */
  directorResult?: { score: unknown; passed: boolean; violations: string[]; moodSignal?: string };
}

// ============================================================================
// 致命行为检测 & 对话节点复活
// ============================================================================

interface FatalResult {
  endingId: import('@murder-loop-ai/shared').EndingId;
  title: string;
  text: string;
}

const FATAL_PATTERNS: Array<{ intent: string; target?: string; endingId: import('@murder-loop-ai/shared').EndingId; title: string; text: string }> = [
  {
    intent: 'escape',
    target: 'window',
    endingId: 'window_route_death',
    title: '雨棚之外',
    text: '窗户推开的一瞬间，雨水和冷风灌了进来。你踩上窗沿的那一步没有犹豫，但雨棚的铁皮比你想象的更滑、更单薄。下坠的时间很短，短到来不及回想任何人。青荷公寓 503 室的灯光在雨中变远，电子钟还停在那一刻。',
  },
  {
    intent: 'self_care',
    endingId: 'hidden_inside_death',
    title: '房间里只剩呼吸',
    text: '你以为自己在保护自己，但有些伤害一旦开始就无法收回。房间还是那个房间，但你不再是那个你了。',
  },
  {
    intent: 'open_door',
    target: 'front_door',
    endingId: 'opened_to_fake_police',
    title: '你给了门缝',
    text: '门链滑开的声音很轻，但足够让对方确认——屋里只有你一个人。',
  },
];

/**
 * 检查行动方案是否包含致命行为。
 * AI 解析结果中的 intent 和 target 是主要判断依据。
 * 返回 null 表示不致命，返回 FatalResult 表示触发死亡。
 */
function checkFatalAction(plan: import('@murder-loop-ai/shared').ActionPlan, state: GameState): FatalResult | null {
  // 只检查 AI 解析的结果（confidence > 0 表示 AI 确认）
  for (const action of plan.actions) {
    for (const pattern of FATAL_PATTERNS) {
      if (action.intent !== pattern.intent) continue;
      if (pattern.target && action.target !== pattern.target) continue;

      // escape + window 但窗户未开 → 先让规则系统处理（可能被阻止）
      if (pattern.intent === 'escape' && pattern.target === 'window') {
        const windowObj = state.room?.window;
        if (windowObj && !windowObj.state?.opened) {
          // 窗户没开，玩家可能在尝试开窗。不立即判定死亡，让规则系统处理。
          continue;
        }
      }

      // open_door: 只在杀手暴力模式下才致命。普通对话/试探时开门不应瞬死。
      if (pattern.intent === 'open_door') {
        if (state.room?.front_door?.state?.barricaded) continue; // 门堵着开不了
        // 杀手在暴力/强入模式 → 危险，交给 AI 判断（不硬编码死亡）
        if (state.killerStatus === 'confronting' || state.threat >= 70) {
          // 高危：开门可能致命，但让 AI 叙事决定
          continue; // 不硬杀——AI 根据叙事上下文判断
        }
        // 杀手只是在试探/对话 → 开门不会立刻死
        continue;
      }

      return {
        endingId: pattern.endingId,
        title: pattern.title,
        text: pattern.text,
      };
    }
  }
  return null;
}

/**
 * 保存对话检查点到 memory，用于死亡后复活到最近对话节点。
 * 只在有 NPC 通信时保存。
 */
function saveConversationCheckpoint(state: GameState): void {
  const lastCommunicate = [...state.log].reverse().find(
    (entry) =>
      entry.channel === 'action' &&
      (entry.text.includes('林越') || entry.text.includes('陈怀民') || entry.text.includes('陌生号码') || entry.text.includes('警察')),
  );
  if (!lastCommunicate) return;

  // 检查是否已保存过同一对话的检查点
  const alreadySaved = state.memory.some(
    (m) => m.id === `checkpoint-${lastCommunicate.id}`,
  );
  if (alreadySaved) return;

  state.memory.push({
    id: `checkpoint-${lastCommunicate.id}`,
    run: state.run,
    title: '对话节点',
    text: `你在那一刻和外界建立了联系。如果发生意外，这是你最后的锚点。`,
  });
}

/**
 * 创建 Harness 系统（EventBus + AgentRegistry 含所有 Agent）。
 *
 * 用法：
 * ```ts
 * const harness = createHarness();
 *
 * // 注入 AI adapter（可选，不注入则全部使用 fallback）
 * const parser = harness.registry.getAgent('parser');
 * if (parser) { parser.handler = myAiParser; parser.mode = 'ai'; }
 *
 * // 执行回合
 * const result = await resolveTurnHarness(state, input, harness);
 * ```
 */
export function createHarness(aiAdapters?: AiAdapters) {
  const bus = new GameEventBus();
  const registry = new AgentRegistry(bus);
  const dispatcher = new HarnessDispatcher(bus, registry);
  const narrationAiUsage = {
    action: Boolean(aiAdapters?.narrateAction ?? aiAdapters?.narrate),
    ambient: Boolean(aiAdapters?.narrateAmbient ?? aiAdapters?.narrate),
  };

  // 注册所有 Agent
  registry.register(ParserAgent);
  registry.register(RuleAgent);
  registry.register(KillerAgent);
  registry.register(NarratorAgent);
  registry.register(DirectorAgent);
  registry.register(NpcAgent);
  registry.register(UIAdapterAgent);
  registry.register(SidebarAgent);

  // 注入 AI adapter（如果提供）
  // 注意：handler 不吞错误——HarnessDispatcher 负责 AI→fallback 降级和 trace 标记
  if (aiAdapters?.parseAction) {
    const agent = registry.getAgent('parser');
    if (agent) {
      const aiFn = aiAdapters.parseAction;
      agent.handler = async (payload: unknown) => {
        const { input, state } = payload as { input: string; state: GameState };
        // 直接调用 AI，失败时让 HarnessDispatcher 处理 fallback
        return aiFn(input, state);
      };
      agent.mode = 'ai';
    }
  }
  if (aiAdapters?.chooseKillerStrategy) {
    const agent = registry.getAgent('killer');
    if (agent) {
      const aiFn = aiAdapters.chooseKillerStrategy;
      agent.handler = async (payload: unknown) => {
        const ctx = payload as TurnContext;
        return aiFn(ctx.state, ctx.plan, ctx.playerResult);
      };
      agent.mode = 'ai';
    }
  }
  if (aiAdapters?.narrate || aiAdapters?.narrateAction || aiAdapters?.narrateAmbient) {
    const agent = registry.getAgent('narrator');
    if (agent) {
      const actionNarrator = aiAdapters.narrateAction ?? aiAdapters.narrate;
      const ambientNarrator = aiAdapters.narrateAmbient ?? aiAdapters.narrate;
      agent.handler = async (payload: unknown) => {
        if (!actionNarrator && !ambientNarrator) {
          throw new Error('no narrate adapter provided');
        }
        const ctx = payload as TurnContext;
        const context = ctx.narrationContext ?? buildNarrationContext(ctx.playerResult!, ctx.killerResult!, ctx.plan?.summary ?? '');
        // 并行调用两个叙事 AI，任一个失败即抛错误让 dispatcher fallback
        const [actionNarration, ambientNarration] = await Promise.all([
          actionNarrator
            ? actionNarrator(context, ctx.playerResult!, ctx.killerResult!, ctx.state)
            : (agent.fallback(payload) as Promise<{ actionNarration: Narration; ambientNarration: Narration }>).then(f => f.actionNarration),
          ambientNarrator
            ? ambientNarrator(context, ctx.playerResult!, ctx.killerResult!, ctx.state)
            : (agent.fallback(payload) as Promise<{ actionNarration: Narration; ambientNarration: Narration }>).then(f => f.ambientNarration),
        ]);
        return { actionNarration, ambientNarration };
      };
      agent.mode = 'ai';
    }
  }

  return { bus, registry, dispatcher, narrationAiUsage };
}

/**
 * 事件驱动的回合解析 — 新架构入口。
 *
 * 流程：
 * 1. 构建 TurnContext（包含输入和初始状态）
 * 2. 依次发射事件，Agent 通过 EventBus 订阅响应
 * 3. 收集最终状态和诊断信息
 *
 * 与旧 resolveTurn 的接口兼容，返回值结构相同。
 */
export async function resolveTurnHarness(
  state: GameState,
  input: string,
  harness: ReturnType<typeof createHarness>,
): Promise<TurnResolution> {
  // 构建回合上下文 — 在事件链中共享的可变状态
  const ctx: TurnContext = { input, state: { ...state } };

  // Step 1: 解析行动
  const plan = await harness.dispatcher.runCommand('PlayerActionSubmitted', {
    input,
    state: ctx.state,
  });

  ctx.plan = plan;

  // Step 1.5: 致命行为检测 — AI 或规则判定危及生命的行为直接死亡
  const fatalResult = checkFatalAction(plan, ctx.state);
  if (fatalResult) {
    const deathState = { ...ctx.state };
    deathState.ending = fatalResult.endingId;
    deathState.phase = 'death' as const;
    deathState.log = [
      ...deathState.log,
      {
        id: `death-${Date.now()}`,
        run: deathState.run,
        minute: deathState.minute,
        title: fatalResult.title,
        text: fatalResult.text,
        tone: 'death' as const,
        channel: 'action' as const,
      },
    ];
    // 保存对话检查点到 memory（用于复活）
    saveConversationCheckpoint(deathState);

    return {
      plan,
      playerResult: { title: fatalResult.title, text: fatalResult.text, tone: 'death' as const, addedClues: [], timePassed: 0, threatDelta: 0, events: [], state: deathState },
      killerStrategy: { id: 'fatal', type: 'retreat' as const, title: '无', rationale: '玩家已死亡', risk: 'low' as const, visibleToPlayer: false },
      killerResult: { title: '', text: '', tone: 'system' as const, addedClues: [], timePassed: 0, threatDelta: 0, events: [], state: deathState },
      narration: { title: fatalResult.title, text: fatalResult.text },
      actionNarration: { title: fatalResult.title, text: fatalResult.text },
      ambientNarration: { title: '', text: '' },
      finalState: deathState,
    };
  }

  // Step 2: 执行规则
  const playerResult = await harness.dispatcher.runCommand('ActionParsed', {
    plan,
    state: ctx.state,
  });
  ctx.playerResult = playerResult;
  ctx.state = playerResult.state;
  const playerLogId = ctx.state.log[ctx.state.log.length - 1]?.id;

  // Step 3: 凶手策略
  const killerStrategy = ctx.state.ending
    ? chooseFallbackKillerStrategy(ctx.state)
    : await harness.dispatcher.runCommand('RulesApplied', {
        playerResult,
        state: ctx.state,
        plan,
      });
  ctx.killerStrategy = killerStrategy;

  // Step 4: 执行凶手策略 + 叙事
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

  // Step 5: 叙事生成
  const narrationContext = buildNarrationContext(playerResult, killerResult, plan.summary);
  ctx.narrationContext = narrationContext;

  const narrationPair = await harness.dispatcher.runCommand('NarrationRequested', {
    plan,
    playerResult,
    killerResult,
    state: ctx.state,
    narrationContext,
  });
  const actionNarration = sanitizeNarration(narrationPair.actionNarration);
  const ambientNarration = playerResult.state.ending
    ? actionNarration
    : sanitizeNarration(narrationPair.ambientNarration);
  ctx.actionNarration = actionNarration;
  ctx.ambientNarration = ambientNarration;

  // Step 6: 导演评分（事件驱动）
  const directorResult = await harness.dispatcher.runCommand('NarrationDone', {
    narration: actionNarration,
    actionNarration,
    ambientNarration,
    state: ctx.state,
  });
  ctx.directorResult = directorResult;

  // Step 7: 组装最终状态
  const finalState = { ...ctx.state };
  replaceLogEntry(finalState, playerLogId, {
    title: actionNarration.title,
    text: actionNarration.text,
    isAiNarration: harness.narrationAiUsage.action,
    channel: 'action',
    tone: playerResult.tone,
  });
  replaceLogEntry(finalState, killerLogId, {
    title: ambientNarration.title,
    text: ambientNarration.text,
    isAiNarration: playerResult.state.ending
      ? harness.narrationAiUsage.action
      : harness.narrationAiUsage.ambient,
    channel: 'ambient',
    tone: killerResult.tone === 'death' ? 'death' : killerResult.tone,
  });

  // Step 8: 完成回合
  await harness.dispatcher.runCommand('TurnCompleted', {
    finalState,
    moodSignal: directorResult.moodSignal,
  });

  return {
    plan,
    playerResult,
    killerStrategy,
    killerResult,
    narration: actionNarration,
    actionNarration,
    ambientNarration,
    finalState,
  };
}

// ============================================================================
// 向后兼容：保留旧的 resolveTurn 函数
// ============================================================================

export async function resolveTurn(
  state: GameState,
  input: string,
  aiAdapters: AiAdapters = {},
): Promise<TurnResolution> {
  const plan = aiAdapters.parseAction
    ? await aiAdapters
        .parseAction(input, state)
        .catch(() => fallbackParseAction(input))
    : fallbackParseAction(input);
  const playerResult = applyPlayerActions(state, plan);
  const playerLogId = playerResult.state.log[playerResult.state.log.length - 1]?.id;

  const killerStrategy = playerResult.state.ending
    ? chooseFallbackKillerStrategy(playerResult.state)
    : aiAdapters.chooseKillerStrategy
      ? await aiAdapters
          .chooseKillerStrategy(playerResult.state, plan, playerResult)
          .catch(() => chooseFallbackKillerStrategy(playerResult.state))
      : chooseFallbackKillerStrategy(playerResult.state);

  const killerResult = playerResult.state.ending
    ? {
        ...playerResult,
        text: '',
        title: '对抗结束',
        tone: 'system' as const,
        addedClues: [],
        timePassed: 0,
        threatDelta: 0,
        events: [],
      }
    : applyKillerStrategy(playerResult.state, killerStrategy);
  const killerLogId = playerResult.state.ending
    ? undefined
    : killerResult.state.log[killerResult.state.log.length - 1]?.id;
  const narrationContext = buildNarrationContext(playerResult, killerResult, plan.summary);
  const actionNarrator = aiAdapters.narrateAction ?? aiAdapters.narrate;
  const ambientNarrator = aiAdapters.narrateAmbient ?? aiAdapters.narrate;
  const rawActionNarration = actionNarrator
    ? await actionNarrator(narrationContext, playerResult, killerResult, killerResult.state).catch(
        () => createFallbackActionNarration(playerResult),
      )
    : createFallbackActionNarration(playerResult);
  const rawAmbientNarration = playerResult.state.ending
    ? rawActionNarration
    : ambientNarrator
      ? await ambientNarrator(
          narrationContext,
          playerResult,
          killerResult,
          killerResult.state,
        ).catch(() => createFallbackAmbientNarration(playerResult, killerResult))
      : createFallbackAmbientNarration(playerResult, killerResult);
  const actionNarration = sanitizeNarration(rawActionNarration);
  const ambientNarration = sanitizeNarration(rawAmbientNarration);

  const finalState = { ...killerResult.state };
  replaceLogEntry(finalState, playerLogId, {
    title: actionNarration.title,
    text: actionNarration.text,
    isAiNarration: Boolean(actionNarrator),
    channel: 'action',
    tone: playerResult.tone,
  });
  replaceLogEntry(finalState, killerLogId, {
    title: ambientNarration.title,
    text: ambientNarration.text,
    isAiNarration: Boolean(ambientNarrator),
    channel: 'ambient',
    tone: killerResult.tone === 'death' ? 'death' : killerResult.tone,
  });

  return {
    plan,
    playerResult,
    killerStrategy,
    killerResult,
    narration: actionNarration,
    actionNarration,
    ambientNarration,
    finalState,
  };
}

export async function resolveAmbientTurn(
  state: GameState,
  aiAdapters: Omit<AiAdapters, 'parseAction'> = {},
): Promise<AmbientResolution> {
  const ambientResult = advanceAmbientTurn(state);
  const killerStrategy = ambientResult.state.ending
    ? chooseFallbackKillerStrategy(ambientResult.state)
    : aiAdapters.chooseKillerStrategy
      ? await aiAdapters
          .chooseKillerStrategy(ambientResult.state)
          .catch(() => chooseFallbackKillerStrategy(ambientResult.state))
      : chooseFallbackKillerStrategy(ambientResult.state);

  const killerResult = ambientResult.state.ending
    ? {
        ...ambientResult,
        text: '',
        title: '对抗结束',
        tone: 'system' as const,
        addedClues: [],
        timePassed: 0,
        threatDelta: 0,
        events: [],
      }
    : applyKillerStrategy(ambientResult.state, killerStrategy);
  const narrationContext = buildNarrationContext(
    ambientResult,
    killerResult,
    '我暂时没有采取新行动，时间和环境继续推进',
  );
  const ambientNarrator = aiAdapters.narrateAmbient ?? aiAdapters.narrate;
  const rawNarration = ambientNarrator
    ? await ambientNarrator(narrationContext, ambientResult, killerResult, killerResult.state).catch(
        () => createFallbackAmbientNarration(ambientResult, killerResult),
      )
    : createFallbackAmbientNarration(ambientResult, killerResult);
  const narration = sanitizeNarration(rawNarration);

  const finalState = { ...killerResult.state };
  finalState.log = [
    ...finalState.log,
    {
      id: `ambient-log-${finalState.run}-${finalState.minute}-${Math.random().toString(36).slice(2, 8)}`,
      run: finalState.run,
      minute: finalState.minute,
      title: narration.title,
      text: narration.text,
      tone:
        killerResult.tone === 'death'
          ? 'death'
          : ambientResult.tone === 'threat' || killerResult.tone === 'threat'
            ? 'threat'
            : 'neutral',
      channel: 'ambient',
      isAiNarration: Boolean(ambientNarrator),
    },
  ];

  return { ambientResult, killerStrategy, killerResult, narration, finalState };
}

export { rewindAfterDeath } from './rewind';
