import assert from 'node:assert/strict';
import type { ActionPlan } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { createHarness, resolveTurnHarness } from './resolveTurn';

async function testResolveTurnHarnessReturnsTraceAndFinalState() {
  const state = createInitialGameState();
  const harness = createHarness();

  const resolution = await resolveTurnHarness(state, 'check the package', harness);

  assert.equal(resolution.plan.raw, 'check the package');
  assert.ok(resolution.finalState.log.length > state.log.length);
  assert.ok(resolution.actionNarration?.text || resolution.narration.text);
  assert.ok(harness.dispatcher.getTrace().some((entry) => entry.eventType === 'PlayerActionSubmitted'));
  assert.ok(harness.dispatcher.getTrace().some((entry) => entry.eventType === 'NarrationRequested'));
}

async function testMalformedParserAiOutputFallsBackToValidPlan() {
  const state = createInitialGameState();
  const harness = createHarness({
    parseAction: async () => ({ wrong: true }) as unknown as ActionPlan,
  });

  const resolution = await resolveTurnHarness(state, 'check the package', harness);
  const parserTrace = harness.dispatcher
    .getTrace()
    .find((entry) => entry.eventType === 'PlayerActionSubmitted');

  assert.equal(resolution.plan.raw, 'check the package');
  assert.ok(resolution.plan.actions.length > 0);
  assert.equal(parserTrace?.source, 'fallback');
  assert.match(parserTrace?.warnings[0] ?? '', /parser.*output violation/i);
}

await testResolveTurnHarnessReturnsTraceAndFinalState();
await testMalformedParserAiOutputFallsBackToValidPlan();
