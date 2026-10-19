import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiReply, GameAction, GameState, RoomSettings } from '../lib/contracts';
import { EDGES, edgeId, getBoard, hasSafePath, maxMines } from '../lib/game.ts';
import { DEFAULT_ROOM_SETTINGS } from '../lib/settings.ts';
import { apiResponse, bearerToken, parseAction, readMutation, RoomError, RoomService, type RoomRecord, type RoomStorage } from '../lib/room-service.ts';

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
    const expired = [...this.records.values()].filter((record) => record.updatedAt < before).slice(0, limit);
    for (const record of expired) this.records.delete(record.code);
  }
}

class ConflictingStorage extends MemoryStorage {
  beforeSwap: (() => Promise<void>) | null = null;
  async compareAndSwap(record: RoomRecord, previousVersion: number) {
    const conflict = this.beforeSwap;
    this.beforeSwap = null;
    if (conflict) await conflict();
    return super.compareAndSwap(record, previousVersion);
  }
}

async function setup(settings?: RoomSettings) {
  const storage = new MemoryStorage();
  let now = 1_000_000;
  const service = new RoomService(storage, () => now);
  const host = await service.create('방장');
  const code = host.view.code;
  const legacyRecord = storage.records.get(code)!;
  const legacyRoom = JSON.parse(legacyRecord.payload);
  legacyRoom.state.rolesEnabled = false;
  legacyRecord.payload = JSON.stringify(legacyRoom);
  if (settings) await service.act(code, host.token, { type: 'settings', settings }, host.view.revision);
  const seats = [host];
  for (let index = 1; index < (settings?.playerCount ?? 6); index++) seats.push(await service.join(code, `참가자${index}`));
  const act = async (seat: number, action: GameAction) => {
    const current = await service.get(code, seats[seat].token);
    const readyAction = action.type === 'place' && current.view.placementMode === 'retained' && !current.view.rebuildSeats?.includes(seat)
      ? { type: 'ready' as const } : action;
    return service.act(code, seats[seat].token, readyAction, current.view.revision);
  };
  return { storage, service, host, code, seats, act, elapse: (milliseconds: number) => { now += milliseconds; } };
}

async function playing() {
  const fixture = await setup();
  await fixture.act(0, { type: 'start' });
  const mine = EDGES.find((edge) => edge.a === '3-0' && edge.b === '4-0')!;
  for (let seat = 0; seat < 6; seat++) await fixture.act(seat, { type: 'place', mines: [mine.id] });
  const current = await fixture.service.get(fixture.code, fixture.host.token);
  await fixture.act(current.view.activeSeat, { type: 'chooseBoard', ownerSeat: (current.view.activeSeat + 1) % 6 });
  return { ...fixture, mine, activeSeat: current.view.activeSeat };
}

test('concurrent arrivals fill six unique seats then wait without losing identities', async () => {
  const storage = new MemoryStorage();
  const service = new RoomService(storage);
  const host = await service.create('방장');
  const outcomes = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => service.join(host.view.code, `친구${index}`)));
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 6);
  const room = await service.get(host.view.code, host.token);
  assert.equal(room.view.players.length, 6);
  assert.equal(room.view.spectators.length, 1);
  assert.deepEqual(room.view.players.map((player) => player.seat), [0, 1, 2, 3, 4, 5]);
  for (const result of outcomes) {
    if (result.status === 'fulfilled') {
      const own = await service.get(host.view.code, result.value.token);
      assert.equal(own.view.selfId, result.value.view.selfId);
    }
  }
  const record = storage.records.get(host.view.code)!;
  assert.equal(record.payload.includes(host.token), false);
  assert.equal(Object.keys(JSON.parse(record.payload).identities).length, 7);
});

