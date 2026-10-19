import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameAction, GameState, RoleId } from '../lib/contracts.ts';
import { addPlayer, advanceTime, applyAction, boardOwnerSeat, createRoom, edgeId, viewFor } from '../lib/game.ts';
import { createDemo, demoAction, tickDemo } from '../lib/demo.ts';
import { parseAction, RoomService, type RoomRecord, type RoomStorage } from '../lib/room-service.ts';

const mine = edgeId('4-0', '3-0');
const safe = edgeId('4-4', '3-3');
const id = (seat: number) => `choice-${seat}`;

function playing(roles: Partial<Record<number, RoleId>> = {}): GameState {
  let state = createRoom('CHOOSE', { id: id(0), name: '방장' });
  state = applyAction(state, id(0), { type: 'settings', settings: { playerCount: 3, hintCoins: 3, totalRounds: 2, gridSize: 4 } }, 0).state;
  for (let seat = 1; seat < 3; seat++) state = addPlayer(state, { id: id(seat), name: `참가자${seat}` });
  state = applyAction(state, id(0), { type: 'start' }, 0).state;
  state = { ...state, activeSeat: 0, starterSeat: 0 };
  for (const player of state.players) {
    state = applyAction(state, player.id, { type: 'chooseRole', role: roles[player.seat] ?? 'trapper' }, 0).state;
    state = applyAction(state, player.id, { type: 'place', mines: [mine] }, 0).state;
  }
  return state;
}

function choose(state: GameState, ownerSeat: number, now = 0): GameState {
  return applyAction(state, state.players[state.activeSeat].id, { type: 'chooseBoard', ownerSeat }, now).state;
}

function explode(state: GameState, now = 0): GameState {
  const actor = state.players[state.activeSeat].id;
  state = applyAction(state, actor, { type: 'spawn', nodeId: '4-0' }, now).state;
  return applyAction(state, actor, { type: 'move', nodeId: '3-0' }, now).state;
}

test('choice rounds wait for the active player and expose no current board or mine total before selection', () => {
  const state = addPlayer(playing(), { id: 'audience', name: '관전자' });
  assert.equal(state.boardMode, 'choice');
  assert.equal(state.turnNumber, 1);
  assert.equal(boardOwnerSeat(state), -1);
  for (const player of [...state.players, ...state.spectators]) {
    const view = viewFor(state, player.id, 0);
    assert.equal(view.boardOwnerSeat, -1);
    assert.equal(view.turnNumber, 1);
    assert.equal('activeBoardMineCount' in view, false);
    assert.equal('boards' in view, false);
  }
  for (const action of [{ type: 'spawn', nodeId: '4-0' }, { type: 'move', nodeId: '3-0' }, { type: 'hint', edgeId: mine }] as GameAction[]) {
    assert.throws(() => applyAction(state, id(0), action, 0), /먼저 도전할 판/);
  }
  assert.throws(() => choose(state, 0), /본인이 만든/);
  assert.throws(() => applyAction(state, id(1), { type: 'chooseBoard', ownerSeat: 2 }, 0), /다른 플레이어/);
  assert.throws(() => applyAction(state, 'audience', { type: 'chooseBoard', ownerSeat: 2 }, 0), /관전 중/);
  for (const ownerSeat of [-1, 3, 1.5, NaN, '1']) assert.throws(() => choose(state, ownerSeat as number));
  const selected = choose(state, 2);
  assert.equal(boardOwnerSeat(selected), 2);
  assert.equal(selected.position, null);
  assert.equal(selected.players[0].coins, 3);
  assert.throws(() => choose(selected, 1), /이미 골랐/);
  for (const player of [...selected.players, ...selected.spectators]) assert.equal(viewFor(selected, player.id, 0).activeBoardMineCount, 1);
  assert.deepEqual(applyAction(selected, id(0), { type: 'hint', edgeId: mine }, 0).privateResult, { edgeId: mine, mined: true });
});

