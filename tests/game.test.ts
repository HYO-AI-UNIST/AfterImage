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
  hasSafePath,
  randomBoard,
  viewFor,
} from '../lib/game.ts';
import type { GameAction, GameState } from '../lib/contracts.ts';

const id = (seat: number) => `player-${seat}`;
const edge = (a: string, b: string) => [a, b].sort().join('~');
const FIRST_MINE = edge('4-0', '3-0');

function waiting(): GameState {
  let state = createRoom('MIND42', { id: id(0), name: '플레이어 1' });
  for (let seat = 1; seat < 6; seat += 1) state = addPlayer(state, { id: id(seat), name: `플레이어 ${seat + 1}` });
  return state;
}

function placing(): GameState {
  const state = applyAction(waiting(), id(0), { type: 'start' }, 0).state;
  // Fixture chooses a known starting seat; the production engine chooses randomly.
  return { ...state, starterSeat: 0, activeSeat: 0 };
}

function commitAll(state: GameState, mines: string[] = []): GameState {
  for (let seat = 0; seat < 6; seat += 1) state = applyAction(state, id(seat), { type: 'place', mines }, 0).state;
  return state;
}

function playing(mines: string[] = []): GameState {
  return commitAll(placing(), mines);
}

function walk(state: GameState, route: string[], now = 0): GameState {
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

test('placement validates reachability and accepts winding routes, not only upward paths', () => {
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
  assert.equal(walk(playing(mines), route).phase, 'roundEnd');
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
  assert.throws(() => addPlayer(room, { id: 'seventh', name: 'Extra' }), /가득/);
  assert.throws(() => addPlayer(one, { id: id(0), name: 'Duplicate' }), /이미 참가/);
  const state = applyAction(room, id(0), { type: 'start' }).state;
  assert.equal(state.phase, 'placing');
  assert.ok(state.starterSeat >= 0 && state.starterSeat < 6);
  assert.equal(state.activeSeat, state.starterSeat);
  assert.equal(state.totalRounds, 7);
  assert.throws(() => addPlayer(state, { id: 'late', name: 'Late' }), /이미 시작/);
  assert.throws(() => applyAction(state, id(0), { type: 'start' }), GameError);
  assert.throws(() => applyAction(state, id(0), { type: 'restart' }), GameError);
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

test('explosion removes the pawn and retains the mine, then clears all location history', () => {
  let state = playing([FIRST_MINE]);
  const before = JSON.stringify(state.boards);
  state = applyAction(state, id(0), { type: 'spawn', nodeId: '4-0' }, 0).state;
  state = applyAction(state, id(0), { type: 'move', nodeId: '3-0' }, 0).state;
  assert.equal(state.position, null);
  assert.equal(state.event?.type, 'explosion');
  assert.equal(state.event?.edgeId, FIRST_MINE);
  assert.equal(state.activeSeat, 0);
  assert.strictEqual(advanceTime(state, 1799), state);
  assert.throws(() => applyAction(state, id(0), { type: 'hint', edgeId: FIRST_MINE }, 500), /기다려/);
  assert.throws(() => applyAction(state, id(0), { type: 'spawn', nodeId: '4-0' }, 500), /기다려/);
  state = advanceTime(state, 1800);
  assert.equal(state.activeSeat, 1);
  assert.equal(state.attempts, 1);
  assert.equal(state.event, null);
  assert.equal(state.position, null);
  assert.equal(JSON.stringify(state.boards), before);
  const publicView = viewFor(state, id(1), 1800);
  assert.equal(JSON.stringify(publicView).includes(FIRST_MINE), false);
  assert.equal('history' in publicView, false);
  assert.throws(() => applyAction(state, id(1), { type: 'spawn', nodeId: '3-0' }, 1800), /출발점/);
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

test('winning scores 1 plus remaining hints; next round resets boards and starts winner left', () => {
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
  assert.equal(state.phase, 'placing');
  assert.equal(state.round, 1);
  assert.ok(state.players.every((player) => player.score === 0 && player.coins === 3 && !player.ready));
  assert.deepEqual(state.boards, {});
  assert.deepEqual(state.champions, []);
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