test('configured room settings are host-only, public, validated, and locked after start', async () => {
  const settings = { playerCount: 3, hintCoins: 0, totalRounds: 2, gridSize: 4 };
  const { service, code, seats, act, storage } = await setup(settings);
  const other = await service.get(code, seats[1].token);
  assert.deepEqual({ playerCount: other.view.playerCount, hintCoins: other.view.hintCoins, totalRounds: other.view.totalRounds, gridSize: other.view.gridSize }, settings);
  assert.equal(other.view.players[1].coins, 0);
  assert.equal('coins' in other.view.players[0], false);
  await assert.rejects(act(1, { type: 'settings', settings: { ...settings, hintCoins: 7 } }), /방장/);
  const reduced = await act(0, { type: 'settings', settings: { ...settings, playerCount: 2 } });
  assert.equal(reduced.view.players.length, 2);
  assert.equal(reduced.view.spectators[0].id, seats[2].view.selfId);
  const audience = await service.join(code, '관전자');
  assert.equal(audience.view.spectators.length, 2);
  await act(0, { type: 'settings', settings: { ...settings, hintCoins: 7 } });
  const state = JSON.parse(storage.records.get(code)!.payload).state as GameState;
  assert.ok(state.players.every((player) => player.coins === 7));
  await act(0, { type: 'start' });
  await assert.rejects(act(0, { type: 'settings', settings }), /지금은/);
  for (let seat = 0; seat < 3; seat++) await act(seat, { type: 'place', mines: [] });
  await assert.rejects(act(0, { type: 'settings', settings }), /지금은/);
});

test('settings input rejects hidden fields, missing fields and every invalid numeric bound', () => {
  const invalid: unknown[] = [undefined, null, [], {}, { ...DEFAULT_ROOM_SETTINGS, hidden: true }];
  for (const field of ['playerCount', 'hintCoins', 'totalRounds', 'gridSize']) {
    const missing: Record<string, unknown> = { ...DEFAULT_ROOM_SETTINGS };
    delete missing[field];
    invalid.push(missing);
    for (const value of [NaN, Infinity, -Infinity, 1.5, '3', null, undefined, true]) invalid.push({ ...DEFAULT_ROOM_SETTINGS, [field]: value });
  }
  for (const [field, values] of Object.entries({ playerCount: [1, 7, 8, 9], hintCoins: [-1, 11], totalRounds: [0, 21], gridSize: [2, 7] })) {
    for (const value of values) invalid.push({ ...DEFAULT_ROOM_SETTINGS, [field]: value });
  }
  for (const settings of invalid) assert.throws(() => parseAction({ type: 'settings', settings }), RoomError);
  assert.throws(() => parseAction({ type: 'settings', settings: DEFAULT_ROOM_SETTINGS, hostId: 'forged' }), /형식/);
  for (const settings of [{ playerCount: 2, hintCoins: 0, totalRounds: 1, gridSize: 4 }, { playerCount: 6, hintCoins: 10, totalRounds: 20, gridSize: 4 }]) {
    assert.deepEqual(parseAction({ type: 'settings', settings }), { type: 'settings', settings });
  }
});

test('a join that loses CAS to a capacity reduction retries against the new capacity', async () => {
  const storage = new ConflictingStorage();
  const service = new RoomService(storage);
  const host = await service.create('방장');
  const guest = await service.join(host.view.code, '친구');
  const before = await service.get(host.view.code, host.token);
  storage.beforeSwap = async () => {
    await service.act(host.view.code, host.token, { type: 'settings', settings: { playerCount: 2, hintCoins: 0, totalRounds: 1, gridSize: 4 } }, before.view.revision);
  };
  const arrival = await service.join(host.view.code, '뒤늦은 참가자');
  const current = await service.get(host.view.code, guest.token);
  assert.equal(current.view.playerCount, 2);
  assert.equal(current.view.players.length, 2);
  assert.equal(current.view.players[1].coins, 0);
  assert.equal(current.view.spectators[0].id, arrival.view.selfId);
  assert.equal(Object.keys(JSON.parse(storage.records.get(host.view.code)!.payload).identities).length, 3);
});

test('settings losing CAS preserve arrivals and retry demotes trailing seats safely', async () => {
  const storage = new ConflictingStorage();
  const service = new RoomService(storage);
  const host = await service.create('방장');
  await service.join(host.view.code, '친구');
  const before = await service.get(host.view.code, host.token);
  let arrivedToken = '';
  storage.beforeSwap = async () => { arrivedToken = (await service.join(host.view.code, '동시 참가')).token; };
  const settings = { playerCount: 2, hintCoins: 0, totalRounds: 1, gridSize: 4 };
  await assert.rejects(service.act(host.view.code, host.token, { type: 'settings', settings }, before.view.revision), (error: unknown) => error instanceof RoomError && error.status === 409);
  const current = await service.get(host.view.code, arrivedToken);
  assert.equal(current.view.players.length, 3);
  assert.equal(current.view.playerCount, 6);
  assert.equal(current.view.hintCoins, 3);
  const shrunk = await service.act(host.view.code, host.token, { type: 'settings', settings }, current.view.revision);
  assert.equal(shrunk.view.players.length, 2);
  assert.equal(shrunk.view.spectators[0].id, current.view.selfId);
});

