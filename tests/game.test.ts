import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGES,
  GameError,
  GOAL,
  NODES,
  STARTS,
  addPlayer,
  advanceTime,
  applyAction,
  boardOwnerSeat,
  createRoom,
  getBoard,
  hasSafePath,
  maxMines,
  randomBoard,
  viewFor,
} from '../lib/game.ts';
import type { GameAction, GameState, RoomSettings } from '../lib/contracts.ts';
import { DEFAULT_ROOM_SETTINGS } from '../lib/settings.ts';

const id = (seat: number) => `player-${seat}`;
const edge = (a: string, b: string) => [a, b].sort().join('~');
const FIRST_MINE = edge('4-0', '3-0');

function waiting(settings?: RoomSettings): GameState {
  let state = createRoom('MIND42', { id: id(0), name: '플레이어 1' });
  // These fixtures isolate the original movement rules; roles have their own suite.
  state.rolesEnabled = false;
  if (settings) state = applyAction(state, id(0), { type: 'settings', settings }, 0).state;
  for (let seat = 1; seat < state.playerCount; seat += 1) state = addPlayer(state, { id: id(seat), name: `플레이어 ${seat + 1}` });
  return state;
}

function placing(settings?: RoomSettings): GameState {
  const state = applyAction(waiting(settings), id(0), { type: 'start' }, 0).state;
  // Fixture chooses a known starting seat; the production engine chooses randomly.
  // Retain explicit saved-round fixtures to cover legacy automatic rotation.
  return { ...state, starterSeat: 0, activeSeat: 0, boardMode: undefined, scoringMode: undefined, placementMode: undefined,
    players: state.players.map(player => ({ ...player, score: 0 })) };
}

function commitAll(state: GameState, mines: string[] = []): GameState {
  for (let seat = 0; seat < state.playerCount; seat += 1) state = applyAction(state, id(seat), { type: 'place', mines }, 0).state;
  return state;
}

function playing(mines: string[] = [], settings?: RoomSettings): GameState {
  return commitAll(placing(settings), mines);
}

function walk(state: GameState, route: string[], now = 0): GameState {
  if (state.boardMode === 'choice' && state.selectedBoardSeat == null) state = applyAction(state, id(state.activeSeat), { type: 'chooseBoard', ownerSeat: (state.activeSeat + 1) % state.playerCount }, now).state;
  state = applyAction(state, id(state.activeSeat), { type: 'spawn', nodeId: route[0] }, now).state;
  for (const nodeId of route.slice(1)) {
    state = applyAction(state, id(state.activeSeat), { type: 'move', nodeId }, now).state;
    if (state.event) {
      now = state.event.until;
      state = advanceTime(state, now);
    }
  }
  return state;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

test('triangle geometry contains exactly 15 nodes, 30 unique unit edges and four safe base edges', () => {
  assert.equal(NODES.length, 15);
  assert.equal(EDGES.length, 30);
  assert.equal(new Set(EDGES.map((entry) => entry.id)).size, 30);
  assert.deepEqual(STARTS, ['4-0', '4-1', '4-2', '4-3', '4-4']);
  assert.equal(GOAL, '0-0');
  assert.deepEqual(NODES.find((node) => node.goal), { id: GOAL, row: 0, col: 0, x: 300, y: 72, start: false, goal: true });
  assert.equal(NODES.find((node) => node.id === '4-0')!.x, 70);
  assert.equal(NODES.find((node) => node.id === '4-4')!.x, 530);
  assert.equal(EDGES.filter((entry) => entry.base).length, 4);
  for (const entry of EDGES) {
    const a = NODES.find((node) => node.id === entry.a)!;
    const b = NODES.find((node) => node.id === entry.b)!;
    assert.ok(a && b);
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 115) < 0.1);
    assert.equal(entry.id, edge(a.id, b.id));
    assert.equal(entry.base, a.start && b.start);
  }
});

test('reachability and movement support winding routes, including older dense boards', () => {
  assert.ok(hasSafePath([]));
  assert.equal(hasSafePath(EDGES.filter((entry) => !entry.base).map((entry) => entry.id)), false);
  assert.equal(hasSafePath([edge('0-0', '1-0'), edge('0-0', '1-1')]), false);
  assert.equal(hasSafePath([EDGES.find((entry) => entry.base)!.id]), false);
  assert.equal(hasSafePath(['not-an-edge']), false);
  // The only route from the base requires going down from 2-0 to 3-1.
  const route = ['4-0', '3-0', '2-0', '3-1', '2-1', '1-1', '0-0'];
  const open = new Set(route.slice(1).map((node, index) => edge(route[index], node)));
  const mines = EDGES.filter((entry) => !entry.base && !open.has(entry.id)).map((entry) => entry.id);
  assert.ok(hasSafePath(mines));
  // Existing committed boards are preserved even when they exceed the new cap.
  const legacy = playing();
  legacy.boards[id(boardOwnerSeat(legacy))] = mines;
  assert.equal(walk(legacy, route).phase, 'roundEnd');
});

test('generated demo boards always have a safe route and never mine the base', () => {
  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let index = 0; index < 150; index += 1) {
    const mines = randomBoard(random);
    assert.ok(hasSafePath(mines));
    assert.equal(new Set(mines).size, mines.length);
    for (const mine of mines) assert.equal(EDGES.find((entry) => entry.id === mine)!.base, false);
  }
});

