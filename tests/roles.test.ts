import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameAction, GameState, RoleId } from '../lib/contracts.ts';
import { addPlayer, advanceTime, applyAction, boardOwnerSeat, createRoom, edgeId, GameError, getBoard, viewFor } from '../lib/game.ts';
import { availableRoles, baseMemoSlots, MAX_CONCEALED_EDGES, MAX_MINE_SHIFTS, memoCapacity, randomRole, ROLE_IDS, roundHintCoins } from '../lib/roles.ts';

const id = (seat: number) => `role-player-${seat}`;
const firstMine = edgeId('4-0', '3-0');
const secondEdge = edgeId('4-1', '3-1');
const thirdEdge = edgeId('4-2', '3-2');

function placing(count = 6, roles: Partial<Record<number, RoleId>> = {}): GameState {
  let state = createRoom('ROLES', { id: id(0), name: '플레이어 1' });
  state = applyAction(state, id(0), { type: 'settings', settings: { playerCount: count, hintCoins: 3, totalRounds: 7, gridSize: 4 } }, 0).state;
  for (let seat = 1; seat < count; seat++) state = addPlayer(state, { id: id(seat), name: `플레이어 ${seat + 1}` });
  state = applyAction(state, id(0), { type: 'start' }, 0).state;
  // Exercise persisted rotation rounds separately from choice-mode coverage.
  state = { ...state, starterSeat: 0, activeSeat: 0, boardMode: undefined, scoringMode: undefined, placementMode: undefined,
    players: state.players.map(player => ({ ...player, score: 0 })) };
  for (const player of state.players) state = applyAction(state, player.id, { type: 'chooseRole', role: roles[player.seat] ?? 'trapper' }, 0).state;
  return state;
}

function playing(count = 6, roles: Partial<Record<number, RoleId>> = {}, mines: string[] = [firstMine]): GameState {
  let state = placing(count, roles);
  for (const player of state.players) state = applyAction(state, player.id, { type: 'place', mines }, 0).state;
  return state;
}

function explode(state: GameState, now = 0): GameState {
  const actor = state.players[state.activeSeat].id;
  state = applyAction(state, actor, { type: 'spawn', nodeId: '4-0' }, now).state;
  return applyAction(state, actor, { type: 'move', nodeId: '3-0' }, now).state;
}

function freeze<T>(object: T): T {
  if (object && typeof object === 'object') {
    Object.freeze(object);
    for (const value of Object.values(object)) freeze(value);
  }
  return object;
}

test('new rooms enable manual roles; two-player games exclude unusable memo roles', () => {
  assert.equal(createRoom('ROLES', { id: id(0), name: '나' }).rolesEnabled, true);
  assert.deepEqual(Array.from({ length: 7 }, (_, index) => baseMemoSlots(index + 2)), [0, 1, 1, 2, 2, 3, 3]);
  assert.equal(memoCapacity(6, 'recorder'), 4);
  assert.equal(memoCapacity(8, 'recorder'), 6);
  assert.equal(roundHintCoins(0, 'illuminator'), 2);
  assert.deepEqual(ROLE_IDS.map((_, index) => randomRole(6, () => index / ROLE_IDS.length)), ROLE_IDS);
  const twoRoles = Array.from({ length: 100 }, (_, index) => randomRole(2, () => index / 100));
  assert.ok(twoRoles.every((role) => role !== 'thief' && role !== 'recorder'));
  assert.deepEqual(availableRoles(2), ['illuminator', 'guardian', 'trapper', 'shifter']);
});

