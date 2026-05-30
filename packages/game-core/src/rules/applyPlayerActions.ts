import { clueBook } from '@murder-loop-ai/content';
import { DEADLINE_MINUTE, type ActionPlan, type GameState, type RuleResult, type StoryLogEntry } from '@murder-loop-ai/shared';
import { cloneGameState } from '../state/createInitialState';
import { scoreRun } from '../scoring/scoreRun';
import { event } from '../narration/buildNarrationContext';

function addClue(state: GameState, added: string[], clueId: string) {
  if (!state.clues.includes(clueId)) {
    state.clues.push(clueId);
    added.push(clueId);
  }
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function calculateTurnTime(actions: ActionPlan['actions']) {
  if (actions.length === 0) return 1;
  const onlyWaiting = actions.every((action) => action.intent === 'wait');
  if (onlyWaiting) return 1;
  const complexity = actions.reduce((sum, action) => sum + Math.max(1, Math.min(action.timeCost || 1, 2)), 0);
  return clamp(Math.ceil(complexity / 2), 1, 3);
}

function extractReplyText(raw: string) {
  const quoted = raw.match(/[“"']([^”"']+)[”"']/)?.[1]?.trim();
  if (quoted) return quoted;
  return raw
    .replace(/我(回了|回复|回)他[:：]?/g, '')
    .replace(/(回消息|回短信|回复消息|回复短信|打字回复)[:：]?/g, '')
    .trim();
}

function pushEntry(state: GameState, result: Omit<RuleResult, 'state'>) {
  const entry: StoryLogEntry = {
    id: `log-${state.run}-${state.minute}-${Math.random().toString(36).slice(2, 8)}`,
    run: state.run,
    minute: state.minute,
      title: result.title,
      text: result.text,
      tone: result.tone,
      channel: result.tone === 'system' ? 'system' : 'action',
    };
  state.log.push(entry);
}

function markEnding(state: GameState, ending: NonNullable<GameState['ending']>, title: string, text: string): RuleResult {
  state.ending = ending;
  state.phase = ending.includes('survived') || ending === 'perfect_truth' || ending === 'escaped_without_truth' || ending === 'framed_survivor' ? 'survived' : 'death';
  state.score = scoreRun(state);
  const result = { title, text, tone: state.phase === 'death' ? 'death' : 'win', addedClues: [], timePassed: 0, threatDelta: 0, events: [event('ending', ending, text, [title])] } as Omit<RuleResult, 'state'>;
  
  return { ...result, state };
}

export function applyPlayerActions(current: GameState, plan: ActionPlan): RuleResult {
  const state = cloneGameState(current);
  const addedClues: string[] = [];
  let complexityCost = 0;
  let threatDelta = 0;
  const texts: string[] = [];
  let title = '行动开始';
  let tone: RuleResult['tone'] = 'neutral';

  if (state.ending) {
    return { title: '循环已经结束', text: '这一轮已经抵达结局。', tone: 'system', addedClues, timePassed: 0, threatDelta, events: [event('ending', 'loop', '这一轮已经抵达结局。')], state };
  }

  for (const action of plan.actions) {
    complexityCost += action.timeCost;
    threatDelta += Math.max(0, action.noise - 1);
    state.player.stress = clamp(state.player.stress + (action.risk === 'high' ? 8 : action.risk === 'medium' ? 3 : 1));

    switch (action.intent) {
      case 'inspect':
        if (action.target === 'package') {
          state.room.package.inspected = true;
          state.room.package.state.opened = true;
          state.evidencePhase = 'package_opened';
          state.killerKnowledge.knowsPlayerOpenedPackage = 'uncertain';
          addClue(state, addedClues, 'wrong_package');
          title = '包裹不是我的';
          tone = 'clue';
          texts.push(`检查包裹：纸箱已被拖到台灯下；旧书、药板和数字纸条暴露；新增线索：${clueBook.wrong_package.title}。`);
        } else if (action.target === 'front_door') {
          state.room.front_door.inspected = true;
          state.room.front_door.state.scratched = true;
          addClue(state, addedClues, 'door_scratch');
          title = '锁芯有划痕';
          tone = 'clue';
          texts.push('检查门锁：锁芯旁有新划痕，边缘发亮，像刚被工具碰过。');
        } else if (action.target === 'window') {
          state.room.window.inspected = true;
          state.room.window.state.checked = true;
          title = '窗外是雨棚';
          tone = 'clue';
          texts.push('检查窗户：窗外有雨棚，位置接近窗沿；窗锁需要确认。');
        } else if (action.target === 'room') {
          state.room.closet.state.checked = true;
          state.room.bed.state.checkedUnder = true;
          title = '房间被重新看见';
          texts.push('检查房间：床底、衣柜和卫生间门缝被确认；暂未发现屋内藏人。');
        }
        break;
      case 'preserve_evidence':
        state.room.package.state.photographed = true;
        state.room.package.state.backedUp = action.raw.includes('备份') || action.raw.includes('云盘') || action.raw.includes('上传') || action.raw.includes('定时');
        state.evidencePhase = state.linYuePhase === 'received_photo' ? 'evidence_shared' : state.room.package.state.backedUp ? 'evidence_backed_up' : 'package_photographed';
        addClue(state, addedClues, 'package_photo');
        title = '照片留下来了';
        tone = 'clue';
        texts.push('保存证据：快递面单、旧书、药板和数字纸条被拍照；快门声已尽量压低。');
        break;
      case 'communicate':
        if (action.target === 'linyue') {
          state.linYuePhase = state.evidencePhase === 'package_photographed' || state.evidencePhase === 'evidence_backed_up' || state.room.package.state.photographed ? 'received_photo' : 'worried';
          state.killerKnowledge.knowsPlayerContactedLinYue = action.noise > 0 && state.killerKnowledge.suspectsPlayerIsAlert;
          if (state.linYuePhase === 'received_photo') addClue(state, addedClues, 'linyue_has_photo');
          title = '林越收到消息';
          texts.push('联系林越：照片/信息已发送；林越回复会在楼下报警，不上楼。');
        } else if (action.target === 'chen_huaimin') {
          state.suspicion = clamp(state.suspicion + 10);
          state.killerKnowledge.suspectsPlayerIsAlert = true;
          addClue(state, addedClues, 'chen_probe');
          title = '房东在试探';
          tone = 'threat';
          const replyText = extractReplyText(action.raw);
          texts.push(`联系陈怀民：你把“${replyText}”发了出去；这次回合只确认这句回复已经送达，不替你补出额外动作。`);
        }
        break;
      case 'deceive':
        state.suspicion = clamp(state.suspicion + 6);
        state.killerKnowledge.suspectsPlayerIsAlert = true;
        addClue(state, addedClues, 'chen_probe');
        title = '假装不知道';
        tone = 'threat';
        texts.push('伪装无知：对外表现为刚醒、没处理包裹；陈怀民暂停追问，但疑心上升。');
        break;
      case 'record':
        state.room.phone.state.recording = true;
        addClue(state, addedClues, 'recording_pressure');
        title = '录音红点亮起';
        tone = 'clue';
        texts.push('录音开启：手机开始保存室内和门外声音，麦克风位置已避开遮挡。');
        break;
      case 'secure_entry':
        if (action.target === 'front_door') {
          state.room.front_door.state.locked = true;
          state.room.front_door.state.chainLocked = true;
          state.room.front_door.state.barricaded = true;
          state.room.chair.state.movedToDoor = true;
          state.killerKnowledge.suspectsPlayerIsAlert = action.noise >= 2 || state.killerKnowledge.suspectsPlayerIsAlert;
          state.killerKnowledge.knowsDoorBarricaded = action.noise >= 2;
          title = '门被临时加固';
          texts.push('加固门：门锁、门链、椅子和行李箱形成临时阻挡；拖动家具产生轻微噪音。');
        } else if (action.target === 'window') {
          state.room.window.state.locked = true;
          state.room.window.state.curtainClosed = true;
          title = '窗帘合上';
          texts.push('处理窗户：窗锁扣紧，窗帘拉严；雨棚路线暂时被挡住视线。');
        } else if (action.target === 'phone') {
          state.room.phone.state.muted = true;
          state.room.phone.state.dimmed = action.raw.includes('暗') || action.raw.includes('亮度');
          state.room.phone.state.lightsOff = action.raw.includes('关灯') || action.raw.includes('灯关');
          texts.push('处理手机：铃声和震动关闭，屏幕亮度压低，暴露风险下降。');
        }
        break;
      case 'hide_evidence':
        state.room.package.state.hiddenAt = action.target === 'bathroom' ? 'bathroom' : 'inside_room';
        state.evidencePhase = 'evidence_hidden';
        title = '证据被藏起';
        texts.push('隐藏证据：包裹位置改变；短期可拖延搜找，但现场痕迹增加。');
        break;
      case 'call_police':
        state.policePhase = 'dispatch_pending';
        state.killerKnowledge.knowsPoliceCalled = action.noise > 0 || state.killerKnowledge.suspectsPlayerIsAlert;
        title = '报警不是终点';
        tone = 'clue';
        texts.push('报警：110 已接通；地址、当前处境和门窗状态被告知接线员。');
        break;
      case 'verify_identity':
        state.policePhase = state.policePhase === 'not_contacted' ? 'verifying_report' : 'real_police_en_route';
        addClue(state, addedClues, 'police_verified');
        title = '先核实，再决定';
        tone = 'clue';
        texts.push('核实身份：要求对方报单位和警号，并等待官方回拨确认。');
        break;
      case 'open_door':
        state.room.front_door.state.opened = true;
        if (state.phase === 'false_police_arrived' || state.threat >= 55) {
          return markEnding(state, 'opened_to_fake_police', '门缝已经够宽', '我只把门开了一条缝。下一秒，黑手套从缝里伸进来，动作快得不像临时起意。对方没有再伪装声音，掌心准确压住我的口鼻。我闻到雨水、皮革和某种很淡的消毒水味，才明白所谓“警察”只是他选中的一张脸。');
        }
        title = '门开了一条缝';
        threatDelta += 18;
        texts.push('打开门：门缝被主动让出，近距离接触风险急剧上升。');
        break;
      case 'self_care':
        title = '厨房灯没有打开';
        tone = 'neutral';
        state.player.stress = clamp(state.player.stress - 5);
        state.killerKnowledge.suspectsPlayerIsAlert = state.killerKnowledge.suspectsPlayerIsAlert || action.noise >= 2;
        texts.push('自我调整：短暂喝水/进食，动作压低；压力略微下降，但时间继续推进。');
        break;
      case 'wait':
        title = '雨声变清楚';
        texts.push('等待观察：保持原位，降低主动暴露；继续监听门外和楼道变化。');
        break;
      default:
        title = '暂时按兵不动';
        texts.push('未识别的自由动作：未改变关键状态；保持当前位置并重新评估门、窗、手机和证据。');
        break;
    }
  }

  const timePassed = calculateTurnTime(plan.actions);
  const compressedTime = complexityCost > timePassed;

  state.minute += timePassed;
  state.threat = clamp(state.threat + threatDelta + (state.minute >= DEADLINE_MINUTE - 10 ? 4 : 0));

  if (state.minute >= DEADLINE_MINUTE && !state.ending) {
    const hasEvidence = state.clues.includes('package_photo') && (state.clues.includes('linyue_has_photo') || state.room.phone.state.recording || state.room.package.state.backedUp);
    const hasDefense = Boolean(state.room.front_door.state.barricaded) && Boolean(state.room.window.state.locked);
    const policeTrusted = state.policePhase === 'real_police_en_route' || state.clues.includes('police_verified');

    if (hasEvidence && hasDefense && policeTrusted) {
      return markEnding(state, 'survived_with_evidence', '23:47 没有吞掉我', '电子钟跳到 23:47 的时候，我几乎不敢眨眼。门外的人没有等到我开门，锁芯也没有再转动。录音、照片和官方回拨把这间屋子从孤岛变成了现场。我还活着，但我知道这不只是因为运气——是因为这一轮，我终于把证据送出了房间。');
    }

    return markEnding(state, 'default_murder', '23:47', '电子钟跳到 23:47。门外的人不再敲门，锁芯却轻轻响了一声。我那一瞬间才明白，自己还是慢了一步：证据没有送到足够远的地方，门窗也没有把危险挡在外面。黑暗从门缝里挤进来，像上一轮死亡时一样熟悉。');
  }

  if (state.policePhase === 'dispatch_pending' && state.clues.includes('police_verified') && state.clues.includes('package_photo')) {
    state.policePhase = 'real_police_en_route';
  }

  state.phase = state.minute >= DEADLINE_MINUTE - 5
    ? 'pre_2347_countdown'
    : state.policePhase !== 'not_contacted'
      ? 'police_called'
      : state.threat >= 48
        ? 'killer_pressure'
        : 'investigating';

  const result = {
    title,
    text: texts.join('\n\n') || '我把这个想法压低到一次可执行的动作。房间仍旧安静，但安静本身也在变化。窗外的雨、门外的走廊、手机屏幕上没有发出的消息，都像在等我做下一个决定。',
    tone,
    addedClues,
    timePassed,
    threatDelta,
    events: [
      event('action', 'player', plan.summary || '玩家执行了一组行动', texts.slice(0, 3)),
      ...addedClues.map((clueId) => event('clue', clueId, `新增线索：${clueId}`, [], 'player')),
      event('state_change', 'time', compressedTime ? '一连串动作被压缩在短短几分钟内完成；电子钟只往后跳了一小格。' : '墙上的电子钟往后跳了一小段；走廊里的动静比刚才更靠近房门。', ['电子钟', '走廊声']),
    ],
  } satisfies Omit<RuleResult, 'state'>;
  if (state.room.phone?.state) {
    const perMin = state.room.phone.state.recording ? 3 : 1.5;
    const bat: number = (state.room.phone.state as any).battery ?? 60;
    (state.room.phone.state as any).battery = Math.max(0, bat - Math.round(perMin * timePassed));
  }
  pushEntry(state, result);
  return { ...result, state };
}
