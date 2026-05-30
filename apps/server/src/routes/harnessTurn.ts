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


// 随机环境事件池
const RANDOM_AMBIENT_EVENTS = [
  '走廊感应灯突然亮了，门缝下的光变强了一瞬，又暗下去',
  '远处电梯井传来金属缆绳的轻微回响',
  '隔壁传来电视碎音——这个时间还有人醒着',
  '老旧水管发出一声沉闷的撞击',
  '窗外雨声中夹进一声极短促的汽车喇叭',
  '楼道里有什么东西被风吹倒了——塑料瓶滚过地面',
  '手机屏幕自动亮了一下：运营商发来的垃圾短信',
  '门缝飘进来一丝烟味——楼道里有人在抽烟',
  '雨水忽然变大，密集地砸在雨棚上',
  '对门猫眼亮了一瞬——有人在对面往外看',
];

const PHYSICAL_SIGNALS = [
  '胃里空空的，搬家那天你只吃了一个面包',
  '嘴唇有点干，水瓶还在行李箱里没拿出来',
  '长时间保持同一姿势，肩膀开始发酸',
  '指尖有点凉，空调出风口正对着你',
  '眼睛盯着手机屏幕太久，开始有点发涩',
  '连续几小时的紧张让你的太阳穴微微跳动',
];

function pickRandom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function buildPlotContext(state: GameState, plan?: ActionPlan): string {
  const recentLog = state.log.slice(-6);
  const playerActions = recentLog.filter(l => l.channel === 'action').map(l => '- ' + l.title + ': ' + l.text.slice(0, 60));
  const killerActions = recentLog.filter(l => l.channel === 'ambient').map(l => '- ' + l.title + ': ' + l.text.slice(0, 60));
  const clues = state.clues.slice(-5).map(c => clueBook[c]?.title ?? c);
  const idleTurns = state.log.filter(l => l.channel === 'action')
    .filter(l => l.text.includes('等待') || l.text.includes('保持原位') || l.text.includes('停在原地')).length;
  const minsToDeadline = 1427 - state.minute;
  const battery = (state.room?.phone?.state as Record<string, unknown>)?.battery as number ?? 60;
  const elapsedMin = state.minute - 1380;
  const randomEvent = pickRandom(RANDOM_AMBIENT_EVENTS);
  const physicalSignal = elapsedMin > 10 ? pickRandom(PHYSICAL_SIGNALS) : '';

  return [
    '=== 剧情状态 ===',
    '第 ' + state.run + ' 轮，时间 23:' + String(state.minute % 60).padStart(2, '0') + '，距离23:47还有' + minsToDeadline + '分钟',
    '手机电量: ' + battery + '% | 线索: ' + (clues.join(', ') || '无') + ' | 闲置回合: ' + idleTurns,
    '玩家近期行动:',
    ...(playerActions.length ? playerActions : ['- 尚无']),
    '暗线近期事件:',
    ...(killerActions.length ? killerActions : ['- 尚无']),
    '本回合输入: "' + (plan?.summary ?? '未知') + '"',
    '=== 玩家身体状态 ===',
    physicalSignal || '你暂时感觉还好，但时间在流逝。',
    '=== 随机环境事件（选一个融入本回合叙事） ===',
    randomEvent,
    '=== 导演指示 ===',
    '叙事必须有实质推进。环境细节每回合必须变化。',
    '如果玩家连续等待，通过环境事件和身体状态变化来打破停滞——饿、冷、累、渴都是真实的压力。',
    '用具体的感官细节(声音、光线、气味、温度、触感)营造紧张感，不要用抽象词。',
  ].join('\n');
}

function generateRecap(state: GameState): string {
  const memories = state.memory.filter(m => !m.id.startsWith('checkpoint-'));
  const keyEvents = state.log.filter(l => l.channel === 'action' && l.tone !== 'system').slice(-4);

  if (memories.length === 0 && keyEvents.length === 0) {
    return '这是你在青荷公寓503室醒来的第一个夜晚。包裹里的秘密、门外的动静、手机上的陌生号码——一切都刚刚开始。';
  }

  const lines: string[] = [];
  if (state.run > 1) {
    lines.push(`第 ${state.run} 次循环。上一次你死于：${memories[memories.length - 1]?.title || '未知原因'}。`);
  }
  for (const evt of keyEvents) {
    lines.push(`${evt.title}：${evt.text.slice(0, 80)}`);
  }
  lines.push('电子钟回到 23:00。窗外的雨声和上一次没什么不同。');

  return lines.join('\n');
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
  const system = [
    buildPlotContext(state),
    '',
    '你是行动回应作者。只写玩家动作的落地结果，不写环境推进。',
    '根据上面的剧情状态，写出玩家本次行动的具体结果。',
    '文风：悬疑网文，有推进有钩子。写门锁、猫眼、手机冷光、纸箱气味、脚步距离、手上动作。',
    '必须查看 narrationContext.recentLog，严格避免复述最近两回合出现过的具体描述。',
    '如果剧情状态里出现了相似的玩家行动，必须写出不同的细节和角度。',
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
    buildPlotContext(state),
    '',
    '你是环境播报/暗线镜头。只写门外、楼道、手机、窗外等外部变化。',
    '根据上面的剧情状态和导演指示，写出本回合的环境推进。',
    '绝对禁止：如果上回合出现过的细节（灯光、电表箱、雨声、窗帘、楼道、脚步声），这回合必须写完全不同的内容。',
    '可用的替代元素：敲门声、短信提示音、窗外人影、钥匙插入锁孔、对门邻居开门、楼下警笛、手机震动、对讲机电流声、电梯停靠声、消防楼梯脚步',
    '每次只推进一个压力点。安静和停顿最多持续一回合就必须有新的事件发生。',
    '语言：悬疑网文收尾钩子，具体克制，最后一句压住下一步选择。',
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
