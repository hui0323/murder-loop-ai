import { GameState } from '../types';

export const INITIAL_STATE: GameState = {
  time: '23:00',
  location: '青荷公寓 503室',
  phase: 'intro',
  isParsing: false,
  isParsingAction: false,
  actionConfirmation: null,
  coordination: { warnings: [], directorScores: [] },
  ending: null,
  deathTitle: null,
  deathSummary: null,
  deathMethod: null,
  clues: [
    {
      id: 'c1',
      name: '奇怪的包裹',
      description: '写着模糊的 "5-03"，里面是一本被掏空的旧书。',
      status: 'new',
    }
  ],
  storyLog: [
    {
      id: 'msg-0',
      type: 'system',
      content: '系统初始化完成。循环载入。',
    },
    {
      id: 'msg-1',
      type: 'narrative',
      content: '你猛地睁开眼，从床上坐起。冷汗浸透了你的睡衣。\n外面正在下雨，雨水拍打着那扇松动的铝合金窗，发出细碎的噪音。',
      timestamp: '23:00',
    },
    {
      id: 'msg-2',
      type: 'narrative',
      content: '后脑勺隐隐作痛，像是撞到了什么硬物。你最后残存的记忆碎片里，只有一股纸箱潮湿发霉的味道，以及一个低沉的男声在问：“东西呢？”',
      timestamp: '23:00',
    },
    {
      id: 'msg-3',
      type: 'narrative',
      content: '你环顾四周，凌乱的行李箱还堆在门边，这是你搬进青荷公寓 503 的第一天。一切看起来很正常，除了桌上那个你以为是自己买的、被拆开了一半的未知包裹。',
      timestamp: '23:00',
    }
  ]
};
