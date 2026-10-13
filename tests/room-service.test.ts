import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiReply, GameAction, GameState } from '../lib/contracts';
import { EDGES } from '../lib/game.ts';
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

async function setup() {
  const storage = new MemoryStorage();
  let now = 1_000_000;
  const service = new RoomService(storage, () => now);
  const host = await service.create('방장');
  const code = host.view.code;
  const seats = [host];
  for (let index = 1; index < 6; index++) seats.push(await service.join(code, `참가자${index}`));
  const act = async (seat: number, action: GameAction) => {
    const current = await service.get(code, seats[seat].token);
    return service.act(code, seats[seat].token, action, current.view.revision);
  };
  return { storage, service, host, code, seats, act, elapse: (milliseconds: number) => { now += milliseconds; } };
}

async function playing() {
  const fixture = await setup();
  await fixture.act(0, { type: 'start' });
  const mine = EDGES.find((edge) => edge.a === '3-0' && edge.b === '4-0')!;
  for (let seat = 0; seat < 6; seat++) await fixture.act(seat, { type: 'place', mines: [mine.id] });
  const current = await fixture.service.get(fixture.code, fixture.host.token);
  return { ...fixture, mine, activeSeat: current.view.activeSeat };
}

test('joining concurrently caps rooms at six unique seats without lost identities', async () => {
  const storage = new MemoryStorage();
  const service = new RoomService(storage);
  const host = await service.create('방장');
  const outcomes = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => service.join(host.view.code, `친구${index}`)));
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 5);
  const room = await service.get(host.view.code, host.token);
  assert.equal(room.view.players.length, 6);
  assert.deepEqual(room.view.players.map((player) => player.seat), [0, 1, 2, 3, 4, 5]);
  for (const result of outcomes) {
    if (result.status === 'fulfilled') {
      const own = await service.get(host.view.code, result.value.token);
      assert.equal(own.view.selfId, result.value.view.selfId);
    }
  }
  const record = storage.records.get(host.view.code)!;
  assert.equal(record.payload.includes(host.token), false);
  assert.equal(Object.keys(JSON.parse(record.payload).identities).length, 6);
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
  assert.deepEqual(state.boards, {});
  assert.equal(state.players.filter((player) => player.ready).length, 0);
  const accepted = await service.act(code, seats[1].token, { type: 'place', mines: [] }, nextRound.view.revision);
  assert.equal(accepted.view.players[1].ready, true);
});

test('expired explosion advances exactly once with simultaneous refreshes and leaves no trail', async () => {
  const { service, code, seats, activeSeat, act, elapse, storage } = await playing();
  await act(activeSeat, { type: 'spawn', nodeId: '4-0' });
  const exploded = await act(activeSeat, { type: 'move', nodeId: '3-0' });
  assert.equal(exploded.view.event?.type, 'explosion');
  elapse(2_000);
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
  elapse(2_000);
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