test('two simultaneous settings saves accept one version without mixed values', async () => {
  const storage = new MemoryStorage();
  const service = new RoomService(storage);
  const host = await service.create('방장');
  const settings = [{ playerCount: 2, hintCoins: 0, totalRounds: 1, gridSize: 4 }, { playerCount: 6, hintCoins: 10, totalRounds: 20, gridSize: 4 }];
  const results = await Promise.allSettled(settings.map((value) => service.act(host.view.code, host.token, { type: 'settings', settings: value }, host.view.revision)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const winnerIndex = results.findIndex((result) => result.status === 'fulfilled');
  const current = (await service.get(host.view.code, host.token)).view;
  assert.deepEqual({ playerCount: current.playerCount, hintCoins: current.hintCoins, totalRounds: current.totalRounds, gridSize: current.gridSize }, settings[winnerIndex]);
  assert.equal(current.players[0].coins, settings[winnerIndex].hintCoins);
});

test('legacy persisted rooms resume with original defaults without resetting ongoing play', async () => {
  const { service, code, seats, activeSeat, act, storage, mine } = await playing();
  await act(activeSeat, { type: 'hint', edgeId: mine.id });
  const record = storage.records.get(code)!;
  const legacy = JSON.parse(record.payload) as { state: Partial<GameState>; identities: Record<string, string> };
  delete legacy.state.playerCount;
  delete legacy.state.hintCoins;
  delete legacy.state.gridSize;
  delete legacy.state.spectators;
  legacy.state.round = 2;
  legacy.state.totalRounds = 4;
  legacy.state.players![activeSeat].score = 9;
  record.payload = JSON.stringify(legacy);
  const before = record.payload;
  const view = (await service.get(code, seats[activeSeat].token)).view;
  assert.equal(view.playerCount, 6);
  assert.equal(view.hintCoins, 3);
  assert.equal(view.gridSize, 4);
  assert.deepEqual(view.spectators, []);
  assert.equal(view.phase, 'playing');
  assert.equal(view.round, 2);
  assert.equal(view.totalRounds, 4);
  assert.equal(view.activeSeat, activeSeat);
  assert.equal(view.players[activeSeat].coins, 2);
  assert.equal(view.players[activeSeat].score, 9);
  assert.equal(view.revision, legacy.state.revision);
  assert.equal(storage.records.get(code)!.payload, before);
  await act(activeSeat, { type: 'spawn', nodeId: '4-0' });
  const resumed = JSON.parse(storage.records.get(code)!.payload).state as GameState;
  assert.equal(resumed.playerCount, 6);
  assert.equal(resumed.hintCoins, 3);
  assert.equal(resumed.position, '4-0');
  assert.deepEqual(resumed.boards, legacy.state.boards);
  assert.deepEqual(resumed.players, legacy.state.players);
  assert.equal(resumed.totalRounds, 4);
});

test('legacy waiting rooms still admit and start all six players', async () => {
  const storage = new MemoryStorage();
  const service = new RoomService(storage);
  const host = await service.create('방장');
  const record = storage.records.get(host.view.code)!;
  const legacy = JSON.parse(record.payload);
  delete legacy.state.playerCount;
  delete legacy.state.hintCoins;
  delete legacy.state.gridSize;
  delete legacy.state.spectators;
  record.payload = JSON.stringify(legacy);
  for (let seat = 1; seat < 6; seat++) await service.join(host.view.code, `친구${seat}`);
  const current = await service.get(host.view.code, host.token);
  const started = await service.act(host.view.code, host.token, { type: 'start' }, current.view.revision);
  assert.equal(started.view.phase, 'placing');
  assert.equal(started.view.playerCount, 6);
  assert.equal(started.view.hintCoins, 3);
  assert.equal(started.view.totalRounds, 7);
});

test('room projections and authentication never expose boards or another player coins', async () => {
  const { service, code, seats, storage, act } = await setup();
  const outside = await service.create('외부인');
  await assert.rejects(service.get(code, outside.token), (error: unknown) => error instanceof RoomError && error.status === 401);
  await assert.rejects(service.get(code, ''), (error: unknown) => error instanceof RoomError && error.status === 401);
  await assert.rejects(act(1, { type: 'start' }), /방장/);
  await act(0, { type: 'start' });
  const minedEdge = EDGES.find((edge) => !edge.base)!;
  await act(0, { type: 'place', mines: [minedEdge.id] });
  const hostView = await service.get(code, seats[0].token);
  const otherView = await service.get(code, seats[1].token);
  assert.deepEqual(hostView.view.ownMines, [minedEdge.id]);
  assert.deepEqual(otherView.view.ownMines, []);
  for (const result of [hostView, otherView]) {
    assert.equal('boards' in result.view, false);
    assert.equal('identities' in result.view, false);
    assert.equal('token' in result, false);
    assert.equal('privateResult' in result, false);
    assert.ok(result.view.players.filter((player) => player.id !== result.view.selfId).every((player) => !('coins' in player)));
  }
  const before = storage.records.get(code)!.payload;
  await assert.rejects(service.act(code, outside.token, { type: 'place', mines: [] }, otherView.view.revision));
  assert.equal(storage.records.get(code)!.payload, before);
});

test('concurrent identical hints charge one coin and deliver one ephemeral answer', async () => {
  const fixture = await playing();
  const { service, code, seats, mine, activeSeat, storage } = fixture;
  const token = seats[activeSeat].token;
  const current = await service.get(code, token);
  const outcomes = await Promise.allSettled([
    service.act(code, token, { type: 'hint', edgeId: mine.id }, current.view.revision),
    service.act(code, token, { type: 'hint', edgeId: mine.id }, current.view.revision),
  ]);
  const successes = outcomes.filter((result) => result.status === 'fulfilled');
  assert.equal(successes.length, 1);
  assert.deepEqual(successes[0].value.privateResult, { edgeId: mine.id, mined: true });
  const failure = outcomes.find((result) => result.status === 'rejected')!;
  assert.equal(failure.reason.status, 409);
  const refreshed = await service.get(code, token);
  assert.equal(refreshed.view.players[activeSeat].coins, 2);
  assert.equal(refreshed.view.position, null);
  assert.equal(refreshed.view.activeSeat, activeSeat);
  assert.equal('privateResult' in refreshed, false);
  assert.equal('ownMines' in refreshed.view, false);
  const room = JSON.parse(storage.records.get(code)!.payload);
  assert.equal('privateResult' in room, false);
  assert.equal(JSON.stringify(room).includes('edgeId'), false);
  for (let seat = 0; seat < 6; seat++) {
    if (seat === activeSeat) continue;
    const observer = await service.get(code, seats[seat].token);
    assert.equal('privateResult' in observer, false);
    assert.equal('coins' in observer.view.players[activeSeat], false);
  }
});

test('six simultaneous placement commits merge safely within the same placement phase', async () => {
  const { service, code, seats, storage, act } = await setup();
  const started = await act(0, { type: 'start' });
  const mines = EDGES.filter((edge) => !edge.base).slice(0, 6).map((edge) => edge.id);
  const results = await Promise.all(seats.map((seat, index) => service.act(
    code, seat.token, { type: 'place', mines: [mines[index]] }, started.view.revision,
  )));
  assert.equal(results.length, 6);
  const current = await service.get(code, seats[0].token);
  assert.equal(current.view.phase, 'playing');
  assert.equal(current.view.players.filter((player) => player.ready).length, 6);
  assert.equal(current.view.revision, started.view.revision + 6);
  const state = JSON.parse(storage.records.get(code)!.payload).state as GameState;
  seats.forEach((seat, index) => {
    assert.deepEqual(state.boards[seat.view.selfId], [mines[index]]);
    assert.equal('boards' in results[index].view, false);
    assert.ok(!results[index].view.ownMines || results[index].view.ownMines.every((edge) => edge === mines[index]));
  });
  await assert.rejects(service.act(code, seats[0].token, { type: 'place', mines: [] }, started.view.revision), (error: unknown) => error instanceof RoomError && error.status === 409);
});

test('placement rebasing rejects a previous round revision and duplicate committed boards', async () => {
  const { service, code, seats, act, elapse, storage } = await setup();
  const firstPlacement = await act(0, { type: 'start' });
  await act(0, { type: 'place', mines: [] });
  await assert.rejects(service.act(code, seats[0].token, { type: 'place', mines: [EDGES[0].id] }, firstPlacement.view.revision), (error: unknown) => error instanceof RoomError && error.status === 409);
  for (let seat = 1; seat < 6; seat++) await act(seat, { type: 'place', mines: [] });
  const active = (await service.get(code, seats[0].token)).view.activeSeat;
  await act(active, { type: 'chooseBoard', ownerSeat: (active + 1) % 6 });
  await act(active, { type: 'spawn', nodeId: '4-0' });
  for (const nodeId of ['3-0', '2-0', '1-0', '0-0']) {
    await act(active, { type: 'move', nodeId });
    elapse(1_000);
  }
  const nextRound = await act(0, { type: 'nextRound' });
  assert.equal(nextRound.view.round, 2);
  assert.equal(nextRound.view.phase, 'placing');
  await assert.rejects(service.act(code, seats[1].token, { type: 'place', mines: [] }, firstPlacement.view.revision), (error: unknown) => error instanceof RoomError && error.status === 409);
  const state = JSON.parse(storage.records.get(code)!.payload).state as GameState;
  assert.deepEqual(state.boards, Object.fromEntries(seats.map(seat => [seat.view.selfId, []])));
  assert.equal(state.players.filter((player) => player.ready).length, 0);
  const accepted = await service.act(code, seats[1].token, nextRound.view.rebuildSeats?.includes(1) ? { type: 'place', mines: [] } : { type: 'ready' }, nextRound.view.revision);
  assert.equal(accepted.view.players[1].ready, true);
});

test('expired explosion advances exactly once with simultaneous refreshes and leaves no trail', async () => {
  const { service, code, seats, activeSeat, act, elapse, storage } = await playing();
  await act(activeSeat, { type: 'spawn', nodeId: '4-0' });
  const exploded = await act(activeSeat, { type: 'move', nodeId: '3-0' });
  assert.equal(exploded.view.event?.type, 'explosion');
  elapse(exploded.view.event!.until - exploded.view.serverNow - 1);
  const pending = await Promise.all(seats.map((seat) => service.get(code, seat.token)));
  assert.ok(pending.every((result) => result.view.activeSeat === activeSeat));
  assert.ok(pending.every((result) => result.view.boardOwnerSeat === exploded.view.boardOwnerSeat));
  assert.ok(pending.every((result) => result.view.event?.id === exploded.view.event?.id && result.view.position === null));
  assert.ok(pending.every((result) => result.view.revision === exploded.view.revision));
  elapse(1);
  const refreshed = await Promise.all(seats.map((seat) => service.get(code, seat.token)));
  assert.ok(refreshed.every((result) => result.view.activeSeat === (activeSeat + 1) % 6));
  assert.ok(refreshed.every((result) => result.view.event === null && result.view.position === null));
  const persisted = JSON.parse(storage.records.get(code)!.payload).state as GameState;
  assert.equal(persisted.attempts, 1);
  assert.equal(persisted.revision, exploded.view.revision + 1);
  assert.equal(persisted.event, null);
  assert.ok(Object.values(persisted.boards).every((mines) => mines.length === 1));
});

test('stale actions cannot respawn, move, or spend a coin after a transition', async () => {
  const { service, code, seats, activeSeat, act, elapse, mine } = await playing();
  await act(activeSeat, { type: 'spawn', nodeId: '4-0' });
  const exploded = await act(activeSeat, { type: 'move', nodeId: '3-0' });
  elapse(exploded.view.event!.until - exploded.view.serverNow);
  await assert.rejects(service.act(code, seats[activeSeat].token, { type: 'hint', edgeId: mine.id }, exploded.view.revision), (error: unknown) => error instanceof RoomError && error.status === 409);
  const after = await service.get(code, seats[activeSeat].token);
  assert.equal(after.view.players[activeSeat].coins, 3);
  assert.equal(after.view.activeSeat, (activeSeat + 1) % 6);
});

test('room expiry is enforced and names and actions are validated', async () => {
  const { service, code, host, elapse, storage } = await setup();
  await assert.rejects(service.create(' '.repeat(5)), /이름/);
  await assert.rejects(service.create('가'.repeat(13)), /이름/);
  await assert.rejects(service.join('BAD!', '이름'), /코드/);
  assert.throws(() => parseAction({ type: 'hint', edgeId: 'x', playerId: host.view.selfId }), /형식/);
  assert.throws(() => parseAction({ type: 'place', mines: ['x', 'x'] }), /배치/);
  assert.throws(() => parseAction({ type: 'place', mines: [12] }), /배치/);
  elapse(24 * 60 * 60 * 1000);
  await assert.rejects(service.get(code, host.token), (error: unknown) => error instanceof RoomError && error.status === 404);
  assert.equal(storage.records.has(code), false);
});

test('request guards reject cross-origin, malformed, and oversized bodies without leaking errors', async () => {
  const request = (body: string, origin = 'https://mindminer.test') => new Request('https://mindminer.test/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body,
  });
  await assert.rejects(readMutation(request('{"name":"A"}', 'https://attacker.test')), (error: unknown) => error instanceof RoomError && error.status === 403);
  await assert.rejects(readMutation(request('{')), /읽을 수/);
  await assert.rejects(readMutation(request('[]')), /형식/);
  await assert.rejects(readMutation(request('x'.repeat(4097))), (error: unknown) => error instanceof RoomError && error.status === 413);
  assert.deepEqual(await readMutation(request('{"name":"A"}')), { name: 'A' });
  assert.throws(() => bearerToken(new Request('https://mindminer.test/api/rooms/ABCDEF?token=secret')), /참가 정보/);
  const response = await apiResponse(async (): Promise<ApiReply> => { throw new Error('SECRET_BOARD_AND_TOKEN'); });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  const errorBody = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(errorBody), ['error']);
  assert.equal(JSON.stringify(errorBody).includes('SECRET'), false);
  const expectedError = await apiResponse(async (): Promise<ApiReply> => { throw new RoomError('참가 정보 없음', 401); });
  assert.equal(expectedError.status, 401);
  assert.equal(expectedError.headers.get('cache-control'), 'no-store, private');
});

