import type { AgentId, AgentRegistration, AgentRegistry } from './AgentRegistry';
import type { GameEventBus } from './EventBus';
import type {
  GameCommandResults,
  GameCommandType,
  GameEvent,
  GameEventType,
} from './eventTypes';

const commandAgents: Record<GameCommandType, AgentId> = {
  PlayerActionSubmitted: 'parser',
  ActionParsed: 'rule',
  RulesApplied: 'killer',
  KillerActed: 'rule',
  NarrationRequested: 'narrator',
  NarrationDone: 'director',
  TurnCompleted: 'ui-adapter',
};

export interface HarnessTraceEntry {
  eventType: string;
  agentId: AgentId;
  source: 'ai' | 'fallback' | 'deterministic';
  durationMs: number;
  warnings: string[];
}

export class HarnessDispatcher {
  private trace: HarnessTraceEntry[] = [];

  constructor(
    private readonly bus: GameEventBus,
    private readonly registry: AgentRegistry,
  ) {}

  async runCommand<T extends GameCommandType>(
    type: T,
    payload: GameEvent<T>['payload'],
    parentId?: string,
  ): Promise<GameCommandResults[T]> {
    const agentId = commandAgents[type];
    const agent = this.registry.getAgent(agentId);
    if (!agent) {
      throw new Error(`No agent registered for command "${type}"`);
    }

    const event = this.bus.createEvent(type, payload, parentId);
    const startedAt = performance.now();
    const warnings: string[] = [];

    try {
      const result = await this.registry.runAgent(agent, payload, event);
      this.recordTrace(type, agent, startedAt, warnings, agent.mode === 'ai' ? 'ai' : 'fallback');
      this.bus.recordEvent(event, [result], performance.now() - startedAt);
      return result as GameCommandResults[T];
    } catch (error) {
      warnings.push(formatError(error));

      if (agent.mode !== 'ai') {
        this.recordTrace(type, agent, startedAt, warnings, 'fallback');
        this.bus.recordEvent(event, [{ __error: error }], performance.now() - startedAt);
        throw error;
      }

      try {
        const fallbackResult = await this.registry.runFallback(agent, payload, event);
        this.recordTrace(type, agent, startedAt, warnings, 'fallback');
        this.bus.recordEvent(event, [fallbackResult], performance.now() - startedAt);
        return fallbackResult as GameCommandResults[T];
      } catch (fallbackError) {
        warnings.push(formatError(fallbackError));
        this.recordTrace(type, agent, startedAt, warnings, 'fallback');
        this.bus.recordEvent(event, [{ __error: error }, { __error: fallbackError }], performance.now() - startedAt);
        throw fallbackError;
      }
    }
  }

  async emitNotification<T extends GameEventType>(
    type: T,
    payload: GameEvent<T>['payload'],
    parentId?: string,
  ): Promise<unknown[]> {
    return this.bus.emit(type, payload, parentId);
  }

  getTrace(): ReadonlyArray<HarnessTraceEntry> {
    return this.trace;
  }

  private recordTrace(
    eventType: string,
    agent: AgentRegistration,
    startedAt: number,
    warnings: string[],
    source: HarnessTraceEntry['source'],
  ): void {
    this.trace.push({
      eventType,
      agentId: agent.id,
      source,
      warnings: [...warnings],
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
