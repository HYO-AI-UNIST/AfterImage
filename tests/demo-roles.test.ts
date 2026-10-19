import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemo, DEMO_SELF_ID, demoAction, tickDemo } from '../lib/demo.ts';
import { applyAction, edgeId, getBoard, hasSafePath, viewFor } from '../lib/game.ts';
import type { GameState, RoleId } from '../lib/contracts.ts';
import { MAX_CONCEALED_EDGES, ROLE_IDS, roundHintCoins } from '../lib/roles.ts';

const firstMine = edgeId('4-0', '3-0');

function playingDemo(role: RoleId = 'illuminator'): GameState {
  let state = createDemo(role);
  state = demoAction(state, { type: 'place', mines: [firstMine] }, 0).state;
  return {
    ...state,
    boards: Object.fromEntries(state.players.map((player) => [player.id, [firstMine]])),
    concealedBoards: {},
    players: state.players.map((player) => player.id === DEMO_SELF_ID ? player : { ...player, role: undefined, blessings: 0, peeks: 0, shifts: 0 }),
  };
}

function explode(state: GameState): GameState {
  const actor = state.players[state.activeSeat].id;
  if (state.boardMode === 'choice' && state.selectedBoardSeat == null) state = applyAction(state, actor, { type: 'chooseBoard', ownerSeat: (state.activeSeat + 1) % state.playerCount }, 0).state;
  state = applyAction(state, actor, { type: 'spawn', nodeId: '4-0' }, 0).state;
  return applyAction(state, actor, { type: 'move', nodeId: '3-0' }, 0).state;
}

test('demo role picker initializes each human ability and privately prepares all bot boards', () => {
  for (const role of ROLE_IDS) {
    const state = createDemo(role);
    const human = state.players[0];
    assert.equal(state.phase, 'placing');
    assert.equal(human.role, role);
    assert.equal(human.ready, false);
    assert.equal(human.coins, roundHintCoins(3, role));
    assert.equal(human.blessings, role === 'guardian' ? 2 : 0);
    assert.equal(human.peeks, role === 'thief' ? 2 : 0);
    assert.equal(human.shifts, role === 'shifter' ? 7 : 0);
    assert.ok(state.players.slice(1).every((player) => player.ready));
    for (const bot of state.players.slice(1)) {
      assert.ok(hasSafePath(state.boards[bot.id]));
      assert.equal(state.concealedBoards?.[bot.id].length, bot.role === 'trapper' ? MAX_CONCEALED_EDGES : 0);
    }
    const view = viewFor(state, DEMO_SELF_ID, 0);
    assert.deepEqual(view.ownMines, []);
    assert.equal('boards' in view, false);
    assert.equal('concealedBoards' in view, false);
  }
});

test('demo guardian holds the human decision indefinitely but automatically continues for bots', () => {
  let human = explode(playingDemo('guardian'));
  assert.strictEqual(tickDemo(human, 3_999), human);
  human = tickDemo(human, 4_000);
  assert.equal(human.blessingSeat, 0);
  assert.strictEqual(tickDemo(human, 100_000), human);
  human = demoAction(human, { type: 'blessing', use: true }, 100_000).state;
  assert.equal(human.activeSeat, 0);
  assert.equal(human.players[0].blessings, 1);
  assert.equal(human.position, null);

  let bot = playingDemo();
  bot = { ...bot, activeSeat: 1, players: bot.players.map((player) => player.seat === 1 ? { ...player, role: 'guardian', blessings: 2 } : player) };
  bot = tickDemo(explode(bot), 4_000);
  assert.equal(bot.blessingSeat, null);
  assert.equal(bot.players[1].blessings, 1);
  assert.equal(bot.activeSeat, 1);
  assert.equal(bot.position, null);
  // First tick may write a guess; the next must actually start the pawn.
  bot = tickDemo(bot, 4_250);
  bot = tickDemo(bot, 4_500);
  assert.ok(getBoard().starts.includes(bot.position!));
});

