import type { FastifyInstance } from 'fastify';
import { ActionPlanSchema, KillerStrategySchema, NarrationSchema } from '@murder-loop-ai/ai-contracts';
import { clueBook } from '@murder-loop-ai/content';
import {
  createHarness, createInitialGameState, resolveTurnHarness,
  type AiAdapters,
} from '@murder-loop-ai/game-core';
import {
  minuteLabel,
  type ActionPlan, type GameState, type KillerStrategy, type Narration,
  type NarrationContext, type RuleResult, type StoryLogEntry, type TurnResolution,
} from '@murder-loop-ai/shared';
import { completeRoleJson } from '../ai/openaiClient';
import { createTurnBlackboard, verifyActionPlan, verifyKillerStrategy, verifyNarration } from '../ai/turnCoordinator';

// ============================================================================
// AI Adapter — 无内部 try/catch，错误由 HarnessDispatcher 统一处理
// ============================================================================

async function parseActionAi(input: string, state: GameState): Promise<ActionPlan> {
  const { fallbackParseAction } = await import('@murder-loop-ai/game-core');
  const fallback = fallbackParseAction(input);
  const blackboard = createTurnBlackboard(input, state);
  const ai = await completeRoleJson('parse', [
    '你是行动解析 AI。把玩家自然语言输入拆成结构化 JSON。',
    '第一原则：尊重否定词和条件词。不开门/不要开门绝不能解析成 open_door。',
    '只解析玩家明确要做的事，不替玩家补全操作，不制造事实，不判断生死。',
    'intent 必须是以下之一：inspect secure_entry record communicate call_police verify_identity deceive hide_evidence preserve_evidence open_door self_care wait escape unknown',
    '跳楼/跳窗/翻窗 → intent=escape, target=window。自杀/想死 → intent=self_care',
    '输出 JSON（全部必填）：{"id":"xxx","raw":"玩家原文","summary":"一句话","actions":[{"id":"act-1","raw":"原文","intent":"枚举值","target":"目标","method":"方式","confidence":0.9,"timeCost":1,"noise":3,"risk":"low|medium|high"}],"confidence":0.9,"warnings":[]}',
  ].join('\n'), { input, state, fallbackShape: fallback }, { temperature: 0.25 });
  if (!ai) throw new Error('parse AI returned null');
  const parsed = ActionPlanSchema.safeParse(ai);
  if (!parsed.success) throw new Error(`parse schema: ${parsed.error.message}`);
  return verifyActionPlan(input, parsed.data, blackboard);
}

async function killerStrategyAi(state: GameState, plan?: ActionPlan): Promise<KillerStrategy> {
  const { chooseFallbackKillerStrategy, projectKillerVisibleState } = await import('@murder-loop-ai/game-core');
  const fallback = chooseFallbackKillerStrategy(state);
  const visible = projectKillerVisibleState(state);
  const ai = await completeRoleJson('killer', [
    '你是暗线导演，负责陈怀民与楼道环境的下一步压力推进。',
    '核心目标：每一回合必须向前推进剧情。不能原地踏步，不能重复上一回合的施压方式。',
    '你只能看 visibleState。玩家没有暴露的信息你都不知道。',
    '陈怀民是谨慎的现实罪犯，但也是被逼到墙角的困兽。包裹里的证据如果泄露，他的转运链就完了。',
    '压力递进路线：短信试探 → 轻敲门 → 房东借口 → 断电 → 假警察 → 假回拨 → 备用钥匙 → 窗外路线 → 暴力闯入',
    '每个阶段持续 1-2 回合就必须升级。不要在同一阶段反复横跳。',
    '如果上一回合已经出现过断电/灯光闪烁/电表箱响，这回合绝对不能再写同样的内容。',
    '如果玩家已经拍照/备份/联系外界，陈怀民应该更焦虑、更激进。',
    '如果玩家在回复消息，优先 message_reply 承接对话。',
    'title 要像章节小标题，rationale 说明为什么这一步。',
    '只输出 JSON，必须符合 KillerStrategySchema。',
  ].join('\n'), { visibleState: visible, allowedShape: fallback, plan }, { temperature: 0.7 });
  if (!ai) throw new Error('killer AI returned null');
  const parsed = KillerStrategySchema.safeParse(ai);
  if (!parsed.success) throw new Error(`killer schema: ${parsed.error.message}`);
  return verifyKillerStrategy(state, parsed.data, createTurnBlackboard('', state));
}

