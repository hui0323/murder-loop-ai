import type { GameState, RuleResult } from '@murder-loop-ai/shared';
import { cloneGameState } from '../state/createInitialState';
import { event } from '../narration/buildNarrationContext';
import { scoreRun } from '../scoring/scoreRun';

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function advanceAmbientTurn(current: GameState): RuleResult {
  const state = cloneGameState(current);
  const timePassed = 3;
  const threatDelta = state.threat >= 55 ? 9 : state.threat >= 42 ? 6 : 3;

  state.minute += timePassed;
  state.threat = clamp(state.threat + threatDelta);
  state.player.stress = clamp(state.player.stress + 2);

  const noEvidenceShared = !state.room.package.state.backedUp && !state.clues.includes('linyue_has_photo') && !state.room.phone.state.recording;
  const noDefense = !state.room.front_door.state.barricaded && !state.room.window.state.locked;

  if (state.threat >= 76 && noDefense && noEvidenceShared) {
    state.ending = 'default_murder';
    state.phase = 'death';
    state.score = scoreRun(state);
    const result = {
      title: '门锁打开',
      text: '无行动后果：门窗没有加固，证据没有送出。锁芯被打开，屋内边界失效。',
      tone: 'death',
      addedClues: [],
      timePassed,
      threatDelta,
      events: [
        event('ending', 'default_murder', '长时间无行动后，凶手完成进入；本轮死亡。', ['锁芯转动', '门缝进光']),
      ],
    } satisfies Omit<RuleResult, 'state'>;

    return { ...result, state };
  }

  state.phase = state.policePhase !== 'not_contacted' ? 'police_called' : state.threat >= 48 ? 'killer_pressure' : 'investigating';

  const result = {
    title: '时间继续走',
    text: '环境推进：没有新的主动动作；楼道、电器底噪、雨声和远处脚步继续变化。',
    tone: state.threat >= 55 ? 'threat' : 'neutral',
    addedClues: [],
    timePassed,
    threatDelta,
    events: [
      event('action', 'player', '没有新的主动行动，当前位置和已有布置保持不变。', ['没有新的主动动作']),
      event('sound', 'apartment', '楼道、电器底噪、雨声和远处脚步继续变化，部分声音接近 503。', ['雨声', '楼道底噪', '远处脚步']),
      event('threat', 'killer_pressure', noDefense ? '门锁和窗沿没有形成有效阻挡；门外的试探声停得更短，位置更近。' : '已有防御挡住入口测试；门外的人暂时换到走廊另一侧，脚步没有离开这一层。', ['门锁', '窗沿', '走廊']),
      event('state_change', 'time', '电子钟的分钟数往后跳；房间里的光线和门外的脚步间隔都变了。', ['电子钟', '室内光线', '脚步间隔']),
    ],
  } satisfies Omit<RuleResult, 'state'>;

  return { ...result, state };
}