test('spectator identities resume across phases, see no secrets, and cannot forge game or host actions', async () => {
  const { service, code, seats, act } = await setup({ ...DEFAULT_ROOM_SETTINGS, playerCount: 2 });
  const spectator = await service.join(code, '관전자');
  assert.equal(spectator.view.spectators[0].id, spectator.view.selfId);
  await act(0, { type: 'start' });
  await act(0, { type: 'place', mines: [EDGES[0].id] });
  let view = (await service.get(code, spectator.token)).view;
  assert.equal('ownMines' in view, false);
  assert.ok(view.players.every((player) => !('coins' in player)));
  for (const action of [
    { type: 'place', mines: [] }, { type: 'spawn', nodeId: '4-0' },
    { type: 'move', nodeId: '3-0' }, { type: 'hint', edgeId: EDGES[0].id },
    { type: 'seat', playerId: seats[0].view.selfId, seated: false },
    { type: 'settings', settings: DEFAULT_ROOM_SETTINGS },
  ]) {
    await assert.rejects(service.act(code, spectator.token, action, view.revision), (error: unknown) => !!error && typeof error === 'object' && 'status' in error && error.status === 403);
  }
  await act(1, { type: 'place', mines: [] });
  const late = await service.join(code, '시작 후 입장');
  view = (await service.get(code, late.token)).view;
  assert.equal(view.phase, 'playing');
  assert.equal(view.players.length, 2);
  assert.equal(view.spectators.length, 2);
  assert.equal('ownMines' in view, false);
  assert.ok(view.players.every((player) => !('coins' in player)));
});

