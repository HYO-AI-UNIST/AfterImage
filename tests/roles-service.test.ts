import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameAction, GameState, MemoEntry, RoleId } from '../lib/contracts';
import { edgeId, GameError } from '../lib/game.ts';
import { parseAction, RoomError, RoomService, type RoomRecord, type RoomStorage } from '../lib/room-service.ts';

class MemoryStorage implements RoomStorage {
  records = new Map<string, RoomRecord>();
  async get(code: string) { const record = this.records.get(code); return record ? { ...record } : null; }
  async create(record: RoomRecord) {
    if (this.records.has(record.code)) return false;
    this.records.set(record.code, { ...record });
    return true;
  }
  async compareAndSwap(record: RoomRecord, previousVersion: number) {
    if (this.records.get(record.code)?.version !== previousVersion) return false;
    this.records.set(record.code, { ...record });
    return true;
  }
  async deleteExpired(before: number, limit: number) {
    for (const record of [...this.records.values()].filter(record => record.updatedAt < before).slice(0, limit)) this.records.delete(record.code);
  }
}

const mine = edgeId('4-0', '3-0');
const safeEdge = edgeId('4-4', '3-3');
const concealedEdges = [mine, safeEdge, edgeId('3-1', '2-1'), edgeId('3-2', '2-2')];
const roleOrder: RoleId[] = ['thief', 'recorder', 'trapper', 'illuminator', 'guardian', 'shifter'];

async function setup({ selectRoles = true, playerCount = 6 }: { selectRoles?: boolean; playerCount?: number } = {}) {
  const storage = new MemoryStorage();
  let now = 1_000_000;
  const clock = () => now;
  const service = new RoomService(storage, clock);
  const host = await service.create('방장');
  const code = host.view.code;
  if (playerCount !== 6) await service.act(code, host.token, { type: 'settings', settings: { playerCount, hintCoins: 3, totalRounds: 7, gridSize: 4 } }, host.view.revision);
  const seats = [host];
  for (let seat = 1; seat < playerCount; seat++) seats.push(await service.join(code, `참가자${seat}`));
  const spectator = await service.join(code, '관전자');
  const act = async (seat: number, action: GameAction) => {
    const current = await service.get(code, seats[seat].token);
    return service.act(code, seats[seat].token, action, current.view.revision);
  };
  // Fixture-only edits control turn order and prepare already-written notes.
  // Roles are selected through the same authenticated actions as the browser.
  const seed = (change: (state: GameState) => void) => {
    const record = storage.records.get(code)!;
    const room = JSON.parse(record.payload) as { state: GameState };
    change(room.state);
    record.payload = JSON.stringify(room);
  };
  await act(0, { type: 'start' });
  seed(state => {
    assert.equal(state.rolesEnabled, true);
    state.activeSeat = 0;
    state.starterSeat = 0;
    // This suite retains the persisted rotation lifecycle and resource fixtures.
    state.boardMode = undefined;
    state.placementMode = undefined;
    assert.ok(state.players.every(player => player.role === undefined));
  });
  if (selectRoles) for (let seat = 0; seat < playerCount; seat++) await act(seat, { type: 'chooseRole', role: playerCount === 2 ? 'guardian' : roleOrder[seat] });
  const persisted = () => JSON.parse(storage.records.get(code)!.payload) as { state: GameState; identities: Record<string, string> };
  return { storage, service, clock, code, seats, spectator, act, seed, persisted, elapse: (ms: number) => { now += ms; } };
}

async function playing() {
  const fixture = await setup();
  for (let seat = 0; seat < 6; seat++) await fixture.act(seat, { type: 'place', mines: [mine] });
  return fixture;
}

test('role action parser accepts exact boundary shapes and preserves private memo guesses', () => {
  const actions: GameAction[] = [
    ...roleOrder.map(role => ({ type: 'chooseRole' as const, role })),
    { type: 'memo', slot: 0, entry: null },
    { type: 'memo', slot: 5, entry: { boardOwnerId: 'owner', edgeId: mine, status: 'unsure' } },
    { type: 'peek', targets: [{ playerId: 'owner', slot: 5 }] },
    { type: 'peek', targets: [0, 1, 2].map(slot => ({ playerId: 'owner', slot })) },
    { type: 'blessing', use: true },
    { type: 'blessing', use: false },
    { type: 'shiftMine' },
    { type: 'shiftMine', fromEdgeId: mine, toEdgeId: safeEdge },
    { type: 'place', mines: [mine], concealed: concealedEdges },
    { type: 'place', mines: [], concealed: [] },
  ];
  for (const action of actions) assert.deepEqual(parseAction(action), action);
  for (const status of ['safe', 'mine', 'unsure']) {
    const action = { type: 'memo', slot: 0, entry: { boardOwnerId: 'owner', edgeId: mine, status } };
    assert.deepEqual(parseAction(action), action);
  }
});

