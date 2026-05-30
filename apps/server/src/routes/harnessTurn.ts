import type { FastifyInstance } from 'fastify';
import { ActionPlanSchema, KillerStrategySchema, NarrationSchema } from '@murder-loop-ai/ai-contracts';
import { clueBook } from '@murder-loop-ai/content';
import {
  createHarness,
  createInitialGameState,
  resolveTurnHarness,
  type AiAdapters,
} from '@murder-loop-ai/game-core';
import {
  minuteLabel,
  type ActionPlan,
  type GameState,
  type KillerStrategy,
  type Narration,
  type NarrationContext,
  type RuleResult,
  type StoryLogEntry,
  type TurnResolution,
} from '@murder-loop-ai/shared';
import { scoreNarrationWithDirector } from '../ai/directorScorer';
import { completeRoleJson } from '../ai/openaiClient';
import { createTurnBlackboard, verifyActionPlan, verifyKillerStrategy, verifyNarration } from '../ai/turnCoordinator';

interface FrontendStoryNode {
  id: string;
  type: 'narrative' | 'action_result' | 'system' | 'player_input';
  content: string;
  timestamp?: string;
}

interface HarnessTraceEntry {
  taskId: string;
  source: string;
  decision?: string;
  warnings: string[];
  durationMs: number;
}

interface HarnessCoordination {
  warnings: string[];
  trace: HarnessTraceEntry[];
  judgements: Record<string, unknown>;
}

interface HarnessTurnResolution extends TurnResolution {
  coordination: HarnessCoordination;
}

interface HarnessLike {
  resolveTurn(state: GameState, input: string): Promise<HarnessTurnResolution>;
}

interface HarnessAiAdapterSet {
  aiAdapters: AiAdapters;
  coordination?: {
    warnings?: string[];
    judgements?: Record<string, unknown>;
  };
}

interface HarnessTurnRouteOptions {
  createHarness?: () => HarnessLike;
  createAiAdapters?: (input: string, state: GameState) => HarnessAiAdapterSet;
}

async function parseActionAi(input: string, state: GameState): Promise<ActionPlan> {
  const { fallbackParseAction } = await import('@murder-loop-ai/game-core');
  const fallback = fallbackParseAction(input);
  const blackboard = createTurnBlackboard(input, state);

  try {
    const ai = await completeRoleJson(
      'parse',
      [
        '你是《23:47》行动解析 AI。把玩家自然语言输入拆成结构化 JSON。',
        '第一原则：尊重否定词和条件词。"不开门/不要开门"绝不能解析成 open_door。',
        '只解析玩家明确要做的事，不替玩家补全操作，不制造事实，不判断生死。',
        '复杂输入拆成 1-6 个动作，顺序保持玩家原意。',
        '只输出 JSON，必须符合 ActionPlanSchema。',
      ].join('\n'),
      { input, state, fallbackShape: fallback },
      { temperature: 0.25 },
    );
    const parsed = ActionPlanSchema.safeParse(ai);
    if (!parsed.success) throw new Error('parse action schema mismatch');
    return verifyActionPlan(input, parsed.data, blackboard);
  } catch {
    return verifyActionPlan(input, fallback, blackboard);
  }
}

async function killerStrategyAi(state: GameState, plan?: ActionPlan): Promise<KillerStrategy> {
  const { chooseFallbackKillerStrategy, projectKillerVisibleState } = await import('@murder-loop-ai/game-core');
  const fallback = chooseFallbackKillerStrategy(state);
  const visible = projectKillerVisibleState(state);
  const blackboard = createTurnBlackboard('', state);

  try {
    const ai = await completeRoleJson(
      'killer',
      [
        '你是《23:47》暗线导演，负责陈怀民与楼道环境的下一步压力。',
        '你只能看 visibleState。玩家没有暴露的信息你都不知道。不要全知反制。',
        '陈怀民是谨慎的现实罪犯：怕监控、怕录音、怕目击、怕真警察。优先试探、欺骗、拖延。',
        '如果玩家本回合在回复陈怀民/陌生号码，优先 message_reply，只承接对话。',
        '节奏一小步一小步收紧。低压用短信/轻敲；中压用房东借口/断电；高压才考虑假警察、窗外路线。',
        '只输出 JSON，必须符合 KillerStrategySchema。',
      ].join('\n'),
      { visibleState: visible, plan, allowedShape: fallback },
      { temperature: 0.55 },
    );
    const parsed = KillerStrategySchema.safeParse(ai);
    if (!parsed.success) throw new Error('killer strategy schema mismatch');
    return verifyKillerStrategy(state, parsed.data, blackboard);
  } catch {
    return verifyKillerStrategy(state, fallback, blackboard);
  }
}

