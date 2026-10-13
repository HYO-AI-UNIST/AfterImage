import type {
  ActionResult,
  BoardEdge,
  BoardNode,
  GameAction,
  GameEvent,
  GameState,
  Player,
  RoomView,
} from './contracts';

const PLAYER_COUNT = 6;
const MOVE_MS = 650;
const EXPLOSION_MS = 1_800;
const ROTATION_MS = 1_400;

/** A deliberately user-facing validation error; unexpected errors stay private. */
export class GameError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GameError';
    this.status = status;
  }
}

export const NODES: BoardNode[] = Array.from({ length: 5 }, (_, row) =>
  Array.from({ length: row + 1 }, (_, col) => ({
    id: `${row}-${col}`,
    row,
    col,
    x: 300 - row * 57.5 + col * 115,
    y: 72 + row * 99.5,
    start: row === 4,
    goal: row === 0,
  })),
).flat();

const edgeId = (a: string, b: string) => [a, b].sort().join('~');

export const EDGES: BoardEdge[] = NODES.flatMap((node) => {
  const destinations: string[] = [];
  if (node.col < node.row) destinations.push(`${node.row}-${node.col + 1}`);
  if (node.row < 4) destinations.push(`${node.row + 1}-${node.col}`, `${node.row + 1}-${node.col + 1}`);
  return destinations.map((b) => ({
    id: edgeId(node.id, b),
    a: node.id,
    b,
    base: node.row === 4,
  }));
});

export const STARTS = NODES.filter((node) => node.start).map((node) => node.id);
export const GOAL = '0-0';
const EDGE_LOOKUP = new Map(EDGES.map((edge) => [edge.id, edge]));

