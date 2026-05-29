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
  const ai = await completeRoleJson(
    'parse',
    [
      '你是《23:47》行动解析 AI。玩家用自然语言写一组求生动作，你要把它拆成可裁判的 JSON。',
      '第一原则：尊重否定词和条件词。“不开门/不要开门/别让他进来”绝不能解析成 open_door；“如果对方身份核实失败就不开门”也不是 open_door。',
      '只解析玩家明确要做的事，不替玩家补全聪明操作，不制造事实，不判断生死。',
      '复杂输入拆成 1-6 个动作，顺序保持玩家原意。每个动作给出 intent、target、method、timeCost、noise、risk、confidence。',
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
}

async function chooseKillerStrategyForFrontend(state: GameState, blackboard = createTurnBlackboard('', state)): Promise<KillerStrategy> {
  const visible = projectKillerVisibleState(state);
  const fallback = chooseFallbackKillerStrategy(state);
  const ai = await completeRoleJson(
    'killer',
    [
      '你是《23:47》的暗线导演，只负责陈怀民与楼道环境的下一步压力，不写小说正文。',
      '你只能看 visibleState。玩家没有暴露的位置、证据备份、心理活动、房内细节，你都不知道。不要全知反制。',
      '陈怀民是谨慎的现实罪犯：怕监控、怕录音、怕目击、怕真警察。他优先试探、欺骗、拖延、切断信息，而不是无脑冲门。',
      '节奏要像悬疑网文：一小步一小步收紧。低压用短信/轻敲/静默；中压用房东借口/断电/伪回拨；高压才考虑假警察、窗外路线、备用钥匙。',
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
}

async function narrateActionForFrontend(context: NarrationContext, playerResult: RuleResult, killerResult: RuleResult, state: GameState, blackboard = createTurnBlackboard('', state)): Promise<Narration> {
  const system = [
      '你是《23:47》的“行动回应”作者。只写玩家这次动作的落地结果，不写下一波环境推进。',
      '你只能使用 narrationContext.events 里的事实。不要新增证据，不改变时间、生死、NPC 状态，不让角色突然进场。',
      '目标是让玩家感到输入被认真执行：动作顺序、物体变化、代价、遗漏和可利用信息都要具体。',
      '文风参考悬疑网文：段落有推进，句子有钩子，但不要中二，不要空喊恐惧。多写门锁、猫眼、手机冷光、纸箱气味、脚步距离、手上动作。',
      '可以有极短的第一人称反应，但不能替玩家悟出真相，不能泄露凶手内心。',
      '220-520 个中文字符。只输出 JSON：{"title":"...","text":"..."}。',
    ].join('\n');
  const fallback = createFallbackActionNarration(playerResult);
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
      '90-240 个中文字符。只输出 JSON：{"title":"...","text":"..."}。',
    ].join('\n');
  const fallback = createFallbackAmbientNarration(playerResult, killerResult);
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
      chooseKillerStrategy: (state) => chooseKillerStrategyForFrontend(state, blackboard),
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