async function narrateActionAi(
  context: NarrationContext, playerResult: RuleResult,
  killerResult: RuleResult, state: GameState,
): Promise<Narration> {
  const { createFallbackActionNarration } = await import('@murder-loop-ai/game-core');
  const fallback = createFallbackActionNarration(playerResult);
  const system = [
    '你是行动回应作者。只写玩家动作的落地结果，不写环境推进。',
    '只使用 narrationContext.events 里的事实。不新增证据或 NPC。',
    '文风：悬疑网文，有推进有钩子。写门锁、猫眼、手机冷光、纸箱气味、脚步距离、手上动作。',
    '必须查看 narrationContext.recentLog，严格避免复述最近两回合出现过的具体描述。',
    '220-520 个中文字符。只输出 JSON：{"title":"...","text":"..."}。',
  ].join('\n');
  const ai = await completeRoleJson('narrator', system,
    { narrationContext: context, playerResult, state }, { temperature: 0.75 });
  if (!ai) throw new Error('action narration AI returned null');
  const parsed = NarrationSchema.safeParse(ai);
  if (!parsed.success) throw new Error(`action narration: ${parsed.error.message}`);
  return verifyNarration(parsed.data, fallback, createTurnBlackboard('', state), 'actionNarration');
}

async function narrateAmbientAi(
  context: NarrationContext, playerResult: RuleResult,
  killerResult: RuleResult, state: GameState,
): Promise<Narration> {
  const { createFallbackAmbientNarration } = await import('@murder-loop-ai/game-core');
  const fallback = createFallbackAmbientNarration(playerResult, killerResult);
  const system = [
    '你是环境播报/暗线镜头。只写门外、楼道、手机、窗外等外部变化。',
    '核心规则：剧情必须向前推进。每回合的环境必须和上一回合有本质不同。',
    '绝对禁止列表——以下元素如果上一回合出现过，这回合绝对不能写：',
    '  电表箱响、灯光闪烁、手机电量变化、雨声变大变小、楼道安静/没有脚步声、窗帘被风掀动、路灯光斜切',
    '如果上回合写了电表箱和灯光，这回合必须写完全不同的内容：敲门声、短信提示音、窗外人影、钥匙插入锁孔的声音、对门邻居开门声、楼下警笛',
    '不要复述玩家动作。只呈现玩家能直接感知的外部现象。',
    '每次只推进一个压力点。安静和停顿最多持续一回合。',
    '语言：悬疑网文收尾钩子，具体克制，最后一句压住下一步选择。',
    '必须查看 narrationContext.recentLog，任何在 recentLog 中出现过的具体描述都不能重复。',
    '90-240 个中文字符。只输出 JSON：{"title":"...","text":"..."}。',
  ].join('\n');
  const ai = await completeRoleJson('narrator', system,
    { narrationContext: context, killerResult, state }, { temperature: 0.85 });
  if (!ai) throw new Error('ambient narration AI returned null');
  const parsed = NarrationSchema.safeParse(ai);
  if (!parsed.success) throw new Error(`ambient narration: ${parsed.error.message}`);
  return verifyNarration(parsed.data, fallback, createTurnBlackboard('', state), 'ambientNarration');
}

// ============================================================================
// Harness 工厂
// ============================================================================

function createAiHarness() {
  return createHarness({
    parseAction: (input, state) => parseActionAi(input, state),
    chooseKillerStrategy: (state, plan) => killerStrategyAi(state, plan),
    narrateAction: (ctx, pr, kr, st) => narrateActionAi(ctx, pr, kr, st),
    narrateAmbient: (ctx, pr, kr, st) => narrateAmbientAi(ctx, pr, kr, st),
  });
}