test('manual role choices allow duplicates, require selection, and lock immediately', () => {
  let state = placing(3);
  state = { ...state, players: state.players.map((player) => ({ ...player, role: undefined })) };
  assert.throws(() => applyAction(state, id(0), { type: 'place', mines: [] }, 0), /특수 능력을 선택/);
  state = applyAction(state, id(0), { type: 'chooseRole', role: 'illuminator' }, 0).state;
  state = applyAction(state, id(1), { type: 'chooseRole', role: 'illuminator' }, 0).state;
  assert.equal(state.players[0].coins, 5);
  assert.equal(state.players[1].coins, 5);
  assert.equal(state.players[0].role, state.players[1].role);
  assert.throws(() => applyAction(state, id(0), { type: 'chooseRole', role: 'guardian' }, 0), /이미 확정/);
  assert.equal(state.players[0].coins, 5);
  assert.equal(state.players[0].blessings, 0);
  assert.equal(state.players[1].coins, 5);
  assert.equal(state.players[1].roleRevision, state.revision);
  assert.ok(state.players[1].roleRevision! > state.players[0].roleRevision!);
  assert.equal('roleRevision' in viewFor(state, id(0), 0).players[0], false);
  state = applyAction(state, id(0), { type: 'place', mines: [] }, 0).state;
  assert.throws(() => applyAction(state, id(0), { type: 'chooseRole', role: 'thief' }, 0), /완료한 뒤/);
  assert.throws(() => applyAction(state, id(2), { type: 'chooseRole', role: 'invented' } as unknown as GameAction, 0), /특수 능력을 선택/);
  for (const role of ['thief', 'recorder'] as const) assert.throws(() => applyAction(placing(2), id(0), { type: 'chooseRole', role }, 0), /특수 능력을 선택/);
  assert.throws(() => applyAction(playing(), id(0), { type: 'chooseRole', role: 'guardian' }, 0), /지금은/);
});

test('legacy illuminator receives bonus hint points and public role does not expose resources', () => {
  let state = addPlayer(playing(6, { 0: 'illuminator', 1: 'guardian', 2: 'thief' }, []), { id: 'audience', name: '관전' });
  assert.equal(state.players[0].coins, 5);
  const audience = viewFor(state, 'audience', 0);
  assert.equal(audience.players[0].role, 'illuminator');
  assert.ok(audience.players.every((player) => !('coins' in player) && !('blessings' in player) && !('peeks' in player) && !('shifts' in player)));
  assert.equal('selfMemos' in audience, false);
  state = applyAction(state, id(0), { type: 'spawn', nodeId: '4-0' }, 0).state;
  let now = 0;
  for (const nodeId of ['3-0', '2-0', '1-0', '0-0']) {
    state = applyAction(state, id(0), { type: 'move', nodeId }, now).state;
    now += 650;
  }
  assert.deepEqual(state.winner, { seat: 0, points: 6, remainingCoins: 5 });
});

test('guardian waits for visible explosion, then may restart twice from base in the same turn', () => {
  let state = explode(playing(3, { 0: 'guardian' }));
  const originalBoards = JSON.stringify(state.boards);
  assert.equal(state.event?.until, 4_000);
  assert.equal(state.blessingSeat, null);
  assert.throws(() => applyAction(state, id(0), { type: 'blessing', use: true }, 3_999), /폭발이 끝난 뒤/);
  state = advanceTime(state, 4_000);
  assert.equal(state.event, null);
  assert.equal(state.blessingSeat, 0);
  assert.equal(state.activeSeat, 0);
  assert.equal(state.attempts, 0);
  assert.strictEqual(advanceTime(state, 999_999), state, 'choice never expires automatically');
  for (const action of [{ type: 'spawn', nodeId: '4-0' }, { type: 'hint', edgeId: firstMine }] as GameAction[]) {
    assert.throws(() => applyAction(state, id(0), action, 4_000), /가호를 사용할지/);
  }
  assert.throws(() => applyAction(state, id(1), { type: 'blessing', use: true }, 4_000), /폭발이 끝난 뒤/);
  state = applyAction(state, id(0), { type: 'blessing', use: true }, 4_000).state;
  assert.equal(state.position, null);
  assert.equal(state.players[0].blessings, 1);
  assert.throws(() => applyAction(state, id(0), { type: 'spawn', nodeId: '3-0' }, 4_000), /밑변/);
  state = explode(state, 4_000);
  state = applyAction(state, id(0), { type: 'blessing', use: true }, 8_000).state;
  assert.equal(state.activeSeat, 0);
  assert.equal(state.players[0].blessings, 0);
  state = advanceTime(explode(state, 8_000), 12_000);
  assert.equal(state.activeSeat, 1);
  assert.equal(state.attempts, 1);
  assert.equal(state.blessingSeat, null);
  assert.equal(JSON.stringify(state.boards), originalBoards);
});

