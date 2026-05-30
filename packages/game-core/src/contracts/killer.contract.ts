import { z } from 'zod';
import type { ArtifactContract } from './ArtifactContract';

/**
 * Killer Agent 的产物契约。
 * 输入：当前游戏状态 + 玩家行动方案
 * 输出：凶手的对抗策略
 */
export const killerStrategySchema = z.object({
  type: z.enum([
    'wait',
    'text_probe',
    'soft_knock',
    'landlord_check',
    'fake_police_pressure',
    'spare_key_entry',
    'power_cut',
    'window_route',
    'lure_linyue',
    'retreat',
    'frame_player',
    'destroy_evidence',
    'message_reply',
  ]),
  priority: z.number().min(0).max(10).describe('策略优先级（0最低，10最高）'),
  description: z.string().describe('策略描述，供叙事AI使用'),
  events: z.array(z.string()).optional().describe('策略触发的具体事件'),
  knownInfo: z.array(z.string()).optional().describe('凶手制定此策略时所知的信息'),
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
