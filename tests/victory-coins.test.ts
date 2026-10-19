import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameAction, GameState, RoleId } from '../lib/contracts.ts';
import { addPlayer, applyAction, createRoom, edgeId, INITIAL_VICTORY_COINS, viewFor } from '../lib/game.ts';
import { createDemo, demoAction } from '../lib/demo.ts';
import { RoomService, type RoomRecord, type RoomStorage } from '../lib/room-service.ts';

const id = (seat: number) => `coin-${seat}`;
const safe = edgeId('4-4', '3-3');

function waiting(): GameState {
  let state = createRoom('COINS', { id: id(0), name: '방장' });
  state = applyAction(state, id(0), { type: 'settings', settings: { playerCount: 3, hintCoins: 3, totalRounds: 2, gridSize: 4 } }, 0).state;
  for (let seat = 1; seat < 3; seat++) state = addPlayer(state, { id: id(seat), name: `참가자${seat}` });
  return state;
}

function place(state: GameState, role: RoleId = 'trapper', now = 0): GameState {
  for (const player of state.players) {
    state = applyAction(state, player.id, { type: 'chooseRole', role }, now).state;
    state = applyAction(state, player.id, state.placementMode === 'retained' && !state.rebuildSeats?.includes(player.seat)
      ? { type: 'ready' } : { type: 'place', mines: [] }, now).state;
  }
  return state;
}

function playing(role: RoleId = 'trapper'): GameState {
  const state = applyAction(waiting(), id(0), { type: 'start' }, 0).state;
  return place({ ...state, activeSeat: 0, starterSeat: 0 }, role);
}

function win(state: GameState, ownerSeat: number, now = 0): GameState {
  const actor = state.players[state.activeSeat].id;
  state = applyAction(state, actor, { type: 'chooseBoard', ownerSeat }, now).state;
  return finishSelected(state, now);
}

function finishSelected(state: GameState, now = 0): GameState {
  const actor = state.players[state.activeSeat].id;
  state = applyAction(state, actor, { type: 'spawn', nodeId: '4-4' }, now).state;
  for (const nodeId of ['3-3', '2-2', '1-1', '0-0']) state = applyAction(state, actor, { type: 'move', nodeId }, now += 1_000).state;
  return state;
}

const balances = (state: GameState) => state.players.map(player => player.score);
const total = (state: GameState) => state.players.reduce((sum, player) => sum + player.score, 0);

test('new lobby, promoted seats, game start and demo all begin with three public victory coins', () => {
  let state = waiting();
  assert.equal(INITIAL_VICTORY_COINS, 3);
  assert.equal(state.scoringMode, 'transfer');
  assert.deepEqual(balances(state), [3, 3, 3]);
  state = addPlayer(state, { id: 'guest', name: '대기' });
  state = applyAction(state, id(0), { type: 'seat', playerId: id(2), seated: false }, 0).state;
  state = applyAction(state, id(0), { type: 'seat', playerId: 'guest', seated: true }, 0).state;
  assert.equal(state.players[2].score, 3);
  state.players[0].score = 99;
  state = applyAction(state, id(0), { type: 'start' }, 0).state;
  assert.deepEqual(balances(state), [3, 3, 3], 'start establishes the game balance independently of lobby history');
  const spectator = viewFor(state, id(2), 0);
  assert.equal(spectator.scoringMode, 'transfer');
  assert.deepEqual(spectator.players.map(player => player.score), [3, 3, 3]);
  assert.ok(spectator.players.every(player => !('coins' in player)));
  assert.deepEqual(balances(createDemo('illuminator')), [3, 3, 3, 3, 3, 3]);
});

test('winner takes exactly one victory coin from the chosen board maker and preserves the total', () => {
  const initial = playing();
  const completed = win(initial, 2);
  assert.deepEqual(balances(initial), [3, 3, 3], 'the original state remains unchanged');
  assert.deepEqual(balances(completed), [4, 3, 2]);
  assert.equal(total(completed), 9);
  assert.equal(completed.phase, 'roundEnd');
  assert.deepEqual(completed.winner, { seat: 0, points: 1, ownerSeat: 2, coinsTransferred: 1 });
  assert.deepEqual(completed.players.map(player => player.coins), [3, 3, 3]);
  assert.equal(viewFor(completed, id(1), 4_000).winner?.ownerSeat, 2);
  assert.equal('remainingCoins' in viewFor(completed, id(1), 4_000).winner!, false);
});

