import { z } from 'zod';
import type { ArtifactContract } from './ArtifactContract';

/**
 * Narrator Agent 的产物契约。
 * 输入：叙事上下文（玩家结果 + 凶手结果 + 游戏状态）
 * 输出：小说化的叙事文本
 */
export const narrationSchema = z.object({
  title: z.string().describe('叙事段落的标题'),
  text: z.string().describe('小说化的叙事正文'),
  tone: z
    .enum(['neutral', 'memory', 'clue', 'threat', 'death', 'win', 'system'])
    .describe('叙事语气'),
});

export const narratorInputSchema = z.object({
  context: z.any().describe('叙事上下文，包含玩家/凶手结果和游戏状态'),
  playerResult: z.any(),
  killerResult: z.any(),
  state: z.any(),
});

export const narratorContract: ArtifactContract = {
  version: '1.0.0',
  input: narratorInputSchema as ArtifactContract['input'],
  output: narrationSchema as ArtifactContract['output'],
  validate: true,
};