test('different players and later attempts may repeat a board, with four-second explosions and no rotation', () => {
  let state = playing();
  const boards = JSON.stringify(state.boards);
  let now = 0;
  for (let turn = 1; turn <= 7; turn++) {
    assert.equal(state.turnNumber, turn);
    assert.equal(boardOwnerSeat(state), -1);
    const activeSeat = state.activeSeat;
    state = choose(state, activeSeat === 2 ? 1 : 2, now);
    state = explode(state, now);
    assert.equal(state.event?.type, 'explosion');
    assert.equal(state.event?.until, now + 4_000);
    assert.equal(advanceTime(state, now + 3_999).activeSeat, activeSeat);
    state = advanceTime(state, now += 4_000);
    assert.equal(state.activeSeat, (activeSeat + 1) % 3);
    assert.equal(state.event, null);
    assert.equal(state.rotation, 0);
    assert.equal(state.position, null);
    assert.equal(JSON.stringify(state.boards), boards);
  }
});

test('guardian restarts the selected board without offering another selection or advancing the turn', () => {
  let state = advanceTime(explode(choose(playing({ 0: 'guardian' }), 2)), 4_000);
  assert.equal(state.blessingSeat, 0);
  assert.equal(boardOwnerSeat(state), 2);
  state = applyAction(state, id(0), { type: 'blessing', use: true }, 4_000).state;
  assert.equal(state.turnNumber, 1);
  assert.equal(state.players[0].blessings, 1);
  assert.equal(boardOwnerSeat(state), 2);
  assert.throws(() => choose(state, 1, 4_000), /이미 골랐/);
  state = advanceTime(explode(state, 4_000), 8_000);
  state = applyAction(state, id(0), { type: 'blessing', use: false }, 8_000).state;
  assert.equal(state.activeSeat, 1);
  assert.equal(state.turnNumber, 2);
  assert.equal(boardOwnerSeat(state), -1);
});

test('shifter gets one private decision from personal turn two, before board selection, and spends only on a valid move', () => {
  let state = playing({ 0: 'shifter' });
  assert.deepEqual(state.shiftQueue, []);
  let now = 0;
  for (let turn = 0; turn < 3; turn++) state = advanceTime(explode(choose(state, (state.activeSeat + 1) % 3, now), now), now += 4_000);
  assert.equal(state.turnNumber, 4);
  assert.equal(state.activeSeat, 0);
  assert.deepEqual(state.shiftQueue, [0]);
  assert.equal(boardOwnerSeat(state), -1);
  assert.equal('activeBoardMineCount' in viewFor(state, id(0), now), false);
  assert.deepEqual(viewFor(state, id(0), now).shiftMines, [mine]);
  assert.equal('shiftMines' in viewFor(state, id(1), now), false);
  assert.throws(() => choose(state, 1, now), /지뢰 이동 선택/);
  assert.throws(() => applyAction(state, id(1), { type: 'shiftMine' }, now));
  assert.throws(() => applyAction(state, id(0), { type: 'shiftMine', fromEdgeId: mine, toEdgeId: mine }, now));
  assert.equal(state.players[0].shifts, 7);
  const note = { boardOwnerId: id(0), edgeId: mine, status: 'mine' as const };
  state = applyAction(state, id(1), { type: 'memo', slot: 0, entry: note }, now).state;
  state = applyAction(state, id(0), { type: 'shiftMine', fromEdgeId: mine, toEdgeId: safe }, now).state;
  assert.equal(state.players[0].shifts, 6);
  assert.deepEqual(state.boards[id(0)], [safe]);
  assert.deepEqual(state.memos?.[id(1)][0], note);
  assert.equal(state.event, null);
  assert.deepEqual(state.shiftQueue, []);
  assert.equal(boardOwnerSeat(state), -1);
  assert.throws(() => applyAction(state, id(0), { type: 'shiftMine' }, now));
  state = choose(state, 1, now);
  assert.equal(boardOwnerSeat(state), 1);
  const skipped = applyAction({ ...state, selectedBoardSeat: null, shiftQueue: [0] }, id(0), { type: 'shiftMine' }, now).state;
  assert.equal(skipped.players[0].shifts, 6);
  assert.equal(boardOwnerSeat(skipped), -1);
  let exhausted: GameState = { ...playing({ 0: 'shifter' }), activeSeat: 2, turnNumber: 3 };
  exhausted.players[0].shifts = 0;
  exhausted = advanceTime(explode(choose(exhausted, 1)), 4_000);
  assert.deepEqual(exhausted.shiftQueue, []);
  assert.equal(exhausted.activeSeat, 0);
});