test('role action parser rejects unknown fields at each private payload level', () => {
  const actions = [
    { type: 'chooseRole', role: 'guardian' },
    { type: 'memo', slot: 0, entry: null },
    { type: 'peek', targets: [{ playerId: 'owner', slot: 0 }] },
    { type: 'blessing', use: true },
    { type: 'shiftMine' },
    { type: 'place', mines: [], concealed: [] },
  ];
  for (const action of actions) assert.throws(() => parseAction({ ...action, selfId: 'forged' }), RoomError);
  assert.throws(() => parseAction({ type: 'memo', slot: 0, entry: { boardOwnerId: 'owner', edgeId: mine, status: 'safe', verified: true } }), RoomError);
  assert.throws(() => parseAction({ type: 'peek', targets: [{ playerId: 'owner', slot: 0, boardOwnerId: 'forged' }] }), RoomError);
});

test('role action parser rejects missing values, wrong types and out-of-range selections', () => {
  const invalid: unknown[] = [];
  for (const role of [undefined, null, false, 0, '', 'wizard', 'ILLUMINATOR', ['guardian'], {}]) invalid.push({ type: 'chooseRole', role });
  for (const slot of [-1, 6, 0.5, NaN, Infinity, '0', null, undefined, true]) {
    invalid.push({ type: 'memo', slot, entry: null }, { type: 'peek', targets: [{ playerId: 'owner', slot }] });
  }
  const validEntry = { boardOwnerId: 'owner', edgeId: mine, status: 'safe' };
  for (const entry of [undefined, false, [], {}, 'safe']) invalid.push({ type: 'memo', slot: 0, entry });
  for (const boardOwnerId of ['', 'x'.repeat(201), 3, null, undefined]) invalid.push({ type: 'memo', slot: 0, entry: { ...validEntry, boardOwnerId } });
  for (const edgeId of ['', 'x'.repeat(33), 3, null, undefined]) invalid.push({ type: 'memo', slot: 0, entry: { ...validEntry, edgeId } });
  for (const status of ['', 'mined', false, 0, null, undefined]) invalid.push({ type: 'memo', slot: 0, entry: { ...validEntry, status } });
  for (const targets of [undefined, null, {}, [], [null], ['owner'], Array.from({ length: 4 }, (_, slot) => ({ playerId: 'owner', slot }))]) invalid.push({ type: 'peek', targets });
  for (const playerId of ['', 'x'.repeat(201), false, null, undefined]) invalid.push({ type: 'peek', targets: [{ playerId, slot: 0 }] });
  for (const use of [undefined, null, 0, 1, 'true', {}]) invalid.push({ type: 'blessing', use });
  for (const badEdge of ['', 'x'.repeat(33), 0, null]) invalid.push({ type: 'shiftMine', fromEdgeId: badEdge, toEdgeId: safeEdge }, { type: 'shiftMine', fromEdgeId: mine, toEdgeId: badEdge });
  invalid.push({ type: 'shiftMine', fromEdgeId: mine }, { type: 'shiftMine', toEdgeId: safeEdge });
  for (const concealed of [null, {}, [''], ['x'.repeat(33)], [false], [mine, mine], [...concealedEdges, 'fifth']]) invalid.push({ type: 'place', mines: [], concealed });
  for (const action of invalid) assert.throws(() => parseAction(action), RoomError, JSON.stringify(action));
});

test('manual role selection is required before placement, permits duplicates and reveals only public role identity', async () => {
  const { service, code, seats, spectator, storage, act } = await setup({ selectRoles: false });
  const before = storage.records.get(code)!.payload;
  await assert.rejects(act(0, { type: 'place', mines: [mine] }), GameError);
  assert.equal(storage.records.get(code)!.payload, before);
  for (const seat of [0, 1]) {
    const chosen = await act(seat, { type: 'chooseRole', role: 'illuminator' });
    assert.equal(chosen.view.players[seat].role, 'illuminator');
    assert.equal(chosen.view.players[seat].coins, 5);
  }
  for (const participant of [...seats, spectator]) {
    const view = (await service.get(code, participant.token)).view;
    assert.equal(view.players[0].role, 'illuminator');
    assert.equal(view.players[1].role, 'illuminator');
    for (const player of view.players.filter(player => player.id !== view.selfId)) {
      for (const key of ['coins', 'blessings', 'peeks', 'shifts']) assert.equal(key in player, false);
    }
  }
  await assert.rejects(act(0, { type: 'chooseRole', role: 'guardian' }), GameError);
  const changed = await service.get(code, seats[0].token);
  assert.equal(changed.view.players[0].role, 'illuminator');
  assert.equal(changed.view.players[0].coins, 5);
  assert.equal(changed.view.players[0].blessings, 0);
  const placed = await act(0, { type: 'place', mines: [mine] });
  const committed = storage.records.get(code)!.payload;
  assert.equal(placed.view.players[0].ready, true);
  await assert.rejects(act(0, { type: 'chooseRole', role: 'trapper' }), GameError);
  assert.equal(storage.records.get(code)!.payload, committed);
  const audience = await service.get(code, spectator.token);
  await assert.rejects(service.act(code, spectator.token, { type: 'chooseRole', role: 'guardian' }, audience.view.revision), (error: unknown) => error instanceof GameError && error.status === 403);
});

