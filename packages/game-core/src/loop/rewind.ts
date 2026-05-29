import { firstDeathMemory } from '@murder-loop-ai/content';
import { START_MINUTE, type GameState } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';

export function rewindAfterDeath(state: GameState): GameState {
  const next = createInitialGameState();
  next.run = state.run + 1;
  next.memory = [
    ...state.memory,
    {
      id: `memory-${state.run}`,
      run: state.run,
      title: state.log[state.log.length - 1]?.title || firstDeathMemory.title,
      text: state.log[state.log.length - 1]?.text || firstDeathMemory.text,
    },
  ].slice(-8);
  next.clues = state.clues.filter((id) => ['wrong_package', 'door_scratch', 'police_verified'].includes(id));
  next.log = [
    {
      id: `rewind-${next.run}`,
      run: next.run,
      minute: START_MINUTE,
      title: `第 ${next.run} 次醒来`,
      text: '雨声重新贴上窗户。电子钟回到 23:00。房间没有变，但死亡前的声音留了下来：门锁、手机、旧书味，还有那句“东西呢？”。',
      tone: 'memory',
      channel: 'memory',
    },
  ];
  return next;
}
