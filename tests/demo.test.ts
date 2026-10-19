import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemo, demoAction, tickDemo, DEMO_SELF_ID } from '../lib/demo.ts';
import { viewFor, boardOwnerSeat } from '../lib/game.ts';

test('solo demo prepares five opponents and waits for the real player', () => {
  const state = createDemo();
  assert.equal(state.phase, 'placing');
  assert.equal(state.players.length, 6);
  assert.equal(state.players.filter(p => p.ready).length, 5);
  assert.equal(viewFor(state, DEMO_SELF_ID).ownMines?.length, 0);
  const selectedRole = demoAction(state, { type: 'chooseRole', role: 'illuminator' }).state;
  const played = demoAction(selectedRole, { type: 'place', mines: [] }).state;
  assert.equal(played.phase, 'playing');
  assert.equal(played.players[played.activeSeat].id, DEMO_SELF_ID);
  assert.equal(boardOwnerSeat(played), -1);
  assert.strictEqual(tickDemo(played), played, 'human waits for an explicit board choice');
  const selected = demoAction(played, { type: 'chooseBoard', ownerSeat: 2 }).state;
  assert.equal(boardOwnerSeat(selected), 2);
  assert.equal('ownMines' in viewFor(played, DEMO_SELF_ID), false);
});

test('demo round reset prepares fresh opponents while preserving scores', () => {
  let state = createDemo('trapper');
  state = demoAction(state, { type: 'place', mines: [] }, 0).state;
  // Supply a board fixture with an open side so the round result is deterministic.
  state = { ...state, boards: Object.fromEntries(state.players.map(p => [p.id, []])) };
  state = demoAction(state, { type: 'chooseBoard', ownerSeat: 1 }, 0).state;
  state = demoAction(state, { type: 'spawn', nodeId: '4-0' }, 0).state;
  for (let row = 3; row >= 0; row--) state = demoAction(state, { type: 'move', nodeId: `${row}-0` }, (4 - row) * 1000).state;
  assert.equal(state.phase, 'roundEnd');
  assert.equal(state.players[0].score, 4);
  assert.equal(state.players[1].score, 2);
  assert.deepEqual(state.winner, { seat: 0, points: 1, ownerSeat: 1, coinsTransferred: 1 });
  state = demoAction(state, { type: 'nextRound' }, 6000).state;
  assert.equal(state.phase, 'placing');
  assert.equal(state.round, 2);
  assert.equal(state.starterSeat, 1);
  assert.equal(state.players[0].score, 4);
  assert.equal(state.players.filter(p => p.ready).length, 5);
  assert.equal(tickDemo(state, 7000), state);
});