test('host starts exactly six participants; lobby and lifecycle permissions are enforced', () => {
  const one = createRoom('MIND42', { id: id(0), name: '  Alice  ' });
  assert.equal(one.players[0].name, 'Alice');
  assert.throws(() => applyAction(one, id(0), { type: 'start' }), /6명/);
  const room = waiting();
  assert.throws(() => applyAction(room, id(1), { type: 'start' }), (error) => error instanceof GameError && error.status === 403);
  assert.throws(() => applyAction(room, 'intruder', { type: 'start' }), /참가자/);
  assert.deepEqual(addPlayer(room, { id: 'seventh', name: 'Extra' }).spectators, [{ id: 'seventh', name: 'Extra' }]);
  assert.throws(() => addPlayer(one, { id: id(0), name: 'Duplicate' }), /이미 참가/);
  const state = applyAction(room, id(0), { type: 'start' }).state;
  assert.equal(state.phase, 'placing');
  assert.ok(state.starterSeat >= 0 && state.starterSeat < 6);
  assert.equal(state.activeSeat, state.starterSeat);
  assert.equal(state.totalRounds, 7);
  assert.deepEqual(addPlayer(state, { id: 'late', name: 'Late' }).spectators, [{ id: 'late', name: 'Late' }]);
  assert.throws(() => applyAction(state, id(0), { type: 'start' }), GameError);
  assert.throws(() => applyAction(state, id(0), { type: 'restart' }), GameError);
});

test('only the lobby host can configure capacity, per-round coins, and round count', () => {
  const initial = deepFreeze(createRoom('MIND42', { id: id(0), name: '방장' }));
  assert.deepEqual({ playerCount: initial.playerCount, hintCoins: initial.hintCoins, totalRounds: initial.totalRounds, gridSize: initial.gridSize }, DEFAULT_ROOM_SETTINGS);
  const settings = { playerCount: 3, hintCoins: 8, totalRounds: 2, gridSize: 4 };
  let state = applyAction(initial, id(0), { type: 'settings', settings }, 0).state;
  assert.equal(state.revision, initial.revision + 1);
  assert.equal(initial.playerCount, 6);
  assert.equal(initial.players[0].coins, 3);
  state = addPlayer(state, { id: id(1), name: '친구' });
  assert.equal(state.players[0].coins, 8);
  assert.equal(state.players[1].coins, 8);
  const view = viewFor(state, id(1), 0);
  assert.deepEqual({ playerCount: view.playerCount, hintCoins: view.hintCoins, totalRounds: view.totalRounds, gridSize: view.gridSize }, settings);
  assert.equal('coins' in view.players[0], false);
  assert.equal(view.players[1].coins, 8);
  assert.throws(() => applyAction(state, id(1), { type: 'settings', settings }), (error) => error instanceof GameError && error.status === 403);
  assert.throws(() => applyAction(state, 'outsider', { type: 'settings', settings }), /참가자/);
  assert.throws(() => applyAction(state, id(0), { type: 'start' }), /3명/);
  state = addPlayer(state, { id: id(2), name: '친구 2' });
  const smaller = applyAction(state, id(0), { type: 'settings', settings: { ...settings, playerCount: 2 } }).state;
  assert.deepEqual(smaller.players.map((player) => player.id), [id(0), id(1)]);
  assert.deepEqual(smaller.spectators.map((player) => player.id), [id(2)]);
  assert.equal(addPlayer(state, { id: id(3), name: '추가' }).spectators.length, 1);
  state = applyAction(state, id(0), { type: 'settings', settings: { ...settings, hintCoins: 0 } }).state;
  assert.ok(state.players.every((player) => player.coins === 0));
  state = applyAction(state, id(0), { type: 'start' }).state;
  assert.ok(state.starterSeat >= 0 && state.starterSeat < 3);
  assert.throws(() => applyAction(state, id(0), { type: 'settings', settings }), (error) => error instanceof GameError && error.status === 409);
});

test('settings reject missing, extra, noninteger and out-of-range values without mutation', () => {
  const state = deepFreeze(createRoom('MIND42', { id: id(0), name: '방장' }));
  const invalid = [null, [], {}, { ...DEFAULT_ROOM_SETTINGS, cheat: true }];
  const fields = {
    playerCount: [1, 7, 8, 9, 2.5, NaN, Infinity, '6', null],
    hintCoins: [-1, 11, 1.5, NaN, Infinity, '3', null],
    totalRounds: [0, 21, 1.5, NaN, Infinity, '7', null],
    gridSize: [2, 7, 3.5, NaN, Infinity, '4', null],
  };
  for (const [field, values] of Object.entries(fields)) {
    for (const value of values) invalid.push({ ...DEFAULT_ROOM_SETTINGS, [field]: value });
  }
  for (const settings of invalid) assert.throws(() => applyAction(state, id(0), { type: 'settings', settings } as GameAction), GameError);
  assert.equal(state.revision, 0);
  const maximum = applyAction(state, id(0), { type: 'settings', settings: { playerCount: 6, hintCoins: 10, totalRounds: 20, gridSize: 4 } }).state;
  assert.equal(maximum.playerCount, 6);
  assert.equal(maximum.hintCoins, 10);
  assert.equal(maximum.totalRounds, 20);
});

