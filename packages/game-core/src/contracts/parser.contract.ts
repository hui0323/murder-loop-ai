import { z } from 'zod';
import { ActionPlanSchema } from '@murder-loop-ai/ai-contracts';
import type { ArtifactContract } from './ArtifactContract';

/**
 * Parser Agent 的产物契约。
 * 输入：玩家自然语言 + 当前游戏状态
 * 输出：ActionPlan（由 @murder-loop-ai/ai-contracts 的 ActionPlanSchema 校验）
 */
export const parserContract: ArtifactContract = {
  version: '1.0.0',
  input: z.object({ input: z.string(), state: z.any() }) as ArtifactContract['input'],
  output: ActionPlanSchema as ArtifactContract['output'],
  validate: true,
};