test('two-player role selection excludes memo-dependent roles and leaves failed selections uncommitted', async () => {
  const { act, storage, code } = await setup({ playerCount: 2, selectRoles: false });
  const before = storage.records.get(code)!.payload;
  for (const role of ['thief', 'recorder'] as const) await assert.rejects(act(0, { type: 'chooseRole', role }), GameError);
  assert.equal(storage.records.get(code)!.payload, before);
  const first = await act(0, { type: 'chooseRole', role: 'guardian' });
  const second = await act(1, { type: 'chooseRole', role: 'guardian' });
  assert.equal(first.view.players[0].role, 'guardian');
  assert.equal(second.view.players[1].role, 'guardian');
  assert.equal(first.view.memoCapacity, 0);
  await act(0, { type: 'place', mines: [mine] });
  await act(1, { type: 'place', mines: [mine] });
  await assert.rejects(act(0, { type: 'chooseRole', role: 'illuminator' }), GameError);
});

test('authenticated manual memos survive service reload and turn changes without cross-player or spectator leakage', async () => {
  const fixture = await playing();
  const { service, storage, clock, code, seats, spectator, act, persisted, elapse } = fixture;
  const note: MemoEntry = { boardOwnerId: seats[2].view.selfId, edgeId: mine, status: 'safe' };
  const written = await act(0, { type: 'memo', slot: 0, entry: note });
  assert.deepEqual(written.view.selfMemos, [note, null]);
  assert.equal(written.view.position, null);
  assert.equal(written.view.activeSeat, 0);
  assert.deepEqual(persisted().state.memos?.[seats[0].view.selfId], [note, null]);
  // The guess is intentionally wrong; the service must not correct or label it.
  assert.ok(persisted().state.boards[seats[2].view.selfId].includes(note.edgeId));
  const restored = await new RoomService(storage, clock).get(code, seats[0].token);
  assert.deepEqual(restored.view.selfMemos, [note, null]);
  for (let seat = 1; seat < 6; seat++) {
    const other = await service.get(code, seats[seat].token);
    assert.ok(other.view.selfMemos?.every(entry => entry === null));
    assert.equal('memos' in other.view, false);
    assert.equal(JSON.stringify(other).includes(note.edgeId), false);
  }
  const audience = await service.get(code, spectator.token);
  for (const key of ['memos', 'selfMemos', 'memoCapacity', 'peekableMemos']) assert.equal(key in audience.view, false);
  await act(0, { type: 'spawn', nodeId: '4-0' });
  await act(0, { type: 'move', nodeId: '3-0' });
  elapse(4_000);
  const next = await service.get(code, seats[1].token);
  assert.equal(next.view.activeSeat, 1);
  await act(1, { type: 'memo', slot: 3, entry: { boardOwnerId: seats[5].view.selfId, edgeId: safeEdge, status: 'mine' } });
  assert.deepEqual((await service.get(code, seats[0].token)).view.selfMemos, [note, null]);
  assert.deepEqual((await service.get(code, seats[1].token)).view.selfMemos?.[3], { boardOwnerId: seats[5].view.selfId, edgeId: safeEdge, status: 'mine' });
});

test('private memo edits reject forged owners, invalid slots and spectators without changing stored state', async () => {
  const { service, code, seats, spectator, act, storage } = await playing();
  const note: MemoEntry = { boardOwnerId: seats[2].view.selfId, edgeId: mine, status: 'unsure' };
  const before = storage.records.get(code)!.payload;
  await assert.rejects(act(0, { type: 'memo', slot: 2, entry: note }), GameError);
  await assert.rejects(act(0, { type: 'memo', slot: 0, entry: { ...note, boardOwnerId: spectator.view.selfId } }), GameError);
  await assert.rejects(act(0, { type: 'memo', slot: 0, entry: { ...note, edgeId: 'not-an-edge' } }), GameError);
  const current = await service.get(code, spectator.token);
  await assert.rejects(service.act(code, spectator.token, { type: 'memo', slot: 0, entry: note }, current.view.revision), (error: unknown) => error instanceof GameError && error.status === 403);
  const outsider = await service.create('다른 방');
  await assert.rejects(service.act(code, outsider.token, { type: 'memo', slot: 0, entry: note }, current.view.revision), (error: unknown) => error instanceof RoomError && error.status === 401);
  assert.equal(storage.records.get(code)!.payload, before);
});

