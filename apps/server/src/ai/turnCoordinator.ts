import type { ActionPlan, GameState, KillerStrategy, Narration, ParsedAction } from '@murder-loop-ai/shared';

export interface TurnBlackboard {
  input: string;
  warnings: string[];
  facts: {
    beforeMinute: number;
    beforePhase: GameState['phase'];
    beforeThreat: number;
    knownClues: string[];
  };
  artifacts: {
    actionPlan?: ActionPlan;
    killerStrategy?: KillerStrategy;
    actionNarration?: Narration;
    ambientNarration?: Narration;
  };
  directorScores: DirectorScore[];
}

const forbiddenMetaWords = ['ActionPlanSchema', 'KillerStrategySchema', 'NarrationSchema', 'fallback', 'GameState', 'threatDelta', 'timePassed'];

export interface DirectorScore {
  slot: 'action' | 'ambient';
  total: number;
  pace: number;
  infoSafety: number;
  ruleConsistency: number;
  prose: number;
  verdict: 'pass' | 'rewrite';
  issues: string[];
  rewriteBrief: string;
  source: 'heuristic' | 'ai' | 'ai_rewrite';
}

export function createTurnBlackboard(input: string, state: GameState): TurnBlackboard {
  return {
    input,
    warnings: [],
    facts: {
      beforeMinute: state.minute,
      beforePhase: state.phase,
      beforeThreat: state.threat,
      knownClues: [...state.clues],
    },
    artifacts: {},
    directorScores: [],
  };
}

function normalized(text: string) {
  return text.toLowerCase().replace(/\s+/g, '').replace(/[，。！？、,.!?]/g, '');
}

function hasOpenDoorNegation(input: string) {
  const text = normalized(input);
  return [
    '不开门',
    '不要开门',
    '别开门',
    '不能开门',
    '先不开门',
    '暂不开门',
    '不直接开门',
    '不要直接开门',
    '不打开门',
    '不要打开门',
    '不给他开门',
    '绝不开门',
    '不让他进来',
    '别让他进来',
    '不要让他进来',
  ].some((word) => text.includes(word));
}

function hasSelfInjuryCheck(input: string) {
  const text = normalized(input);
  const bodyCue = /后脑勺|后脑|脑勺|头部|额头|脖子|身体|身上|伤口|伤|血|流血|出血|疼|痛/.test(text);
  const checkCue = /摸|检查|确认|看看|查看|碰|按|擦|处理|包扎/.test(text);
  return bodyCue && checkCue;
}

function planAlreadyHandlesSelfCare(plan: ActionPlan) {
  return plan.actions.some((action) => action.intent === 'self_care' && action.target === 'self');
}

function repairSelfInjuryCheck(input: string, plan: ActionPlan, blackboard: TurnBlackboard): ActionPlan {
  if (!hasSelfInjuryCheck(input) || planAlreadyHandlesSelfCare(plan)) return plan;

  blackboard.warnings.push('action plan verifier repaired a self-injury check that was parsed as a passive action.');
  const selfCareAction: ParsedAction = {
    id: `repair-self-care-${Date.now()}`,
    raw: input,
    intent: 'self_care',
    target: 'self',
    method: '摸索后脑勺并检查是否有伤口、出血或明显疼痛',
    confidence: Math.max(plan.confidence, 0.82),
    timeCost: Math.max(1, Math.min(plan.actions[0]?.timeCost ?? 1, 2)),
    noise: Math.min(plan.actions[0]?.noise ?? 0, 1),
    risk: 'low',
  };

  return {
    ...plan,
    summary: '检查自己的伤口和身体状态',
    actions: [
      selfCareAction,
      ...plan.actions.filter((action) => action.intent !== 'wait' && action.intent !== 'unknown'),
    ].slice(0, 8),
    confidence: Math.max(plan.confidence, 0.82),
    warnings: [...plan.warnings, '系统已将检查自身伤口的输入修正为 self_care。'],
  };
}

export function verifyActionPlan(input: string, plan: ActionPlan, blackboard: TurnBlackboard): ActionPlan {
  plan = repairSelfInjuryCheck(input, plan, blackboard);

  if (!hasOpenDoorNegation(input)) {
    blackboard.artifacts.actionPlan = plan;
    return plan;
  }

  const filtered = plan.actions.filter((action) => action.intent !== 'open_door');
  if (filtered.length === plan.actions.length) {
    blackboard.artifacts.actionPlan = plan;
    return plan;
  }

  blackboard.warnings.push('行动解析验证器移除了与“不要开门”冲突的 open_door 动作。');
  const repaired: ActionPlan = {
    ...plan,
    summary: filtered.map((action) => action.method).join('；') || '保持门关闭并谨慎观察',
    actions: filtered.length ? filtered : [{
      id: `repair-${Date.now()}`,
      raw: input,
      intent: 'inspect',
      target: 'front_door',
      method: '保持门关闭，隔着猫眼观察门外',
      confidence: 0.72,
      timeCost: 2,
      noise: 0,
      risk: 'medium',
    }],
    warnings: [...plan.warnings, '系统已按“不要开门”的明确意图修正解析结果。'],
  };
  blackboard.artifacts.actionPlan = repaired;
  return repaired;
}

