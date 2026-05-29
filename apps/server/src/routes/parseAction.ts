import type { FastifyInstance } from 'fastify';
import { ActionPlanSchema } from '@murder-loop-ai/ai-contracts';
import { fallbackParseAction } from '@murder-loop-ai/game-core';
import { completeRoleJson } from '../ai/openaiClient';

export async function parseActionRoute(app: FastifyInstance) {
  app.post('/api/parse-action', async (request) => {
    const body = request.body as { input?: string; state?: unknown };
    const input = body.input || '';
    const fallback = fallbackParseAction(input);

    const ai = await completeRoleJson(
      'parse',
      [
        '你是《23:47》行动解析 AI。玩家用自然语言写一组求生动作，你要拆成规则系统能执行的 JSON。',
        '第一原则：尊重否定词、条件词和顺序。“不开门/不要开门/别让他进来”绝不能解析成 open_door；“先核实，失败就不开门”也不是 open_door。',
        '只解析玩家明确要做的动作，不替玩家补全聪明操作，不制造新事实，不决定生死和结局。',
        '“我回了他/回复他/给他发：……”这种输入是 communicate + chen_huaimin，只表示发送这句话；不能解析成等待、开门或额外搜查。',
        '复杂输入拆成 1-6 个动作，保持玩家原始顺序。每个动作给 intent、target、method、timeCost、noise、risk、confidence。timeCost 只表示复杂度：普通动作填 1，报警/加固/检查房间等复杂动作最多填 2；后端会把单回合总耗时压缩到 1-3 分钟。',
        'method 用简洁中文动作短句，例如“隔门询问并录音”“拍照备份包裹”“锁窗拉帘”，不要输出开发术语。',
        '如果玩家输入含糊，保守解析可执行部分，并把歧义放进 warnings。',
        '只输出 JSON，必须符合 ActionPlanSchema。',
      ].join('\n'),
      { input, state: body.state, fallbackShape: fallback },
      { temperature: 0.25 },
    ).catch(() => null);

    const parsed = ActionPlanSchema.safeParse(ai);
    return parsed.success ? parsed.data : fallback;
  });
}
