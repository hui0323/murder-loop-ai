import { z } from 'zod';
import {
  ActionPlanSchema,
  KillerStrategySchema,
  RuleEventSchema,
} from '@murder-loop-ai/ai-contracts';
import type { ArtifactContract } from './ArtifactContract';

const clueRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  source: z.enum(['ai_generated', 'static_fallback', 'player_discovered']),
  weight: z.number(),
  discoveredAt: z.object({
    run: z.number(),
    minute: z.number(),
  }),
  isPersistent: z.boolean(),
});

const gameStateSchema = z.object({
  run: z.number(),
  minute: z.number(),
  phase: z.string(),
  killerPhase: z.string(),
  killerStatus: z.string(),
  policePhase: z.string(),
  linYuePhase: z.string(),
  evidencePhase: z.string(),
  threat: z.number(),
  suspicion: z.number(),
  player: z.object({
    injury: z.string(),
    stress: z.number(),
    hidden: z.boolean(),
  }),
  playerHolding: z.string().nullable(),
  combatTriggered: z.boolean(),
  clues: z.array(clueRecordSchema),
  room: z.record(z.string(), z.unknown()),
  killerKnowledge: z.record(z.string(), z.unknown()),
  memory: z.array(z.unknown()),
  log: z.array(z.unknown()),
  ending: z.string().nullable(),
  score: z.unknown().nullable(),
  phoneBattery: z.number(),
  phoneFunctional: z.boolean(),
});

const ruleInputSchema = z.union([
  z.object({
    plan: ActionPlanSchema,
    state: gameStateSchema,
  }),
  z.object({
    killerStrategy: KillerStrategySchema,
    playerResult: z.unknown(),
    state: gameStateSchema,
  }),
]);

const ruleResultSchema = z.object({
  title: z.string(),
  text: z.string(),
  tone: z.enum(['neutral', 'memory', 'clue', 'threat', 'death', 'win', 'system']),
  addedClues: z.array(clueRecordSchema),
  timePassed: z.number(),
  threatDelta: z.number(),
  events: z.array(RuleEventSchema),
  state: gameStateSchema,
});

export const ruleContract: ArtifactContract = {
  version: '1.0.0',
  input: ruleInputSchema as ArtifactContract['input'],
  output: ruleResultSchema as ArtifactContract['output'],
  validate: true,
};
