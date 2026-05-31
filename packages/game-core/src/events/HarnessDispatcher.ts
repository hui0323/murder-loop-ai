import type { AgentId, AgentRegistration, AgentRegistry } from './AgentRegistry';
import type { GameEventBus } from './EventBus';
import type {
  GameCommandResults,
  GameCommandType,
  GameEvent,
  GameEventType,
} from './eventTypes';

export interface HarnessTraceEntry {
  eventType: string;
  agentId: AgentId;
  source: 'ai' | 'fallback' | 'deterministic';
  durationMs: number;
  warnings: string[];
}

export class HarnessDispatcher {
  private trace: HarnessTraceEntry[] = [];
  private artifacts: Array<{ eventType: string; agentId: AgentId; source: HarnessTraceEntry['source']; result: unknown }> = [];

  constructor(
    private readonly bus: GameEventBus,
    private readonly registry: AgentRegistry,
  ) {}

  async runCommand<T extends GameCommandType>(
    type: T,
    payload: GameEvent<T>['payload'],
    parentId?: string,
  ): Promise<GameCommandResults[T]> {
    const event = this.bus.createEvent(type, payload, parentId);
    const startedAt = performance.now();
    const subscribers = this.registry.getAgentsForEvent(type);
    const primary = subscribers.find((subscriber) => subscriber.role === 'primary');
    if (!primary) {
      throw new Error(`No primary agent registered for command "${type}"`);
    }

    const eventResults: unknown[] = [];
    let primaryResult: unknown;
    try {
      primaryResult = await this.runWithFallback(type, primary.agent, payload, event);
      eventResults.push(primaryResult);
    } catch (error) {
      eventResults.push({ __error: error });
      this.bus.recordEvent(event, eventResults, performance.now() - startedAt);
      throw error;
    }

    for (const subscriber of subscribers.filter((entry) => entry.agent.id !== primary.agent.id)) {
      if (subscriber.defer) {
        void this.runWithFallback(type, subscriber.agent, payload, event).catch(() => null);
        continue;
      }

      try {
        eventResults.push(await this.runWithFallback(type, subscriber.agent, payload, event));
      } catch (error) {
        eventResults.push({ __error: error });
      }
    }

    this.bus.recordEvent(event, eventResults, performance.now() - startedAt);
    return primaryResult as GameCommandResults[T];
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

  getArtifacts(eventType?: string): ReadonlyArray<{ eventType: string; agentId: AgentId; source: HarnessTraceEntry['source']; result: unknown }> {
    return eventType ? this.artifacts.filter((artifact) => artifact.eventType === eventType) : this.artifacts;
  }

  getLatestArtifact(agentId: AgentId, eventType?: string): unknown | undefined {
    return [...this.artifacts]
      .reverse()
      .find((artifact) => artifact.agentId === agentId && (!eventType || artifact.eventType === eventType))
      ?.result;
  }

  private async runWithFallback(
    eventType: string,
    agent: AgentRegistration,
    payload: unknown,
    event: GameEvent,
  ): Promise<unknown> {
    const startedAt = performance.now();
    const warnings: string[] = [];

    try {
      const result = await this.registry.runAgent(agent, payload, event);
      const source = agent.mode === 'ai' ? 'ai' : 'fallback';
      this.recordTrace(eventType, agent, startedAt, warnings, source);
      this.recordArtifact(eventType, agent, source, result);
      return result;
    } catch (error) {
      warnings.push(formatError(error));

      if (agent.mode !== 'ai') {
        this.recordTrace(eventType, agent, startedAt, warnings, 'fallback');
        throw error;
      }

      try {
        const fallbackResult = await this.registry.runFallback(agent, payload, event);
        this.recordTrace(eventType, agent, startedAt, warnings, 'fallback');
        this.recordArtifact(eventType, agent, 'fallback', fallbackResult);
        return fallbackResult;
      } catch (fallbackError) {
        warnings.push(formatError(fallbackError));
        this.recordTrace(eventType, agent, startedAt, warnings, 'fallback');
        throw fallbackError;
      }
    }
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

  private recordArtifact(
    eventType: string,
    agent: AgentRegistration,
    source: HarnessTraceEntry['source'],
    result: unknown,
  ): void {
    this.artifacts.push({ eventType, agentId: agent.id, source, result });
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
