import type { GameAction, GameState, ActionResult } from './contracts.ts';
import { NODES, EDGES, STARTS, createRoom, addPlayer, applyAction, advanceTime, randomBoard } from './game.ts';

export const DEMO_SELF_ID = 'demo-you';
const names = ['나', '루나', '테오', '이든', '노아', '미로'];

function prepareBots(state: GameState, now: number): GameState {
  if (state.phase !== 'placing') return state;
  let next = state;
  for (const player of state.players) {
    if (player.id !== DEMO_SELF_ID && !player.ready) {
      next = applyAction(next, player.id, { type: 'place', mines: randomBoard() }, now).state;
    }
  }
  return next;
}

export function createDemo(): GameState {
  const now = Date.now();
  let state = createRoom('DEMO', { id: DEMO_SELF_ID, name: names[0] }, now);
  for (let i = 1; i < names.length; i++) state = addPlayer(state, { id: `demo-${i}`, name: names[i] });
  state = applyAction(state, DEMO_SELF_ID, { type: 'start' }, now).state;
  state = { ...state, demo: true, starterSeat: 0, activeSeat: 0 };
  return prepareBots(state, now);
}

export function demoAction(state: GameState, action: GameAction, now = Date.now()): ActionResult {
  const result = applyAction(advanceTime(state, now), DEMO_SELF_ID, action, now);
  return { ...result, state: prepareBots(result.state, now) };
}

export function tickDemo(state: GameState, now = Date.now()): GameState {
  const next = advanceTime(state, now);
  if (next.phase !== 'playing' || next.event || next.players[next.activeSeat].id === DEMO_SELF_ID) return next;
  const actor = next.players[next.activeSeat];
  if (!next.position) {
    return applyAction(next, actor.id, { type: 'spawn', nodeId: STARTS[Math.floor(Math.random() * STARTS.length)] }, now).state;
  }
  // Demo opponents know only the public geometry; they never inspect a mine layout.
  const current = NODES.find(n => n.id === next.position)!;
  const neighbors = EDGES.filter(e => e.a === current.id || e.b === current.id)
    .map(e => NODES.find(n => n.id === (e.a === current.id ? e.b : e.a))!);
  const weighted = neighbors.flatMap(n => Array(n.row < current.row ? 7 : n.row === current.row ? 2 : 1).fill(n.id));
  const nodeId = weighted[Math.floor(Math.random() * weighted.length)];
  return applyAction(next, actor.id, { type: 'move', nodeId }, now).state;
}