test('independent private notes and a move or hint merge in either commit order without repeating the game action', async () => {
  for (const gameType of ['move', 'hint'] as const) {
    for (const order of ['notes-first', 'game-first', 'concurrent'] as const) {
      const { service, code, seats, spectator, act, persisted, storage } = await playing();
      if (gameType === 'move') await act(0, { type: 'spawn', nodeId: '4-4' });
      const current = await service.get(code, seats[0].token);
      const revision = current.view.revision;
      const gameAction: GameAction = gameType === 'move' ? { type: 'move', nodeId: '3-3' } : { type: 'hint', edgeId: mine };
      const notes: MemoEntry[] = [
        { boardOwnerId: seats[4].view.selfId, edgeId: mine, status: 'safe' },
        { boardOwnerId: seats[5].view.selfId, edgeId: safeEdge, status: 'mine' },
      ];
      const write = (index: number) => service.act(code, seats[index + 1].token, { type: 'memo', slot: 0, entry: notes[index] }, revision);
      const play = () => service.act(code, seats[0].token, gameAction, revision);
      if (order === 'notes-first') { await Promise.all([write(0), write(1)]); await play(); }
      else if (order === 'game-first') { await play(); await Promise.all([write(0), write(1)]); }
      else await Promise.all([write(0), play(), write(1)]);
      const final = persisted().state;
      assert.equal(final.revision, revision + 3, `${gameType}/${order}`);
      assert.equal(final.activeSeat, 0);
      assert.equal(final.position, gameType === 'move' ? '3-3' : null);
      assert.equal(final.players[0].coins, gameType === 'hint' ? 2 : 3);
      assert.equal(final.event?.type ?? null, gameType === 'move' ? 'move' : null);
      for (const index of [0, 1]) {
        assert.deepEqual(final.memos?.[seats[index + 1].view.selfId]?.[0], notes[index]);
        const own = await service.get(code, seats[index + 1].token);
        assert.deepEqual(own.view.selfMemos?.[0], notes[index]);
      }
      const audience = (await service.get(code, spectator.token)).view;
      assert.equal('selfMemos' in audience, false);
      assert.equal('actionRevision' in audience, false);
      for (const participant of [...seats, spectator]) {
        const projected = (await service.get(code, participant.token)).view;
        assert.equal('actionRevision' in projected, false);
        for (const player of projected.players) {
          assert.equal('memoRevision' in player, false);
          assert.equal('roleRevision' in player, false);
        }
      }
      const committed = storage.records.get(code)!.payload;
      await assert.rejects(play(), error => error instanceof RoomError && error.status === 409);
      await assert.rejects(write(0), error => error instanceof RoomError && error.status === 409);
      assert.equal(storage.records.get(code)!.payload, committed, 'stale repeats never spend another coin, move or replace a note');
    }
  }
});

test('two stale writes by the same memo owner accept one while a fresh correction and deletion succeed off turn', async () => {
  const { service, code, seats, persisted, act } = await playing();
  const current = await service.get(code, seats[1].token);
  const entries: MemoEntry[] = [
    { boardOwnerId: seats[2].view.selfId, edgeId: mine, status: 'mine' },
    { boardOwnerId: seats[3].view.selfId, edgeId: safeEdge, status: 'safe' },
  ];
  const outcomes = await Promise.allSettled(entries.map((entry, slot) =>
    service.act(code, seats[1].token, { type: 'memo', slot, entry }, current.view.revision)));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const failed = outcomes.find(result => result.status === 'rejected');
  assert.ok(failed?.status === 'rejected' && failed.reason instanceof RoomError && failed.reason.status === 409);
  assert.equal(persisted().state.memos?.[seats[1].view.selfId]?.filter(Boolean).length, 1);
  const corrected = await act(1, { type: 'memo', slot: 0, entry: entries[1] });
  assert.equal(corrected.view.activeSeat, 0);
  assert.deepEqual(corrected.view.selfMemos?.[0], entries[1]);
  const removed = await act(1, { type: 'memo', slot: 0, entry: null });
  assert.equal(removed.view.selfMemos?.[0], null);
  assert.equal(removed.view.activeSeat, 0);
});

test('an open memo can survive a turn transition but cannot overwrite notes in a later round', async () => {
  const { service, code, seats, act, seed, persisted, elapse, storage } = await playing();
  const note: MemoEntry = { boardOwnerId: seats[2].view.selfId, edgeId: mine, status: 'unsure' };
  const opened = await service.get(code, seats[2].token);
  await act(0, { type: 'spawn', nodeId: '4-0' });
  const exploded = await act(0, { type: 'move', nodeId: '3-0' });
  elapse(2_000);
  const written = await service.act(code, seats[2].token, { type: 'memo', slot: 0, entry: note }, opened.view.revision);
  assert.deepEqual(written.view.event, exploded.view.event, 'recording never shortens the explosion');
  assert.equal(written.view.position, null);
  const editing = written.view.revision;
  elapse(2_000);
  const corrected = await service.act(code, seats[2].token, { type: 'memo', slot: 0, entry: { ...note, status: 'mine' } }, editing);
  assert.equal(corrected.view.activeSeat, 1);
  assert.equal(corrected.view.event, null);
  assert.equal(corrected.view.selfMemos?.[0]?.status, 'mine');

  const previousRound = corrected.view.revision;
  seed(state => { state.phase = 'roundEnd'; state.winner = { seat: 0, points: 4, remainingCoins: 3 }; state.event = null; });
  await act(0, { type: 'nextRound' });
  for (let seat = 0; seat < seats.length; seat++) {
    await act(seat, { type: 'chooseRole', role: roleOrder[seat] });
    await act(seat, { type: 'place', mines: [mine] });
  }
  const before = storage.records.get(code)!.payload;
  await assert.rejects(service.act(code, seats[2].token, { type: 'memo', slot: 0, entry: note }, previousRound), error => error instanceof RoomError && error.status === 409);
  assert.equal(storage.records.get(code)!.payload, before);
  assert.ok(persisted().state.memos?.[seats[2].view.selfId]?.every(entry => entry === null));
});