test('queued bot shifters run even with human active seat, pause for human, and skip an empty board', () => {
  let state = playingDemo('shifter');
  state = {
    ...state, boardMode: undefined, rotation: 5, activeSeat: 0, shiftQueue: [1, 0, 2],
    players: state.players.map((player) => player.seat <= 2 ? { ...player, role: 'shifter', shifts: 7 } : player),
    boards: { ...state.boards, [state.players[2].id]: [] },
  };
  const botId = state.players[1].id;
  state = tickDemo(state, 0);
  assert.deepEqual(state.shiftQueue, [0, 2]);
  assert.equal(state.boards[botId].length, 1);
  assert.notEqual(state.boards[botId][0], firstMine);
  assert.ok(hasSafePath(state.boards[botId]));
  assert.equal(state.players[1].shifts, 6);
  assert.strictEqual(tickDemo(state, 50_000), state, 'human choice holds without automatic skip');
  assert.deepEqual(viewFor(state, DEMO_SELF_ID, 50_000).shiftMines, [firstMine]);
  state = demoAction(state, { type: 'shiftMine' }, 50_000).state;
  assert.deepEqual(state.shiftQueue, [2]);
  assert.equal(state.players[0].shifts, 7);
  state = tickDemo(state, 50_250);
  assert.deepEqual(state.shiftQueue, []);
  assert.equal(state.players[2].shifts, 7);
  assert.equal(state.rotation, 1);
  assert.equal(state.event?.type, 'rotation');
  state = tickDemo(state, state.event!.until);
  assert.equal(state.event, null);
  assert.equal(state.activeSeat, 0);
  assert.equal(state.position, null);
});

test('bot memo and thief pre-spawn actions converge without hanging or saving private peek answers', () => {
  let state = playingDemo();
  state = { ...state, activeSeat: 1,
    players: state.players.map((player) => player.seat === 1 ? { ...player, role: 'thief', peeks: 2 } : player),
    memos: { [DEMO_SELF_ID]: [{ boardOwnerId: state.players[3].id, edgeId: firstMine, status: 'safe' }] },
  };
  state = tickDemo(state, 0);
  assert.notEqual(state.selectedBoardSeat, null);
  assert.notEqual(state.selectedBoardSeat, state.activeSeat);
  state = tickDemo(state, 0);
  assert.equal(state.memos?.[state.players[1].id]?.filter(Boolean).length, 1);
  assert.equal(state.position, null);
  state = tickDemo(state, 250);
  assert.equal(state.players[1].peeks, 1);
  state = tickDemo(state, 500);
  assert.equal(state.players[1].peeks, 0);
  state = tickDemo(state, 750);
  assert.ok(getBoard().starts.includes(state.position!));
  assert.equal('peekResult' in state, false);
  assert.equal(state.memos?.[state.players[1].id]?.filter(Boolean).length, 1);
  const guess = state.memos![state.players[1].id].find(Boolean)!;
  assert.equal(guess.status, 'unsure');
});

test('legacy role-free turns accept new manual memos without acquiring powers midround', () => {
  let state = playingDemo();
  state = { ...state, rolesEnabled: undefined, players: state.players.map((player) => ({ ...player, role: undefined, coins: 3, blessings: undefined, peeks: undefined })) };
  state = demoAction(state, { type: 'memo', slot: 0, entry: { boardOwnerId: state.players[2].id, edgeId: firstMine, status: 'safe' } }, 0).state;
  assert.equal(state.players[0].role, undefined);
  assert.equal(state.players[0].coins, 3);
  assert.equal(viewFor(state, DEMO_SELF_ID, 0).selfMemos?.[0]?.status, 'safe');
  state = tickDemo(explode(state), 4_000);
  assert.equal(state.activeSeat, 1);
  assert.equal(state.blessingSeat, null);
});
