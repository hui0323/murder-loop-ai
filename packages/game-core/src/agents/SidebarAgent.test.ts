import assert from 'node:assert/strict';
import { createInitialGameState } from '../state/createInitialState';
import { SidebarAgent, type SidebarPayload } from './SidebarAgent';

async function testFalsePolicePhaseDoesNotSpoilIdentity() {
  const state = createInitialGameState();
  state.phase = 'false_police_arrived';
  state.policePhase = 'dispatch_pending';

  const sidebar = await SidebarAgent.fallback({ finalState: state }) as SidebarPayload;

  assert.equal(sidebar.phaseLabel, '警察到场');
  assert.ok(!sidebar.phaseLabel.includes('假警察'));
}

await testFalsePolicePhaseDoesNotSpoilIdentity();