test('memo requests from before an ability change cannot rebase into the later playing phase', async () => {
  const { service, code, seats, act, storage } = await setup({ selectRoles: false });
  const beforeSelection = await service.get(code, seats[1].token);
  for (let seat = 0; seat < seats.length; seat++) {
    await act(seat, { type: 'chooseRole', role: roleOrder[seat] });
    await act(seat, { type: 'place', mines: [mine] });
  }
  const committed = storage.records.get(code)!.payload;
  await assert.rejects(service.act(code, seats[1].token, { type: 'memo', slot: 0, entry: null }, beforeSelection.view.revision), error => error instanceof RoomError && error.status === 409);
  assert.equal(storage.records.get(code)!.payload, committed);
});

test('peek keeps exact-revision protection when another player edits a note and still costs only a successful fresh use', async () => {
  const { service, code, seats, act, persisted } = await playing();
  const first: MemoEntry = { boardOwnerId: seats[2].view.selfId, edgeId: mine, status: 'safe' };
  await act(1, { type: 'memo', slot: 0, entry: first });
  const viewed = await service.get(code, seats[0].token);
  const corrected: MemoEntry = { ...first, edgeId: safeEdge, status: 'mine' };
  await act(1, { type: 'memo', slot: 0, entry: corrected });
  const action: GameAction = { type: 'peek', targets: [{ playerId: seats[1].view.selfId, slot: 0 }] };
  await assert.rejects(service.act(code, seats[0].token, action, viewed.view.revision), error => error instanceof RoomError && error.status === 409);
  assert.equal(persisted().state.players[0].peeks, 2);
  const accepted = await act(0, action);
  assert.deepEqual(accepted.peekResult, [{ ...corrected, playerId: seats[1].view.selfId, slot: 0 }]);
  assert.equal(persisted().state.players[0].peeks, 1);
});

test('thief sees only occupied slot identifiers before choosing and receives contents only in the mutation reply', async () => {
  const { service, storage, clock, code, seats, spectator, act, seed, persisted } = await playing();
  const first: MemoEntry = { boardOwnerId: seats[4].view.selfId, edgeId: mine, status: 'safe' };
  const second: MemoEntry = { boardOwnerId: seats[2].view.selfId, edgeId: safeEdge, status: 'mine' };
  seed(state => { state.memos = { [seats[1].view.selfId]: [null, first, null, second] }; });
  const targets = [1, 3].map(slot => ({ playerId: seats[1].view.selfId, slot }));
  const before = await service.get(code, seats[0].token);
  assert.deepEqual(before.view.peekableMemos, targets);
  assert.equal(JSON.stringify(before).includes(first.edgeId), false);
  assert.equal(JSON.stringify(before).includes(second.edgeId), false);
  const result = await act(0, { type: 'peek', targets });
  assert.deepEqual(result.peekResult, [{ ...targets[0], ...first }, { ...targets[1], ...second }]);
  assert.equal(result.view.players[0].peeks, 1);
  assert.equal(result.view.players[0].coins, 3);
  assert.equal(result.view.activeSeat, 0);
  assert.equal(result.view.position, null);
  assert.deepEqual(result.view.selfMemos, [null, null]);
  assert.equal('peekResult' in persisted(), false);
  assert.equal('peekResult' in persisted().state, false);
  assert.equal('peekResult' in result.view, false);
  assert.equal(persisted().state.memos?.[seats[0].view.selfId], undefined);
  assert.deepEqual(persisted().state.memos?.[seats[1].view.selfId], [null, first, null, second]);
  for (const participant of [...seats, spectator]) {
    const refreshed = await new RoomService(storage, clock).get(code, participant.token);
    assert.equal('peekResult' in refreshed, false);
    assert.equal('peekResult' in refreshed.view, false);
    if (participant.view.selfId !== seats[0].view.selfId) assert.equal('peekableMemos' in refreshed.view, false);
    if (participant.view.selfId !== seats[1].view.selfId) {
      assert.equal(JSON.stringify(refreshed).includes(first.edgeId), false);
      assert.equal(JSON.stringify(refreshed).includes(second.edgeId), false);
    }
    if (participant.view.selfId !== seats[0].view.selfId) assert.equal('peeks' in refreshed.view.players[0], false);
  }
});

test('concurrent duplicate peeks consume one use and return exactly one private result', async () => {
  const { service, code, seats, seed, persisted } = await playing();
  const note: MemoEntry = { boardOwnerId: seats[3].view.selfId, edgeId: safeEdge, status: 'unsure' };
  seed(state => { state.memos = { [seats[1].view.selfId]: [note] }; });
  const current = await service.get(code, seats[0].token);
  const targets = [{ playerId: seats[1].view.selfId, slot: 0 }];
  const outcomes = await Promise.allSettled(Array.from({ length: 2 }, () => service.act(code, seats[0].token, { type: 'peek', targets }, current.view.revision)));
  const successes = outcomes.filter(outcome => outcome.status === 'fulfilled');
  const failures = outcomes.filter(outcome => outcome.status === 'rejected');
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.deepEqual(successes[0].value.peekResult, [{ ...targets[0], ...note }]);
  assert.ok(failures[0].reason instanceof RoomError);
  assert.equal(failures[0].reason.status, 409);
  const refreshed = await service.get(code, seats[0].token);
  assert.equal(refreshed.view.players[0].peeks, 1);
  assert.equal(refreshed.view.revision, current.view.revision + 1);
  assert.equal('peekResult' in refreshed, false);
  assert.equal(persisted().state.players[0].peeks, 1);
  assert.equal('peekResult' in persisted().state, false);
});

