import type { NarrationContext, RuleEvent, RuleResult } from '@murder-loop-ai/shared';

export function event(kind: RuleEvent['kind'], subject: string, summary: string, sensoryHints: string[] = [], visibility: RuleEvent['visibility'] = 'player'): RuleEvent {
  return { kind, subject, summary, sensoryHints, visibility };
}

export function mergeEvents(...results: Array<Pick<RuleResult, 'events'>>): RuleEvent[] {
  return results.flatMap((result) => result.events);
}

export function buildNarrationContext(playerResult: RuleResult, killerResult: RuleResult, playerActionSummary: string): NarrationContext {
  const state = killerResult.state;

  return {
    run: state.run,
    minute: state.minute,
    turnIndex: state.log.length,
    playerActionSummary,
    events: mergeEvents(playerResult, killerResult),
    stateSnapshot: {
      phase: state.phase,
      killerPhase: state.killerPhase,
      policePhase: state.policePhase,
      linYuePhase: state.linYuePhase,
      evidencePhase: state.evidencePhase,
      threat: state.threat,
      suspicion: state.suspicion,
      injury: state.player.injury,
      stress: state.player.stress,
      clues: state.clues,
      ending: state.ending,
    },
    forbiddenFacts: [
      '不要新增房间里不存在的人或物。',
      '不要让警察、林越或凶手突然进入现场，除非事件中明确发生。',
      '不要改变死亡、生还、证据、时间和 NPC 状态。',
      '不要透露主角无法看见或合理推断的凶手内心。',
      '不要替玩家写心理感受、内心独白、恐惧、担忧、领悟或判断。',
      '不要写“我害怕”“我明白”“我意识到”“我感觉”“我知道他在想什么”。',
      '不要照抄规则 fallback 文本。',
    ],
    styleGuide: [
      '第一人称限知视角，但只呈现现实反馈，不替玩家思考。',
      '写可观察事实：声音、光线、位置、距离、物体状态、他人行为、时间变化。',
      '可以写身体外部动作：手停住、呼吸变浅、脚步后撤；不要解释心理原因。',
      '少用恐惧感、压迫感、危险感、可怕、绝望这类抽象词。',
      '每段推进一个明确变化，不要重复同一信息，不要总结主题。',
    ],
  };
}
