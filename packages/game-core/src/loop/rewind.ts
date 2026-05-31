import { firstDeathMemory } from '@murder-loop-ai/content';
import { START_MINUTE, type GameState } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { grantReviveProtection } from './reviveProtection';

export function rewindAfterDeath(state: GameState): GameState {
  // 优先查找对话检查点 — 如果玩家因致命行为死亡，复活到最近对话
  const conversationCheckpoint = [...state.memory]
    .reverse()
    .find((m) => m.id.startsWith('checkpoint-'));
  const lastMemory = state.memory.filter((m) => !m.id.startsWith('checkpoint-'));

  if (conversationCheckpoint) {
    // 对话节点复活：保留线索和记忆，延续对话
    const next = createInitialGameState();
    next.run = state.run + 1;
    next.memory = [
      ...lastMemory,
      {
        id: `memory-${state.run}`,
        run: state.run,
        title: state.log[state.log.length - 1]?.title || firstDeathMemory.title,
        text: state.log[state.log.length - 1]?.text || firstDeathMemory.text,
      },
    ].slice(-8);
    // 保留跨循环线索（isPersistent: true）
    next.clues = state.clues.filter(c => c.isPersistent);
    grantReviveProtection(next);
    next.log = [
      {
        id: `rewind-${next.run}`,
        run: next.run,
        minute: START_MINUTE,
        title: `第 ${next.run} 次醒来 — 对话锚点`,
        text: `电子钟回到 23:00。窗外的雨声和刚才没什么不同，但你清楚记得——死亡前最后一刻，你和外界还有联系。那个对话像一根锚，把你从坠落中拉了回来。`,
        tone: 'memory',
        channel: 'memory',
      },
    ];
    return next;
  }

  // 标准重启：从零开始，但保留跨循环线索
  const next = createInitialGameState();
  next.run = state.run + 1;
  next.memory = [
    ...lastMemory,
    {
      id: `memory-${state.run}`,
      run: state.run,
      title: state.log[state.log.length - 1]?.title || firstDeathMemory.title,
      text: state.log[state.log.length - 1]?.text || firstDeathMemory.text,
    },
  ].slice(-8);
  // 只保留跨循环标记的线索（AI 动态生成的线索通常 isPersistent: true）
  next.clues = state.clues.filter(c => c.isPersistent);
  grantReviveProtection(next);
  next.log = [
    {
      id: `rewind-${next.run}`,
      run: next.run,
      minute: START_MINUTE,
      title: `第 ${next.run} 次醒来`,
      text: state.clues.length > 0
        ? '雨声重新贴上窗户。电子钟回到 23:00。房间没有变，但上一轮发现的线索碎片还留在记忆里——像没做完的梦。'
        : '雨声重新贴上窗户。电子钟回到 23:00。房间没有变，但死亡前的声音留了下来：门锁、手机、旧书味，还有那句"东西呢？"。',
      tone: 'memory',
      channel: 'memory',
    },
  ];
  return next;
}