test('declining blessing ends the failed attempt and rotates correctly at the final seat', () => {
  let state = playing(2, { 1: 'guardian' });
  state = { ...state, activeSeat: 1, attempts: 1 };
  state = advanceTime(explode(state), 4_000);
  assert.equal(state.blessingSeat, 1);
  state = applyAction(state, id(1), { type: 'blessing', use: false }, 4_000).state;
  assert.equal(state.activeSeat, 0);
  assert.equal(state.event?.type, 'rotation');
  assert.equal(state.players[1].blessings, 2);
  assert.equal(state.blessingSeat, null);
});

test('camouflage hides both true and false hints, consumes coins, and remains private', () => {
  let state = placing(3, { 2: 'trapper' });
  const concealed = [firstMine, secondEdge];
  for (const player of state.players) state = applyAction(state, player.id, { type: 'place', mines: [firstMine], ...(player.role === 'trapper' ? { concealed } : {}) }, 0).state;
  assert.equal(boardOwnerSeat(state), 2);
  for (const edgeId of concealed) {
    const result = applyAction(state, id(0), { type: 'hint', edgeId }, 0);
    state = result.state;
    assert.deepEqual(result.privateResult, { edgeId, mined: null });
  }
  assert.equal(state.players[0].coins, 1);
  for (const player of state.players) {
    const view = viewFor(state, player.id, 0);
    assert.equal('concealedBoards' in view, false);
    assert.equal('ownConcealed' in view, false);
    assert.equal('privateResult' in view, false);
  }
  const openHint = applyAction(state, id(0), { type: 'hint', edgeId: thirdEdge }, 0);
  assert.equal(openHint.privateResult?.mined, false);
});

test('camouflage accepts four safe or mined edges and rejects invalid or excessive choices', () => {
  const state = freeze(placing(3, { 0: 'trapper', 1: 'guardian' }));
  const candidates = getBoard().edges.filter((edge) => !edge.base).map((edge) => edge.id);
  const accepted = applyAction(state, id(0), { type: 'place', mines: [firstMine], concealed: [firstMine, ...candidates.filter((edge) => edge !== firstMine).slice(0, 3)] }, 0).state;
  assert.equal(accepted.concealedBoards?.[id(0)].length, MAX_CONCEALED_EDGES);
  for (const concealed of [['forged'], [edgeId('4-0', '4-1')], candidates.slice(0, 5), null, {}]) {
    assert.throws(() => applyAction(state, id(0), { type: 'place', mines: [], concealed } as unknown as GameAction, 0));
  }
  assert.throws(() => applyAction(state, id(1), { type: 'place', mines: [], concealed: [firstMine] }, 0), /기만의 장막 능력/);
  assert.deepEqual(state.boards, {});
});

test('manual memos allow wrong guesses on any board, stay private, and recorder doubles slots', () => {
  let state = playing(6, { 0: 'recorder' });
  const entry = { boardOwnerId: id(2), edgeId: firstMine, status: 'safe' as const };
  state = applyAction(freeze(state), id(0), { type: 'memo', slot: 3, entry }, 0).state;
  assert.deepEqual(state.memos?.[id(0)]?.[3], entry, 'wrong guess is stored without reading the mine');
  assert.equal(viewFor(state, id(0), 0).selfMemos?.length, 4);
  assert.deepEqual(viewFor(state, id(1), 0).selfMemos, [null, null]);
  assert.equal(JSON.stringify(viewFor(state, id(1), 0)).includes(firstMine), false);
  const self = viewFor(state, id(0), 0);
  self.selfMemos![3]!.status = 'mine';
  assert.equal(state.memos?.[id(0)]?.[3]?.status, 'safe');
  const otherWritten = applyAction(state, id(1), { type: 'memo', slot: 0, entry }, 0).state;
  assert.deepEqual(viewFor(otherWritten, id(1), 0).selfMemos?.[0], entry, 'another player may record during the active turn');
  assert.deepEqual(viewFor(otherWritten, id(0), 0).selfMemos?.[3], entry, 'the other player cannot overwrite my notes');
  for (const action of [
    { type: 'memo', slot: 4, entry }, { type: 'memo', slot: -1, entry }, { type: 'memo', slot: 1.5, entry },
    { type: 'memo', slot: 0, entry: { ...entry, boardOwnerId: 'unknown' } },
    { type: 'memo', slot: 0, entry: { ...entry, edgeId: 'forged' } },
    { type: 'memo', slot: 0, entry: { ...entry, status: 'confirmed' } },
    { type: 'memo', slot: 0, entry: { ...entry, note: 'unbounded free text' } },
  ]) assert.throws(() => applyAction(state, id(0), action as GameAction, 0));
  state = applyAction(state, id(0), { type: 'memo', slot: 3, entry: null }, 0).state;
  assert.deepEqual(state.memos?.[id(0)], [null, null, null, null]);
  assert.throws(() => applyAction(playing(2), id(0), { type: 'memo', slot: 0, entry: null }, 0), /메모 슬롯/);
});

