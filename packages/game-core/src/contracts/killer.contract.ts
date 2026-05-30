import { z } from 'zod';
import type { ArtifactContract } from './ArtifactContract';

export const killerStrategySchema = z.object({
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
    'message_reply',
    'wait_for_fatigue',
    'retreat',
  ]),
  title: z.string(),
  rationale: z.string(),
  responseHint: z.string().optional(),
  visibleToPlayer: z.boolean(),
  risk: z.enum(['low', 'medium', 'high']),
});

export const killerInputSchema = z.object({
  state: z.any(),
  plan: z.any().optional(),
  playerResult: z.any().optional(),
});

export const killerContract: ArtifactContract = {
  version: '1.0.0',
  input: killerInputSchema as ArtifactContract['input'],
  output: killerStrategySchema as ArtifactContract['output'],
  validate: true,
};