test('invalid peek selections preserve allowance and records, including duplicate slots and a recorder overflow slot', async () => {
  const { service, code, seats, spectator, act, seed, storage } = await playing();
  const note: MemoEntry = { boardOwnerId: seats[2].view.selfId, edgeId: safeEdge, status: 'safe' };
  seed(state => { state.memos = { [seats[1].view.selfId]: [note, note, note, note], [seats[0].view.selfId]: [note] }; });
  const target = { playerId: seats[1].view.selfId, slot: 0 };
  const before = storage.records.get(code)!.payload;
  const invalid = [
    [target, target],
    [0, 1, 2].map(slot => ({ ...target, slot })),
    [{ ...target, slot: 5 }],
    [{ playerId: seats[0].view.selfId, slot: 0 }],
    [{ playerId: spectator.view.selfId, slot: 0 }],
    [{ playerId: 'outside', slot: 0 }],
  ];
  for (const targets of invalid) await assert.rejects(act(0, { type: 'peek', targets }), GameError);
  await assert.rejects(act(1, { type: 'peek', targets: [target] }), (error: unknown) => error instanceof GameError && error.status === 409);
  const current = await service.get(code, spectator.token);
  await assert.rejects(service.act(code, spectator.token, { type: 'peek', targets: [target] }, current.view.revision), (error: unknown) => error instanceof GameError && error.status === 403);
  assert.equal(storage.records.get(code)!.payload, before);
});

test('concealed placement is owner-private and safe or mined concealed hints return the same ephemeral answer', async () => {
  const { service, code, seats, spectator, act, seed, persisted } = await setup();
  const placed = await act(2, { type: 'place', mines: [mine], concealed: concealedEdges });
  assert.deepEqual(placed.view.ownMines, [mine]);
  assert.deepEqual(placed.view.ownConcealed, concealedEdges);
  assert.deepEqual((await service.get(code, seats[2].token)).view.ownConcealed, concealedEdges);
  for (const participant of [seats[0], seats[1], seats[3], seats[4], seats[5], spectator]) {
    const other = await service.get(code, participant.token);
    assert.equal('ownConcealed' in other.view, false);
    assert.equal('concealedBoards' in other.view, false);
    for (const concealed of concealedEdges) assert.equal(JSON.stringify(other).includes(concealed), false);
  }
  for (let seat = 0; seat < 6; seat++) if (seat !== 2) await act(seat, { type: 'place', mines: [mine] });
  seed(state => { state.activeSeat = 3; });
  const current = await service.get(code, seats[3].token);
  assert.equal(current.view.boardOwnerSeat, 2);
  for (const participant of [...seats, spectator]) {
    const playingView = (await service.get(code, participant.token)).view;
    assert.equal(playingView.activeBoardMineCount, 1);
    for (const key of ['ownMines', 'ownConcealed', 'concealedBoards']) assert.equal(key in playingView, false);
  }
  for (const edgeId of [mine, safeEdge]) {
    const answer = await act(3, { type: 'hint', edgeId });
    assert.deepEqual(answer.privateResult, { edgeId, mined: null });
    for (const participant of [...seats, spectator]) assert.equal('privateResult' in await service.get(code, participant.token), false);
  }
  assert.equal((await service.get(code, seats[3].token)).view.players[3].coins, 3);
  assert.deepEqual(persisted().state.concealedBoards?.[seats[2].view.selfId], concealedEdges);
  assert.equal('privateResult' in persisted().state, false);
});

test('only the installer can commit concealment and base edges cannot be concealed', async () => {
  const { act, storage, code } = await setup();
  const before = storage.records.get(code)!.payload;
  await assert.rejects(act(0, { type: 'place', mines: [mine], concealed: [safeEdge] }), (error: unknown) => error instanceof GameError && error.status === 403);
  await assert.rejects(act(2, { type: 'place', mines: [mine], concealed: [edgeId('4-0', '4-1')] }), GameError);
  await assert.rejects(act(2, { type: 'place', mines: [mine], concealed: ['not-an-edge'] }), GameError);
  assert.equal(storage.records.get(code)!.payload, before);
});