test('memos can be created, corrected and deleted during another turn, animations and pending abilities without changing play', () => {
  let moving = applyAction(playing(), id(0), { type: 'spawn', nodeId: '4-4' }, 0).state;
  moving = applyAction(moving, id(0), { type: 'move', nodeId: '3-3' }, 0).state;
  const exploded = explode(playing());
  const beforeRotation = { ...playing(), activeSeat: 5, attempts: 5 };
  const rotation = advanceTime(explode(beforeRotation), 4_000);
  const blessing = advanceTime(explode(playing(3, { 0: 'guardian' })), 4_000);
  const beforeShift = { ...playing(3, { 0: 'shifter' }), rotation: 2, activeSeat: 2, attempts: 2 };
  const shifting = advanceTime(explode(beforeShift), 4_000);
  const cases = [
    { label: 'another turn', initial: playing(), now: 0 },
    { label: 'movement', initial: moving, now: 300 },
    { label: 'explosion', initial: exploded, now: 2_000 },
    { label: 'rotation', initial: rotation, now: 4_500 },
    { label: 'blessing decision', initial: blessing, now: 4_000 },
    { label: 'mine shift decision', initial: shifting, now: 4_000 },
  ];
  for (const { label, initial, now } of cases) {
    const gameplay = (state: GameState) => ({
      phase: state.phase, event: state.event, position: state.position, activeSeat: state.activeSeat,
      attempts: state.attempts, rotation: state.rotation, blessingSeat: state.blessingSeat,
      shiftQueue: state.shiftQueue, boards: state.boards,
      resources: state.players.map(({ id, coins, score, blessings, peeks, shifts }) => ({ id, coins, score, blessings, peeks, shifts })),
    });
    const before = gameplay(initial);
    const note = { boardOwnerId: id(2), edgeId: firstMine, status: 'safe' as const };
    for (const actor of [0, 1]) {
      let state = initial;
      for (const entry of [note, { ...note, status: 'mine' as const }, null]) {
        state = applyAction(freeze(state), id(actor), { type: 'memo', slot: 0, entry }, now).state;
        assert.deepEqual(viewFor(state, id(actor), now).selfMemos?.[0], entry, label);
        assert.deepEqual(gameplay(state), before, `${label}: notes must not change the turn, event or resources`);
        assert.ok(viewFor(state, id(actor === 0 ? 1 : 0), now).selfMemos?.every(value => value === null), `${label}: notes remain private`);
      }
    }
  }
});

test('memo editing is limited to playing phases while peek still requires an uninterrupted own turn', () => {
  const note = { boardOwnerId: id(2), edgeId: firstMine, status: 'unsure' as const };
  for (const phase of ['waiting', 'placing', 'roundEnd', 'finished'] as const) {
    const state = { ...playing(3), phase };
    assert.throws(() => applyAction(freeze(state), id(1), { type: 'memo', slot: 0, entry: note }, 0), GameError, phase);
    assert.throws(() => applyAction(state, id(1), { type: 'memo', slot: 0, entry: null }, 0), GameError, phase);
  }
  let state = playing(3, { 0: 'thief', 1: 'thief' });
  state = applyAction(state, id(2), { type: 'memo', slot: 0, entry: note }, 0).state;
  const targets = [{ playerId: id(2), slot: 0 }];
  assert.throws(() => applyAction(state, id(1), { type: 'peek', targets }, 0), error => error instanceof GameError && error.status === 409);
  state = explode(state);
  assert.throws(() => applyAction(state, id(0), { type: 'peek', targets }, 500), error => error instanceof GameError && error.status === 409);
  assert.equal(state.players[0].peeks, 2);
  assert.equal(state.players[1].peeks, 2);
});

