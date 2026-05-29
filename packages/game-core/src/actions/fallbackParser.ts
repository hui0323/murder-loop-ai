import type { ActionIntent, ActionPlan, ActionTarget, ParsedAction } from '@murder-loop-ai/shared';

const includesAny = (text: string, words: string[]) => words.some((word) => text.includes(word));
const includesOpenDoorNegation = (text: string) =>
  includesAny(text, [
    '不开门',
    '不要开门',
    '别开门',
    '不能开门',
    '先不开门',
    '暂不开门',
    '不直接开门',
    '不要直接开门',
    '不打开门',
    '不要打开门',
    '不给他开门',
    '绝不开门',
    '不让他进来',
    '别让他进来',
    '不要让他进来',
  ]);

function normalize(input: string) {
  return input.toLowerCase().replace(/\s+/g, '').replace(/[，。！？、,.!?]/g, '');
}

function createAction(raw: string, intent: ActionIntent, target: ActionTarget, method: string, confidence: number, timeCost: number, noise: number, risk: ParsedAction['risk']): ParsedAction {
  return {
    id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    raw,
    intent,
    target,
    method,
    confidence,
    timeCost,
    noise,
    risk,
  };
}

export function fallbackParseAction(input: string): ActionPlan {
  const raw = input.trim();
  const text = normalize(raw);
  const actions: ParsedAction[] = [];
  const warnings: string[] = [];

  if (!raw) {
    actions.push(createAction('沉默等待', 'wait', 'self', '保持安静并倾听门外变化', 0.8, 3, 0, 'medium'));
  }

  if (includesAny(text, ['包裹', '纸箱', '快递', '旧书', '药盒'])) {
    const intent: ActionIntent = includesAny(text, ['藏', '水箱', '卫生间', '放到'])
      ? 'hide_evidence'
      : includesAny(text, ['拍照', '拍下来', '照片', '发给', '备份'])
        ? 'preserve_evidence'
        : 'inspect';
    actions.push(createAction(raw, intent, 'package', intent === 'hide_evidence' ? '处理包裹位置' : '检查或保存包裹信息', 0.86, 3, 1, 'medium'));
  }

  if (includesAny(text, ['拍照', '拍下来', '照片', '备份', '上传', '云盘', '定时发送'])) {
    actions.push(createAction(raw, 'preserve_evidence', 'phone', '拍摄并保留证据', 0.88, 2, 0, 'low'));
  }

  if (includesAny(text, ['林越', '前男友', '发给他', '让他报警', '让他在楼下', '别上楼', '不要上楼', '短信'])) {
    actions.push(createAction(raw, 'communicate', 'linyue', '联系林越并传递外部任务', 0.88, 3, 0, 'medium'));
  }

  if (includesAny(text, ['报警', '110', '警察', '警方'])) {
    const intent: ActionIntent = includesAny(text, ['核实', '确认', '回拨', '警号', '真假']) ? 'verify_identity' : 'call_police';
    actions.push(createAction(raw, intent, 'police', intent === 'verify_identity' ? '核实警察身份' : '报警求助', 0.9, 4, 1, 'medium'));
  }

  if (includesAny(text, ['录音', '录像', '录下来', '打开录音', '拍视频'])) {
    actions.push(createAction(raw, 'record', 'phone', '打开手机录音或录像', 0.92, 1, 0, 'low'));
  }

  if (includesAny(text, ['静音', '勿扰', '关铃声', '不震动', '关灯', '灯关', '屏幕调暗', '降低亮度'])) {
    actions.push(createAction(raw, 'secure_entry', 'phone', '让手机保持安静', 0.84, 1, 0, 'low'));
  }

  if (includesAny(text, ['锁门', '反锁', '门链', '堵门', '抵住门', '顶住门', '椅子', '行李箱'])) {
    actions.push(createAction(raw, 'secure_entry', 'front_door', '加固门锁并尝试堵门', 0.92, 4, includesAny(text, ['轻轻', '小声', '尽量不要']) ? 1 : 3, 'medium'));
  }

  if (!includesOpenDoorNegation(text) && includesAny(text, ['开门', '打开门', '让他进来'])) {
    actions.push(createAction(raw, 'open_door', 'front_door', '打开入户门', 0.94, 1, 1, 'high'));
  }

  if (includesAny(text, ['猫眼', '看门外', '门外', '门缝', '门锁', '锁链', '链条'])) {
    actions.push(createAction(raw, 'inspect', 'front_door', '观察门外和门锁状态', 0.86, 2, 0, 'medium'));
  }

  if (includesAny(text, ['窗', '阳台', '窗帘', '雨棚', '窗台'])) {
    const intent: ActionIntent = includesAny(text, ['锁', '关上', '拉上']) ? 'secure_entry' : 'inspect';
    actions.push(createAction(raw, intent, 'window', intent === 'secure_entry' ? '锁窗并处理窗帘' : '检查窗户路线', 0.86, 3, 1, 'medium'));
  }

  if (includesAny(text, ['衣柜', '床底', '卫生间', '检查房间', '搜一遍', '通风口'])) {
    actions.push(createAction(raw, 'inspect', 'room', '检查可能藏人的位置', 0.82, 4, 2, 'medium'));
  }

  if (includesAny(text, ['房东', '陈怀民', '套话', '假装不知道', '问他'])) {
    actions.push(createAction(raw, includesAny(text, ['假装', '套话', '骗']) ? 'deceive' : 'communicate', 'chen_huaimin', '与房东通话并控制信息暴露', 0.87, 4, 0, 'high'));
  }

  if (includesAny(text, ['睡着', '装睡', '假装睡', '没拆', '不知道包裹'])) {
    actions.push(createAction(raw, 'deceive', 'chen_huaimin', '制造自己没有察觉包裹异常的假象', 0.82, 3, 0, 'medium'));
  }

  if (includesAny(text, ['吃', '吃点', '吃东西', '喝水', '倒水', '压惊', '缓一缓', '缓一下', '冷静', '镇定', '深呼吸'])) {
    actions.push(createAction(raw, 'self_care', 'self', '短暂补充体力并让自己冷静下来', 0.78, 4, 1, 'medium'));
  }

  if (includesAny(text, ['等', '等待', '听', '安静', '不动'])) {
    actions.push(createAction(raw, 'wait', 'self', '等待并倾听变化', 0.75, 3, 0, 'medium'));
  }

  if (actions.length === 0) {
    actions.push(createAction(raw, 'wait', 'self', '把这个想法压低成一次谨慎的停顿和观察', 0.46, 3, 0, 'medium'));
    warnings.push('这个行动比较开放，当前版本会先按谨慎观察处理。');
  }

  const confidence = actions.reduce((sum, action) => sum + action.confidence, 0) / actions.length;

  return {
    id: `plan-${Date.now()}`,
    raw,
    summary: actions.map((action) => action.method).join('；'),
    actions: actions.slice(0, 6),
    confidence,
    warnings,
  };
}