test('a board maker with zero coins loses nothing and a successful attempt still ends the round', () => {
  let state = playing();
  state.players[2].score = 0;
  state.players[1].score = 6;
  const completed = win(state, 2);
  assert.equal(completed.phase, 'roundEnd');
  assert.deepEqual(balances(completed), [3, 6, 0]);
  assert.equal(total(completed), 9);
  assert.deepEqual(completed.winner, { seat: 0, points: 0, ownerSeat: 2, coinsTransferred: 0 });
  assert.ok(completed.players.every(player => player.score >= 0));
});

test('hint spending and illuminator bonus hints never increase or decrease victory-coin rewards', () => {
  for (const role of ['trapper', 'illuminator'] as const) {
    for (const useAllHints of [false, true]) {
      let state = playing(role);
      const startingHints = role === 'illuminator' ? 5 : 3;
      assert.equal(state.players[0].coins, startingHints);
      state = applyAction(state, id(0), { type: 'chooseBoard', ownerSeat: 1 }, 0).state;
      if (useAllHints) {
        for (let hint = 0; hint < startingHints; hint++) {
          state = applyAction(state, id(0), { type: 'hint', edgeId: safe }, 0).state;
          assert.deepEqual(balances(state), [3, 3, 3]);
        }
      }
      const completed = finishSelected(state);
      assert.deepEqual(balances(completed), [4, 2, 3]);
      assert.equal(completed.winner?.coinsTransferred, 1);
      assert.equal(completed.players[0].coins, useAllHints ? 0 : startingHints);
      assert.equal('remainingCoins' in completed.winner!, false);
    }
  }
});

test('later rounds retain victory balances, refill hints, and a restarted game resets everybody to three', () => {
  let state = win(playing('illuminator'), 2);
  state = applyAction(state, id(0), { type: 'nextRound' }, 5_000).state;
  assert.equal(state.round, 2);
  assert.equal(state.activeSeat, 1);
  assert.equal(state.scoringMode, 'transfer');
  assert.deepEqual(balances(state), [4, 3, 2]);
  assert.ok(state.players.every(player => player.coins === 3));
  state = place(state, 'illuminator', 5_000);
  assert.ok(state.players.every(player => player.coins === 5));
  state = win(state, 0, 5_000);
  assert.deepEqual(balances(state), [3, 4, 2]);
  assert.equal(total(state), 9);
  assert.equal(state.phase, 'finished');
  assert.deepEqual(state.champions, [1]);
  state = applyAction(state, id(0), { type: 'restart' }, 10_000).state;
  assert.equal(state.phase, 'waiting');
  assert.equal(state.scoringMode, 'transfer');
  assert.deepEqual(balances(state), [3, 3, 3]);
  assert.deepEqual(state.champions, []);
  assert.equal(state.winner, null);
  const demo = createDemo();
  const restartedDemo = demoAction({ ...demo, phase: 'finished', players: demo.players.map(player => ({ ...player, score: player.seat + 1 })) }, { type: 'restart' }, 10_000).state;
  assert.deepEqual(balances(restartedDemo), [3, 3, 3, 3, 3, 3]);
});

test('final champions are the richest players, including joint ties and a champion other than the last winner', () => {
  let tie = playing();
  tie.round = tie.totalRounds;
  tie.players[0].score = 2;
  tie.players[1].score = 3;
  tie.players[2].score = 4;
  tie = win(tie, 2);
  assert.deepEqual(balances(tie), [3, 3, 3]);
  assert.deepEqual(tie.champions, [0, 1, 2]);
  let rich = playing();
  rich.round = rich.totalRounds;
  rich.players[0].score = 0;
  rich.players[1].score = 6;
  rich = win(rich, 2);
  assert.deepEqual(balances(rich), [1, 6, 2]);
  assert.equal(rich.winner?.seat, 0);
  assert.deepEqual(rich.champions, [1]);
});