test('thief selects occupied hidden slots across owners twice and receives only ephemeral private replies', () => {
  let state = playing(6, { 0: 'thief', 1: 'recorder' });
  state.memos = {
    [id(1)]: [{ boardOwnerId: id(4), edgeId: firstMine, status: 'safe' }, null, { boardOwnerId: id(0), edgeId: secondEdge, status: 'unsure' }],
    [id(2)]: [{ boardOwnerId: id(3), edgeId: thirdEdge, status: 'mine' }],
  };
  const view = viewFor(state, id(0), 0);
  assert.deepEqual(view.peekableMemos, [{ playerId: id(1), slot: 0 }, { playerId: id(1), slot: 2 }, { playerId: id(2), slot: 0 }]);
  assert.ok(!JSON.stringify(view).includes(firstMine) && !JSON.stringify(view).includes(secondEdge));
  const targets = [{ playerId: id(1), slot: 0 }, { playerId: id(2), slot: 0 }];
  const first = applyAction(freeze(state), id(0), { type: 'peek', targets }, 0);
  state = first.state;
  assert.equal(first.peekResult?.length, 2);
  assert.equal(first.peekResult?.[0].status, 'safe');
  assert.equal(state.players[0].peeks, 1);
  assert.deepEqual(viewFor(state, id(0), 0).selfMemos, [null, null]);
  assert.equal('peekResult' in state, false);
  first.peekResult![0].status = 'mine';
  assert.equal(state.memos?.[id(1)]?.[0]?.status, 'safe');
  for (const badTargets of [[], [targets[0], targets[0]], [{ playerId: id(1), slot: 1 }], [{ playerId: id(0), slot: 0 }], [targets[0], targets[1], { playerId: id(1), slot: 2 }]]) {
    assert.throws(() => applyAction(state, id(0), { type: 'peek', targets: badTargets }, 0));
  }
  state = applyAction(state, id(0), { type: 'peek', targets: [{ playerId: id(1), slot: 2 }] }, 0).state;
  assert.equal(state.players[0].peeks, 0);
  assert.throws(() => applyAction(state, id(0), { type: 'peek', targets }, 0), /모두 사용/);
  assert.equal('peekableMemos' in viewFor(state, id(1), 0), false);
});

test('returning own boards queues shifters privately; moves keep notes and mine totals unchanged', () => {
  let state = playing(3, { 0: 'shifter', 2: 'shifter' });
  state = { ...state, rotation: 2, activeSeat: 2, attempts: 2, memos: { [id(1)]: [{ boardOwnerId: id(0), edgeId: firstMine, status: 'mine' }] } };
  state = advanceTime(explode(state), 4_000);
  assert.deepEqual(state.shiftQueue, [0, 2]);
  assert.equal(state.event, null);
  for (const player of state.players) {
    assert.notEqual(boardOwnerSeat(state, player.seat), player.seat);
    const view = viewFor(state, player.id, 4_000);
    assert.equal(view.shiftSeat, 0);
    assert.equal('shiftMines' in view, player.seat === 0);
    assert.equal('boards' in view, false);
  }
  assert.throws(() => applyAction(state, id(0), { type: 'spawn', nodeId: '4-0' }, 4_000), /지뢰 이동 선택/);
  assert.throws(() => applyAction(state, id(2), { type: 'shiftMine' }, 4_000), /지뢰 이동 선택 시간/);
  const moved = applyAction(freeze(state), id(0), { type: 'shiftMine', fromEdgeId: firstMine, toEdgeId: secondEdge }, 4_000).state;
  assert.deepEqual(moved.boards[id(0)], [secondEdge]);
  assert.deepEqual(moved.memos, state.memos);
  assert.deepEqual(moved.shiftQueue, [2]);
  assert.equal(moved.players[0].shifts, 6);
  assert.equal(moved.players[2].shifts, 7);
  assert.equal('shiftMines' in viewFor(moved, id(0), 4_000), false);
  state = applyAction(moved, id(2), { type: 'shiftMine' }, 4_000).state;
  assert.deepEqual(state.shiftQueue, []);
  assert.equal(state.players[2].shifts, 7, 'passing the board does not consume a move');
  assert.equal(state.rotation, 1);
  assert.equal(state.activeSeat, 0);
  assert.equal(state.attempts, 0);
  assert.equal(state.event?.type, 'rotation');
  assert.equal(state.event?.until, 5_400);
});

