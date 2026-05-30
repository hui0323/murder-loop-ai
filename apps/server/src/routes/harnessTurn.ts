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
// Plot Director — 上帝视角，评估剧情并指导下一步走向
// ============================================================================

interface PlotGuidance {
  phase: string;           // 当前剧情阶段: 'opening' | 'rising_tension' | 'climax' | 'resolution'
  progress: string;        // 一行总结：故事已经走到了哪里
  stuck: boolean;          // 剧情是否卡住了
  stuckReason: string;     // 如果卡住了，原因是什么
  nextDirection: string;   // 下一回合叙事应该朝什么方向发展（1-2句话）
  killerDirective: string; // 杀手下一步应该做什么
  missedOpportunities: string[]; // 玩家错过的线索或行动机会（可以自然提示的）
}

async function directPlot(state: GameState): Promise<PlotGuidance | null> {
  try {
    const recentEvents = state.log.slice(-6).map(l => `${l.channel}: ${l.title} — ${l.text.slice(0, 100)}`).join('\n');
    const system = [
      '你是剧情导演。评估当前故事状态，给出下一步指引。',
      '',
      '【故事设定】',
      '主角沈知夏，青荷公寓503室。房东陈怀民是毒品转运链关键人物。',
      '她误收了装有毒品的包裹。陈怀民要在23:47前确认包裹去向并灭口。',
      '这是一个悬疑生存故事，核心是证据/逃生/真相的博弈。',
      '',
      '【当前状态】',
      `时间: 23:${String(state.minute % 60).padStart(2, '0')} | 第${state.run}轮`,
      `杀手状态: ${state.killerStatus} | 威胁值: ${state.threat}`,
      `手机电量: ${state.phoneBattery}分钟 | 手机可用: ${state.phoneFunctional}`,
      `已有线索: ${state.clues.map(c => c.title).join('、') || '无'}`,
      `玩家状况: injury=${state.player.injury}, stress=${state.player.stress}`,
      `最近事件:\n${recentEvents}`,
      '',
      '输出 JSON:',
      '{"phase":"opening|rising_tension|climax|resolution","progress":"故事走到了X","stuck":true/false,"stuckReason":"","nextDirection":"叙事应该走向X（1-2句话）","killerDirective":"杀手下一步做什么","missedOpportunities":[]}',
      '',
      '判断标准:',
      '- stuck=true: 故事循环重复、无进展、玩家被困在同一场景3回合以上',
      '- 【节奏控制】悬疑游戏需要快速推进。3-5回合内必须有重大发展，8回合内应接近结局。不要让玩家磨蹭太久。',
      '- 如果玩家在同一个调查方向上花了3回合还没进展，直接给一个爆炸性的发现推剧情',
      '- nextDirection: 具体、可执行、推动调查。优先引导玩家发现线索、道具、环境细节',
      '- 【核心玩法】智斗悬疑，不是肉搏。引导玩家用道具、证据、欺骗和环境来智取杀手。',
      '- 肉搏是下下策，只在绝境时才建议。攻击类行动应带来高风险后果。',
      '- 玩家应该通过自己的调查和道具来解决问题。NPC只在玩家主动联系时才介入',
      '- 如果玩家离开了房间（去了手机店/楼下等），故事已超出原本边界。指引叙事灵活处理外部场景',
      '- 每回合给叙事AI的具体指引中，至少包含一个可发现的环境细节或可互动的物品',
    ].join('\n');

    const ai = await completeRoleJson('recap', system, { state: { minute: state.minute, phase: state.phase, clues: state.clues.map(c => c.title), log: state.log.slice(-8) } }, { temperature: 0.5 });
    if (!ai) return null;
    return {
      phase: (ai as any).phase || 'rising_tension',
      progress: (ai as any).progress || '',
      stuck: (ai as any).stuck || false,
      stuckReason: (ai as any).stuckReason || '',
      nextDirection: (ai as any).nextDirection || '',
      killerDirective: (ai as any).killerDirective || '',
      missedOpportunities: (ai as any).missedOpportunities || [],
    };
  } catch {
    return null;
  }
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
    '',
    '【硬规则——违反即失败】',
    '1. 禁止答非所问。动词必须映射到最接近的 intent：',
    '   追/冲/追上去/冲出门 → escape (target=front_door)',
    '   砍/杀/捅/刺/打/攻击/搏斗 → attack (target=chen_huaimin)',
    '   砸/殴打/揍 → attack',
    '   拿起/捡起/找到/翻出 → pick_up',
    '   用胶带/用急救包/充电/包扎 → use_item',
    '   绝不因"不确定"而选 wait。',
    '2. 尊重否定词。不开门/不要开门 → 绝不能解析成 open_door。',
    '3. 道具合理性：普通租客房间里不会有枪/炸弹/闪光弹。',
    '   如果玩家声称用枪/炸弹 → confidence < 0.3，warnings 注明"不合理道具"。',
    '   厨房刀/剪刀/台灯/雨伞 → 合理武器，正常解析。',
    '4. 只解析玩家明确要做的事，不替玩家补全操作，不制造事实。',
    '',
    '【优先智斗】玩家想设陷阱、用道具智取、误导杀手、制造假象时，用 deceive intent。不要什么都解析成 attack。',
    'intent 枚举值：inspect secure_entry record communicate call_police verify_identity deceive hide_evidence preserve_evidence open_door self_care wait escape attack pick_up use_item unknown',
    '',
    '输出 JSON（全部必填）：',
    '{"id":"xxx","raw":"玩家原文","summary":"一句话","actions":[{"id":"act-1","raw":"原文","intent":"枚举值","target":"目标","method":"方式","confidence":0.9,"timeCost":1,"noise":3,"risk":"low|medium|high"}],"confidence":0.9,"warnings":[]}',
    '可选字段：如果 attack intent 且有武器，加 "weaponId":"kitchen_knife" 到 action 上。',
    '如果 pick_up/use_item intent，加 "itemId":"tape" 到 action 上。',
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
  const killerStatusNote = state.killerStatus !== 'alive'
    ? `【重要】陈怀民当前状态：${state.killerStatus}。${state.killerStatus === 'injured' ? '他已受伤，策略应更加绝望或选择撤退。' : state.killerStatus === 'dead' ? '他已死亡，无法采取任何行动。选择 retreat。' : ''}`
    : '';
  const ai = await completeRoleJson('killer', [
    plotCtx,
    killerStatusNote,
    state.plotGuidance ? `【导演指引】${state.plotGuidance}` : '',
    '',
    '你是暗线导演，负责陈怀民与楼道环境的下一步压力推进。',
    '陈怀民是一个谨慎但越来越焦虑的现实罪犯。包裹证据足以毁掉他的转运链。',
    '',
    '【杀手状态约束】',
    '- alive: 正常策略选择，根据威胁值渐进施压',
    '- injured: 策略必须更激进或选择撤退——受伤的人不能再慢慢试探',
    '- dead/arrested/fled: 只能选择 retreat，陈怀民已无法行动',
    '',
    '可选策略（按推荐优先级）：spare_key_entry(备用钥匙强入)、window_route(窗外路线)、direct_confrontation(正面质问)、framing_pressure(证据施压)、fake_police(假警察)、landlord_excuse(房东借口)、phone_probe(短信试探)、message_reply(对话回复)、retreat(撤退)',
    '【禁止使用 power_cut——电表箱已经用烂了。用更直接的方式施压。】',
    '节奏要求：2-3回合内必须把威胁升级一级。不要磨蹭。陈怀民的时间也在流逝，23:47前必须解决。',
    '玩家连续闲置→直接 spare_key_entry 或 window_route。玩家在回复消息→优先 message_reply。',
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
  // 构建剧情上下文供叙事 AI 使用
  const plotCtx = [
    `剧情阶段：${context.plotPhase}`,
    `玩家处境：${context.playerSituation}`,
    `杀手状态：${state.killerStatus}（${state.killerStatus === 'alive' ? '活跃中' : state.killerStatus === 'dead' ? '已死亡' : state.killerStatus === 'injured' ? '已受伤' : state.killerStatus === 'fled' ? '已逃跑' : '其他'}）`,
    context.combatContext
      ? `战斗态势：玩家${context.combatContext.advantage === 'player' ? '占优' : context.combatContext.advantage === 'killer' ? '劣势' : '双方均势'}，手持${context.combatContext.playerWeapon || '徒手'}，杀手${context.combatContext.killerArmed ? '可能持有武器' : '未见武器'}`
      : '',
    `已知线索：${context.knownClueTitles.join('、') || '暂无'}`,
    `手机：${state.phoneFunctional ? `电量约${state.phoneBattery}分钟` : '已关机'}`,
  ].filter(Boolean).join('\n');

  const system = [
    '你是行动叙事 AI。你的核心任务不是写优美的景物描写，而是推进剧情。',
    '',
    '【硬规则——违反即失败】',
    '0. 玩家做了什么你就写什么。玩家说"看包裹"→写包裹里的东西。玩家说"看门外"→写门外。',
    '   绝不允许：玩家说"看包裹"，你却写"门外有人敲门"。这是最严重的错误。',
    '1. 答其所问：玩家做了 X，你必须写 X 的后果。不能写成 Y。',
    '   玩家说"冲出去"就写冲出房门，绝不能写"你停在原地"。',
    '2. 剧情推进：每段叙事必须让调查前进一步。线索→发现→推理→新问题。',
    '   【核心玩法】这是智斗悬疑游戏，不是格斗游戏。',
    '   玩家应该用智慧取胜：收集证据、设置陷阱、欺骗杀手、报警核实、巧妙逃脱。',
    '   肉搏是下下策——只有山穷水尽时才考虑。优先引导玩家用道具和环境智取。',
    '   【智斗手段】制造假象误导杀手、用镜子观察门外、设绊线拖延时间、',
    '   录音取证、拍照留证、用便签传递信息、触发火警制造混乱、伪装房间无人...',
    '   当玩家探索时，必须具体描述房间里有什么可用的东西：',
    '   厨房区：厨刀、剪刀、打火机、胶带、螺丝刀',
    '   书桌区：台灯、笔和便签、旧报纸',
    '   卫生间：急救包、镜子、清洁剂',
    '   衣柜：衣架（铁丝）、皮带、行李箱',
    '   门边：雨伞、充电器、门链',
    '   禁止"雨还在下""电子钟又跳了一格"这类零信息句子。',
    '3. 线索揭示：可选地自然引入 0-1 条新线索（在玩家当前行动和感知范围内）。',
    '   线索不能从天而降，必须基于当前情境自然出现。不重复已有线索。',
    '   如果引入线索，在 JSON 中加 clue 字段：',
    '   {"id":"ai_gen_xxx","title":"线索标题","detail":"具体描述","weight":10}',
    '4. 道具柔化：如果玩家声称使用不存在的武器（枪等），叙事自然揭示手边没有。',
    '   不硬拒绝，不假装有。用感官描写过渡：手指碰到空气/布料——什么都没有。',
    `【导演指引——必须遵守】${state.plotGuidance ? `\n${state.plotGuidance}` : '\n故事处于开局阶段。通过包裹/门外的线索自然引导玩家理解处境。'}`,
    plotCtx,
    '5. 战斗叙事：如果发生了攻击，描写动作的真实后果——伤害、血迹、反击、恐惧。',
    '   不美化暴力。保持悬疑紧张感。受伤的人会痛、会怕、会失误。',
    '6. 【完成动作】玩家发起了一个行动，你必须写完它的直接后果。',
    '   不要在半空中断——如果玩家挥拳，就写拳头的落点和对方的反应；',
    '   如果窗锁被撬开，就写窗户到底被推开没有、进来了什么、或者玩家做了什么应对。',
    '   每个场景必须有一个"落点"——哪怕结果是负面的，也要写完整。',
    '7. 严格基于 events 里的内容。不编造玩家没做的事。不替玩家写心理独白或判断。',
    '8. 【生死判定——你来决定】如果玩家的行为会导致死亡（被捅、被勒、坠楼、失血等），',
    '   或者杀手在场景中被致命攻击，你有权在 JSON 中设定结局：',
    '   玩家死亡 → 加 "isFatal": true',
    '   杀手死亡 → 加 "killerKilled": true',
    '   不要让玩家在明显已经死了的情况下还能继续操作。',
    '9. 文风：第一人称限知视角，写可观察事实（声音/光线/距离/动作），不写"我害怕"。',
    '   220-520 中文字符。只输出 JSON：{"title":"...","text":"..."}。',
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
  const ambientContext = [
    `杀手状态：${state.killerStatus}`,
    state.killerStatus === 'dead' ? '外部世界正在失去控制者的痕迹——楼道声控灯再没人去触发，门缝下不再有影子移动。' : '',
    state.killerStatus === 'injured' ? '地板上有血迹/挣扎痕迹，楼道里的动静变得不稳定。' : '',
    state.killerStatus === 'fled' ? '楼梯间传来仓促撤离的痕迹——急促的脚步、被撞翻的东西。' : '',
    `手机：${state.phoneFunctional ? `电量${state.phoneBattery}分钟` : '已关机，屏幕最后一次闪烁后彻底黑了下去'}`,
  ].filter(Boolean).join(' ');

  const system = [
    '你是环境播报/暗线镜头。只写门外、楼道、手机、窗外等外部变化。',
    '',
    '【硬规则】',
    '1. 每次必须推进一个明确的外部事件。禁止"一切安静"。禁止零信息描写。',
    '2. 基于 killerResult.events 写环境推进。一个事件 + 一个具体后果 + 一个钩子。',
    '3. 杀手状态决定环境基调：',
    '   alive → 写逼近感：脚步声、试探、越来越近的东西',
    '   injured → 写混乱：血迹、不稳的动静、挣扎痕迹',
    '   dead → 写突然的安静和控制者的缺席：没人再去触发的声控灯、停在某个位置的影子',
    '   fled → 写仓促撤离的痕迹：脚步声向下远去、撞翻的垃圾桶',
    '4. 手机没电时 → 写孤立感："屏幕最后一次闪烁后彻底黑了下去"',
    '5. 【绝对禁止】不要写电表箱、供电中断、灯光闪烁、电压不稳。这些已经用过太多次了。',
    '   找新的环境事件：水管声、隔壁动静、楼下对讲机、窗外车灯、手机信号干扰、对讲机杂音...',
    '6. 最后一句留钩子。让玩家想知道接下来会怎样。',
    '7. 90-240 中文字符。只输出 JSON：{"title":"...","text":"..."}。',
    '',
    ambientContext,
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
  return state.clues.map((clue, i) => ({
    id: clue.id,
    name: clue.title,
    description: clue.detail,
    status: (i === state.clues.length - 1 ? 'new' : 'known') as 'new' | 'known',
    source: clue.source,
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
    const rawState = body.state ?? createInitialGameState();

    // 死亡状态自动回退——无论有没有输入，先复活
    let state = rawState;
    if (rawState.phase === 'death' || (rawState.ending && rawState.phase !== 'loop_started')) {
      const { rewindAfterDeath } = await import('@murder-loop-ai/game-core');
      state = rewindAfterDeath(rawState);
    }

    if (!input) {
      return {
        coreState: state, time: minuteLabel(state.minute), location: '青荷公寓 503 室',
        phase: state.phase, clues: toFrontendClues(state),
        storyLog: [] satisfies FrontendStoryNode[],
        coordination: { warnings: [], trace: [], judgements: {} },
      };
    }

    const harness = createAiHarness();

    const recap = generateRecap(state);

    const beforeLen = state.log.length;
    const resolution = await resolveTurnHarness(state, input, harness);

    // ---- AI 生死判定：叙事 AI 说了算，规则引擎只执行 ----
    if (!resolution.finalState.ending) {
      const fatalNarration = resolution.actionNarration?.isFatal || resolution.ambientNarration?.isFatal;
      const killerDeadByAI = resolution.actionNarration?.killerKilled || resolution.ambientNarration?.killerKilled;
      if (fatalNarration) {
        resolution.finalState.ending = 'default_murder';
        resolution.finalState.phase = 'death';
        resolution.finalState.log.push({
          id: `ai-death-${Date.now()}`,
          run: resolution.finalState.run,
          minute: resolution.finalState.minute,
          title: resolution.actionNarration?.title || '死亡',
          text: resolution.actionNarration?.text || '一切归于黑暗。',
          tone: 'death',
          channel: 'action',
        });
      }
      if (killerDeadByAI && resolution.finalState.killerStatus === 'alive') {
        resolution.finalState.killerStatus = 'dead';
        resolution.finalState.combatTriggered = true;
      }
      // AI 动态线索提取——叙事 AI 在 JSON 中附带的线索自动加入 state
      for (const narration of [resolution.actionNarration, resolution.ambientNarration]) {
        if (narration?.clue && !resolution.finalState.clues.some(c => c.id === narration.clue!.id)) {
          resolution.finalState.clues.push({
            id: narration.clue.id,
            title: narration.clue.title,
            detail: narration.clue.detail,
            source: 'ai_generated',
            weight: narration.clue.weight,
            discoveredAt: { run: resolution.finalState.run, minute: resolution.finalState.minute },
            isPersistent: true,
          });
        }
      }
    }

    const sidebarAgent = harness.registry.getAgent('sidebar');
    const sidebar = sidebarAgent
      ? await harness.registry.runFallback(sidebarAgent, { finalState: resolution.finalState, moodSignal: undefined })
      : null;

    const endingEntry = resolution.finalState.ending ? resolution.finalState.log[resolution.finalState.log.length - 1] : null;
    const deathMethod = resolution.finalState.ending
      ? ({ default_murder: '锁芯轻响，门缝里的光先于脚步进入房间。', opened_to_fake_police: '你给了门缝。', window_route_death: '雨棚比想象中更滑。', hidden_inside_death: '呼吸声从更近的地方响起。', framed_survivor: '证据替别人说话。', escaped_without_truth: '真相留在503。', survived_with_evidence: '房间从孤岛变成现场。', perfect_truth: '证据链闭合。', killer_dead_with_evidence: '刀落在瓷砖上。证据比你更早抵达外面。', killer_dead_no_evidence: '陈怀民不再动了——但你没有证据证明他该死。', killer_arrested: '警笛声由远及近。这一次，戴上手铐的是他。', killer_fled: '脚步声向下远去，消失在雨里。他逃了，但你也安全了。', mutual_kill: '两具身体倒在走廊里。23:47还没到，但503已经空了。', phone_dead_helpless: '屏幕黑了。在这个时间点，没有手机意味着什么都做不了。' } as Record<string, string>)[resolution.finalState.ending] : null;

    const trace = harness.dispatcher.getTrace().map(e => ({
      taskId: e.eventType, source: e.source, warnings: e.warnings, durationMs: e.durationMs,
    }));

    // Plot Director: 评估当前剧情，生成下一回合的指导（异步，不影响本次返回）
    const plotGuidance = directPlot(resolution.finalState).catch(() => null);
    // 同时把 guidance 存入 finalState，供前端下次请求时使用
    const guidanceResult = await plotGuidance;
    if (guidanceResult) {
      resolution.finalState.plotGuidance = [
        `剧情阶段: ${guidanceResult.phase} | ${guidanceResult.progress}`,
        `下一步: ${guidanceResult.nextDirection}`,
        `杀手行动: ${guidanceResult.killerDirective}`,
        guidanceResult.stuck ? `⚠ 卡住了: ${guidanceResult.stuckReason}` : '',
        guidanceResult.missedOpportunities.length ? `可提示线索: ${guidanceResult.missedOpportunities.join('; ')}` : '',
      ].filter(Boolean).join('\n');
    }

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
