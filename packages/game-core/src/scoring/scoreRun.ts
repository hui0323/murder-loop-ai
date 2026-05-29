import type { GameState, ScoreResult } from '@murder-loop-ai/shared';

export function scoreRun(state: GameState): ScoreResult {
  const survived = state.ending !== null && !['default_murder', 'opened_to_fake_police', 'window_route_death', 'hidden_inside_death'].includes(state.ending);
  const survival = survived ? (state.player.injury === 'none' ? 20 : 12) : 0;
  const truth = Math.min(20, state.clues.filter((id) => ['wrong_package', 'chen_probe', 'police_verified', 'door_scratch'].includes(id)).length * 5);
  const evidence = Math.min(20, state.clues.filter((id) => ['package_photo', 'linyue_has_photo', 'recording_pressure'].includes(id)).length * 7);
  const npc = state.linYuePhase === 'dead' ? 0 : state.linYuePhase === 'injured' ? 6 : state.linYuePhase === 'safe' || state.linYuePhase === 'received_photo' ? 14 : 10;
  const injury = state.player.injury === 'none' ? 10 : state.player.injury === 'minor' ? 7 : state.player.injury === 'leg_injured' ? 4 : 2;
  const riskControl = Math.min(15, [state.room.front_door.state.barricaded, state.room.window.state.locked, state.clues.includes('police_verified')].filter(Boolean).length * 5);
  const total = survival + truth + evidence + npc + injury + riskControl;
  const rank = total >= 90 ? 'S' : total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 45 ? 'C' : total >= 25 ? 'D' : 'F';

  const notes: string[] = [];
  if (!survived) notes.push('这一轮没有活下来，但死亡会变成下一轮的情报。');
  if (!state.clues.includes('package_photo')) notes.push('缺少包裹照片，证据链很脆弱。');
  if (!state.clues.includes('police_verified')) notes.push('没有核实警察身份，假警察路线仍然危险。');
  if (state.clues.includes('linyue_has_photo')) notes.push('林越成为外部备份，但也要注意他的风险。');
  if (riskControl >= 10) notes.push('门窗防御处理得较好，凶手必须改变策略。');

  return { total, rank, survival, truth, evidence, npc, injury, riskControl, notes };
}
