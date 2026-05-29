import type { ActionPlan, AmbientResolution, GameState, KillerStrategy, Narration, NarrationContext, TurnResolution } from '@murder-loop-ai/shared';
import { fallbackParseAction } from '../actions/fallbackParser';
import { applyPlayerActions } from '../rules/applyPlayerActions';
import { chooseFallbackKillerStrategy } from '../killer/fallbackStrategy';
import { applyKillerStrategy } from '../killer/applyKillerStrategy';
import { createFallbackActionNarration, createFallbackAmbientNarration, sanitizeNarration } from '../narration/fallbackNarration';
import { buildNarrationContext } from '../narration/buildNarrationContext';
import { advanceAmbientTurn } from '../ambient/advanceAmbientTurn';

export interface AiAdapters {
  parseAction?: (input: string, state: GameState) => Promise<ActionPlan>;
  chooseKillerStrategy?: (state: GameState) => Promise<KillerStrategy>;
  narrate?: (context: NarrationContext, playerResult: TurnResolution['playerResult'], killerResult: TurnResolution['killerResult'], state: GameState) => Promise<Narration>;
  narrateAction?: (context: NarrationContext, playerResult: TurnResolution['playerResult'], killerResult: TurnResolution['killerResult'], state: GameState) => Promise<Narration>;
  narrateAmbient?: (context: NarrationContext, playerResult: TurnResolution['playerResult'], killerResult: TurnResolution['killerResult'], state: GameState) => Promise<Narration>;
}

function replaceLogEntry(state: GameState, id: string | undefined, patch: Partial<GameState['log'][number]>) {
  if (!id) return;
  const index = state.log.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  state.log[index] = { ...state.log[index], ...patch };
}

export async function resolveTurn(state: GameState, input: string, aiAdapters: AiAdapters = {}): Promise<TurnResolution> {
  const plan = aiAdapters.parseAction ? await aiAdapters.parseAction(input, state).catch(() => fallbackParseAction(input)) : fallbackParseAction(input);
  const playerResult = applyPlayerActions(state, plan);
  const playerLogId = playerResult.state.log[playerResult.state.log.length - 1]?.id;

  const killerStrategy = playerResult.state.ending
    ? chooseFallbackKillerStrategy(playerResult.state)
    : aiAdapters.chooseKillerStrategy
      ? await aiAdapters.chooseKillerStrategy(playerResult.state).catch(() => chooseFallbackKillerStrategy(playerResult.state))
      : chooseFallbackKillerStrategy(playerResult.state);

  const killerResult = playerResult.state.ending ? { ...playerResult, text: '', title: '对抗结束', tone: 'system' as const, addedClues: [], timePassed: 0, threatDelta: 0, events: [] } : applyKillerStrategy(playerResult.state, killerStrategy);
  const killerLogId = playerResult.state.ending ? undefined : killerResult.state.log[killerResult.state.log.length - 1]?.id;
  const narrationContext = buildNarrationContext(playerResult, killerResult, plan.summary);
  const actionNarrator = aiAdapters.narrateAction ?? aiAdapters.narrate;
  const ambientNarrator = aiAdapters.narrateAmbient ?? aiAdapters.narrate;
  const rawActionNarration = actionNarrator
    ? await actionNarrator(narrationContext, playerResult, killerResult, killerResult.state).catch(() => createFallbackActionNarration(playerResult))
    : createFallbackActionNarration(playerResult);
  const rawAmbientNarration = playerResult.state.ending
    ? rawActionNarration
    : ambientNarrator
      ? await ambientNarrator(narrationContext, playerResult, killerResult, killerResult.state).catch(() => createFallbackAmbientNarration(playerResult, killerResult))
      : createFallbackAmbientNarration(playerResult, killerResult);
  const actionNarration = sanitizeNarration(rawActionNarration);
  const ambientNarration = sanitizeNarration(rawAmbientNarration);

  const finalState = { ...killerResult.state };
  replaceLogEntry(finalState, playerLogId, {
    title: actionNarration.title,
    text: actionNarration.text,
    isAiNarration: Boolean(actionNarrator),
    channel: 'action',
    tone: playerResult.tone,
  });
  replaceLogEntry(finalState, killerLogId, {
    title: ambientNarration.title,
    text: ambientNarration.text,
    isAiNarration: Boolean(ambientNarrator),
    channel: 'ambient',
    tone: killerResult.tone === 'death' ? 'death' : killerResult.tone,
  });

  return { plan, playerResult, killerStrategy, killerResult, narration: actionNarration, actionNarration, ambientNarration, finalState };
}

export async function resolveAmbientTurn(state: GameState, aiAdapters: Omit<AiAdapters, 'parseAction'> = {}): Promise<AmbientResolution> {
  const ambientResult = advanceAmbientTurn(state);
  const killerStrategy = ambientResult.state.ending
    ? chooseFallbackKillerStrategy(ambientResult.state)
    : aiAdapters.chooseKillerStrategy
      ? await aiAdapters.chooseKillerStrategy(ambientResult.state).catch(() => chooseFallbackKillerStrategy(ambientResult.state))
      : chooseFallbackKillerStrategy(ambientResult.state);

  const killerResult = ambientResult.state.ending ? { ...ambientResult, text: '', title: '对抗结束', tone: 'system' as const, addedClues: [], timePassed: 0, threatDelta: 0, events: [] } : applyKillerStrategy(ambientResult.state, killerStrategy);
  const narrationContext = buildNarrationContext(ambientResult, killerResult, '我暂时没有采取新行动，时间和环境继续推进');
  const ambientNarrator = aiAdapters.narrateAmbient ?? aiAdapters.narrate;
  const rawNarration = ambientNarrator
    ? await ambientNarrator(narrationContext, ambientResult, killerResult, killerResult.state).catch(() => createFallbackAmbientNarration(ambientResult, killerResult))
    : createFallbackAmbientNarration(ambientResult, killerResult);
  const narration = sanitizeNarration(rawNarration);

  const finalState = { ...killerResult.state };
  finalState.log = [
    ...finalState.log,
    {
      id: `ambient-log-${finalState.run}-${finalState.minute}-${Math.random().toString(36).slice(2, 8)}`,
      run: finalState.run,
      minute: finalState.minute,
      title: narration.title,
      text: narration.text,
      tone: killerResult.tone === 'death' ? 'death' : ambientResult.tone === 'threat' || killerResult.tone === 'threat' ? 'threat' : 'neutral',
      channel: 'ambient',
      isAiNarration: Boolean(ambientNarrator),
    },
  ];

  return { ambientResult, killerStrategy, killerResult, narration, finalState };
}

export { rewindAfterDeath } from './rewind';
