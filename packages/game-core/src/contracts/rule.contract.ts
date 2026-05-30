import { z } from 'zod';
import {
  ActionPlanSchema,
  KillerStrategySchema,
  RuleEventSchema,
} from '@murder-loop-ai/ai-contracts';
import type { ArtifactContract } from './ArtifactContract';

const gameStateSchema = z.object({
  run: z.number(),
  minute: z.number(),
  phase: z.string(),
  killerPhase: z.string(),
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
  clues: z.array(z.string()),
  room: z.record(z.string(), z.unknown()),
  killerKnowledge: z.record(z.string(), z.unknown()),
  memory: z.array(z.unknown()),
  log: z.array(z.unknown()),
  ending: z.string().nullable(),
  score: z.unknown().nullable(),
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
  addedClues: z.array(z.string()),
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