test('roster changes preserve tokens and CAS prevents a stale promotion from stealing an occupied seat', async () => {
  const storage = new ConflictingStorage();
  const service = new RoomService(storage);
  const host = await service.create('방장');
  const guest = await service.join(host.view.code, '참가자');
  let view = (await service.get(host.view.code, host.token)).view;
  await service.act(host.view.code, host.token, { type: 'settings', settings: { ...DEFAULT_ROOM_SETTINGS, playerCount: 2 } }, view.revision);
  const waiting = await service.join(host.view.code, '대기자');
  view = (await service.get(host.view.code, host.token)).view;
  await service.act(host.view.code, host.token, { type: 'seat', playerId: guest.view.selfId, seated: false }, view.revision);
  const demoted = (await service.get(host.view.code, guest.token)).view;
  assert.ok(demoted.spectators.some((player) => player.id === guest.view.selfId));
  assert.equal('ownMines' in demoted, false);
  const before = (await service.get(host.view.code, host.token)).view;
  storage.beforeSwap = async () => { await service.join(host.view.code, '동시 입장'); };
  await assert.rejects(service.act(host.view.code, host.token, { type: 'seat', playerId: waiting.view.selfId, seated: true }, before.revision), (error: unknown) => error instanceof RoomError && error.status === 409);
  const after = (await service.get(host.view.code, waiting.token)).view;
  assert.equal(after.players.length, 2);
  assert.equal(after.players[1].name, '동시 입장');
  assert.deepEqual(after.spectators.map((player) => player.id), [waiting.view.selfId, guest.view.selfId]);
});

