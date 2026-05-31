import type { GameState, NpcReply } from '@murder-loop-ai/shared';

export function fallbackNpcReply(speaker: NpcReply['speaker'], input: string, state: GameState): NpcReply {
  if (speaker === 'police_dispatch') {
    return {
      speaker,
      text: '接线员让我压低声音，确认门窗是否锁好。她没有让我开门，只重复了一遍：如果门外有人自称警察，也要等官方回拨核实。',
      intent: '稳定玩家并要求官方核验',
      riskWarning: state.policePhase === 'not_contacted' ? '还没有形成有效报警记录。' : '门外身份仍需核验。',
      suggestedExternalAction: '保持通话，等待官方渠道确认。',
    };
  }

  if (speaker === 'chen_huaimin') {
    return {
      speaker,
      text: '陈怀民的声音还是很平，问我是不是拿错了什么东西。他没有说包裹里有什么，只说如果不是我的，最好现在交出来，免得之后解释不清。',
      intent: '试探玩家是否掌握包裹内容',
      riskWarning: '继续通话可能暴露玩家已经警觉。',
      suggestedExternalAction: '不要承认已经打开或备份证据，尽量录音。',
    };
  }

  return {
    speaker: 'linyue',
    text: '林越很快回了消息。他没有打电话，只发来几行字：别开门，别让手机响。我不上楼，我去楼下找能拍到门口的位置，同时报警。你把照片再发我一遍。',
    intent: '提供外部支援但不上楼',
    riskWarning: state.linYuePhase === 'received_photo' ? '林越已经被卷入，不能让他靠近 503。' : '林越还没有拿到足够证据。',
    suggestedExternalAction: input.includes('上楼') ? '改为让林越留在楼下等待警察。' : '让林越备份照片并报警。',
  };
}