async function narrateActionAi(
  context: NarrationContext,
  playerResult: RuleResult,
  killerResult: RuleResult,
  state: GameState,
): Promise<Narration> {
  const { createFallbackActionNarration } = await import('@murder-loop-ai/game-core');
  const fallback = createFallbackActionNarration(playerResult);
  const blackboard = createTurnBlackboard('', state);
  const system = [
    '你是《23:47》"行动回应"作者。只写玩家动作的落地结果，不写下一波环境推进。',
    '只使用 narrationContext.events 里的事实。不新增证据，不改变时间/生死/NPC状态。',
    '文风参考悬疑网文：段落有推进，句子有钩子。多写门锁、猫眼、手机冷光、纸箱气味、脚步距离。',
    '220-520 个中文字符。只输出 JSON：{"title":"...","text":"..."}。',
  ].join('\n');

  try {
    const ai = await completeRoleJson(
      'narrator',
      system,
      { narrationContext: context, playerResult, state },
      { temperature: 0.72 },
    );
    const parsed = NarrationSchema.safeParse(ai);
    if (!parsed.success) throw new Error('action narration schema mismatch');

    const narration = verifyNarration(parsed.data, fallback, blackboard, 'actionNarration');
    const score = await scoreNarrationWithDirector({
      slot: 'action',
      narration,
      context,
      playerResult,
      killerResult,
      state,
    });

    if (score.verdict === 'rewrite') {
      const rewrite = await completeRoleJson(
        'narrator',
        `${system}\n\n根据导演意见重写：${score.rewriteBrief}`,
        { narrationContext: context, playerResult, state, previousNarration: narration, directorRewriteBrief: score.rewriteBrief },
        { temperature: 0.68 },
      ).catch(() => null);
      const reparsed = NarrationSchema.safeParse(rewrite);
      if (reparsed.success) return verifyNarration(reparsed.data, fallback, blackboard, 'actionNarration');
    }

    return narration;
  } catch {
    return verifyNarration(fallback, fallback, blackboard, 'actionNarration');
  }
}

async function narrateAmbientAi(
  context: NarrationContext,
  playerResult: RuleResult,
  killerResult: RuleResult,
  state: GameState,
): Promise<Narration> {
  const { createFallbackAmbientNarration } = await import('@murder-loop-ai/game-core');
  const fallback = createFallbackAmbientNarration(playerResult, killerResult);
  const blackboard = createTurnBlackboard('', state);
  const system = [
    '你是《23:47》"环境播报/暗线镜头"。只写门外、楼道、手机、时间、来电、灯光、窗外等环境变化。',
    '不要复述玩家动作细节，不要写玩家心理。只呈现玩家能直接感知的现象。',
    '语言要像悬疑网文的收尾钩子：具体、克制、最后一句压住下一步选择。',
    '90-240 个中文字符。只输出 JSON：{"title":"...","text":"..."}。',
  ].join('\n');

  try {
    const ai = await completeRoleJson(
      'narrator',
      system,
      { narrationContext: context, killerResult, state },
      { temperature: 0.78 },
    );
    const parsed = NarrationSchema.safeParse(ai);
    if (!parsed.success) throw new Error('ambient narration schema mismatch');

    const narration = verifyNarration(parsed.data, fallback, blackboard, 'ambientNarration');
    const score = await scoreNarrationWithDirector({
      slot: 'ambient',
      narration,
      context,
      playerResult,
      killerResult,
      state,
    });

    if (score.verdict === 'rewrite') {
      const rewrite = await completeRoleJson(
        'narrator',
        `${system}\n\n根据导演意见重写：${score.rewriteBrief}`,
        { narrationContext: context, killerResult, state, previousNarration: narration, directorRewriteBrief: score.rewriteBrief },
        { temperature: 0.72 },
      ).catch(() => null);
      const reparsed = NarrationSchema.safeParse(rewrite);
      if (reparsed.success) return verifyNarration(reparsed.data, fallback, blackboard, 'ambientNarration');
    }

    return narration;
  } catch {
    return verifyNarration(fallback, fallback, blackboard, 'ambientNarration');
  }
}

function createAiHarness() {
  const aiAdapters: AiAdapters = {
    parseAction: (input, state) => parseActionAi(input, state),
    chooseKillerStrategy: (state, plan) => killerStrategyAi(state, plan),
    narrateAction: (context, playerResult, killerResult, state) =>
      narrateActionAi(context, playerResult, killerResult, state),
    narrateAmbient: (context, playerResult, killerResult, state) =>
      narrateAmbientAi(context, playerResult, killerResult, state),
  };

  return createHarness(aiAdapters);
}

function toFrontendClues(state: GameState) {
  return state.clues.map((id, index) => ({
    id,
    name: clueBook[id]?.title ?? id,
    description: clueBook[id]?.detail ?? '线索已记录。',
    status: index === state.clues.length - 1 ? 'new' : 'known',
  }));
}

