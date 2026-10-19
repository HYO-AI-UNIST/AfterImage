import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameAction, GameState, RoleId } from '../lib/contracts.ts';
import { addPlayer, applyAction, canRebuildBoard, createRoom, edgeId, viewFor } from '../lib/game.ts';
import { createDemo, demoAction } from '../lib/demo.ts';
import { parseAction, RoomService, type RoomRecord, type RoomStorage } from '../lib/room-service.ts';

const id = (seat: number) => `retained-${seat}`;
const mines = [edgeId('4-0', '3-0'), edgeId('4-1', '3-1'), edgeId('4-2', '3-2')];
const shifted = edgeId('3-1', '2-1');
const concealed = edgeId('3-0', '2-0');

function placing(): GameState {
  let state = createRoom('RETAIN', { id: id(0), name: '방장' });
  state = applyAction(state, id(0), { type: 'settings', settings: { playerCount: 3, hintCoins: 3, totalRounds: 3, gridSize: 4 } }, 0).state;
  for (let seat = 1; seat < 3; seat++) state = addPlayer(state, { id: id(seat), name: `참가자${seat}` });
  state = applyAction(state, id(0), { type: 'start' }, 0).state;
  return { ...state, activeSeat: 0, starterSeat: 0 };
}

function playing(): GameState {
  let state = placing();
  for (const player of state.players) {
    const role = player.seat === 1 ? 'shifter' : 'trapper';
    state = applyAction(state, player.id, { type: 'chooseRole', role }, 0).state;
    state = applyAction(state, player.id, { type: 'place', mines: [mines[player.seat]], concealed: role === 'trapper' ? [concealed] : [] }, 0).state;
  }
  return state;
}

function win(state: GameState, ownerSeat = 2, now = 0): GameState {
  const actor = state.players[state.activeSeat].id;
  state = applyAction(state, actor, { type: 'chooseBoard', ownerSeat }, now).state;
  state = applyAction(state, actor, { type: 'spawn', nodeId: '4-4' }, now).state;
  for (const nodeId of ['3-3', '2-2', '1-1', '0-0']) state = applyAction(state, actor, { type: 'move', nodeId }, now += 1_000).state;
  return state;
}

test('first round requires everybody to build; later only the maker who lost a coin may rebuild', () => {
  let state = placing();
  assert.equal(state.placementMode, 'retained');
  assert.deepEqual(state.rebuildSeats, [0, 1, 2]);
  assert.ok(state.players.every(player => canRebuildBoard(state, player.seat)));
  assert.throws(() => applyAction(state, id(0), { type: 'ready' }, 0), /지뢰 배치를 완료/);
  state = win(playing());
  const previousBoards = structuredClone(state.boards);
  const previousConcealment = structuredClone(state.concealedBoards);
  state = applyAction(state, id(0), { type: 'nextRound' }, 5_000).state;
  assert.deepEqual(state.rebuildSeats, [2]);
  assert.deepEqual(state.boards, previousBoards);
  assert.deepEqual(state.concealedBoards, previousConcealment);
  assert.ok(state.players.every(player => !player.ready && player.role === undefined));
  assert.deepEqual(state.players.map(player => player.score), [4, 3, 2]);
  assert.equal(state.activeSeat, 1);
  assert.equal(state.turnNumber, 1);
  assert.equal(state.selectedBoardSeat, null);
  assert.throws(() => applyAction(state, id(0), { type: 'place', mines: [] }, 5_000), /기존 판을 그대로/);
  assert.throws(() => applyAction(state, id(0), { type: 'ready' }, 5_000), /특수 능력을 선택/);
  for (const player of state.players) state = applyAction(state, player.id, { type: 'chooseRole', role: 'trapper' }, 5_000).state;
  state = applyAction(state, id(0), { type: 'ready' }, 5_000).state;
  state = applyAction(state, id(1), { type: 'ready' }, 5_000).state;
  assert.equal(state.phase, 'placing', 'everyone waits for the eligible maker');
  state = applyAction(state, id(2), { type: 'place', mines: [shifted], concealed: [mines[2]] }, 5_000).state;
  assert.equal(state.phase, 'playing');
  assert.deepEqual(state.boards[id(0)], previousBoards[id(0)]);
  assert.deepEqual(state.boards[id(1)], previousBoards[id(1)]);
  assert.deepEqual(state.boards[id(2)], [shifted]);
  assert.deepEqual(state.concealedBoards?.[id(2)], [mines[2]]);
});