test('shifter validates source, empty destination, base, safe route, and accepts another return', () => {
  const topLeft = edgeId('0-0', '1-0');
  const topRight = edgeId('0-0', '1-1');
  let state = playing(2, { 0: 'shifter' }, [firstMine, topLeft]);
  state = { ...state, shiftQueue: [0] };
  for (const action of [
    { type: 'shiftMine', fromEdgeId: firstMine },
    { type: 'shiftMine', fromEdgeId: 'forged', toEdgeId: secondEdge },
    { type: 'shiftMine', fromEdgeId: firstMine, toEdgeId: firstMine },
    { type: 'shiftMine', fromEdgeId: firstMine, toEdgeId: topLeft },
    { type: 'shiftMine', fromEdgeId: firstMine, toEdgeId: edgeId('4-0', '4-1') },
    { type: 'shiftMine', fromEdgeId: firstMine, toEdgeId: topRight },
  ]) assert.throws(() => applyAction(freeze(state), id(0), action as GameAction, 0));
  state = applyAction(state, id(0), { type: 'shiftMine', fromEdgeId: firstMine, toEdgeId: secondEdge }, 0).state;
  state = advanceTime(state, 1_400);
  state = { ...state, shiftQueue: [0] };
  state = applyAction(state, id(0), { type: 'shiftMine', fromEdgeId: secondEdge, toEdgeId: firstMine }, 1_400).state;
  assert.deepEqual(state.boards[id(0)], [firstMine, topLeft]);
  assert.equal(state.players[0].shifts, 5, 'invalid choices did not consume uses');
});

test('shifter allows seven actual moves per round, preserves uses on pass, and rejects an eighth', () => {
  let state: GameState = { ...playing(2, { 0: 'shifter' }), shiftQueue: [0] };
  assert.equal(state.players[0].shifts, MAX_MINE_SHIFTS);
  state = applyAction(freeze(state), id(0), { type: 'shiftMine' }, 0).state;
  assert.equal(state.players[0].shifts, 7);
  let now = 1_400;
  for (let used = 1; used <= 7; used++) {
    state = { ...advanceTime(state, now), shiftQueue: [0] };
    const fromEdgeId = used % 2 ? firstMine : secondEdge;
    const toEdgeId = used % 2 ? secondEdge : firstMine;
    state = applyAction(freeze(state), id(0), { type: 'shiftMine', fromEdgeId, toEdgeId }, now).state;
    assert.equal(state.players[0].shifts, 7 - used);
    assert.deepEqual(state.boards[id(0)], [toEdgeId]);
    assert.equal(viewFor(state, id(0), now).players[0].shifts, 7 - used);
    assert.equal('shifts' in viewFor(state, id(1), now).players[0], false);
    now += 1_400;
  }
  state = { ...advanceTime(state, now), shiftQueue: [0] };
  assert.throws(() => applyAction(freeze(state), id(0), { type: 'shiftMine', fromEdgeId: secondEdge, toEdgeId: firstMine }, now), /지뢰 이동 7회를 모두 사용/);
  assert.equal(state.players[0].shifts, 0);
  assert.deepEqual(state.boards[id(0)], [secondEdge]);
  const passed = applyAction(state, id(0), { type: 'shiftMine' }, now).state;
  assert.equal(passed.players[0].shifts, 0);
  assert.deepEqual(passed.shiftQueue, []);
});