test('mine placement is private, immutable, legal, and can only be committed once', () => {
  const initial = deepFreeze(placing());
  assert.throws(() => applyAction(initial, id(0), { type: 'place', mines: [edge('4-0', '4-1')] }), /출발점/);
  assert.throws(() => applyAction(initial, id(0), { type: 'place', mines: ['forged'] }), /판에 없는/);
  assert.throws(() => applyAction(initial, id(0), { type: 'place', mines: [edge('0-0', '1-0'), edge('0-0', '1-1')] }), /안전한 길/);
  const placed = applyAction(initial, id(0), { type: 'place', mines: [FIRST_MINE] }, 0).state;
  assert.deepEqual(initial.boards, {});
  assert.equal(initial.players[0].ready, false);
  assert.equal(placed.players[0].ready, true);
  assert.deepEqual(viewFor(placed, id(0), 0).ownMines, [FIRST_MINE]);
  assert.deepEqual(viewFor(placed, id(1), 0).ownMines, []);
  assert.equal('boards' in viewFor(placed, id(1), 0), false);
  assert.throws(() => applyAction(placed, id(0), { type: 'place', mines: [] }), /이미 배치/);
  let completed = placed;
  for (let seat = 1; seat < 6; seat += 1) completed = applyAction(completed, id(seat), { type: 'place', mines: [] }, 0).state;
  assert.equal(completed.phase, 'playing');
  assert.equal(completed.rotation, 1);
  for (const player of completed.players) {
    const view = viewFor(completed, player.id, 0);
    assert.equal('ownMines' in view, false);
    assert.equal('boards' in view, false);
  }
});

test('movement permits base travel, backtracking and downward steps, with animation pacing', () => {
  let state = playing();
  assert.throws(() => applyAction(state, id(1), { type: 'spawn', nodeId: '4-0' }, 0), /다른 플레이어/);
  assert.throws(() => applyAction(state, id(0), { type: 'spawn', nodeId: '3-0' }, 0), /출발점/);
  assert.throws(() => applyAction(state, id(0), { type: 'move', nodeId: '4-0' }, 0), /먼저 출발점/);
  state = applyAction(state, id(0), { type: 'spawn', nodeId: '4-0' }, 0).state;
  assert.throws(() => applyAction(state, id(0), { type: 'spawn', nodeId: '4-4' }, 0), /이미 출발/);
  assert.throws(() => applyAction(state, id(0), { type: 'move', nodeId: '2-0' }, 0), /연결된/);
  state = applyAction(state, id(0), { type: 'move', nodeId: '4-1' }, 0).state;
  assert.equal(state.position, '4-1');
  assert.equal(state.event?.type, 'move');
  assert.equal(state.event?.until, 650);
  assert.throws(() => applyAction(state, id(0), { type: 'move', nodeId: '4-0' }, 649), /기다려/);
  state = applyAction(state, id(0), { type: 'move', nodeId: '4-0' }, 650).state;
  state = applyAction(state, id(0), { type: 'move', nodeId: '3-0' }, 1300).state;
  state = applyAction(state, id(0), { type: 'move', nodeId: '4-0' }, 1950).state;
  assert.equal(state.position, '4-0');
  assert.equal(state.activeSeat, 0);
  assert.equal(state.players[0].coins, 3);
});

test('explosion removes the pawn, holds the turn for four seconds, then clears all location history', () => {
  let state = playing([FIRST_MINE]);
  const before = JSON.stringify(state.boards);
  state = applyAction(state, id(0), { type: 'spawn', nodeId: '4-0' }, 0).state;
  state = applyAction(state, id(0), { type: 'move', nodeId: '3-0' }, 0).state;
  assert.equal(state.position, null);
  assert.equal(state.event?.type, 'explosion');
  assert.equal(state.event?.edgeId, FIRST_MINE);
  const deadline = state.event!.until;
  assert.equal(deadline, 4_000);
  assert.equal(state.activeSeat, 0);
  assert.strictEqual(advanceTime(state, deadline - 1), state);
  const beforeTransition = viewFor(state, id(1), deadline - 1);
  assert.equal(beforeTransition.activeSeat, 0);
  assert.equal(beforeTransition.boardOwnerSeat, 5);
  assert.equal(beforeTransition.event?.edgeId, FIRST_MINE);
  for (const action of [
    { type: 'hint', edgeId: FIRST_MINE }, { type: 'spawn', nodeId: '4-0' }, { type: 'move', nodeId: '3-0' },
  ] as GameAction[]) {
    assert.throws(() => applyAction(state, id(0), action, deadline - 1), /기다려/);
    assert.throws(() => applyAction(state, id(1), action, deadline - 1), /다른 플레이어/);
  }
  assert.equal(state.players[0].coins, 3);
  state = advanceTime(state, deadline);
  assert.equal(state.activeSeat, 1);
  assert.equal(state.attempts, 1);
  assert.equal(state.event, null);
  assert.equal(state.position, null);
  assert.equal(JSON.stringify(state.boards), before);
  assert.strictEqual(advanceTime(state, deadline), state);
  const publicView = viewFor(state, id(1), deadline);
  assert.equal(JSON.stringify(publicView).includes(FIRST_MINE), false);
  assert.equal('history' in publicView, false);
  assert.throws(() => applyAction(state, id(1), { type: 'spawn', nodeId: '3-0' }, deadline), /출발점/);
});

