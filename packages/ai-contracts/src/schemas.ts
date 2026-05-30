import { z } from 'zod';

// ActionIntent 不做 enum 校验——AI 可以自由创造新的意图
export const ActionIntentSchema = z.string();

// ActionTarget 不做 enum 校验——AI 可以自由使用任何物品/目标
export const ActionTargetSchema = z.string();

export const ParsedActionSchema = z.object({
  id: z.string(),
  raw: z.string(),
  intent: ActionIntentSchema,
  target: ActionTargetSchema,
  method: z.string().optional(),
  confidence: z.number().min(0).max(1),
  timeCost: z.number().min(1).max(5),
  noise: z.number().min(0).max(10),
  risk: z.enum(['low', 'medium', 'high']),
});

export const ActionPlanSchema = z.object({
  id: z.string(),
  raw: z.string(),
  summary: z.string(),
  actions: z.array(ParsedActionSchema).min(1).max(8),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

export const KillerStrategySchema = z.object({
  id: z.string(),
  // Killer strategy type: AI 自由选择，不做 enum 限制
  type: z.string(),
  title: z.string(),
  rationale: z.string(),
  responseHint: z.string().optional(),
  visibleToPlayer: z.boolean(),
  risk: z.enum(['low', 'medium', 'high']),
});

export const RuleEventSchema = z.object({
  kind: z.enum(['action', 'clue', 'state_change', 'sound', 'message', 'threat', 'ending']),
  subject: z.string(),
  summary: z.string(),
  sensoryHints: z.array(z.string()),
  visibility: z.enum(['player', 'killer', 'hidden']),
});

export const NarrationContextSchema = z.object({
  run: z.number(),
  minute: z.number(),
  turnIndex: z.number(),
  playerActionSummary: z.string(),
  events: z.array(RuleEventSchema),
  stateSnapshot: z.object({
    phase: z.string(),
    killerPhase: z.string(),
    killerStatus: z.string(),
    policePhase: z.string(),
    linYuePhase: z.string(),
    evidencePhase: z.string(),
    threat: z.number(),
    suspicion: z.number(),
    injury: z.string(),
    stress: z.number(),
    clues: z.array(z.object({
      id: z.string(),
      title: z.string(),
      detail: z.string(),
      source: z.string(),
      weight: z.number(),
      discoveredAt: z.object({ run: z.number(), minute: z.number() }),
      isPersistent: z.boolean(),
    })),
    ending: z.string().nullable(),
    phoneBattery: z.number().optional(),
    phoneFunctional: z.boolean().optional(),
    playerHolding: z.string().nullable().optional(),
    combatTriggered: z.boolean().optional(),
  }),
  recentLog: z.array(z.object({
    minute: z.number(),
    title: z.string(),
    text: z.string(),
    channel: z.string().optional(),
  })).optional(),
  knownClueTitles: z.array(z.string()).optional(),
  combatContext: z.object({
    playerWeapon: z.string().nullable(),
    killerArmed: z.boolean(),
    advantage: z.enum(['player', 'killer', 'mutual']),
  }).optional(),
  plotPhase: z.string().optional(),
  playerSituation: z.string().optional(),
  forbiddenFacts: z.array(z.string()),
  styleGuide: z.array(z.string()),
});

export const NpcReplySchema = z.object({
  speaker: z.enum(['linyue', 'police_dispatch', 'chen_huaimin']),
  text: z.string().min(1).max(800),
  intent: z.string(),
  riskWarning: z.string(),
  suggestedExternalAction: z.string(),
});

export const EndingIdSchema = z.enum([
  'default_murder',
  'opened_to_fake_police',
  'window_route_death',
  'hidden_inside_death',
  'framed_survivor',
  'escaped_without_truth',
  'survived_with_evidence',
  'perfect_truth',
  'killer_dead_with_evidence',
  'killer_dead_no_evidence',
  'killer_arrested',
  'killer_fled',
  'mutual_kill',
  'phone_dead_helpless',
  'suicide',
]);

export const NarrationSchema = z.object({
  title: z.string().min(1).max(24),
  text: z.string().min(1).max(1200),
  ending: EndingIdSchema.optional(),
  isFatal: z.boolean().optional(),
  killerKilled: z.boolean().optional(),
  clue: z.object({
    id: z.string(),
    title: z.string(),
    detail: z.string(),
    weight: z.number().min(1).max(20),
  }).optional(),
});

export const ScoreRecapSchema = z.object({
  total: z.number().min(0).max(100),
  rank: z.enum(['S', 'A', 'B', 'C', 'D', 'F']),
  survival: z.number().min(0).max(20),
  truth: z.number().min(0).max(20),
  evidence: z.number().min(0).max(20),
  npc: z.number().min(0).max(15),
  injury: z.number().min(0).max(10),
  riskControl: z.number().min(0).max(15),
  notes: z.array(z.string()),
});

export type ParsedActionContract = z.infer<typeof ParsedActionSchema>;
export type ActionPlanContract = z.infer<typeof ActionPlanSchema>;
export type KillerStrategyContract = z.infer<typeof KillerStrategySchema>;
export type RuleEventContract = z.infer<typeof RuleEventSchema>;
export type NarrationContextContract = z.infer<typeof NarrationContextSchema>;
export type NpcReplyContract = z.infer<typeof NpcReplySchema>;
export type NarrationContract = z.infer<typeof NarrationSchema>;
export type ScoreRecapContract = z.infer<typeof ScoreRecapSchema>;
