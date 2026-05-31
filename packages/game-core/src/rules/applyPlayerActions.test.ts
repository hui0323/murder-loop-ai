import { strict as assert } from 'node:assert';
import type { ActionPlan } from '@murder-loop-ai/shared';
import { createInitialGameState } from '../state/createInitialState';
import { applyPlayerActions } from './applyPlayerActions';

function testChargingPhoneFromParserShape() {
  const state = createInitialGameState();
  state.phoneBattery = 10;
  state.phoneFunctional = true;
  state.room.phone.state.battery = 10;

  const plan: ActionPlan = {
    id: 'plan-charge-phone',
    raw: '使用充电器给手机充电',
    summary: '给手机充电',
    confidence: 0.98,
    warnings: [],
    actions: [
      {
        id: 'act-charge-phone',
        raw: '使用充电器给手机充电',
        intent: 'use_item',
        target: 'phone',
        method: '使用充电器给手机充电',
        confidence: 0.98,
        timeCost: 2,
        noise: 0,
        risk: 'low',
      },
    ],
  };

  const result = applyPlayerActions(state, plan);

  assert.equal(result.title, '电量回升');
  assert.equal(result.state.phoneBattery, 40);
  assert.equal(result.state.room.phone.state.battery, 40);
  assert.ok(!result.text.includes('未知'), 'charging with a phone target should not become an unknown item');
}

testChargingPhoneFromParserShape();