test('private memos remain editable before selection and during another player turn; round reset clears selection and notes', () => {
  let state = playing();
  const note = { boardOwnerId: id(2), edgeId: mine, status: 'safe' as const };
  state = applyAction(state, id(1), { type: 'memo', slot: 0, entry: note }, 0).state;
  assert.equal(boardOwnerSeat(state), -1);
  state = choose(state, 2);
  state = applyAction(state, id(0), { type: 'spawn', nodeId: '4-4' }, 0).state;
  let now = 0;
  for (const nodeId of ['3-3', '2-2', '1-1', '0-0']) state = applyAction(state, id(0), { type: 'move', nodeId }, now += 1_000).state;
  assert.equal(state.phase, 'roundEnd');
  assert.equal(boardOwnerSeat(state), 2);
  assert.equal(viewFor(state, id(1), now).revealedBoards?.[id(2)]?.length, 1);
  state = applyAction(state, id(0), { type: 'nextRound' }, now).state;
  assert.equal(state.boardMode, 'choice');
  assert.equal(state.turnNumber, 1);
  assert.equal(state.activeSeat, 1);
  assert.equal(boardOwnerSeat(state), -1);
  assert.deepEqual(state.memos, {});
});

function eightPlayerLegacy(): GameState {
  const state = playing();
  return {
    ...state, boardMode: undefined, scoringMode: undefined, placementMode: undefined, selectedBoardSeat: undefined, turnNumber: undefined, playerCount: 8, rotation: 1,
    players: Array.from({ length: 8 }, (_, seat) => ({ ...state.players[0], id: id(seat), seat, name: `참가자${seat}`, score: seat })),
    boards: Object.fromEntries(Array.from({ length: 8 }, (_, seat) => [id(seat), [mine]])),
  };
}