test('retained mines and concealment stay private even from their owner during preparation', () => {
  let state = addPlayer(win(playing()), { id: 'audience', name: '관전' });
  state = applyAction(state, id(0), { type: 'nextRound' }, 5_000).state;
  for (const player of state.players) state = applyAction(state, player.id, { type: 'chooseRole', role: 'trapper' }, 5_000).state;
  for (const player of [...state.players, ...state.spectators]) {
    const view = viewFor(state, player.id, 5_000);
    assert.deepEqual(view.rebuildSeats, [2]);
    assert.equal('boards' in view, false);
    assert.equal('revealedBoards' in view, false);
    if (player.id === id(2)) {
      assert.deepEqual(view.ownMines, [mines[2]]);
      assert.deepEqual(view.ownConcealed, [concealed]);
    } else {
      assert.equal('ownMines' in view, false);
      assert.equal('ownConcealed' in view, false);
    }
  }
  assert.throws(() => applyAction(state, 'audience', { type: 'ready' }, 5_000), /관전 중/);
});

test('role changes cannot erase retained camouflage or add new camouflage to a retained board', () => {
  let state = applyAction(win(playing()), id(0), { type: 'nextRound' }, 5_000).state;
  const before = structuredClone(state.concealedBoards);
  for (const role of ['guardian', 'trapper', 'illuminator'] as RoleId[]) {
    state = applyAction(state, id(0), { type: 'chooseRole', role }, 5_000).state;
    assert.deepEqual(state.concealedBoards, before);
  }
  state = applyAction(state, id(1), { type: 'chooseRole', role: 'trapper' }, 5_000).state;
  assert.throws(() => applyAction(state, id(1), { type: 'place', mines: [mines[1]], concealed: [concealed] }, 5_000), /기존 판/);
  state = applyAction(state, id(0), { type: 'ready' }, 5_000).state;
  assert.throws(() => applyAction(state, id(0), { type: 'chooseRole', role: 'trapper' }, 5_000), /완료한 뒤/);
  assert.throws(() => applyAction(state, id(0), { type: 'ready' }, 5_000), /이미 준비/);
  state = applyAction(state, id(2), { type: 'chooseRole', role: 'trapper' }, 5_000).state;
  assert.deepEqual(viewFor(state, id(2), 5_000).ownConcealed, [concealed]);
  state = applyAction(state, id(2), { type: 'chooseRole', role: 'guardian' }, 5_000).state;
  assert.equal('ownConcealed' in viewFor(state, id(2), 5_000), false);
  assert.throws(() => applyAction(state, id(2), { type: 'place', mines: [mines[2]], concealed: [concealed] }, 5_000), /기만의 장막 능력/);
  state = applyAction(state, id(2), { type: 'place', mines: [mines[2]] }, 5_000).state;
  assert.deepEqual(state.concealedBoards?.[id(2)], []);
  assert.deepEqual(state.concealedBoards?.[id(0)], [concealed]);
});

test('zero transfer preserves every board and camouflage while all players select refreshed abilities and ready', () => {
  let state = playing();
  state.players[2].score = 0;
  state.memos = { [id(0)]: [{ boardOwnerId: id(1), edgeId: mines[1], status: 'safe' }] };
  state.players[0].coins = 0;
  state.players[1].shifts = 2;
  state = win(state);
  const beforeBoards = structuredClone(state.boards);
  const beforeConcealment = structuredClone(state.concealedBoards);
  assert.equal(state.winner?.coinsTransferred, 0);
  state = applyAction(state, id(0), { type: 'nextRound' }, 5_000).state;
  assert.deepEqual(state.rebuildSeats, []);
  assert.deepEqual(state.memos, {});
  assert.ok(state.players.every(player => player.coins === 3 && player.shifts === 0 && player.blessings === 0 && player.peeks === 0));
  for (const player of state.players) {
    assert.equal('ownMines' in viewFor(state, player.id, 5_000), false);
    state = applyAction(state, player.id, { type: 'chooseRole', role: 'shifter' }, 5_000).state;
    state = applyAction(state, player.id, { type: 'ready' }, 5_000).state;
  }
  assert.equal(state.phase, 'playing');
  assert.ok(state.players.every(player => player.shifts === 7));
  assert.deepEqual(state.boards, beforeBoards);
  assert.deepEqual(state.concealedBoards, beforeConcealment);
});