test('every six failures rotate all boards; five offsets exclude self and wrap by skipping offset six', () => {
  let state = playing([FIRST_MINE]);
  state = applyAction(state, id(0), { type: 'hint', edgeId: FIRST_MINE }, 0).state;
  let now = 0;
  const seen = Array.from({ length: 6 }, () => new Set<number>());
  for (let rotation = 1; rotation <= 5; rotation += 1) {
    assert.equal(state.rotation, rotation);
    for (let seat = 0; seat < 6; seat += 1) {
      const owner = boardOwnerSeat(state, seat);
      assert.notEqual(owner, seat);
      seen[seat].add(owner);
      assert.equal(state.activeSeat, seat);
      state = applyAction(state, id(seat), { type: 'spawn', nodeId: '4-0' }, now).state;
      state = applyAction(state, id(seat), { type: 'move', nodeId: '3-0' }, now).state;
      now = state.event!.until;
      state = advanceTime(state, now);
    }
    assert.equal(state.event?.type, 'rotation');
    assert.equal(state.activeSeat, 0);
    assert.equal(state.starterSeat, 0);
    assert.equal(state.attempts, 0);
    assert.equal(state.rotation, rotation === 5 ? 1 : rotation + 1);
    assert.throws(() => applyAction(state, id(0), { type: 'spawn', nodeId: '4-0' }, now), /기다려/);
    now = state.event!.until;
    state = advanceTime(state, now);
    assert.equal(state.event, null);
    assert.deepEqual(state.players.map((player) => player.coins), [2, 3, 3, 3, 3, 3]);
  }
  for (let seat = 0; seat < 6; seat += 1) assert.deepEqual([...seen[seat]].sort(), [0, 1, 2, 3, 4, 5].filter((other) => other !== seat));
});

test('legacy 2, 3, and 6 player circuits rotate through every other board and never their own', () => {
  for (const playerCount of [2, 3, 6]) {
    let state = playing([FIRST_MINE], { playerCount, hintCoins: 1, totalRounds: 2, gridSize: 4 });
    let now = 0;
    const seen = Array.from({ length: playerCount }, () => new Set<number>());
    for (let rotation = 1; rotation < playerCount; rotation += 1) {
      assert.equal(state.rotation, rotation);
      for (let seat = 0; seat < playerCount; seat += 1) {
        assert.equal(state.activeSeat, seat);
        const owner = boardOwnerSeat(state, seat);
        assert.notEqual(owner, seat);
        seen[seat].add(owner);
        state = applyAction(state, id(seat), { type: 'spawn', nodeId: '4-0' }, now).state;
        state = applyAction(state, id(seat), { type: 'move', nodeId: '3-0' }, now).state;
        now = state.event!.until;
        state = advanceTime(state, now);
      }
      assert.equal(state.event?.type, 'rotation');
      assert.equal(state.rotation, rotation === playerCount - 1 ? 1 : rotation + 1);
      assert.equal(state.activeSeat, 0);
      now = state.event!.until;
      state = advanceTime(state, now);
    }
    for (let seat = 0; seat < playerCount; seat += 1) {
      assert.deepEqual([...seen[seat]].sort((a, b) => a - b), Array.from({ length: playerCount }, (_, other) => other).filter((other) => other !== seat));
    }
  }
});

test('hints are repeatable private answers that cost one coin and never move or end a turn', () => {
  let state = playing([FIRST_MINE]);
  for (let remaining = 2; remaining >= 0; remaining -= 1) {
    const result = applyAction(deepFreeze(state), id(0), { type: 'hint', edgeId: FIRST_MINE }, 0);
    assert.deepEqual(result.privateResult, { edgeId: FIRST_MINE, mined: true });
    state = result.state;
    assert.equal(state.players[0].coins, remaining);
    assert.equal(state.activeSeat, 0);
    assert.equal(state.position, null);
    assert.equal(state.event, null);
    assert.equal('privateResult' in state, false);
    assert.equal('hintHistory' in state, false);
    const own = viewFor(state, id(0), 0);
    const other = viewFor(state, id(1), 0);
    assert.equal(own.players[0].coins, remaining);
    assert.equal('coins' in other.players[0], false);
    assert.equal(other.players[1].coins, 3);
    assert.equal(JSON.stringify(other).includes(FIRST_MINE), false);
    assert.equal(JSON.stringify(own).includes(FIRST_MINE), false);
  }
  assert.throws(() => applyAction(state, id(0), { type: 'hint', edgeId: FIRST_MINE }, 0), /모두 사용/);
  assert.throws(() => applyAction(playing(), id(0), { type: 'hint', edgeId: edge('4-0', '4-1') }, 0), /놓을 수 있는 길/);
  assert.throws(() => applyAction(playing(), id(0), { type: 'hint', edgeId: 'forged' }, 0), /놓을 수 있는 길/);
  const safe = applyAction(playing(), id(0), { type: 'hint', edgeId: FIRST_MINE }, 0);
  assert.deepEqual(safe.privateResult, { edgeId: FIRST_MINE, mined: false });
});

test('safe move details expire and projections cannot mutate internal state', () => {
  let state = applyAction(playing(), id(0), { type: 'spawn', nodeId: '4-0' }, 0).state;
  state = applyAction(state, id(0), { type: 'move', nodeId: '3-0' }, 0).state;
  const before = viewFor(state, id(1), 0);
  assert.equal(before.event?.edgeId, FIRST_MINE);
  before.players[0].score = 99;
  before.event!.edgeId = 'forged';
  assert.equal(state.players[0].score, 0);
  assert.equal(state.event!.edgeId, FIRST_MINE);
  const after = viewFor(state, id(1), 650);
  assert.equal(after.event, null);
  assert.equal(after.position, '3-0');
  assert.equal(JSON.stringify(after).includes(FIRST_MINE), false);
  assert.throws(() => viewFor(state, 'intruder'), /참가자/);
});