// ============================================================================
// 前端数据转换
// ============================================================================

interface FrontendStoryNode {
  id: string; type: 'narrative' | 'action_result' | 'system' | 'player_input';
  content: string; timestamp?: string;
}

function toFrontendClues(state: GameState) {
  return state.clues.map((id, i) => ({
    id, name: clueBook[id]?.title ?? id,
    description: clueBook[id]?.detail ?? '线索已记录。',
    status: i === state.clues.length - 1 ? 'new' : 'known',
  }));
}

function toFrontendNode(entry: StoryLogEntry): FrontendStoryNode {
  if (entry.channel === 'action')
    return { id: entry.id, type: 'action_result', content: `${entry.title ? `${entry.title}: ` : ''}${entry.text}`, timestamp: minuteLabel(entry.minute) };
  if (entry.tone === 'system')
    return { id: entry.id, type: 'system', content: entry.title || entry.text, timestamp: minuteLabel(entry.minute) };
  return { id: entry.id, type: 'narrative', content: entry.text, timestamp: minuteLabel(entry.minute) };
}

// ============================================================================
// 路由
// ============================================================================

export async function harnessTurnRoute(app: FastifyInstance) {
  app.post('/api/harness/turn', async (request) => {
    const body = request.body as { input?: string; state?: GameState };
    const input = body.input?.trim() ?? '';
    const state = body.state ?? createInitialGameState();

    if (!input) {
      return {
        coreState: state, time: minuteLabel(state.minute), location: '青荷公寓 503 室',
        phase: state.phase, clues: toFrontendClues(state),
        storyLog: [] satisfies FrontendStoryNode[],
        coordination: { warnings: [], trace: [], judgements: {} },
      };
    }

    const harness = createAiHarness();
    const beforeLen = state.log.length;
    const resolution = await resolveTurnHarness(state, input, harness);

    const sidebarAgent = harness.registry.getAgent('sidebar');
    const sidebar = sidebarAgent
      ? await harness.registry.runFallback(sidebarAgent, { finalState: resolution.finalState, moodSignal: undefined })
      : null;

    const endingEntry = resolution.finalState.ending ? resolution.finalState.log[resolution.finalState.log.length - 1] : null;
    const deathMethod = resolution.finalState.ending
      ? ({ default_murder: '锁芯轻响，门缝里的光先于脚步进入房间。', opened_to_fake_police: '你给了门缝。', window_route_death: '雨棚比想象中更滑。', hidden_inside_death: '呼吸声从更近的地方响起。', framed_survivor: '证据替别人说话。', escaped_without_truth: '真相留在503。', survived_with_evidence: '房间从孤岛变成现场。', perfect_truth: '证据链闭合。' } as Record<string, string>)[resolution.finalState.ending] : null;

    const trace = harness.dispatcher.getTrace().map(e => ({
      taskId: e.eventType, source: e.source, warnings: e.warnings, durationMs: e.durationMs,
    }));

    return {
      coreState: resolution.finalState, time: minuteLabel(resolution.finalState.minute),
      location: '青荷公寓 503 室', phase: resolution.finalState.phase,
      clues: toFrontendClues(resolution.finalState), ending: resolution.finalState.ending,
      deathTitle: resolution.finalState.phase === 'death' ? endingEntry?.title ?? '23:47' : null,
      deathSummary: resolution.finalState.phase === 'death' ? endingEntry?.text ?? null : null,
      deathMethod, score: resolution.finalState.score,
      storyLog: [
        { id: `input-${Date.now()}`, type: 'player_input', content: input },
        ...resolution.finalState.log.slice(beforeLen).map(toFrontendNode),
      ] satisfies FrontendStoryNode[],
      turn: { plan: resolution.plan, killerStrategy: resolution.killerStrategy, actionNarration: resolution.actionNarration ?? resolution.narration, ambientNarration: resolution.ambientNarration ?? null },
      coordination: { warnings: trace.flatMap(t => t.warnings), trace, judgements: {} },
      sidebar,
    };
  });
}
