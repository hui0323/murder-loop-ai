import { z } from 'zod';
import type { ArtifactContract } from './ArtifactContract';

/**
 * Director Agent 的产物契约。
 * 输入：叙事输出 + 游戏状态
 * 输出：评分结果 + 违规列表 + 氛围信号
 */
export const directorOutputSchema = z.object({
  score: z.object({
    /** 节奏控制（0-10），事件推进是否合理 */
    pacing: z.number().min(0).max(10),
    /** 信息泄露检查（0-10），越低=越严重的信息泄露 */
    infoLeak: z.number().min(0).max(10),
    /** 规则一致性（0-10），叙事是否遵守游戏事实 */
    ruleConsistency: z.number().min(0).max(10),
    /** 文笔质量（0-10），叙事是否生动、不过于机械 */
    prose: z.number().min(0).max(10),
  }),
  /** Phase 1 硬守卫是否通过 */
  passed: z.boolean(),
  /** 违规列表 */
  violations: z.array(z.string()),
  /** 氛围信号文本（给玩家的不破坏沉浸感的反馈） */
  moodSignal: z.string().optional(),
});

export const directorInputSchema = z.object({
  narration: z.any(),
  state: z.any(),
});

export const directorContract: ArtifactContract = {
  version: '1.0.0',
  input: directorInputSchema as ArtifactContract['input'],
  output: directorOutputSchema as ArtifactContract['output'],
  validate: true,
};