test('legacy winning scores 1 plus remaining hints; next round retains that score model and starts winner left', () => {
  let state = playing();
  state = applyAction(state, id(0), { type: 'hint', edgeId: FIRST_MINE }, 0).state;
  state = walk(state, ['4-0', '3-0', '2-0', '1-0', '0-0']);
  assert.equal(state.phase, 'roundEnd');
  assert.deepEqual(state.winner, { seat: 0, points: 3, remainingCoins: 2 });
  assert.equal(state.players[0].score, 3);
  assert.equal(state.position, GOAL);
  assert.equal(state.event, null);
  assert.throws(() => applyAction(state, id(0), { type: 'move', nodeId: '1-0' }), GameError);
  assert.throws(() => applyAction(state, id(1), { type: 'nextRound' }), /방장/);
  state = applyAction(state, id(0), { type: 'nextRound' }, 4000).state;
  assert.equal(state.phase, 'placing');
  assert.equal(state.round, 2);
  assert.equal(state.starterSeat, 1);
  assert.equal(state.activeSeat, 1);
  assert.equal(state.players[0].score, 3);
  assert.ok(state.players.every((player) => !player.ready && player.coins === 3));
  assert.deepEqual(state.boards, {});
  assert.equal(state.winner, null);
  assert.equal(state.position, null);
  assert.equal(state.rotation, 0);
});

test('seven actual rounds produce joint winners and only host can restart with clean scores', () => {
  let state = playing();
  for (let round = 1; round <= 7; round += 1) {
    assert.equal(state.round, round);
    assert.equal(state.activeSeat, (round - 1) % 6);
    if (state.boardMode === 'choice') state = applyAction(state, id(state.activeSeat), { type: 'chooseBoard', ownerSeat: (state.activeSeat + 1) % state.playerCount }, 0).state;
    if (round === 1 || round === 7) {
      // Seat zero scores two points twice; the five others score four once.
      for (let hint = 0; hint < 2; hint += 1) state = applyAction(state, id(state.activeSeat), { type: 'hint', edgeId: FIRST_MINE }, 0).state;
    }
    state = walk(state, ['4-0', '3-0', '2-0', '1-0', '0-0']);
    if (round < 7) {
      assert.equal(state.phase, 'roundEnd');
      state = applyAction(state, id(0), { type: 'nextRound' }, 10_000).state;
      state = commitAll(state);
    }
  }
  assert.equal(state.phase, 'finished');
  assert.deepEqual(state.players.map((player) => player.score), [4, 4, 4, 4, 4, 4]);
  assert.deepEqual(state.champions, [0, 1, 2, 3, 4, 5]);
  assert.throws(() => applyAction(state, id(0), { type: 'nextRound' }), GameError);
  assert.throws(() => applyAction(state, id(1), { type: 'restart' }), /방장/);
  state = applyAction(state, id(0), { type: 'restart' }).state;
  assert.equal(state.phase, 'waiting');
  assert.equal(state.round, 1);
  assert.equal(state.scoringMode, 'transfer');
  assert.ok(state.players.every((player) => player.score === 3 && player.coins === 3 && !player.ready));
  assert.deepEqual(state.boards, {});
  assert.deepEqual(state.champions, []);
});

test('configured coins reset each round and restart; chosen round counts determine game end', () => {
  for (const settings of [
    { playerCount: 2, hintCoins: 0, totalRounds: 1, gridSize: 4 },
    { playerCount: 2, hintCoins: 5, totalRounds: 3, gridSize: 4 },
  ]) {
    let state = playing([], settings);
    // Starting at the last seat exercises the winner-left wrap to seat zero.
    state = { ...state, activeSeat: 1, starterSeat: 1 };
    for (let round = 1; round <= settings.totalRounds; round += 1) {
      const winnerSeat = state.activeSeat;
      const winnerId = id(winnerSeat);
      if (state.boardMode === 'choice') state = applyAction(state, winnerId, { type: 'chooseBoard', ownerSeat: (winnerSeat + 1) % state.playerCount }, 0).state;
      assert.ok(state.players.every((player) => player.coins === settings.hintCoins));
      if (settings.hintCoins > 0) state = applyAction(state, winnerId, { type: 'hint', edgeId: FIRST_MINE }, 0).state;
      else assert.throws(() => applyAction(state, winnerId, { type: 'hint', edgeId: FIRST_MINE }, 0), /모두 사용/);
      const remainingCoins = Math.max(0, settings.hintCoins - 1);
      state = walk(state, ['4-0', '3-0', '2-0', '1-0', '0-0']);
      assert.deepEqual(state.winner, { seat: winnerSeat, remainingCoins, points: 1 + remainingCoins });
      assert.equal(state.phase, round === settings.totalRounds ? 'finished' : 'roundEnd');
      if (round < settings.totalRounds) {
        state = applyAction(state, id(0), { type: 'nextRound' }, 10_000).state;
        assert.equal(state.activeSeat, (winnerSeat + 1) % settings.playerCount);
        state = commitAll(state);
      }
    }
    assert.throws(() => applyAction(state, id(0), { type: 'settings', settings }), /지금은/);
    state = applyAction(state, id(0), { type: 'restart' }).state;
    assert.equal(state.round, 1);
    assert.equal(state.totalRounds, settings.totalRounds);
    assert.equal(state.playerCount, settings.playerCount);
    assert.equal(state.hintCoins, settings.hintCoins);
    assert.ok(state.players.every((player) => player.coins === settings.hintCoins && player.score === 3));
  }
});

