import cors from '@fastify/cors';
import Fastify from 'fastify';
import { roleHealth } from './ai/roleConfig';
import { env } from './env';
import { killerStrategyRoute } from './routes/killerStrategy';
import { narrateRoute } from './routes/narrate';
import { npcReplyRoute } from './routes/npcReply';
import { parseActionRoute } from './routes/parseAction';
import { scoreRunRoute } from './routes/scoreRun';
import { frontendAdapterRoute } from './routes/frontendAdapter';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
});

app.get('/health', async () => ({
  ok: true,
  service: 'murder-loop-ai-server',
  ai: {
    openai: Boolean(env.openaiApiKey),
    deepseek: Boolean(env.deepseekApiKey),
    duckingmind: Boolean(env.duckingmindApiKey),
    roles: roleHealth(),
  },
}));

await app.register(parseActionRoute);
await app.register(killerStrategyRoute);
await app.register(narrateRoute);
await app.register(npcReplyRoute);
await app.register(scoreRunRoute);
await app.register(frontendAdapterRoute);

try {
  await app.listen({ port: env.port, host: '127.0.0.1' });
  app.log.info(`murder-loop-ai server listening on http://127.0.0.1:${env.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