test('seat requests reject malformed and forged fields; large-grid placements survive API validation', () => {
  for (const action of [
    { type: 'seat' }, { type: 'seat', playerId: '', seated: true },
    { type: 'seat', playerId: 'person', seated: 1 },
    { type: 'seat', playerId: 'person', seated: true, host: true },
    { type: 'seat', playerId: 'person', seated: false, seat: 0 },
  ]) assert.throws(() => parseAction(action), RoomError);
  assert.deepEqual(parseAction({ type: 'seat', playerId: 'person', seated: true }), { type: 'seat', playerId: 'person', seated: true });
  const mines = Array.from({ length: 40 }, (_, index) => `edge-${index}`);
  assert.deepEqual(parseAction({ type: 'place', mines }), { type: 'place', mines });
  assert.throws(() => parseAction({ type: 'place', mines: Array.from({ length: 58 }, (_, index) => `edge-${index}`) }), /배치/);
});

test('spectator arrivals during placement preserve independent commits but never rebase previous rounds', async () => {
  const { service, code, seats, act, elapse } = await setup({ ...DEFAULT_ROOM_SETTINGS, playerCount: 2 });
  const first = await act(0, { type: 'start' });
  const spectator = await service.join(code, '첫 관전자');
  await service.act(code, seats[0].token, { type: 'place', mines: [] }, first.view.revision);
  await service.join(code, '둘째 관전자');
  const played = await service.act(code, seats[1].token, { type: 'place', mines: [] }, first.view.revision);
  assert.equal(played.view.phase, 'playing');
  assert.equal(played.view.spectators.length, 2);
  const active = played.view.activeSeat;
  await act(active, { type: 'chooseBoard', ownerSeat: (active + 1) % 2 });
  await act(active, { type: 'spawn', nodeId: '4-0' });
  for (const nodeId of ['3-0', '2-0', '1-0', '0-0']) {
    await act(active, { type: 'move', nodeId });
    elapse(1_000);
  }
  const next = await act(0, { type: 'nextRound' });
  await service.join(code, '새 라운드 관전자');
  await assert.rejects(service.act(code, seats[1].token, { type: 'place', mines: [] }, first.view.revision), (error: unknown) => error instanceof RoomError && error.status === 409);
  const committed = await service.act(code, seats[1].token, next.view.rebuildSeats?.includes(1) ? { type: 'place', mines: [] } : { type: 'ready' }, next.view.revision);
  assert.equal(committed.view.players[1].ready, true);
  assert.equal('placementRevision' in (await service.get(code, spectator.token)).view, false);
});

