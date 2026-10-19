import type { GameAction, GameState, ActionResult, RoleId } from './contracts.ts';
import { getBoard, createRoom, addPlayer, applyAction, advanceTime, randomBoard, boardOwnerSeat, canRebuildBoard, hasSafePath, viewFor } from './game.ts';
import { baseMemoSlots, memoCapacity, randomRole } from './roles.ts';

export const DEMO_SELF_ID = 'demo-you';
const names = ['나', '루나', '테오', '이든', '노아', '미로'];

function prepareBots(state: GameState, now: number): GameState {
  if (state.phase !== 'placing') return state;
  let next = state;
  for (const player of state.players) {
    if (player.id !== DEMO_SELF_ID && !player.ready) {
      if (!player.role) next = applyAction(next, player.id, { type: 'chooseRole', role: randomRole(state.playerCount) }, now).state;
      if (!canRebuildBoard(next, player.seat)) {
        next = applyAction(next, player.id, { type: 'ready' }, now).state;
        continue;
      }
      const bot = next.players.find(participant => participant.id === player.id)!;
      const concealed = bot.role === 'trapper' ? getBoard(state.gridSize).edges.filter(edge => !edge.base).sort(() => Math.random() - .5).slice(0, 4).map(edge => edge.id) : undefined;
      next = applyAction(next, player.id, { type: 'place', mines: randomBoard(Math.random, state.gridSize), ...(concealed ? {concealed} : {}) }, now).state;
    }
  }
  return next;
}

export function createDemo(role?: RoleId): GameState {
  const now = Date.now();
  let state = createRoom('DEMO', { id: DEMO_SELF_ID, name: names[0] }, now);
  for (let i = 1; i < names.length; i++) state = addPlayer(state, { id: `demo-${i}`, name: names[i] });
  state = applyAction(state, DEMO_SELF_ID, { type: 'start' }, now).state;
  state = { ...state, demo: true, starterSeat: 0, activeSeat: 0 };
  state = applyAction(state, DEMO_SELF_ID, { type: 'chooseRole', role: role ?? 'illuminator' }, now).state;
  return prepareBots(state, now);
}

export function demoAction(state: GameState, action: GameAction, now = Date.now()): ActionResult {
  const result = applyAction(advanceTime(state, now), DEMO_SELF_ID, action, now);
  return { ...result, state: prepareBots(result.state, now) };
}

export function tickDemo(state: GameState, now = Date.now()): GameState {
  const next = advanceTime(state, now);
  if (next.phase !== 'playing' || next.event) return next;
  const shiftingSeat = next.shiftQueue?.[0];
  if (shiftingSeat !== undefined) {
    const shifting = next.players[shiftingSeat];
    if (shifting.id === DEMO_SELF_ID) return next;
    const mines = next.boards[shifting.id];
    const fromEdgeId = mines[Math.floor(Math.random() * mines.length)];
    const destination = getBoard(next.gridSize).edges.find(edge => !edge.base && !mines.includes(edge.id) && hasSafePath(mines.map(mine => mine === fromEdgeId ? edge.id : mine), next.gridSize));
    return applyAction(next, shifting.id, fromEdgeId && destination ? { type: 'shiftMine', fromEdgeId, toEdgeId: destination.id } : { type: 'shiftMine' }, now).state;
  }
  if (next.blessingSeat !== undefined && next.blessingSeat !== null) {
    const guarded = next.players[next.blessingSeat];
    return guarded.id === DEMO_SELF_ID ? next : applyAction(next, guarded.id, { type: 'blessing', use: true }, now).state;
  }
  if (next.players[next.activeSeat].id === DEMO_SELF_ID) return next;
  const actor = next.players[next.activeSeat];
  if (next.boardMode === 'choice' && boardOwnerSeat(next) < 0) {
    // Pick by public seat identity alone; bots never inspect candidate layouts.
    const owners = next.players.filter(player => player.seat !== actor.seat);
    const owner = owners[Math.floor(Math.random() * owners.length)];
    return applyAction(next, actor.id, { type: 'chooseBoard', ownerSeat: owner.seat }, now).state;
  }
  const { nodes: NODES, edges: EDGES, starts: STARTS } = getBoard(next.gridSize);
  if (!next.position) {
    const owner = next.players[boardOwnerSeat(next)];
    const capacity = memoCapacity(next.playerCount, actor.role);
    if (capacity && !(next.memos?.[actor.id] ?? []).some(memo => memo?.boardOwnerId === owner.id)) {
      // A bot's guess uses public geometry, never the hidden layout.
      const choices = EDGES.filter(edge => !edge.base);
      const choice = choices[Math.floor(Math.random() * choices.length)];
      return applyAction(next, actor.id, { type: 'memo', slot: (next.turnNumber ?? next.rotation) % capacity, entry: { boardOwnerId: owner.id, edgeId: choice.id, status: 'unsure' } }, now).state;
    }
    if (actor.role === 'thief' && (actor.peeks ?? 0) > 0) {
      const targets = viewFor(next, actor.id, now).peekableMemos?.slice(0, baseMemoSlots(next.playerCount));
      if (targets?.length) return applyAction(next, actor.id, { type: 'peek', targets }, now).state;
    }
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