function toFrontendNode(entry: StoryLogEntry): FrontendStoryNode {
  if (entry.channel === 'action') {
    return {
      id: entry.id,
      type: 'action_result',
      content: `${entry.title ? `${entry.title}: ` : ''}${entry.text}`,
      timestamp: minuteLabel(entry.minute),
    };
  }

  if (entry.tone === 'system') {
    return {
      id: entry.id,
      type: 'system',
      content: entry.title || entry.text,
      timestamp: minuteLabel(entry.minute),
    };
  }

  return {
    id: entry.id,
    type: 'narrative',
    content: entry.text,
    timestamp: minuteLabel(entry.minute),
  };
}

function defaultHarness(createAiAdapters?: (input: string, state: GameState) => HarnessAiAdapterSet): HarnessLike {
  return {
    async resolveTurn(state: GameState, input: string): Promise<HarnessTurnResolution> {
      const adapterSet = createAiAdapters?.(input, state);
      const harness = adapterSet ? createHarness(adapterSet.aiAdapters) : createAiHarness();
      const resolution = await resolveTurnHarness(state, input, harness);
      const trace = harness.dispatcher.getTrace().map((entry) => ({
        taskId: entry.eventType,
        source: entry.source,
        warnings: entry.warnings,
        durationMs: entry.durationMs,
      }));

      return {
        ...resolution,
        coordination: {
          warnings: [
            ...(adapterSet?.coordination?.warnings ?? []),
            ...trace.flatMap((entry) => entry.warnings),
          ],
          trace,
          judgements: adapterSet?.coordination?.judgements ?? {},
        },
      };
    },
  };
}

function deathMethodFor(ending: NonNullable<GameState['ending']>) {
  return ({
    default_murder: '锁芯轻响，门缝里的光先于脚步进入房间。',
    opened_to_fake_police: '你给了门缝，对方给了一个足够近的假身份。',
    window_route_death: '窗外雨棚成了第二条入口，门不是唯一边界。',
    hidden_inside_death: '你以为房间里只剩自己，呼吸声却从更近的地方响起。',
    framed_survivor: '你活了下来，但证据的位置开始替别人说话。',
    escaped_without_truth: '你离开了房间，真相却还留在 503。',
    survived_with_evidence: '录音、照片和官方回拨把房间从孤岛变成现场。',
    perfect_truth: '证据链闭合之前，陈怀民已经没有下一句借口。',
  } as Record<string, string>)[ending];
}

export async function harnessTurnRoute(
  app: FastifyInstance,
  options: HarnessTurnRouteOptions = {},
) {
  app.post('/api/harness/turn', async (request) => {
    const body = request.body as { input?: string; state?: GameState };
    const input = body.input?.trim() ?? '';
    const state = body.state ?? createInitialGameState();

    if (!input) {
      return {
        coreState: state,
        time: minuteLabel(state.minute),
        location: '青荷公寓 503 室',
        phase: state.phase,
        clues: toFrontendClues(state),
        storyLog: [] satisfies FrontendStoryNode[],
        coordination: {
          warnings: [],
          trace: [],
          judgements: {},
        },
      };
    }

    const harness = options.createHarness ? options.createHarness() : defaultHarness(options.createAiAdapters);
    const beforeLogLength = state.log.length;
    const resolution = await harness.resolveTurn(state, input);
    const endingEntry = resolution.finalState.ending
      ? resolution.finalState.log[resolution.finalState.log.length - 1]
      : null;

    return {
      coreState: resolution.finalState,
      time: minuteLabel(resolution.finalState.minute),
      location: '青荷公寓 503 室',
      phase: resolution.finalState.phase,
      clues: toFrontendClues(resolution.finalState),
      ending: resolution.finalState.ending,
      deathTitle: resolution.finalState.phase === 'death' ? endingEntry?.title ?? '23:47' : null,
      deathSummary: resolution.finalState.phase === 'death' ? endingEntry?.text ?? null : null,
      deathMethod: resolution.finalState.ending ? deathMethodFor(resolution.finalState.ending) : null,
      score: resolution.finalState.score,
      storyLog: [
        {
          id: `input-${Date.now()}`,
          type: 'player_input',
          content: input,
        },
        ...resolution.finalState.log.slice(beforeLogLength).map(toFrontendNode),
      ] satisfies FrontendStoryNode[],
      turn: {
        plan: resolution.plan,
        killerStrategy: resolution.killerStrategy,
        actionNarration: resolution.actionNarration ?? resolution.narration,
        ambientNarration: resolution.ambientNarration ?? null,
      },
      coordination: resolution.coordination,
    };
  });
}
