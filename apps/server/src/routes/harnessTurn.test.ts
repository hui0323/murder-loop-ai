import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createInitialGameState } from '@murder-loop-ai/game-core';
import type { GameState, TurnResolution } from '@murder-loop-ai/shared';
import { harnessTurnRoute } from './harnessTurn';

type HarnessTurnResolution = TurnResolution & {
  coordination: {
    warnings: string[];
    trace: Array<{
      taskId: string;
      source: string;
      decision?: string;
      warnings: string[];
      durationMs: number;
    }>;
    judgements: Record<string, unknown>;
  };
};

const baseState = createInitialGameState();
const finalState = {
  ...baseState,
  log: [
    ...baseState.log,
    {
      id: 'log-1',
      run: baseState.run,
      minute: baseState.minute,
      title: 'Message reply',
      text: 'The unknown number replies with another question about the package.',
      tone: 'threat' as const,
      channel: 'ambient' as const,
    },
  ],
};

const resolution = {
  plan: {
    id: 'plan-1',
    raw: 'reply to Chen',
    summary: 'Reply to Chen',
    actions: [
      {
        id: 'action-1',
        raw: 'reply to Chen',
        intent: 'communicate' as const,
        target: 'chen_huaimin' as const,
        confidence: 0.9,
        timeCost: 1,
        noise: 0,
        risk: 'medium' as const,
      },
    ],
    confidence: 0.9,
    warnings: [],
  },
  playerResult: {
    title: 'Action',
    text: 'Action complete',
    tone: 'neutral' as const,
    addedClues: [],
    timePassed: 1,
    threatDelta: 0,
    events: [],
    state: baseState,
  },
  killerStrategy: {
    id: 'strategy-1',
    type: 'message_reply' as const,
    title: 'Message reply',
    rationale: 'Continue the conversation',
    visibleToPlayer: true,
    risk: 'medium' as const,
  },
  killerResult: {
    title: 'Message reply',
    text: 'The unknown number replies with another question about the package.',
    tone: 'threat' as const,
    addedClues: [],
    timePassed: 0,
    threatDelta: 4,
    events: [],
    state: finalState,
  },
  narration: {
    title: 'Action',
    text: 'Action complete',
  },
  finalState,
  coordination: {
    warnings: [],
    trace: [
      {
        taskId: 'PlayerActionSubmitted',
        source: 'game-core-harness',
        warnings: [],
        durationMs: 1,
      },
    ],
    judgements: {},
  },
} satisfies HarnessTurnResolution;

async function testHarnessTurnRouteReturnsFrontendPackage() {
  const app = Fastify({ logger: false });
  let calledWith: { stateMinute: number; input: string } | null = null;

  await app.register(harnessTurnRoute, {
    createHarness: () => ({
      resolveTurn: async (state: GameState, input: string) => {
        calledWith = { stateMinute: state.minute, input };
        return resolution;
      },
    }),
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: 'reply to Chen',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calledWith, { stateMinute: baseState.minute, input: 'reply to Chen' });

  const body = response.json();
  assert.equal(body.time, '23:00');
  assert.equal(body.location, 'Qinghe Apartment 503');
  assert.equal(body.phase, finalState.phase);
  assert.ok(Array.isArray(body.clues));
  assert.equal(body.coreState.log.at(-1).title, 'Message reply');
  assert.equal(body.storyLog[0].type, 'player_input');
  assert.equal(body.storyLog[1].type, 'narrative');
  assert.equal(body.coordination.trace[0].taskId, 'PlayerActionSubmitted');

  await app.close();
}

async function testDefaultHarnessRouteReturnsDispatcherTrace() {
  const app = Fastify({ logger: false });

  await app.register(harnessTurnRoute);

  const response = await app.inject({
    method: 'POST',
    url: '/api/harness/turn',
    payload: {
      input: 'look around',
      state: baseState,
    },
  });

  assert.equal(response.statusCode, 200);

  const body = response.json();
  assert.equal(body.coordination.trace[0].taskId, 'PlayerActionSubmitted');
  assert.notEqual(body.coordination.trace[0].source, 'game-core-harness');
  assert.deepEqual(
    body.coordination.warnings,
    body.coordination.trace.flatMap((entry: { warnings: string[] }) => entry.warnings),
  );

  await app.close();
}

await testHarnessTurnRouteReturnsFrontendPackage();
await testDefaultHarnessRouteReturnsDispatcherTrace();