test('saved cumulative games keep their scoring for every remaining round and adopt transfer only on restart', () => {
  let state = playing('illuminator');
  state = { ...state, scoringMode: undefined, placementMode: undefined, players: state.players.map(player => ({ ...player, score: 0 })) };
  state = win(state, 2);
  assert.deepEqual(balances(state), [6, 0, 0]);
  assert.deepEqual(state.winner, { seat: 0, points: 6, remainingCoins: 5 });
  assert.equal('scoringMode' in viewFor(state, id(1), 4_000), false);
  state = applyAction(state, id(0), { type: 'nextRound' }, 5_000).state;
  assert.equal(state.scoringMode, undefined);
  assert.deepEqual(balances(state), [6, 0, 0]);
  state = win(place(state, 'illuminator', 5_000), 2, 5_000);
  assert.deepEqual(balances(state), [6, 6, 0]);
  assert.deepEqual(state.champions, [0, 1]);
  state = applyAction(state, id(0), { type: 'restart' }, 10_000).state;
  assert.equal(state.scoringMode, 'transfer');
  assert.deepEqual(balances(state), [3, 3, 3]);
  const oldLobby = { ...waiting(), scoringMode: undefined, players: waiting().players.map(player => ({ ...player, score: 0 })) };
  const started = applyAction(oldLobby, id(0), { type: 'start' }, 0).state;
  assert.equal(started.scoringMode, 'transfer');
  assert.deepEqual(balances(started), [3, 3, 3]);
});

class MemoryStorage implements RoomStorage {
  records = new Map<string, RoomRecord>();
  async get(code: string) { const row = this.records.get(code); return row ? { ...row } : null; }
  async create(row: RoomRecord) { if (this.records.has(row.code)) return false; this.records.set(row.code, { ...row }); return true; }
  async compareAndSwap(row: RoomRecord, previousVersion: number) { if (this.records.get(row.code)?.version !== previousVersion) return false; this.records.set(row.code, { ...row }); return true; }
  async deleteExpired() {}
}

test('authenticated concurrent winning moves transfer one coin only and spectators see balances without private hints', async () => {
  const storage = new MemoryStorage();
  let now = 1_000;
  const service = new RoomService(storage, () => now);
  const host = await service.create('방장');
  const code = host.view.code;
  await service.act(code, host.token, { type: 'settings', settings: { playerCount: 3, hintCoins: 3, totalRounds: 1, gridSize: 4 } }, host.view.revision);
  const sessions = [host, await service.join(code, '둘째'), await service.join(code, '셋째')];
  const spectator = await service.join(code, '관전자');
  const get = async (seat: number) => (await service.get(code, sessions[seat].token)).view;
  const act = async (seat: number, action: GameAction) => service.act(code, sessions[seat].token, action, (await get(seat)).revision);
  await act(0, { type: 'start' });
  for (let seat = 0; seat < 3; seat++) {
    await act(seat, { type: 'chooseRole', role: 'illuminator' });
    await act(seat, { type: 'place', mines: [] });
  }
  const activeSeat = (await get(0)).activeSeat;
  const ownerSeat = (activeSeat + 2) % 3;
  await act(activeSeat, { type: 'chooseBoard', ownerSeat });
  await act(activeSeat, { type: 'hint', edgeId: safe });
  await act(activeSeat, { type: 'spawn', nodeId: '4-4' });
  for (const nodeId of ['3-3', '2-2', '1-1']) { await act(activeSeat, { type: 'move', nodeId }); now += 1_000; }
  const before = await get(activeSeat);
  const outcomes = await Promise.allSettled([0, 1].map(() => service.act(code, sessions[activeSeat].token, { type: 'move', nodeId: '0-0' }, before.revision)));
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  const restored = new RoomService(storage, () => now);
  const expected = [3, 3, 3];
  expected[activeSeat]++;
  expected[ownerSeat]--;
  for (const session of [...sessions, spectator]) {
    const view = (await restored.get(code, session.token)).view;
    assert.equal(view.phase, 'finished');
    assert.equal(view.scoringMode, 'transfer');
    assert.deepEqual(view.players.map(player => player.score), expected);
    assert.deepEqual(view.winner, { seat: activeSeat, ownerSeat, points: 1, coinsTransferred: 1 });
    assert.deepEqual(view.champions, [activeSeat]);
    assert.ok(view.players.filter(player => player.id !== view.selfId).every(player => !('coins' in player)));
    assert.equal('remainingCoins' in view.winner!, false);
  }
  assert.equal((await get(activeSeat)).players[activeSeat].coins, 4, 'remaining hints stay separate and private');
  await assert.rejects(act(activeSeat, { type: 'move', nodeId: '0-0' }));
  assert.deepEqual((await get(activeSeat)).players.map(player => player.score), expected);
});