/** Validate both legal placement and reachability, including safe base travel. */
export function hasSafePath(mines: string[]): boolean {
  if (!Array.isArray(mines) || mines.some((id) => typeof id !== 'string' || !EDGE_LOOKUP.has(id) || EDGE_LOOKUP.get(id)!.base)) {
    return false;
  }
  const blocked = new Set(mines);
  const visited = new Set(STARTS);
  const queue = [...STARTS];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === GOAL) return true;
    for (const edge of EDGES) {
      if (blocked.has(edge.id)) continue;
      const next = edge.a === current ? edge.b : edge.b === current ? edge.a : null;
      if (next && !visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** Keep one randomly chosen descending path open before scattering mines. */
export function randomBoard(random: () => number = Math.random): string[] {
  const safe = new Set<string>();
  let col = 0;
  for (let row = 0; row < 4; row += 1) {
    const nextCol = col + (random() < 0.5 ? 0 : 1);
    safe.add(edgeId(`${row}-${col}`, `${row + 1}-${nextCol}`));
    col = nextCol;
  }
  return EDGES.filter((edge) => !edge.base && !safe.has(edge.id) && random() < 0.48).map((edge) => edge.id);
}

function validatedPlayer(player: { id: string; name: string }, seat: number): Player {
  if (!player || typeof player.id !== 'string' || !player.id.trim() || player.id.length > 200) {
    throw new GameError('플레이어 정보가 올바르지 않습니다.');
  }
  if (typeof player.name !== 'string' || !player.name.trim() || player.name.trim().length > 20) {
    throw new GameError('이름을 1~20자로 입력해주세요.');
  }
  return { id: player.id, name: player.name.trim(), seat, score: 0, coins: 3, ready: false };
}

export function createRoom(code: string, host: { id: string; name: string }, now?: number): GameState {
  void now;
  if (typeof code !== 'string' || !code.trim() || code.length > 20) throw new GameError('방 코드가 올바르지 않습니다.');
  return {
    code,
    phase: 'waiting',
    round: 1,
    totalRounds: PLAYER_COUNT + 1,
    rotation: 0,
    players: [validatedPlayer(host, 0)],
    hostId: host.id,
    boards: {},
    starterSeat: 0,
    activeSeat: 0,
    attempts: 0,
    position: null,
    event: null,
    winner: null,
    champions: [],
    revision: 0,
  };
}

export function addPlayer(state: GameState, player: { id: string; name: string }): GameState {
  if (state.phase !== 'waiting') throw new GameError('이미 시작한 게임에는 참가할 수 없습니다.', 409);
  if (state.players.length >= PLAYER_COUNT) throw new GameError('방이 가득 찼습니다.', 409);
  const participant = validatedPlayer(player, state.players.length);
  if (state.players.some((existing) => existing.id === participant.id)) throw new GameError('이미 참가한 플레이어입니다.', 409);
  return { ...state, players: [...state.players, participant], revision: state.revision + 1 };
}

/** Seat numbers advance clockwise; the left neighbor is seat + 1. */
export function boardOwnerSeat(state: GameState, seat = state.activeSeat): number {
  return ((seat - state.rotation) % PLAYER_COUNT + PLAYER_COUNT) % PLAYER_COUNT;
}

function nextState(state: GameState, changes: Partial<GameState>): GameState {
  return { ...state, ...changes, revision: state.revision + 1 };
}

function eventFor(state: GameState, type: GameEvent['type'], until: number, detail: Partial<GameEvent> = {}): GameEvent {
  return {
    id: `${state.code}-${state.revision + 1}-${type}`,
    type,
    actorSeat: state.activeSeat,
    ownerSeat: boardOwnerSeat(state),
    until,
    ...detail,
  };
}

/** Expiring effects are the only retained movement information. */
export function advanceTime(state: GameState, now: number): GameState {
  if (!state.event || now < state.event.until) return state;
  if (state.event.type !== 'explosion') return nextState(state, { event: null });

  const attempts = state.attempts + 1;
  const activeSeat = (state.activeSeat + 1) % PLAYER_COUNT;
  if (attempts < PLAYER_COUNT) return nextState(state, { event: null, activeSeat, attempts, position: null });

  // Offset six would return everyone's own board. Skip it together and go to one.
  const rotation = state.rotation === PLAYER_COUNT - 1 ? 1 : state.rotation + 1;
  const rotated = { ...state, rotation, activeSeat: state.starterSeat };
  return nextState(state, {
    event: eventFor(rotated, 'rotation', now + ROTATION_MS),
    activeSeat: state.starterSeat,
    attempts: 0,
    position: null,
    rotation,
  });
}

function beginPlacement(state: GameState, starterSeat: number, restart = false): GameState {
  return nextState(state, {
    phase: 'placing',
    round: restart ? 1 : state.round,
    rotation: 0,
    players: state.players.map((player) => ({ ...player, score: restart ? 0 : player.score, coins: 3, ready: false })),
    boards: {},
    starterSeat,
    activeSeat: starterSeat,
    attempts: 0,
    position: null,
    event: null,
    winner: null,
    champions: [],
  });
}

function requireHost(state: GameState, playerId: string) {
  if (state.hostId !== playerId) throw new GameError('방장만 진행할 수 있습니다.', 403);
}

function requirePhase(state: GameState, phase: GameState['phase']) {
  if (state.phase !== phase) throw new GameError('지금은 이 행동을 할 수 없습니다.', 409);
}

export function applyAction(original: GameState, playerId: string, action: GameAction, now = Date.now()): ActionResult {
  if (!original.players.some((player) => player.id === playerId)) throw new GameError('이 방의 참가자가 아닙니다.', 403);
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') throw new GameError('행동 정보가 올바르지 않습니다.');
  const state = advanceTime(original, now);
  const player = state.players.find((participant) => participant.id === playerId)!;

  switch (action.type) {
    case 'start': {
      requireHost(state, playerId);
      requirePhase(state, 'waiting');
      if (state.players.length !== PLAYER_COUNT) throw new GameError('6명이 모두 모이면 시작할 수 있습니다.', 409);
      return { state: beginPlacement(state, Math.floor(Math.random() * PLAYER_COUNT)) };
    }
    case 'place': {
      requirePhase(state, 'placing');
      if (player.ready) throw new GameError('이미 배치를 완료했습니다.', 409);
      if (!Array.isArray(action.mines) || action.mines.length > EDGES.length || action.mines.some((id) => typeof id !== 'string')) {
        throw new GameError('지뢰 배치 정보가 올바르지 않습니다.');
      }
      for (const id of action.mines) {
        const edge = EDGE_LOOKUP.get(id);
        if (!edge) throw new GameError('판에 없는 길에는 지뢰를 놓을 수 없습니다.');
        if (edge.base) throw new GameError('출발점 사이에는 지뢰를 놓을 수 없습니다.');
      }
      const mines = [...new Set(action.mines)];
      if (!hasSafePath(mines)) throw new GameError('정상까지 이어지는 안전한 길을 하나 이상 남겨주세요.');
      const players = state.players.map((participant) => participant.id === playerId ? { ...participant, ready: true } : participant);
      const everyoneReady = players.every((participant) => participant.ready);
      return {
        state: nextState(state, {
          players,
          boards: { ...state.boards, [playerId]: mines },
          phase: everyoneReady ? 'playing' : 'placing',
          rotation: everyoneReady ? 1 : 0,
        }),
      };
    }
    case 'spawn':
    case 'move':
    case 'hint': {
      requirePhase(state, 'playing');
      if (state.activeSeat !== player.seat) throw new GameError('지금은 다른 플레이어의 차례입니다.', 409);
      if (state.event) throw new GameError('진행 중인 동작이 끝날 때까지 기다려주세요.', 409);
      const owner = state.players[boardOwnerSeat(state)];
      if (!owner || owner.id === playerId) throw new GameError('현재 판을 사용할 수 없습니다.', 409);
      const mines = state.boards[owner.id];
      if (!Array.isArray(mines)) throw new GameError('배치가 완료되지 않은 판입니다.', 409);

      if (action.type === 'hint') {
        const edge = EDGE_LOOKUP.get(action.edgeId);
        if (!edge || edge.base) throw new GameError('힌트는 지뢰를 놓을 수 있는 길에만 사용할 수 있습니다.');
        if (player.coins <= 0) throw new GameError('이번 라운드의 힌트 코인을 모두 사용했습니다.', 409);
        return {
          state: nextState(state, {
            players: state.players.map((participant) => participant.id === playerId ? { ...participant, coins: participant.coins - 1 } : participant),
          }),
          privateResult: { edgeId: edge.id, mined: mines.includes(edge.id) },
        };
      }

      if (action.type === 'spawn') {
        if (state.position !== null) throw new GameError('이미 출발했습니다. 연결된 점으로 이동해주세요.', 409);
        if (!STARTS.includes(action.nodeId)) throw new GameError('밑변의 출발점에서 시작해주세요.');
        return { state: nextState(state, { position: action.nodeId }) };
      }

      if (state.position === null) throw new GameError('먼저 출발점을 선택해주세요.', 409);
      if (typeof action.nodeId !== 'string') throw new GameError('이동할 점이 올바르지 않습니다.');
      const edge = EDGE_LOOKUP.get(edgeId(state.position, action.nodeId));
      if (!edge) throw new GameError('현재 위치와 연결된 점으로만 이동할 수 있습니다.');
      if (mines.includes(edge.id)) {
        return {
          state: nextState(state, {
            position: null,
            event: eventFor(state, 'explosion', now + EXPLOSION_MS, { from: state.position, to: action.nodeId, edgeId: edge.id }),
          }),
        };
      }

      if (action.nodeId === GOAL) {
        const points = 1 + player.coins;
        const players = state.players.map((participant) => participant.id === playerId ? { ...participant, score: participant.score + points } : participant);
        const finished = state.round >= state.totalRounds;
        const bestScore = Math.max(...players.map((participant) => participant.score));
        return {
          state: nextState(state, {
            phase: finished ? 'finished' : 'roundEnd',
            position: GOAL,
            event: null,
            players,
            winner: { seat: player.seat, points, remainingCoins: player.coins },
            champions: finished ? players.filter((participant) => participant.score === bestScore).map((participant) => participant.seat) : [],
          }),
        };
      }

      return {
        state: nextState(state, {
          position: action.nodeId,
          event: eventFor(state, 'move', now + MOVE_MS, { from: state.position, to: action.nodeId, edgeId: edge.id }),
        }),
      };
    }
    case 'nextRound': {
      requireHost(state, playerId);
      requirePhase(state, 'roundEnd');
      if (!state.winner) throw new GameError('라운드 결과를 확인할 수 없습니다.', 409);
      return { state: beginPlacement({ ...state, round: state.round + 1 }, (state.winner.seat + 1) % PLAYER_COUNT) };
    }
    case 'restart': {
      requireHost(state, playerId);
      requirePhase(state, 'finished');
      return { state: beginPlacement(state, Math.floor(Math.random() * PLAYER_COUNT), true) };
    }
    default:
      throw new GameError('알 수 없는 행동입니다.');
  }
}

/** Explicit allowlist prevents unrevealed boards or hint answers crossing the API. */
export function viewFor(original: GameState, playerId: string, now = Date.now()): RoomView {
  if (!original.players.some((player) => player.id === playerId)) throw new GameError('이 방의 참가자가 아닙니다.', 403);
  const state = advanceTime(original, now);
  return {
    code: state.code,
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds,
    rotation: state.rotation,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      score: player.score,
      ready: player.ready,
      ...(player.id === playerId ? { coins: player.coins } : {}),
    })),
    selfId: playerId,
    hostId: state.hostId,
    starterSeat: state.starterSeat,
    activeSeat: state.activeSeat,
    boardOwnerSeat: boardOwnerSeat(state),
    position: state.position,
    ...(state.phase === 'placing' ? { ownMines: [...(Object.hasOwn(state.boards, playerId) ? state.boards[playerId] : [])] } : {}),
    event: state.event ? { ...state.event } : null,
    winner: state.winner ? { ...state.winner } : null,
    champions: [...state.champions],
    revision: state.revision,
    serverNow: now,
  };
}