export function verifyKillerStrategy(state: GameState, strategy: KillerStrategy, blackboard: TurnBlackboard): KillerStrategy {
  const impossibleDirectEntry = strategy.type === 'spare_key_entry' && Boolean(state.room.front_door.state.barricaded);
  if (!impossibleDirectEntry) {
    blackboard.artifacts.killerStrategy = strategy;
    return strategy;
  }

  blackboard.warnings.push('凶手策略验证器降级了与当前门防御冲突的备用钥匙强入。');
  const repaired: KillerStrategy = {
    id: `repair-killer-${Date.now()}`,
    type: 'landlord_excuse',
    title: '门外换了借口',
    rationale: '门已形成明显阻挡，直接备用钥匙进入不够现实，改为低风险试探。',
    visibleToPlayer: true,
    risk: 'medium',
  };
  blackboard.artifacts.killerStrategy = repaired;
  return repaired;
}

export function verifyNarration(narration: Narration, fallback: Narration, blackboard: TurnBlackboard, slot: 'actionNarration' | 'ambientNarration'): Narration {
  const text = `${narration.title}\n${narration.text}`;
  const hasMetaLeak = forbiddenMetaWords.some((word) => text.includes(word));
  const hasInternalId = /\b[a-z]+_[a-z_]+\b/.test(text);

  if (!hasMetaLeak && !hasInternalId) {
    blackboard.artifacts[slot] = narration;
    return narration;
  }

  blackboard.warnings.push(`${slot} 验证器拦截了开发词或内部 id 泄漏，改用安全叙事。`);
  blackboard.artifacts[slot] = fallback;
  return fallback;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function heuristicDirectorScore(
  narration: Narration,
  slot: DirectorScore['slot'],
  contextText: string,
  source: DirectorScore['source'] = 'heuristic',
): DirectorScore {
  const text = `${narration.title}\n${narration.text}`;
  const compact = normalized(text);
  const issues: string[] = [];
  let pace = 86;
  let infoSafety = 92;
  let ruleConsistency = 92;
  let prose = 86;

  if (forbiddenMetaWords.some((word) => text.includes(word)) || /\b[a-z]+_[a-z_]+\b/.test(text)) {
    issues.push('叙事泄漏了开发词、schema 名或内部 id。');
    infoSafety -= 45;
    prose -= 25;
  }

  if (/规则|系统|判定|数值|接口|JSON|schema|AI/.test(text)) {
    issues.push('叙事出现了开发/系统视角词汇。');
    infoSafety -= 25;
    prose -= 20;
  }

  if (/我明白|我意识到|我知道他|他心里|凶手想|陈怀民心/.test(text)) {
    issues.push('叙事越过限知视角，替玩家或凶手解释心理。');
    infoSafety -= 22;
    ruleConsistency -= 15;
  }

  if (slot === 'action') {
    if (text.length < 120) {
      issues.push('行动回应太短，缺少动作落地和后果。');
      pace -= 18;
      prose -= 18;
    }
    if (text.length > 700) {
      issues.push('行动回应过长，影响回合节奏。');
      pace -= 20;
    }
    if (!/[门锁猫眼手机包裹窗楼道录音照片脚步]/.test(text)) {
      issues.push('行动回应缺少可感知物体或现场细节。');
      prose -= 16;
    }
  } else {
    if (text.length < 60) {
      issues.push('环境播报太短，压力点不足。');
      pace -= 15;
    }
    if (text.length > 320) {
      issues.push('环境播报过长，不像镜头切换。');
      pace -= 25;
    }
    if (/我先|我要|我把|玩家|动作/.test(text)) {
      issues.push('环境播报复述了玩家行动，应只写外部变化。');
      pace -= 15;
      prose -= 12;
    }
  }

  for (const phrase of ['陈怀民', '警察', '林越', '窗', '包裹']) {
    if (compact.includes(normalized(phrase)) && !normalized(contextText).includes(normalized(phrase))) {
      issues.push(`叙事提到了上下文事件中不明显支持的“${phrase}”。`);
      ruleConsistency -= 10;
    }
  }

  const total = clampScore(pace * 0.22 + infoSafety * 0.3 + ruleConsistency * 0.28 + prose * 0.2);
  return {
    slot,
    total,
    pace: clampScore(pace),
    infoSafety: clampScore(infoSafety),
    ruleConsistency: clampScore(ruleConsistency),
    prose: clampScore(prose),
    verdict: total < 78 ? 'rewrite' : 'pass',
    issues,
    rewriteBrief: issues.length
      ? `重写时修复：${issues.join(' ')}保持只使用规则事件，写得更具体、有镜头感。`
      : '质量达标，无需重写。',
    source,
  };
}