test('a shifted layout is retained in the next round when its maker did not lose a coin', () => {
  let state = { ...playing(), activeSeat: 1, turnNumber: 5, shiftQueue: [1] };
  state = applyAction(state, id(1), { type: 'shiftMine', fromEdgeId: mines[1], toEdgeId: shifted }, 0).state as typeof state;
  assert.deepEqual(state.boards[id(1)], [shifted]);
  const ended = win(state, 2);
  const next = applyAction(ended, id(0), { type: 'nextRound' }, 5_000).state;
  assert.deepEqual(next.rebuildSeats, [2]);
  assert.deepEqual(next.boards[id(1)], [shifted]);
});

test('round results reveal only the completed board, including zero-transfer wins; final results reveal all boards', () => {
  for (const zeroTransfer of [false, true]) {
    let state = addPlayer(playing(), { id: 'audience', name: '관전' });
    if (zeroTransfer) state.players[2].score = 0;
    state = win(state, 2);
    for (const player of [...state.players, ...state.spectators]) {
      const view = viewFor(state, player.id, 4_000);
      assert.deepEqual(view.revealedBoards, { [id(2)]: [mines[2]] });
      assert.equal('ownMines' in view, false);
      assert.equal('concealedBoards' in view, false);
      const final = viewFor({ ...state, phase: 'finished' }, player.id, 4_000);
      assert.deepEqual(final.revealedBoards, state.boards);
    }
  }
});

test('old ongoing games keep all-board rebuilding and reveals until restart adopts retention', () => {
  const current = playing();
  const old = { ...current, placementMode: undefined, rebuildSeats: undefined };
  const ended = win(old);
  assert.deepEqual(viewFor(ended, id(0), 4_000).revealedBoards, ended.boards);
  const next = applyAction(ended, id(0), { type: 'nextRound' }, 5_000).state;
  assert.equal(next.placementMode, undefined);
  assert.deepEqual(next.boards, {});
  assert.deepEqual(next.concealedBoards, {});
  assert.ok(next.players.every(player => canRebuildBoard(next, player.seat)));
  const restarted = applyAction({ ...ended, phase: 'finished' }, id(0), { type: 'restart' }, 5_000).state;
  assert.equal(restarted.placementMode, 'retained');
  assert.deepEqual(restarted.rebuildSeats, [0, 1, 2]);
  assert.deepEqual(restarted.boards, {});
  assert.deepEqual(restarted.concealedBoards, {});
  assert.ok(restarted.players.every(player => player.score === 3));
});

test('demo bots rebuild only eligible boards and ready retained boards without re-randomizing them', () => {
  for (const zeroTransfer of [false, true]) {
    let state = demoAction(createDemo('trapper'), { type: 'place', mines: [mines[0]], concealed: [concealed] }, 0).state;
    state = { ...state, boards: Object.fromEntries(state.players.map(player => [player.id, [mines[0]]])) };
    if (zeroTransfer) state.players[1].score = 0;
    state = win(state, 1);
    const boards = structuredClone(state.boards);
    const concealment = structuredClone(state.concealedBoards);
    state = demoAction(state, { type: 'nextRound' }, 5_000).state;
    assert.deepEqual(state.rebuildSeats, zeroTransfer ? [] : [1]);
    assert.ok(state.players.slice(1).every(player => player.ready));
    for (const player of state.players) {
      if (zeroTransfer || player.seat !== 1) {
        assert.deepEqual(state.boards[player.id], boards[player.id]);
        assert.deepEqual(state.concealedBoards?.[player.id], concealment?.[player.id]);
      }
    }
    assert.equal('ownMines' in viewFor(state, state.players[0].id, 5_000), false);
    state = demoAction(state, { type: 'chooseRole', role: 'guardian' }, 5_000).state;
    state = demoAction(state, { type: 'ready' }, 5_000).state;
    assert.equal(state.phase, 'playing');
  }
});

