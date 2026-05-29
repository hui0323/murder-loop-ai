import { z } from 'zod';

export const ActionIntentSchema = z.enum([
  'inspect',
  'secure_entry',
  'record',
  'communicate',
  'call_police',
  'verify_identity',
  'deceive',
  'hide_evidence',
  'preserve_evidence',
  'open_door',
  'self_care',
  'wait',
  'escape',
  'unknown',
]);

export const ActionTargetSchema = z.enum([
  'package',
  'phone',
  'front_door',
  'window',
  'closet',
  'bed',
  'bathroom',
  'chair',
  'linyue',
  'chen_huaimin',
  'police',
  'room',
  'self',
  'unknown',
]);

export const ParsedActionSchema = z.object({
  id: z.string(),
  raw: z.string(),
  intent: ActionIntentSchema,
  target: ActionTargetSchema,
  method: z.string().optional(),
  confidence: z.number().min(0).max(1),
  timeCost: z.number().min(0).max(20),
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
  type: z.enum([
    'phone_probe',
    'soft_knock',
    'landlord_excuse',
    'fake_police',
    'spare_key_entry',
    'window_route',
    'framing_pressure',
    'power_cut',
    'lure_linyue',
    'fake_neighbor',
    'fake_callback',
    'wait_for_fatigue',
    'retreat',
  ]),
  title: z.string(),
  rationale: z.string(),
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
    policePhase: z.string(),
    linYuePhase: z.string(),
    evidencePhase: z.string(),
    threat: z.number(),
    suspicion: z.number(),
    injury: z.string(),
    stress: z.number(),
    clues: z.array(z.string()),
    ending: z.string().nullable(),
  }),
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

export const NarrationSchema = z.object({
  title: z.string().min(1).max(24),
  text: z.string().min(1).max(1200),
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
