import type { ActionPlan, GameState, KillerStrategy, Narration, NarrationContext, NpcReply, RuleResult } from '@murder-loop-ai/shared';

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`${url} failed: ${response.status}`);
  return (await response.json()) as T;
}

export const aiClient = {
  parseAction(input: string, state: GameState) {
    return postJson<ActionPlan>('/api/parse-action', { input, state });
  },
  chooseKillerStrategy(state: GameState) {
    return postJson<KillerStrategy>('/api/killer-strategy', { state });
  },
  narrate(context: NarrationContext, playerResult: RuleResult, killerResult: RuleResult, state: GameState) {
    return postJson<Narration>('/api/narrate', { context, playerResult, killerResult, state });
  },
  narrateAction(context: NarrationContext, playerResult: RuleResult, killerResult: RuleResult, state: GameState) {
    return postJson<Narration>('/api/narrate-action', { context, playerResult, killerResult, state });
  },
  narrateAmbient(context: NarrationContext, playerResult: RuleResult, killerResult: RuleResult, state: GameState) {
    return postJson<Narration>('/api/narrate-ambient', { context, playerResult, killerResult, state });
  },
  npcReply(speaker: NpcReply['speaker'], input: string, state: GameState) {
    return postJson<NpcReply>('/api/npc-reply', { speaker, input, state });
  },
};