class MemoryStorage implements RoomStorage {
  records = new Map<string, RoomRecord>();
  async get(code: string) { const row = this.records.get(code); return row ? { ...row } : null; }
  async create(row: RoomRecord) { if (this.records.has(row.code)) return false; this.records.set(row.code, { ...row }); return true; }
  async compareAndSwap(row: RoomRecord, previousVersion: number) { if (this.records.get(row.code)?.version !== previousVersion) return false; this.records.set(row.code, { ...row }); return true; }
  async deleteExpired() {}
}

test('ready parses only its exact shape; authenticated ready/place CAS preserves boards and rejects stale rounds or ability choices', async () => {
  assert.deepEqual(parseAction({ type: 'ready' }), { type: 'ready' });
  for (const extra of [{ mines: [] }, { playerId: 'another' }, { role: 'guardian' }]) assert.throws(() => parseAction({ type: 'ready', ...extra }));
  const storage = new MemoryStorage();
  let now = 1_000;
  const service = new RoomService(storage, () => now);
  const host = await service.create('방장');
  const code = host.view.code;
  await service.act(code, host.token, { type: 'settings', settings: { playerCount: 3, hintCoins: 3, totalRounds: 2, gridSize: 4 } }, host.view.revision);
  const sessions = [host, await service.join(code, '둘째'), await service.join(code, '셋째')];
  const spectator = await service.join(code, '관전자');
  const get = async (seat = 0) => (await service.get(code, sessions[seat].token)).view;
  const act = async (seat: number, action: GameAction) => service.act(code, sessions[seat].token, action, (await get(seat)).revision);
  const initial = await act(0, { type: 'start' });
  for (let seat = 0; seat < 3; seat++) {
    await act(seat, { type: 'chooseRole', role: 'trapper' });
    await act(seat, { type: 'place', mines: [mines[seat]], concealed: [concealed] });
  }
  const activeSeat = (await get()).activeSeat;
  const ownerSeat = (activeSeat + 2) % 3;
  await act(activeSeat, { type: 'chooseBoard', ownerSeat });
  await act(activeSeat, { type: 'spawn', nodeId: '4-4' });
  for (const nodeId of ['3-3', '2-2', '1-1', '0-0']) { await act(activeSeat, { type: 'move', nodeId }); now += 1_000; }
  const next = await act(0, { type: 'nextRound' });
  const retained = [0, 1, 2].filter(seat => seat !== ownerSeat);
  for (const seat of retained) {
    const view = await get(seat);
    assert.equal('ownMines' in view, false);
    await assert.rejects(act(seat, { type: 'place', mines: [] }));
  }
  for (let seat = 0; seat < 3; seat++) await act(seat, { type: 'chooseRole', role: 'guardian' });
  await assert.rejects(service.act(code, sessions[retained[0]].token, { type: 'ready' }, initial.view.revision));
  await assert.rejects(service.act(code, sessions[retained[0]].token, { type: 'ready' }, next.view.revision));
  const common = await get();
  await assert.rejects(service.act(code, spectator.token, { type: 'ready' }, common.revision));
  const duplicated = await Promise.allSettled([0, 1].map(() => service.act(code, sessions[retained[0]].token, { type: 'ready' }, common.revision)));
  assert.equal(duplicated.filter(response => response.status === 'fulfilled').length, 1);
  const lastRevision = (await get()).revision;
  const final = await Promise.all([
    service.act(code, sessions[retained[1]].token, { type: 'ready' }, lastRevision),
    service.act(code, sessions[ownerSeat].token, { type: 'place', mines: [shifted] }, lastRevision),
  ]);
  assert.equal(final.some(response => response.view.phase === 'playing'), true);
  const persisted = JSON.parse(storage.records.get(code)!.payload).state as GameState;
  assert.equal(persisted.phase, 'playing');
  for (const seat of retained) {
    assert.deepEqual(persisted.boards[sessions[seat].view.selfId], [mines[seat]]);
    assert.deepEqual(persisted.concealedBoards?.[sessions[seat].view.selfId], [concealed]);
  }
  assert.deepEqual(persisted.boards[sessions[ownerSeat].view.selfId], [shifted]);
  assert.deepEqual(persisted.concealedBoards?.[sessions[ownerSeat].view.selfId], []);
});
