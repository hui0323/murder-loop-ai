import type { ClueRecord } from '@murder-loop-ai/shared';

export const clueBook: Record<string, ClueRecord> = {
  wrong_package: {
    id: 'wrong_package',
    title: '标记模糊的包裹',
    detail: '包裹上的 5-03 / 503 标记很模糊，可能并不是寄给沈知夏。',
    source: '检查包裹',
    weight: 12,
  },
  package_photo: {
    id: 'package_photo',
    title: '包裹照片',
    detail: '沈知夏拍下了旧书、药盒和数字纸条。这是外部求救链的起点。',
    source: '拍照',
    weight: 16,
  },
  linyue_has_photo: {
    id: 'linyue_has_photo',
    title: '林越收到照片',
    detail: '林越成为包裹证据的外部备份，也因此可能被卷入风险。',
    source: '联系林越',
    weight: 14,
  },
  door_scratch: {
    id: 'door_scratch',
    title: '锁芯划痕',
    detail: '门锁边有新鲜划痕，说明有人尝试过进入。',
    source: '检查门锁',
    weight: 10,
  },
  recording_pressure: {
    id: 'recording_pressure',
    title: '录音里的停顿',
    detail: '录音记录到门外人在听见屋内动静后停顿，说明对方在试探沈知夏是否醒着。',
    source: '打开录音',
    weight: 12,
  },
  police_verified: {
    id: 'police_verified',
    title: '核实出警',
    detail: '通过官方渠道核实后，假警察话术的漏洞变得明显。',
    source: '核实警察身份',
    weight: 18,
  },
  chen_probe: {
    id: 'chen_probe',
    title: '房东试探包裹',
    detail: '陈怀民没有直接说包裹内容，只反复确认有没有“拿错东西”。',
    source: '与房东通话',
    weight: 14,
  },
};