test('legacy eight-seat play stays intact and upgrades to six seats plus waiting spectators only at boundaries', () => {
  const original = eightPlayerLegacy();
  assert.equal(viewFor(original, id(7), 0).players.length, 8);
  const active = applyAction(original, id(0), { type: 'spawn', nodeId: '4-0' }, 0).state;
  assert.equal(active.playerCount, 8);
  assert.equal(active.boardMode, undefined);
  const ended = { ...original, phase: 'roundEnd' as const, winner: { seat: 6, points: 1, remainingCoins: 0 } };
  const next = applyAction(ended, id(0), { type: 'nextRound' }, 0).state;
  assert.equal(next.boardMode, 'choice');
  assert.equal(next.playerCount, 6);
  assert.equal(next.activeSeat, 0);
  assert.deepEqual(next.players.map(player => player.score), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(next.spectators.map(player => player.id), [id(6), id(7)]);
  assert.equal(viewFor(next, id(7), 0).selfId, id(7));
  const restarted = applyAction({ ...original, phase: 'finished' }, id(0), { type: 'restart' }, 0).state;
  assert.equal(restarted.phase, 'waiting');
  assert.equal(restarted.playerCount, 6);
  assert.ok(restarted.players.every(player => player.score === 3));
  assert.deepEqual(restarted.spectators.map(player => player.id), [id(6), id(7)]);
  const waiting = addPlayer({ ...original, phase: 'waiting' }, { id: 'new', name: '새 참가자' });
  assert.equal(waiting.playerCount, 6);
  assert.deepEqual(waiting.spectators.map(player => player.id), [id(6), id(7), 'new']);
});

test('demo bot selection uses public identities without reading any candidate mine layout', () => {
  let state = demoAction(createDemo('illuminator'), { type: 'place', mines: [] }, 0).state;
  state = { ...state, activeSeat: 1 };
  // Selection validates existence only after deciding, so observe the chosen
  // owner rather than permitting the policy to inspect any candidate layout.
  const readOwners: PropertyKey[] = [];
  const boards = new Proxy(state.boards, { get(target, key) { readOwners.push(key); return Reflect.get(target, key); } });
  const next = tickDemo({ ...state, boards }, 0);
  assert.equal(next.boardMode, 'choice');
  assert.notEqual(next.selectedBoardSeat, null);
  assert.notEqual(next.selectedBoardSeat, next.activeSeat);
  assert.deepEqual(readOwners, [next.players[next.selectedBoardSeat!].id]);
  assert.equal(next.position, null);
  assert.equal('peekResult' in next, false);
});

class MemoryStorage implements RoomStorage {
  records = new Map<string, RoomRecord>();
  async get(code: string) { const row = this.records.get(code); return row ? { ...row } : null; }
  async create(row: RoomRecord) { if (this.records.has(row.code)) return false; this.records.set(row.code, { ...row }); return true; }
  async compareAndSwap(row: RoomRecord, previousVersion: number) { if (this.records.get(row.code)?.version !== previousVersion) return false; this.records.set(row.code, { ...row }); return true; }
  async deleteExpired() {}
}

test('API choice parsing rejects forged fields, non-seat values and seats past the six-player limit', () => {
  for (let ownerSeat = 0; ownerSeat < 6; ownerSeat++) assert.deepEqual(parseAction({ type: 'chooseBoard', ownerSeat }), { type: 'chooseBoard', ownerSeat });
  for (const ownerSeat of [undefined, null, -1, 6, 8, .5, '1', true, NaN]) assert.throws(() => parseAction({ type: 'chooseBoard', ownerSeat }));
  assert.throws(() => parseAction({ type: 'chooseBoard', ownerSeat: 1, activeSeat: 0 }));
});

test('authenticated board choices survive reload and competing choices commit exactly once without exposing layouts', async () => {
  const storage = new MemoryStorage();
  const service = new RoomService(storage, () => 1_000);
  const host = await service.create('방장');
  const code = host.view.code;
  await service.act(code, host.token, { type: 'settings', settings: { playerCount: 3, hintCoins: 3, totalRounds: 2, gridSize: 4 } }, host.view.revision);
  const seats = [host, await service.join(code, '둘째'), await service.join(code, '셋째')];
  const audience = await service.join(code, '관전자');
  const act = async (seat: number, action: GameAction) => service.act(code, seats[seat].token, action, (await service.get(code, seats[seat].token)).view.revision);
  await act(0, { type: 'start' });
  for (let seat = 0; seat < 3; seat++) {
    await act(seat, { type: 'chooseRole', role: 'trapper' });
    await act(seat, { type: 'place', mines: [mine] });
  }
  const current = await service.get(code, host.token);
  const activeSeat = current.view.activeSeat;
  assert.equal(current.view.boardOwnerSeat, -1);
  const owners = [0, 1, 2].filter(seat => seat !== activeSeat);
  await assert.rejects(service.act(code, audience.token, { type: 'chooseBoard', ownerSeat: owners[0] }, current.view.revision));
  await assert.rejects(service.act(code, seats[activeSeat].token, { type: 'chooseBoard', ownerSeat: activeSeat }, current.view.revision));
  const responses = await Promise.allSettled(owners.map(ownerSeat => service.act(code, seats[activeSeat].token, { type: 'chooseBoard', ownerSeat }, current.view.revision)));
  assert.equal(responses.filter(response => response.status === 'fulfilled').length, 1);
  const winner = responses.find(response => response.status === 'fulfilled')!;
  assert.equal(winner.status, 'fulfilled');
  const selected = winner.value.view.boardOwnerSeat;
  const restored = new RoomService(storage, () => 1_000);
  for (const participant of [...seats, audience]) {
    const view = (await restored.get(code, participant.token)).view;
    assert.equal(view.boardOwnerSeat, selected);
    assert.equal(view.activeBoardMineCount, 1);
    assert.equal('boards' in view, false);
    assert.equal('ownMines' in view, false);
  }
  await act(activeSeat, { type: 'spawn', nodeId: '4-0' });
});
