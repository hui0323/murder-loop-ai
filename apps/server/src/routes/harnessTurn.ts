import type { FastifyInstance } from 'fastify';
import { clueBook } from '@murder-loop-ai/content';
import {
  createHarness,
  createInitialGameState,
  resolveTurnHarness,
} from '@murder-loop-ai/game-core';
import {
  minuteLabel,
  type GameState,
  type StoryLogEntry,
  type TurnResolution,
} from '@murder-loop-ai/shared';

interface FrontendStoryNode {
  id: string;
  type: 'narrative' | 'action_result' | 'system' | 'player_input';
  content: string;
  timestamp?: string;
}

interface HarnessTraceEntry {
  taskId: string;
  source: string;
  decision?: string;
  warnings: string[];
  durationMs: number;
}

interface HarnessCoordination {
  warnings: string[];
  trace: HarnessTraceEntry[];
  judgements: Record<string, unknown>;
}

interface HarnessTurnResolution extends TurnResolution {
  coordination: HarnessCoordination;
}

interface HarnessLike {
  resolveTurn(state: GameState, input: string): Promise<HarnessTurnResolution>;
}

interface HarnessTurnRouteOptions {
  createHarness?: () => HarnessLike;
}

function toFrontendClues(state: GameState) {
  return state.clues.map((id, index) => ({
    id,
    name: clueBook[id]?.title ?? id,
    description: clueBook[id]?.detail ?? 'Recorded clue.',
    status: index === state.clues.length - 1 ? 'new' : 'known',
  }));
}

function toFrontendNode(entry: StoryLogEntry): FrontendStoryNode {
  if (entry.channel === 'action') {
    return {
      id: entry.id,
      type: 'action_result',
      content: `${entry.title ? `${entry.title}: ` : ''}${entry.text}`,
      timestamp: minuteLabel(entry.minute),
    };
  }

  if (entry.tone === 'system') {
    return {
      id: entry.id,
      type: 'system',
      content: entry.title || entry.text,
      timestamp: minuteLabel(entry.minute),
    };
  }

  return {
    id: entry.id,
    type: 'narrative',
    content: entry.text,
    timestamp: minuteLabel(entry.minute),
  };
}

function defaultHarness(): HarnessLike {
  return {
    async resolveTurn(state: GameState, input: string): Promise<HarnessTurnResolution> {
      const harness = createHarness();
      const resolution = await resolveTurnHarness(state, input, harness);
      const trace = harness.dispatcher.getTrace().map((entry) => ({
        taskId: entry.eventType,
        source: entry.source,
        warnings: entry.warnings,
        durationMs: entry.durationMs,
      }));

      return {
        ...resolution,
        coordination: {
          warnings: trace.flatMap((entry) => entry.warnings),
          trace,
          judgements: {},
        },
      };
    },
  };
}

export async function harnessTurnRoute(
  app: FastifyInstance,
  options: HarnessTurnRouteOptions = {},
) {
  app.post('/api/harness/turn', async (request) => {
    const body = request.body as { input?: string; state?: GameState };
    const input = body.input?.trim() ?? '';
    const state = body.state ?? createInitialGameState();

    if (!input) {
      return {
        coreState: state,
        time: minuteLabel(state.minute),
        location: 'Qinghe Apartment 503',
        phase: state.phase,
        clues: toFrontendClues(state),
        storyLog: [] satisfies FrontendStoryNode[],
        coordination: {
          warnings: [],
          trace: [],
          judgements: {},
        },
      };
    }

    const harness = options.createHarness ? options.createHarness() : defaultHarness();
    const beforeLogLength = state.log.length;
    const resolution = await harness.resolveTurn(state, input);

    return {
      coreState: resolution.finalState,
      time: minuteLabel(resolution.finalState.minute),
      location: 'Qinghe Apartment 503',
      phase: resolution.finalState.phase,
      clues: toFrontendClues(resolution.finalState),
      ending: resolution.finalState.ending,
      score: resolution.finalState.score,
      storyLog: [
        {
          id: `input-${Date.now()}`,
          type: 'player_input',
          content: input,
        },
        ...resolution.finalState.log.slice(beforeLogLength).map(toFrontendNode),
      ] satisfies FrontendStoryNode[],
      turn: {
        plan: resolution.plan,
        killerStrategy: resolution.killerStrategy,
        actionNarration: resolution.actionNarration ?? resolution.narration,
        ambientNarration: resolution.ambientNarration ?? null,
      },
      coordination: resolution.coordination,
    };
  });
}
