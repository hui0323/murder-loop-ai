import type { FastifyInstance } from 'fastify';
import { ActionPlanSchema, KillerStrategySchema, NarrationSchema } from '@murder-loop-ai/ai-contracts';
import { clueBook } from '@murder-loop-ai/content';
import { chooseFallbackKillerStrategy, createFallbackActionNarration, createFallbackAmbientNarration, createInitialGameState, fallbackParseAction, projectKillerVisibleState, resolveTurn } from '@murder-loop-ai/game-core';
import { minuteLabel, type ActionPlan, type GameState, type KillerStrategy, type Narration, type NarrationContext, type RuleResult, type StoryLogEntry } from '@murder-loop-ai/shared';
import { completeRoleJson } from '../ai/openaiClient';
import { createTurnBlackboard, verifyActionPlan, verifyKillerStrategy, verifyNarration } from '../ai/turnCoordinator';
import { scoreNarrationWithDirector } from '../ai/directorScorer';

interface FrontendStoryNode {
  id: string;
  type: 'narrative' | 'action_result' | 'system' | 'player_input';
  content: string;
  timestamp?: string;
}

function toFrontendNode(entry: StoryLogEntry): FrontendStoryNode {
  if (entry.channel === 'action') {
    return {
      id: entry.id,
      type: 'action_result',
      content: `${entry.title ? `${entry.title}。` : ''}${entry.text}`,
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

async function parseActionForFrontend(input: string, state: GameState, blackboard = createTurnBlackboard(input, state)): Promise<ActionPlan> {
  const fallback = fallbackParseAction(input);
  try {
    const ai = await completeRoleJson(
      'parse',
    [
      '你是《23:47》行动解析 AI。玩家用自然语言写一组求生动作，你要把它拆成可裁判的 JSON。',
      '第一原则：尊重否定词和条件词。“不开门/不要开门/别让他进来”绝不能解析成 open_door；“如果对方身份核实失败就不开门”也不是 open_door。',
      '只解析玩家明确要做的事，不替玩家补全聪明操作，不制造事实，不判断生死。',
      '“我回了他/回复他/给他发：……”这种输入是 communicate + chen_huaimin，只表示发送这句话；不能解析成等待、开门或额外搜查。',
      '复杂输入拆成 1-6 个动作，顺序保持玩家原意。每个动作给出 intent、target、method、timeCost、noise、risk、confidence。timeCost 只表示复杂度：普通动作填 1，复杂检查/报警/加固最多填 2；后端会把单回合总耗时压缩到 1-3 分钟。',
      'method 用中文短句，像“隔门询问并录音”“拍照备份包裹”“锁窗拉帘”，不要写开发术语。',
      '如果输入含糊，把核心安全动作解析出来，并在 warnings 里写需要玩家确认的歧义。',
      '只输出 JSON，必须符合 ActionPlanSchema。',
    ].join('\n'),
    { input, state, fallbackShape: fallback },
    { temperature: 0.25 },
  );
  const parsed = ActionPlanSchema.safeParse(ai);
  if (!parsed.success) throw new Error('parse action schema mismatch');
  return verifyActionPlan(input, parsed.data, blackboard);
  } catch (error) {
    blackboard.warnings.push(`parse action AI failed; using fallback parser. ${error instanceof Error ? error.message : String(error)}`);
    return verifyActionPlan(input, fallback, blackboard);
  }
}

function isDirectChenConversation(plan?: ActionPlan) {
  return Boolean(plan?.actions.some((action) =>
    (action.intent === 'communicate' || action.intent === 'deceive')
    && action.target === 'chen_huaimin'
  ));
}

function replyAwareKillerStrategy(plan?: ActionPlan): KillerStrategy | null {
  if (!isDirectChenConversation(plan)) return null;
  const raw = plan?.raw ?? '';
  const admittedPackage = /有啊|看见|拿进|拿了|包裹/.test(raw);
  return {
    id: `killer-message-${Date.now()}`,
    type: 'message_reply',
    title: '消息接上了',
    rationale: '玩家这一回合是在回复陈怀民/陌生号码；暗线必须先承接对话，不允许跳去新的敲门、断电或脚步压力。',
    responseHint: admittedPackage
      ? '手机屏幕在十几秒后再次亮起。陌生号码只回：“哪个包裹？你先别动，我上来确认一下。”字句很短，却把话题钉回了门口那只纸箱。'
      : '手机屏幕在十几秒后再次亮起。陌生号码没有回答身份，只追问：“你现在在屋里吗？门口那件东西别乱碰。”楼道没有新的敲门声，压力先停在这句话里。',
    visibleToPlayer: true,
    risk: 'medium',
  };
}

function hasMessageReply(context: NarrationContext) {
  return context.events.some((event) => event.subject === 'message_reply');
}

async function chooseKillerStrategyForFrontend(state: GameState, plan?: ActionPlan, blackboard = createTurnBlackboard('', state)): Promise<KillerStrategy> {
  const coordinated = replyAwareKillerStrategy(plan);
  if (coordinated) {
    blackboard.warnings.push('turn coordinator routed killer strategy to message_reply because player directly replied to Chen Huaimin.');
    return verifyKillerStrategy(state, coordinated, blackboard);
  }

  const visible = projectKillerVisibleState(state);
  const fallback = chooseFallbackKillerStrategy(state);
  try {
    const ai = await completeRoleJson(
      'killer',
    [
      '你是《23:47》的暗线导演，只负责陈怀民与楼道环境的下一步压力，不写小说正文。',
      '你只能看 visibleState。玩家没有暴露的位置、证据备份、心理活动、房内细节，你都不知道。不要全知反制。',
      '陈怀民是谨慎的现实罪犯：怕监控、怕录音、怕目击、怕真警察。他优先试探、欺骗、拖延、切断信息，而不是无脑冲门。',
      '节奏要像悬疑网文：一小步一小步收紧。低压用短信/轻敲/静默；中压用房东借口/断电/伪回拨；高压才考虑假警察、窗外路线、备用钥匙。',
      '如果玩家本回合是在回复陈怀民、陌生号码或门外人，优先选择 message_reply，只承接对话，不要突然切到敲门、断电、脚步逼近。',
      '如果玩家已经有证据外传、官方核验、门窗防御较强，可以选择 retreat 或 framing_pressure，不要硬杀。',
      'title 要像章节小标题，短而有画面；rationale 写给调试看，说明为什么这一步合理；visibleToPlayer 只表示玩家能感知到外部现象。',
      '只输出 JSON，必须符合 KillerStrategySchema。',
    ].join('\n'),
    { visibleState: visible, allowedShape: fallback },
    { temperature: 0.55 },
  );
  const parsed = KillerStrategySchema.safeParse(ai);
  if (!parsed.success) throw new Error('killer strategy schema mismatch');
  return verifyKillerStrategy(state, parsed.data, blackboard);
  } catch (error) {
    blackboard.warnings.push(`killer strategy AI failed; using fallback strategy. ${error instanceof Error ? error.message : String(error)}`);
    return verifyKillerStrategy(state, fallback, blackboard);
  }
}

async function narrateActionForFrontend(context: NarrationContext, playerResult: RuleResult, killerResult: RuleResult, state: GameState, blackboard = createTurnBlackboard('', state)): Promise<Narration> {
  const system = [
      '你是《23:47》的“行动回应”作者。只写玩家这次动作的落地结果，不写下一波环境推进。',
      '你只能使用 narrationContext.events 里的事实。不要新增证据，不改变时间、生死、NPC 状态，不让角色突然进场。',
      '目标是让玩家感到输入被认真执行：动作顺序、物体变化、代价、遗漏和可利用信息都要具体。',
      '文风参考悬疑网文：段落有推进，句子有钩子，但不要中二，不要空喊恐惧。多写门锁、猫眼、手机冷光、纸箱气味、脚步距离、手上动作。',
      '可以有极短的第一人称反应，但不能替玩家悟出真相，不能泄露凶手内心。',
      '必须查看 narrationContext.recentLog，避免复述最近两回合已经出现过的短信问法、敲门借口和具体句子。',
      '220-520 个中文字符。只输出 JSON：{"title":"...","text":"..."}。',
    ].join('\n');
  const fallback = createFallbackActionNarration(playerResult);
  if (hasMessageReply(context)) {
    blackboard.warnings.push('action narrator bypassed for message_reply; deterministic action narration used to prevent cross-agent drift.');
    const narration = verifyNarration(fallback, fallback, blackboard, 'actionNarration');
    const score = await scoreNarrationWithDirector({ slot: 'action', narration, context, playerResult, killerResult, state });
    blackboard.directorScores.push(score);
    return narration;
  }

  const ai = await completeRoleJson(
    'narrator',
    system,
    { narrationContext: context, playerResult, killerResult, state },
    { temperature: 0.72 },
  ).catch(() => null);
  const parsed = NarrationSchema.safeParse(ai);
  let narration = parsed.success ? verifyNarration(parsed.data, fallback, blackboard, 'actionNarration') : fallback;
  if (!parsed.success) {
    blackboard.warnings.push('actionNarration AI failed schema validation; scored fallback narration instead.');
    blackboard.artifacts.actionNarration = fallback;
  }
  let score = await scoreNarrationWithDirector({ slot: 'action', narration, context, playerResult, killerResult, state });
  blackboard.directorScores.push(score);

  if (score.verdict === 'rewrite') {
    const rewrite = await completeRoleJson(
      'narrator',
      `${system}\n\n你正在根据剧情导演评分器重写。必须修复导演意见，不要解释重写过程。`,
      { narrationContext: context, playerResult, killerResult, state, previousNarration: narration, directorRewriteBrief: score.rewriteBrief },
      { temperature: 0.68 },
    ).catch(() => null);
    const reparsed = NarrationSchema.safeParse(rewrite);
    if (reparsed.success) {
      narration = verifyNarration(reparsed.data, fallback, blackboard, 'actionNarration');
      score = await scoreNarrationWithDirector({ slot: 'action', narration, context, playerResult, killerResult, state });
      blackboard.directorScores.push({ ...score, source: 'ai_rewrite' });
    }
  }

  return narration;
}

async function narrateAmbientForFrontend(context: NarrationContext, playerResult: RuleResult, killerResult: RuleResult, state: GameState, blackboard = createTurnBlackboard('', state)): Promise<Narration> {
  const system = [
      '你是《23:47》的“环境播报/暗线镜头”。只写门外、楼道、手机、时间、来电、灯光、窗外等环境变化。',
      '不要复述玩家动作细节，不要写玩家心理，不要解释凶手计划。你只呈现玩家能直接感知的现象。',
      '节奏要短促、有镜头感：每次只推进一个压力点。不要每回合都大爆发，安静、停顿、误导同样重要。',
      '语言要像悬疑网文的收尾钩子：具体、克制、最后一句压住下一步选择。',
      '必须查看 narrationContext.recentLog，避免复述最近两回合已经出现过的短信问法、敲门借口和具体句子。',
      '90-240 个中文字符。只输出 JSON：{"title":"...","text":"..."}。',
    ].join('\n');
  const fallback = createFallbackAmbientNarration(playerResult, killerResult);
  if (hasMessageReply(context)) {
    blackboard.warnings.push('ambient narrator bypassed for message_reply; deterministic ambient narration used to prevent invented footsteps or knocking.');
    const narration = verifyNarration(fallback, fallback, blackboard, 'ambientNarration');
    const score = await scoreNarrationWithDirector({ slot: 'ambient', narration, context, playerResult, killerResult, state });
    blackboard.directorScores.push(score);
    return narration;
  }

  const ai = await completeRoleJson(
    'narrator',
    system,
    { narrationContext: context, playerResult, killerResult, state },
    { temperature: 0.78 },
  ).catch(() => null);
  const parsed = NarrationSchema.safeParse(ai);
  let narration = parsed.success ? verifyNarration(parsed.data, fallback, blackboard, 'ambientNarration') : fallback;
  if (!parsed.success) {
    blackboard.warnings.push('ambientNarration AI failed schema validation; scored fallback narration instead.');
    blackboard.artifacts.ambientNarration = fallback;
  }
  let score = await scoreNarrationWithDirector({ slot: 'ambient', narration, context, playerResult, killerResult, state });
  blackboard.directorScores.push(score);

  if (score.verdict === 'rewrite') {
    const rewrite = await completeRoleJson(
      'narrator',
      `${system}\n\n你正在根据剧情导演评分器重写。必须修复导演意见，不要解释重写过程。`,
      { narrationContext: context, playerResult, killerResult, state, previousNarration: narration, directorRewriteBrief: score.rewriteBrief },
      { temperature: 0.72 },
    ).catch(() => null);
    const reparsed = NarrationSchema.safeParse(rewrite);
    if (reparsed.success) {
      narration = verifyNarration(reparsed.data, fallback, blackboard, 'ambientNarration');
      score = await scoreNarrationWithDirector({ slot: 'ambient', narration, context, playerResult, killerResult, state });
      blackboard.directorScores.push({ ...score, source: 'ai_rewrite' });
    }
  }

  return narration;
}

export async function frontendAdapterRoute(app: FastifyInstance) {
  app.post('/api/frontend/resolve-action', async (request) => {
    const body = request.body as { actionText?: string; coreState?: GameState };
    const actionText = body.actionText?.trim();
    const baseState = body.coreState ?? createInitialGameState();

    if (!actionText) {
      return {
        coreState: baseState,
        time: minuteLabel(baseState.minute),
        location: '青荷公寓 503室',
        phase: baseState.phase,
        clues: baseState.clues.map((id) => ({ id, name: id, description: '线索已记录。', status: 'known' })),
        storyLog: [] satisfies FrontendStoryNode[],
        actionConfirmation: null,
      };
    }

    const beforeLogLength = baseState.log.length;
    const blackboard = createTurnBlackboard(actionText, baseState);
    const resolution = await resolveTurn(baseState, actionText, {
      parseAction: (input, state) => parseActionForFrontend(input, state, blackboard),
      chooseKillerStrategy: (state, plan) => chooseKillerStrategyForFrontend(state, plan, blackboard),
      narrateAction: (context, playerResult, killerResult, state) => narrateActionForFrontend(context, playerResult, killerResult, state, blackboard),
      narrateAmbient: (context, playerResult, killerResult, state) => narrateAmbientForFrontend(context, playerResult, killerResult, state, blackboard),
    });
    const finalState = resolution.finalState;
    const newNodes = finalState.log.slice(beforeLogLength).map(toFrontendNode);
    const endingEntry = finalState.ending ? finalState.log[finalState.log.length - 1] : null;
    const deathMethod = finalState.ending
      ? ({
          default_murder: '锁芯轻响，门缝里的光先于脚步进入房间。',
          opened_to_fake_police: '你给了门缝，对方给了一个足够近的假身份。',
          window_route_death: '窗外雨棚成了第二条入口，门不是唯一边界。',
          hidden_inside_death: '你以为房间里只剩自己，呼吸声却从更近的地方响起。',
          framed_survivor: '你活了下来，但证据的位置开始替别人说话。',
          escaped_without_truth: '你离开了房间，真相却还留在 503。',
          survived_with_evidence: '录音、照片和官方回拨把房间从孤岛变成现场。',
          perfect_truth: '证据链闭合之前，陈怀民已经没有下一句借口。',
        } as Record<string, string>)[finalState.ending]
      : null;

    return {
      coreState: finalState,
      time: minuteLabel(finalState.minute),
      location: '青荷公寓 503室',
      phase: finalState.phase,
      clues: finalState.clues.map((id, index) => ({
        id,
        name: clueBook[id]?.title ?? id,
        description: clueBook[id]?.detail ?? '线索已记录，详情由右侧情报面板继续扩展。',
        status: index === finalState.clues.length - 1 ? 'new' : 'known',
      })),
      storyLog: [
        {
          id: `input-${Date.now()}`,
          type: 'player_input',
          content: actionText,
        },
        ...newNodes,
      ] satisfies FrontendStoryNode[],
      actionConfirmation: null,
      ending: finalState.ending,
      deathTitle: finalState.phase === 'death' ? endingEntry?.title ?? '23:47' : null,
      deathSummary: finalState.phase === 'death' ? endingEntry?.text ?? null : null,
      deathMethod,
      score: finalState.score,
      coordination: {
        warnings: blackboard.warnings,
        facts: blackboard.facts,
        directorScores: blackboard.directorScores,
      },
    };
  });
}