test('seven mine shifts persist across authenticated service reloads, remain private and prevent further returns', async () => {
  const { service, storage, clock, code, seats, spectator, act, seed, persisted, elapse } = await playing();
  const owner = seats[5];
  const ownerId = owner.view.selfId;
  assert.equal((await service.get(code, owner.token)).view.players[5].shifts, 7);
  let fromEdgeId = mine;
  let toEdgeId = safeEdge;
  for (let remaining = 6; remaining >= 0; remaining--) {
    // Advance the fixture to the next own-board return without replaying all
    // six players' failed attempts between each authenticated relocation.
    seed(state => { state.shiftQueue = [5]; state.event = null; state.position = null; });
    const moved = await act(5, { type: 'shiftMine', fromEdgeId, toEdgeId });
    assert.equal(moved.view.players[5].shifts, remaining);
    assert.equal(persisted().state.players[5].shifts, remaining);
    assert.deepEqual(persisted().state.boards[ownerId], [toEdgeId]);
    const restored = await new RoomService(storage, clock).get(code, owner.token);
    assert.equal(restored.view.players[5].shifts, remaining);
    [fromEdgeId, toEdgeId] = [toEdgeId, fromEdgeId];
  }
  for (const participant of [...seats.slice(0, 5), spectator]) {
    const other = await service.get(code, participant.token);
    assert.equal('shifts' in other.view.players[5], false);
  }
  seed(state => { state.shiftQueue = [5]; state.event = null; });
  const exhausted = storage.records.get(code)!.payload;
  await assert.rejects(act(5, { type: 'shiftMine', fromEdgeId, toEdgeId }),
    (error: unknown) => error instanceof GameError && error.status === 409);
  assert.equal(storage.records.get(code)!.payload, exhausted);

  // The real final failed attempt must skip an exhausted shifter entirely.
  seed(state => {
    state.shiftQueue = []; state.event = null; state.position = null;
    state.rotation = 5; state.activeSeat = 5; state.attempts = 5;
  });
  await act(5, { type: 'spawn', nodeId: '4-0' });
  await act(5, { type: 'move', nodeId: '3-0' });
  elapse(4_000);
  const rotated = await service.get(code, owner.token);
  assert.equal(rotated.view.rotation, 1);
  assert.equal(rotated.view.event?.type, 'rotation');
  assert.equal('shiftSeat' in rotated.view, false);
  assert.equal(rotated.view.players[5].shifts, 0);
});

test('concurrent duplicate mine shifts commit one relocation and consume exactly one allowance', async () => {
  const { service, code, seats, seed, persisted } = await playing();
  seed(state => { state.shiftQueue = [5]; state.event = null; });
  const current = await service.get(code, seats[5].token);
  const action: GameAction = { type: 'shiftMine', fromEdgeId: mine, toEdgeId: safeEdge };
  const outcomes = await Promise.allSettled(Array.from({ length: 2 }, () =>
    service.act(code, seats[5].token, action, current.view.revision)));
  const successes = outcomes.filter(outcome => outcome.status === 'fulfilled');
  const failures = outcomes.filter(outcome => outcome.status === 'rejected');
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.ok(failures[0].reason instanceof RoomError);
  assert.equal(failures[0].reason.status, 409);
  assert.equal(successes[0].value.view.players[5].shifts, 6);
  assert.equal(successes[0].value.view.revision, current.view.revision + 1);
  assert.equal(persisted().state.players[5].shifts, 6);
  assert.deepEqual(persisted().state.boards[seats[5].view.selfId], [safeEdge]);
});

test('legacy shifters get seven uses once, while invalid moves and skipped returns preserve the allowance', async () => {
  const { service, storage, clock, code, seats, act, seed, persisted } = await playing();
  seed(state => { delete state.players[5].shifts; state.shiftQueue = [5]; state.event = null; });
  const legacy = await new RoomService(storage, clock).get(code, seats[5].token);
  assert.equal(legacy.view.players[5].shifts, 7);
  const before = storage.records.get(code)!.payload;
  for (const action of [
    { type: 'shiftMine', fromEdgeId: safeEdge, toEdgeId: mine },
    { type: 'shiftMine', fromEdgeId: mine, toEdgeId: mine },
    { type: 'shiftMine', fromEdgeId: mine, toEdgeId: edgeId('4-0', '4-1') },
  ] satisfies GameAction[]) await assert.rejects(act(5, action), GameError);
  assert.equal(storage.records.get(code)!.payload, before);
  const skipped = await act(5, { type: 'shiftMine' });
  assert.equal(skipped.view.players[5].shifts, 7);
  assert.deepEqual(persisted().state.boards[seats[5].view.selfId], [mine]);
  seed(state => { state.shiftQueue = [5]; state.event = null; });
  const moved = await act(5, { type: 'shiftMine', fromEdgeId: mine, toEdgeId: safeEdge });
  assert.equal(moved.view.players[5].shifts, 6);
  assert.equal(persisted().state.players[5].shifts, 6);
  const restored = await new RoomService(storage, clock).get(code, seats[5].token);
  assert.equal(restored.view.players[5].shifts, 6);
  assert.equal((await service.get(code, seats[5].token)).view.players[5].shifts, 6);
});