test('the service enforces each grid mine cap before persisting a placement', async () => {
  for (const gridSize of [3, 4, 5, 6]) {
    const { service, code, seats, storage, act } = await setup({ ...DEFAULT_ROOM_SETTINGS, playerCount: 2, gridSize });
    await act(0, { type: 'start' });
    const safe = new Set(Array.from({ length: gridSize }, (_, row) => edgeId(`${row}-0`, `${row + 1}-0`)));
    const mines = getBoard(gridSize).edges.filter((edge) => !edge.base && !safe.has(edge.id)).slice(0, maxMines(gridSize) + 1).map((edge) => edge.id);
    assert.ok(hasSafePath(mines, gridSize));
    const before = storage.records.get(code)!.payload;
    await assert.rejects(act(0, { type: 'place', mines }), /최대.*개/);
    assert.equal(storage.records.get(code)!.payload, before);
    const accepted = await act(0, { type: 'place', mines: mines.slice(0, -1) });
    assert.equal(accepted.view.ownMines?.length, maxMines(gridSize));
    const other = await service.get(code, seats[1].token);
    assert.deepEqual(other.view.ownMines, []);
    assert.equal('revealedBoards' in other.view, false);
    assert.equal('activeBoardMineCount' in other.view, false);
  }
});

test('authenticated API serialization shares the current board count with all participants and reveals answer boards only between rounds', async () => {
  const { service, code, seats, act, elapse } = await setup({ ...DEFAULT_ROOM_SETTINGS, playerCount: 2, totalRounds: 2 });
  const spectator = await service.join(code, '관전자');
  const outsider = await service.create('외부인');
  const mines = [edgeId('4-0', '3-0'), edgeId('4-1', '3-1')];
  const expectedBoards = { [seats[0].view.selfId]: [mines[0]], [seats[1].view.selfId]: mines };
  const readApi = async (token: string) => {
    const response = await apiResponse(() => service.get(code, token));
    assert.equal(response.headers.get('cache-control'), 'no-store, private');
    return { status: response.status, body: await response.json() as ApiReply };
  };
  await act(0, { type: 'start' });
  for (let round = 1; round <= 2; round++) {
    for (const participant of [...seats, spectator]) {
      const { body } = await readApi(participant.token);
      assert.equal('revealedBoards' in body.view, false);
      assert.equal('activeBoardMineCount' in body.view, false);
    }
    await act(0, { type: 'place', mines: [mines[0]] });
    const playing = await act(1, { type: 'place', mines });
    const active = playing.view.activeSeat;
    await act(active, { type: 'chooseBoard', ownerSeat: (active + 1) % 2 });
    for (const participant of [...seats, spectator]) {
      const { status, body } = await readApi(participant.token);
      assert.equal(status, 200);
      assert.equal('boards' in body.view, false);
      assert.equal('revealedBoards' in body.view, false);
      assert.equal('ownMines' in body.view, false);
      assert.equal('privateResult' in body, false);
      assert.equal(body.view.activeBoardMineCount, active === 0 ? 2 : 1);
    }
    await act(active, { type: 'spawn', nodeId: '4-4' });
    for (const nodeId of ['3-3', '2-2', '1-1', '0-0']) {
      await act(active, { type: 'move', nodeId });
      elapse(1_000);
    }
    for (const participant of [...seats, spectator]) {
      const { body } = await readApi(participant.token);
      assert.equal(body.view.phase, round === 1 ? 'roundEnd' : 'finished');
      const completedOwner = seats[(active + 1) % 2].view.selfId;
      assert.deepEqual(body.view.revealedBoards, round === 1 ? { [completedOwner]: expectedBoards[completedOwner] } : expectedBoards);
      assert.equal('activeBoardMineCount' in body.view, false);
      assert.equal('identities' in body.view, false);
      assert.equal('token' in body, false);
      assert.ok(body.view.players.filter((player) => player.id !== body.view.selfId).every((player) => !('coins' in player)));
    }
    assert.equal((await readApi(outsider.token)).status, 401);
    if (round === 1) await act(0, { type: 'nextRound' });
  }
  const newcomer = await service.join(code, '결과 관전자');
  assert.deepEqual(newcomer.view.revealedBoards, expectedBoards);
  await act(0, { type: 'restart' });
  for (const participant of [...seats, spectator, newcomer]) {
    const { body } = await readApi(participant.token);
    assert.equal(body.view.phase, 'waiting');
    assert.equal('revealedBoards' in body.view, false);
    assert.equal('activeBoardMineCount' in body.view, false);
  }
});