test('exhausted shifters are skipped on board return while available shifters still choose in order', () => {
  let state = playing(3, { 0: 'shifter', 1: 'shifter', 2: 'shifter' });
  state = { ...state, rotation: 2, activeSeat: 2, attempts: 2,
    players: state.players.map((player) => ({ ...player, shifts: player.seat === 1 ? 1 : 0 })),
  };
  const pending = advanceTime(explode(freeze(state)), 4_000);
  assert.deepEqual(pending.shiftQueue, [1]);
  assert.equal(pending.event, null);
  const allExhausted = { ...state, players: state.players.map((player) => ({ ...player, shifts: 0 })) };
  const rotated = advanceTime(explode(freeze(allExhausted)), 4_000);
  assert.deepEqual(rotated.shiftQueue, []);
  assert.equal(rotated.rotation, 1);
  assert.equal(rotated.activeSeat, rotated.starterSeat);
  assert.equal(rotated.event?.type, 'rotation');
  for (const player of rotated.players) assert.notEqual(boardOwnerSeat(rotated, player.seat), player.seat);
  assert.equal(viewFor(rotated, id(0), 4_000).shiftSeat, undefined);
});

test('saved shifters without a counter receive seven uses and persist the reduced count', () => {
  let state = playing(2, { 0: 'shifter' });
  state = { ...state, shiftQueue: [0], players: state.players.map((player) => ({ ...player, shifts: undefined })) };
  assert.equal(viewFor(state, id(0), 0).players[0].shifts, 7);
  state = applyAction(freeze(state), id(0), { type: 'shiftMine', fromEdgeId: firstMine, toEdgeId: secondEdge }, 0).state;
  const restored: GameState = JSON.parse(JSON.stringify(state));
  assert.equal(restored.players[0].shifts, 6);
  assert.equal(viewFor(restored, id(0), 1_400).players[0].shifts, 6);
});

test('next round clears records and role choices; choosing again replenishes ability resources', () => {
  let state = playing(6, { 0: 'recorder' });
  state = { ...state, rolesEnabled: true, phase: 'roundEnd', winner: { seat: 0, points: 2, remainingCoins: 1 },
    memos: { [id(0)]: [{ boardOwnerId: id(1), edgeId: firstMine, status: 'mine' }] },
    concealedBoards: { [id(2)]: [firstMine] }, blessingSeat: 1, shiftQueue: [3],
  };
  state = applyAction(freeze(state), id(0), { type: 'nextRound' }, 0).state;
  assert.equal(state.round, 2);
  assert.equal(state.starterSeat, 1);
  assert.deepEqual(state.memos, {});
  assert.deepEqual(state.concealedBoards, {});
  assert.deepEqual(state.boards, {});
  assert.equal(state.blessingSeat, null);
  assert.deepEqual(state.shiftQueue, []);
  for (const player of state.players) {
    assert.equal(player.role, undefined);
    assert.equal(player.roleRevision, undefined);
    assert.equal(player.coins, 3);
    assert.equal(player.blessings, 0);
    assert.equal(player.peeks, 0);
    assert.equal(player.shifts, 0);
    assert.ok(viewFor(state, player.id, 0).selfMemos!.every((note) => note === null));
  }
  for (const player of state.players) state = applyAction(state, player.id, { type: 'chooseRole', role: ROLE_IDS[player.seat] }, 0).state;
  for (const player of state.players) {
    assert.equal(player.coins, roundHintCoins(3, player.role));
    assert.equal(player.blessings, player.role === 'guardian' ? 2 : 0);
    assert.equal(player.peeks, player.role === 'thief' ? 2 : 0);
    assert.equal(player.shifts, player.role === 'shifter' ? 7 : 0);
  }
});

test('spectators cannot submit any role or memo action', () => {
  const state = addPlayer(playing(), { id: 'audience', name: '관전자' });
  for (const action of [
    { type: 'chooseRole', role: 'guardian' },
    { type: 'memo', slot: 0, entry: null }, { type: 'peek', targets: [] },
    { type: 'blessing', use: true }, { type: 'shiftMine' },
  ] as GameAction[]) assert.throws(() => applyAction(state, 'audience', action, 0), /관전 중/);
  assert.equal(getBoard(state.gridSize).edges.length, 30);
});
