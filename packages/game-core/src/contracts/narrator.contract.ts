import { z } from 'zod';
import type { ArtifactContract } from './ArtifactContract';

export const narrationSchema = z.object({
  title: z.string(),
  text: z.string(),
});

export const narratorInputSchema = z.object({
  plan: z.any(),
  playerResult: z.any(),
  killerResult: z.any(),
  state: z.any(),
  narrationContext: z.any().optional(),
});

export const narrationPairSchema = z.object({
  actionNarration: narrationSchema,
  ambientNarration: narrationSchema,
});

export const narratorContract: ArtifactContract = {
  version: '1.0.0',
  input: narratorInputSchema as ArtifactContract['input'],
  output: narrationPairSchema as ArtifactContract['output'],
  validate: true,
};