test('malformed and forged actions fail without mutation or information disclosure', () => {
  const state = deepFreeze(playing([FIRST_MINE]));
  const before = JSON.stringify(state);
  const hostile: unknown[] = [null, {}, { type: 'reveal' }, { type: 'hint', edgeId: null }, { type: 'spawn', nodeId: {} }];
  for (const action of hostile) assert.throws(() => applyAction(state, id(0), action as GameAction, 0), GameError);
  const placement = deepFreeze(placing());
  for (const mines of [null, {}, [1], ['x'.repeat(500)], Array(100).fill(FIRST_MINE)]) {
    assert.throws(() => applyAction(placement, id(0), { type: 'place', mines } as GameAction, 0), GameError);
  }
  assert.equal(JSON.stringify(state), before);
});

test('capacity shrink keeps the first seats and growth fills from the waiting queue in order', () => {
  const settings = { playerCount: 6, hintCoins: 2, totalRounds: 2, gridSize: 5 };
  let state = waiting(settings);
  state = addPlayer(state, { id: 'queued-first', name: '먼저 대기' });
  state = addPlayer(state, { id: 'queued-second', name: '다음 대기' });
  state = applyAction(deepFreeze(state), id(0), { type: 'settings', settings: { ...settings, playerCount: 4 } }).state;
  assert.deepEqual(state.players.map((player) => player.id), [id(0), id(1), id(2), id(3)]);
  assert.deepEqual(state.spectators.map((guest) => guest.id), ['queued-first', 'queued-second', id(4), id(5)]);
  assert.deepEqual(state.players.map((player) => player.seat), [0, 1, 2, 3]);
  state = applyAction(state, id(0), { type: 'settings', settings: { ...settings, playerCount: 6 } }).state;
  assert.deepEqual(state.players.map((player) => player.id), [id(0), id(1), id(2), id(3), 'queued-first', 'queued-second']);
  assert.deepEqual(state.players.map((player) => player.seat), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(state.spectators.map((guest) => guest.id), [id(4), id(5)]);
  assert.ok(state.players.every((player) => player.coins === 2 && !player.ready));
});

test('only the lobby host assigns seats; demotion remains empty until explicit promotion or arrival', () => {
  let state = waiting({ ...DEFAULT_ROOM_SETTINGS, playerCount: 3 });
  state = addPlayer(state, { id: 'guest', name: '대기' });
  assert.throws(() => applyAction(state, id(1), { type: 'seat', playerId: id(0), seated: false }), (error) => error instanceof GameError && error.status === 403);
  assert.throws(() => applyAction(state, id(0), { type: 'seat', playerId: 'guest', seated: true }), /모두 찼/);
  state = applyAction(deepFreeze(state), id(0), { type: 'seat', playerId: id(1), seated: false }).state;
  assert.deepEqual(state.players.map((player) => [player.id, player.seat]), [[id(0), 0], [id(2), 1]]);
  assert.deepEqual(state.spectators.map((guest) => guest.id), ['guest', id(1)]);
  state = applyAction(state, id(0), { type: 'settings', settings: { ...DEFAULT_ROOM_SETTINGS, playerCount: 3, hintCoins: 5 } }).state;
  assert.equal(state.players.length, 2, 'unrelated settings preserve the host seat choice');
  assert.throws(() => applyAction(state, id(0), { type: 'start' }), /3명/);
  state = applyAction(state, id(0), { type: 'seat', playerId: 'guest', seated: true }).state;
  assert.equal(state.players[2].id, 'guest');
  assert.equal(state.players[2].coins, 5);
  assert.throws(() => applyAction(state, id(0), { type: 'seat', playerId: 'missing', seated: false }), /참가자/);
  state = applyAction(state, id(0), { type: 'start' }, 0).state;
  assert.throws(() => applyAction(state, id(0), { type: 'seat', playerId: id(2), seated: false }), /지금은/);
});

test('a spectating host controls rounds and returns to an editable lobby without receiving secrets', () => {
  const settings = { ...DEFAULT_ROOM_SETTINGS, playerCount: 2, totalRounds: 2 };
  let state = waiting(settings);
  state = addPlayer(state, { id: id(2), name: '세 번째' });
  state = applyAction(state, id(0), { type: 'seat', playerId: id(0), seated: false }).state;
  state = applyAction(state, id(0), { type: 'seat', playerId: id(2), seated: true }).state;
  state = applyAction(state, id(0), { type: 'start' }, 0).state;
  for (let round = 1; round <= 2; round++) {
    assert.equal('ownMines' in viewFor(state, id(0), 0), false);
    assert.ok(viewFor(state, id(0), 0).players.every((player) => !('coins' in player)));
    for (const player of state.players) state = applyAction(state, player.id,
      state.placementMode === 'retained' && !state.rebuildSeats?.includes(player.seat) ? { type: 'ready' } : { type: 'place', mines: [] }, 0).state;
    const actor = state.players[state.activeSeat].id;
    state = applyAction(state, actor, { type: 'chooseBoard', ownerSeat: (state.activeSeat + 1) % state.playerCount }, 0).state;
    state = applyAction(state, actor, { type: 'spawn', nodeId: '4-0' }, 0).state;
    let now = 0;
    for (const nodeId of ['3-0', '2-0', '1-0', '0-0']) {
      state = applyAction(state, actor, { type: 'move', nodeId }, now).state;
      now += 1_000;
    }
    assert.equal(state.phase, round === 2 ? 'finished' : 'roundEnd');
    if (round === 1) state = applyAction(state, id(0), { type: 'nextRound' }, now).state;
  }
  const audienceBefore = state.spectators.map((guest) => guest.id);
  state = applyAction(state, id(0), { type: 'restart' }, 10_000).state;
  assert.equal(state.phase, 'waiting');
  assert.equal(state.round, 1);
  assert.equal(state.position, null);
  assert.equal(state.event, null);
  assert.equal(state.winner, null);
  assert.deepEqual(state.boards, {});
  assert.deepEqual(state.champions, []);
  assert.deepEqual(state.spectators.map((guest) => guest.id), audienceBefore);
  assert.ok(state.players.every((player) => player.score === 3 && player.coins === settings.hintCoins && !player.ready));
  state = applyAction(state, id(0), { type: 'settings', settings: { ...settings, gridSize: 6 } }).state;
  assert.equal(state.gridSize, 6);
});

test('late arrivals only observe public ephemeral play and cannot place, spawn, move or ask hints', () => {
  let state = addPlayer(placing(), { id: 'audience', name: '관전자' });
  const audienceView = viewFor(state, 'audience', 0);
  assert.equal('ownMines' in audienceView, false);
  assert.ok(audienceView.players.every((player) => !('coins' in player)));
  audienceView.spectators[0].name = 'changed';
  assert.equal(state.spectators[0].name, '관전자');
  for (const action of [
    { type: 'place', mines: [] }, { type: 'spawn', nodeId: '4-0' },
    { type: 'move', nodeId: '3-0' }, { type: 'hint', edgeId: FIRST_MINE },
  ] as GameAction[]) {
    assert.throws(() => applyAction(state, 'audience', action, 0), (error) => error instanceof GameError && error.status === 403);
  }
  state = commitAll(state, [FIRST_MINE]);
  state = addPlayer(state, { id: 'later', name: '뒤늦은 관전자' });
  assert.equal(state.players.length, 6);
  state = applyAction(state, id(0), { type: 'spawn', nodeId: '4-0' }, 0).state;
  state = applyAction(state, id(0), { type: 'move', nodeId: '3-0' }, 0).state;
  assert.equal(viewFor(state, 'later', 0).event?.edgeId, FIRST_MINE);
  const deadline = state.event!.until;
  assert.equal(viewFor(state, 'later', deadline).event, null);
  assert.equal(JSON.stringify(viewFor(state, 'later', deadline)).includes(FIRST_MINE), false);
});

test('room participant cap includes seats and spectators while preserving identities', () => {
  let state = waiting();
  for (let i = 6; i < 32; i++) state = addPlayer(state, { id: id(i), name: `참가자 ${i}` });
  assert.equal(state.players.length, 6);
  assert.equal(state.spectators.length, 26);
  assert.throws(() => addPlayer(state, { id: 'extra', name: '초과' }), /32명/);
  assert.throws(() => addPlayer(state, { id: id(31), name: '중복' }), /이미 참가/);
});

test('each grid difficulty validates its own base, placement, spawn and route to victory', () => {
  for (const gridSize of [3, 4, 5, 6]) {
    let state = placing({ ...DEFAULT_ROOM_SETTINGS, playerCount: 2, totalRounds: 1, gridSize });
    const base = edge(`${gridSize}-0`, `${gridSize}-1`);
    const firstMine = edge(`${gridSize}-0`, `${gridSize - 1}-0`);
    assert.throws(() => applyAction(state, id(0), { type: 'place', mines: [base] }), /출발점/);
    assert.throws(() => applyAction(state, id(0), { type: 'place', mines: [edge(`${gridSize}-0`, `${gridSize + 1}-0`)] }), /판에 없는/);
    state = commitAll(state, [firstMine]);
    assert.equal(viewFor(state, id(0), 0).gridSize, gridSize);
    assert.throws(() => applyAction(state, id(0), { type: 'spawn', nodeId: `${gridSize - 1}-0` }, 0), /출발점/);
    const hint = applyAction(state, id(0), { type: 'hint', edgeId: firstMine }, 0);
    assert.equal(hint.privateResult?.mined, true);
    state = hint.state;
    // Use the opposite edge so the known mine stays intact.
    state = walk(state, Array.from({ length: gridSize + 1 }, (_, i) => `${gridSize - i}-${gridSize - i}`));
    assert.equal(state.phase, 'finished');
    assert.equal(state.position, GOAL);
    assert.equal(state.winner?.points, 3);
  }
});

test('every difficulty accepts the unique-mine boundary and rejects one extra mine despite a safe route', () => {
  for (const gridSize of [3, 4, 5, 6]) {
    const state = deepFreeze(placing({ ...DEFAULT_ROOM_SETTINGS, playerCount: 2, gridSize }));
    const route = Array.from({ length: gridSize + 1 }, (_, row) => `${row}-0`);
    const safe = new Set(route.slice(1).map((node, index) => edge(route[index], node)));
    const candidates = getBoard(gridSize).edges.filter((entry) => !entry.base && !safe.has(entry.id)).map((entry) => entry.id);
    const boundary = candidates.slice(0, maxMines(gridSize));
    const excessive = candidates.slice(0, maxMines(gridSize) + 1);
    assert.ok(hasSafePath(excessive, gridSize));
    assert.throws(() => applyAction(state, id(0), { type: 'place', mines: excessive }, 0), /최대.*개/);
    assert.equal(state.players[0].ready, false);
    assert.deepEqual(state.boards, {});
    const accepted = applyAction(state, id(0), { type: 'place', mines: [...boundary, boundary[0]] }, 0).state;
    assert.equal(accepted.players[0].ready, true);
    assert.deepEqual(accepted.boards[id(0)], boundary);
    assert.deepEqual(viewFor(accepted, id(0), 0).ownMines, boundary);
  }
});

test('existing committed dense boards survive completing placement and expose the actual mine count', () => {
  let state = placing({ ...DEFAULT_ROOM_SETTINGS, playerCount: 2 });
  const safe = new Set(['4-0', '3-0', '2-0', '1-0', '0-0'].slice(1).map((node, index) => edge(`${4 - index}-0`, node)));
  const dense = EDGES.filter((entry) => !entry.base && !safe.has(entry.id)).map((entry) => entry.id);
  assert.ok(dense.length > maxMines() && hasSafePath(dense));
  state = { ...state, boards: { [id(1)]: dense }, players: state.players.map((player) => ({ ...player, ready: player.seat === 1 })) };
  state = applyAction(state, id(0), { type: 'place', mines: [] }, 0).state;
  assert.equal(state.phase, 'playing');
  assert.deepEqual(state.boards[id(1)], dense);
  assert.equal(viewFor(state, id(0), 0).activeBoardMineCount, dense.length);
  assert.equal(walk(state, ['4-0', '3-0', '2-0', '1-0', '0-0']).phase, 'roundEnd');
});

test('all players and spectators see only the current board mine count, including after explosions and rotations', () => {
  let state = addPlayer(placing({ ...DEFAULT_ROOM_SETTINGS, playerCount: 3 }), { id: 'audience', name: '관전' });
  const extras = [edge('3-1', '4-1'), edge('3-2', '4-2')];
  for (let seat = 0; seat < 3; seat++) state = applyAction(state, id(seat), { type: 'place', mines: [FIRST_MINE, ...extras.slice(0, seat)] }, 0).state;
  let now = 0;
  const verify = () => {
    for (const participant of [...state.players, ...state.spectators]) {
      const view = viewFor(state, participant.id, now);
      assert.equal('revealedBoards' in view, false);
      assert.equal('boards' in view, false);
      assert.equal('ownMines' in view, false);
      assert.equal(view.activeBoardMineCount, boardOwnerSeat(state) + 1);
    }
  };
  for (let circuit = 0; circuit < 3; circuit++) {
    for (let seat = 0; seat < 3; seat++) {
      verify();
      state = applyAction(state, id(seat), { type: 'spawn', nodeId: '4-0' }, now).state;
      state = applyAction(state, id(seat), { type: 'move', nodeId: '3-0' }, now).state;
      verify();
      now = state.event!.until;
      state = advanceTime(state, now);
    }
    verify();
    now = state.event!.until;
    state = advanceTime(state, now);
  }
  const empty = addPlayer(playing(), { id: 'audience', name: '관전' });
  for (const participant of [...empty.players, ...empty.spectators]) {
    assert.equal(viewFor(empty, participant.id, 0).activeBoardMineCount, 0);
  }
});

test('all players and spectators see copied answer boards only after each round, with no previous-round reveal', () => {
  let state = addPlayer(placing({ ...DEFAULT_ROOM_SETTINGS, playerCount: 2, totalRounds: 2 }), { id: 'audience', name: '관전' });
  const participants = [id(0), id(1), 'audience'];
  for (let round = 1; round <= 2; round++) {
    for (const participant of participants) {
      const view = viewFor(state, participant, 0);
      assert.equal('revealedBoards' in view, false);
      assert.equal('activeBoardMineCount' in view, false);
    }
    state = applyAction(state, id(0), { type: 'place', mines: [FIRST_MINE] }, 0).state;
    state = applyAction(state, id(1), { type: 'place', mines: [] }, 0).state;
    for (const participant of participants) assert.equal('revealedBoards' in viewFor(state, participant, 0), false);
    state = walk(state, ['4-4', '3-3', '2-2', '1-1', '0-0']);
    assert.equal(state.phase, round === 1 ? 'roundEnd' : 'finished');
    for (const participant of participants) {
      const view = viewFor(state, participant, 5_000);
      assert.deepEqual(view.revealedBoards, { [id(0)]: [FIRST_MINE], [id(1)]: [] });
      assert.equal('activeBoardMineCount' in view, false);
      assert.equal('ownMines' in view, false);
      view.revealedBoards![id(0)].push('forged');
      view.revealedBoards![id(1)] = ['forged'];
      assert.deepEqual(state.boards, { [id(0)]: [FIRST_MINE], [id(1)]: [] });
    }
    if (round === 1) state = applyAction(state, id(0), { type: 'nextRound' }, 5_000).state;
  }
  state = applyAction(state, id(0), { type: 'restart' }, 5_000).state;
  assert.equal(state.phase, 'waiting');
  for (const participant of participants) {
    assert.equal('revealedBoards' in viewFor(state, participant, 5_000), false);
    assert.equal('activeBoardMineCount' in viewFor(state, participant, 5_000), false);
  }
});
