import type { GameState, KillerStrategy } from '@murder-loop-ai/shared';

export function chooseFallbackKillerStrategy(state: GameState): KillerStrategy {
  const k = state.killerKnowledge;

  if (state.ending) {
    return {
      id: `killer-${Date.now()}`,
      type: 'retreat',
      title: '对抗结束',
      rationale: '这一轮已经结束。',
      visibleToPlayer: false,
      risk: 'low',
    };
  }

  if (state.policePhase !== 'not_contacted' && !state.clues.includes('police_verified') && state.threat >= 55) {
    return {
      id: `killer-${Date.now()}`,
      type: 'fake_callback',
      title: '伪造回拨',
      rationale: '玩家已经等待官方核验，陈怀民尝试抢先制造一个假的权威声音。',
      visibleToPlayer: true,
      risk: 'high',
    };
  }

  if (state.linYuePhase === 'received_photo' && state.threat >= 45) {
    return {
      id: `killer-${Date.now()}`,
      type: 'lure_linyue',
      title: '引林越上楼',
      rationale: '外部联系人已经介入，陈怀民会尝试把外部支援变成新的弱点。',
      visibleToPlayer: true,
      risk: 'high',
    };
  }

  if (state.threat >= 52 && !state.room.phone.state.muted) {
    return {
      id: `killer-${Date.now()}`,
      type: 'power_cut',
      title: '电表箱响了一下',
      rationale: '玩家还依赖手机和灯光，陈怀民可以先制造环境失控。',
      visibleToPlayer: true,
      risk: 'medium',
    };
  }

  if (state.threat >= 58 && state.player.stress >= 35) {
    return {
      id: `killer-${Date.now()}`,
      type: 'wait_for_fatigue',
      title: '长时间沉默',
      rationale: '玩家精神压力升高时，等待本身也能成为攻击策略。',
      visibleToPlayer: false,
      risk: 'medium',
    };
  }

  if (state.policePhase !== 'not_contacted' && !state.clues.includes('police_verified')) {
    return {
      id: `killer-${Date.now()}`,
      type: 'fake_police',
      title: '假警察抢先到场',
      rationale: '玩家已经报警但尚未核实身份，陈怀民会利用等待权威的心理。',
      visibleToPlayer: true,
      risk: 'high',
    };
  }

  if (k.knowsDoorBarricaded && !k.knowsWindowLocked) {
    return {
      id: `killer-${Date.now()}`,
      type: 'window_route',
      title: '窗外路线被考虑',
      rationale: '门被堵住后，陈怀民会寻找替代入口。',
      visibleToPlayer: false,
      risk: 'high',
    };
  }

  if (!k.suspectsPlayerIsAlert && state.minute < 23 * 60 + 28) {
    return {
      id: `killer-${Date.now()}`,
      type: 'phone_probe',
      title: '陌生号码试探',
      rationale: '陈怀民还不确定沈知夏是否意识到包裹价值，先用电话试探。',
      visibleToPlayer: true,
      risk: 'medium',
    };
  }

  if (state.threat >= 64 && !state.room.front_door.state.barricaded) {
    return {
      id: `killer-${Date.now()}`,
      type: 'spare_key_entry',
      title: '备用钥匙靠近锁芯',
      rationale: '门没有形成有效阻挡，陈怀民可能直接使用备用钥匙。',
      visibleToPlayer: true,
      risk: 'high',
    };
  }

  if (state.clues.includes('package_photo') && !state.clues.includes('linyue_has_photo')) {
    return {
      id: `killer-${Date.now()}`,
      type: 'framing_pressure',
      title: '证据反成风险',
      rationale: '照片只在玩家手里，陈怀民可以制造玩家主动持有违禁物的压力。',
      visibleToPlayer: true,
      risk: 'medium',
    };
  }

  return {
    id: `killer-${Date.now()}`,
    type: 'landlord_excuse',
    title: '房东借口靠近',
    rationale: '温和试探仍然是低风险方式。',
    visibleToPlayer: true,
    risk: 'medium',
  };
}