test('a fresh round clears exhausted mine shifts and selecting the ability replenishes all seven', async () => {
  const { act, seed, persisted, elapse } = await playing();
  seed(state => { state.players[5].shifts = 0; });
  await act(0, { type: 'spawn', nodeId: '4-4' });
  for (const nodeId of ['3-3', '2-2', '1-1', '0-0']) {
    await act(0, { type: 'move', nodeId });
    elapse(650);
  }
  const next = await act(0, { type: 'nextRound' });
  assert.equal(next.view.phase, 'placing');
  assert.equal(next.view.round, 2);
  assert.equal(persisted().state.players[5].role, undefined);
  assert.equal(persisted().state.players[5].shifts, 0);
  const selected = await act(5, { type: 'chooseRole', role: 'shifter' });
  assert.equal(selected.view.players[5].shifts, 7);
  assert.equal(persisted().state.players[5].shifts, 7);
});

test('six simultaneous role choices rebase independent participants from the same placement revision', async () => {
  const { service, code, seats, persisted } = await setup({ selectRoles: false });
  const starting = await service.get(code, seats[0].token);
  const choices = await Promise.all(seats.map((seat, index) => service.act(code, seat.token, { type: 'chooseRole', role: roleOrder[index] }, starting.view.revision)));
  assert.equal(choices.length, 6);
  for (let seat = 0; seat < choices.length; seat++) {
    assert.equal(choices[seat].view.players[seat].role, roleOrder[seat]);
    assert.ok(choices[seat].view.players.every(player => !('roleRevision' in player)));
  }
  const current = await service.get(code, seats[0].token);
  assert.equal(current.view.revision, starting.view.revision + 6);
  assert.deepEqual(current.view.players.map(player => player.role), roleOrder);
  assert.deepEqual(persisted().state.players.map(player => player.role), roleOrder);
  assert.ok(current.view.players.every(player => !player.ready));
});

test('two simultaneous different role choices by one participant accept only one choice', async () => {
  const { service, code, seats, persisted } = await setup({ selectRoles: false });
  const starting = await service.get(code, seats[0].token);
  const roles = ['guardian', 'illuminator'] as const;
  const choices = await Promise.allSettled(roles.map(role => service.act(code, seats[0].token, { type: 'chooseRole', role }, starting.view.revision)));
  const successes = choices.filter(choice => choice.status === 'fulfilled');
  const failures = choices.filter(choice => choice.status === 'rejected');
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.ok(failures[0].reason instanceof RoomError);
  assert.equal(failures[0].reason.status, 409);
  const winningRole = roles[choices.findIndex(choice => choice.status === 'fulfilled')];
  const current = await service.get(code, seats[0].token);
  assert.equal(current.view.revision, starting.view.revision + 1);
  assert.equal(current.view.players[0].role, winningRole);
  assert.equal(current.view.players[0].coins, winningRole === 'illuminator' ? 5 : 3);
  assert.equal(current.view.players[0].blessings, winningRole === 'guardian' ? 2 : 0);
  assert.equal(persisted().state.players[0].role, winningRole);
});

test('placement older than the actor role choice is rejected while unrelated later choices allow rebasing', async () => {
  const { service, code, seats, act, storage } = await setup({ selectRoles: false });
  const beforeChoice = await service.get(code, seats[0].token);
  const ownChoice = await act(0, { type: 'chooseRole', role: 'trapper' });
  await act(1, { type: 'chooseRole', role: 'guardian' });
  const beforeReject = storage.records.get(code)!.payload;
  const placement = { type: 'place', mines: [mine], concealed: concealedEdges } as const;
  await assert.rejects(service.act(code, seats[0].token, placement, beforeChoice.view.revision), (error: unknown) => error instanceof RoomError && error.status === 409);
  assert.equal(storage.records.get(code)!.payload, beforeReject);
  const placed = await service.act(code, seats[0].token, placement, ownChoice.view.revision);
  assert.equal(placed.view.players[0].role, 'trapper');
  assert.equal(placed.view.players[0].ready, true);
  assert.deepEqual(placed.view.ownMines, [mine]);
  assert.deepEqual(placed.view.ownConcealed, concealedEdges);
  assert.equal(placed.view.players[1].role, 'guardian');
});

test('a previous round role-choice revision cannot rebase into the new placement phase', async () => {
  const { service, code, seats, act, elapse, storage } = await setup();
  const previousRound = await service.get(code, seats[1].token);
  for (let seat = 0; seat < 6; seat++) await act(seat, { type: 'place', mines: [] });
  await act(0, { type: 'spawn', nodeId: '4-0' });
  for (const nodeId of ['3-0', '2-0', '1-0', '0-0']) {
    await act(0, { type: 'move', nodeId });
    elapse(650);
  }
  const next = await act(0, { type: 'nextRound' });
  assert.equal(next.view.phase, 'placing');
  assert.equal(next.view.round, 2);
  assert.ok(next.view.players.every(player => player.role === undefined));
  const beforeReject = storage.records.get(code)!.payload;
  await assert.rejects(service.act(code, seats[1].token, { type: 'chooseRole', role: 'guardian' }, previousRound.view.revision), (error: unknown) => error instanceof RoomError && error.status === 409);
  assert.equal(storage.records.get(code)!.payload, beforeReject);
  const chosen = await service.act(code, seats[1].token, { type: 'chooseRole', role: 'guardian' }, next.view.revision);
  assert.equal(chosen.view.players[1].role, 'guardian');
  assert.equal(chosen.view.players[1].blessings, 2);
});
