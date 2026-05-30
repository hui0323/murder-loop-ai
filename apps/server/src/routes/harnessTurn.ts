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
// 剧情上下文 & 前情提要
// ============================================================================




function buildPlotContext(state: GameState, plan?: ActionPlan): string {
  const recentTitles = state.log.slice(-4).map(l => l.title).join(' / ');
  const minsToDeadline = 1427 - state.minute;
  return [
    '时间23:' + String(state.minute % 60).padStart(2, '0') + '，距23:47还有' + minsToDeadline + '分钟',
    '最近回合: ' + (recentTitles || '游戏开始'),
    '本回合玩家要做: ' + (plan?.summary || '未知'),
    '避免重复最近出现过的施压方式。玩家在回复消息时优先message_reply。',
  ].join('\n');
}


function generateRecap(state: GameState): string {
  const memories = state.memory.filter(m => !m.id.startsWith('checkpoint-'));

  if (state.run > 1 && memories.length > 0) {
    const last = memories[memories.length - 1];
    return `第 ${state.run} 次循环。死因：${last.title}`;
  }

  return `第 ${state.run} 次循环。`;
}

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
  const plotCtx = buildPlotContext(state, plan);
  const ai = await completeRoleJson('killer', [
    plotCtx,
    '',
    '你是暗线导演，负责陈怀民与楼道环境的下一步压力推进。',
    '根据上面的剧情状态和导演指示，制定本回合的暗线行动。',
    '陈怀民是一个谨慎但越来越焦虑的现实罪犯。包裹证据足以毁掉他的转运链。',
    '可选策略：phone_probe(短信)、soft_knock(轻敲)、landlord_excuse(房东借口)、power_cut(断电)、fake_police(假警察)、fake_callback(假回拨)、spare_key_entry(备用钥匙)、window_route(窗外路线)、lure_linyue(引诱林越)、framing_pressure(证据施压)、retreat(撤退)、message_reply(对话回复)、wait_for_fatigue(沉默)',
    '选择策略时参考剧情状态里的闲置回合数、随机环境事件、玩家身体状态。',
    '如果玩家连续闲置不行动，必须主动推进。如果玩家在回复消息，优先 message_reply。',
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
  // 只用 narrationContext 里的真实事件，不加额外的剧情上下文
  const system = [
    '你是行动回应作者。核心任务：把 narrationContext.events 里的事实写成悬疑小说段落。',
    '必须严格基于 events 里的内容写作。玩家做了什么，你就写什么。不要自己编造玩家没做的事。',
    '文风：悬疑网文，具体克制。写门锁、猫眼、手机冷光、纸箱气味、脚步距离、手上动作。',
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
    '基于 killerResult.events 和 stateSnapshot 写环境推进。',
    '不要重复上一回合出现过的具体细节（灯光闪烁、电表箱、雨声变化、窗帘飘动等）。',
    '每次只推进一个明确的外部事件。语言克制，最后一句留钩子。',
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

    // 死亡后自动复活：如果 state 处于死亡/结局状态，先 rewind 再继续
    let liveState = state;
    if (state.phase === 'death' || (state.ending && state.phase !== 'loop_started')) {
      const { rewindAfterDeath } = await import('@murder-loop-ai/game-core');
      liveState = rewindAfterDeath(state);
    }

    // 用原始状态生成 recap（不包含本回合结果）
    const recap = generateRecap(liveState);

    const beforeLen = liveState.log.length;
    const resolution = await resolveTurnHarness(liveState, input, harness);

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
      recap,
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
