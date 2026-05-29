import { DEADLINE_MINUTE, type GameState } from '@murder-loop-ai/shared';

export function updateKillerKnowledgeFromState(state: GameState) {
  const packageState = state.room.package?.state;
  const doorState = state.room.front_door?.state;
  const windowState = state.room.window?.state;

  state.killerKnowledge.knowsDoorBarricaded = Boolean(doorState?.barricaded) || state.killerKnowledge.knowsDoorBarricaded;
  state.killerKnowledge.knowsWindowLocked = Boolean(windowState?.locked) && state.killerKnowledge.suspectsPlayerIsAlert;
  state.killerKnowledge.knowsPlayerOpenedPackage = packageState?.opened ? true : state.killerKnowledge.knowsPlayerOpenedPackage;
  state.killerKnowledge.knowsPlayerPhotographedPackage = state.killerKnowledge.knowsPlayerPhotographedPackage || state.threat > 72;
}

export function projectKillerVisibleState(state: GameState) {
  return {
    minute: state.minute,
    phase: state.phase,
    threat: state.threat,
    killerPhase: state.killerPhase,
    policePhase: state.policePhase,
    linYuePhase: state.killerKnowledge.knowsPlayerContactedLinYue ? state.linYuePhase : 'unknown',
    minutesToDeadline: Math.max(0, DEADLINE_MINUTE - state.minute),
    knowledge: state.killerKnowledge,
  };
}
