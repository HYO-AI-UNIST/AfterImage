import type {
  ActionResult,
  GameAction,
  GameEvent,
  GameState,
  MemoEntry,
  PeekEntry,
  Player,
  RoomView,
} from './contracts';
import { DEFAULT_ROOM_SETTINGS, isValidRoomSettings, ROOM_SETTING_LIMITS } from './settings.ts';
import { getBoard, edgeId, hasSafePath, maxMines } from './geometry.ts';
import { availableRoles, baseMemoSlots, MAX_CONCEALED_EDGES, MAX_MINE_SHIFTS, memoCapacity, remainingMineShifts, roundHintCoins } from './roles.ts';
export { getBoard, edgeId, NODES, EDGES, STARTS, GOAL, hasSafePath, maxMines, randomBoard } from './geometry.ts';

const MOVE_MS = 650;
const EXPLOSION_MS = 4_000;
const ROTATION_MS = 1_400;
export const INITIAL_VICTORY_COINS = 3;

/** A deliberately user-facing validation error; unexpected errors stay private. */
export class GameError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GameError';
    this.status = status;
  }
}

function validatedPlayer(player: { id: string; name: string }, seat: number, coins: number): Player {
  if (!player || typeof player.id !== 'string' || !player.id.trim() || player.id.length > 200) {
    throw new GameError('플레이어 정보가 올바르지 않습니다.');
  }
  if (typeof player.name !== 'string' || !player.name.trim() || player.name.trim().length > 20) {
    throw new GameError('이름을 1~20자로 입력해주세요.');
  }
  return { id: player.id, name: player.name.trim(), seat, score: INITIAL_VICTORY_COINS, coins, ready: false };
}

export function createRoom(code: string, host: { id: string; name: string }, now?: number): GameState {
  void now;
  if (typeof code !== 'string' || !code.trim() || code.length > 20) throw new GameError('방 코드가 올바르지 않습니다.');
  return {
    code,
    phase: 'waiting',
    round: 1,
    ...DEFAULT_ROOM_SETTINGS,
    rotation: 0,
    players: [validatedPlayer(host, 0, DEFAULT_ROOM_SETTINGS.hintCoins)],
    spectators: [],
    hostId: host.id,
    boards: {},
    starterSeat: 0,
    activeSeat: 0,
    boardMode: 'choice',
    scoringMode: 'transfer',
    placementMode: 'retained',
    selectedBoardSeat: null,
    turnNumber: 1,
    attempts: 0,
    position: null,
    event: null,
    winner: null,
    champions: [],
    revision: 0,
    actionRevision: 0,
    rolesEnabled: true,
  };
}

/** Lobby arrivals fill vacant seats; everyone else joins the waiting audience. */
export function addPlayer(original: GameState, player: { id: string; name: string }): GameState {
  const state = upgradeWaitingRoom(original);
  const participant = validatedPlayer(player, 0, state.hintCoins);
  if ([...state.players, ...state.spectators].some((existing) => existing.id === participant.id)) throw new GameError('이미 참가한 플레이어입니다.', 409);
  if (state.players.length + state.spectators.length >= 32) throw new GameError('방 정원 32명이 모두 찼습니다.', 409);
  if (state.phase === 'waiting' && state.players.length < state.playerCount) {
    return nextState(state, { players: [...state.players, { ...participant, seat: state.players.length }] });
  }
  return nextState(state, { spectators: [...state.spectators, { id: participant.id, name: participant.name }] });
}

function requireParticipant(state: GameState, playerId: string) {
  if (![...state.players, ...state.spectators].some((player) => player.id === playerId)) throw new GameError('이 방의 참가자가 아닙니다.', 403);
}

/** Seat numbers advance clockwise; the left neighbor is seat + 1. */
export function boardOwnerSeat(state: GameState, seat = state.activeSeat): number {
  if (state.boardMode === 'choice') return state.selectedBoardSeat ?? -1;
  return ((seat - state.rotation) % state.playerCount + state.playerCount) % state.playerCount;
}

/** Older rooms keep their seats until the current round is over. */
function capRoomSeats(state: GameState): GameState {
  const playerCount = Math.min(state.playerCount, ROOM_SETTING_LIMITS.playerCount.max);
  if (state.playerCount === playerCount && state.players.length <= playerCount) return state;
  return {
    ...state,
    playerCount,
    players: state.players.slice(0, playerCount),
    spectators: [...state.spectators, ...state.players.slice(playerCount).map(({ id, name }) => ({ id, name }))],
    starterSeat: state.starterSeat % playerCount,
    activeSeat: state.activeSeat % playerCount,
  };
}

export function upgradeWaitingRoom(state: GameState): GameState {
  if (state.phase !== 'waiting') return state;
  const capped = capRoomSeats(state);
  return capped.scoringMode === 'transfer' ? capped : {
    ...capped, scoringMode: 'transfer', players: capped.players.map(player => ({ ...player, score: INITIAL_VICTORY_COINS })),
  };
}

function nextState(state: GameState, changes: Partial<GameState>, affectsPlay = true): GameState {
  const revision = state.revision + 1;
  return {
    ...state, ...changes, revision,
    actionRevision: affectsPlay ? revision : (state.actionRevision ?? state.revision),
  };
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

  const actor = state.players[state.activeSeat];
  if (actor.role === 'guardian' && (actor.blessings ?? 0) > 0) {
    return nextState(state, { event: null, blessingSeat: actor.seat, position: null });
  }
  return finishTurn(state, now);
}

function finishTurn(state: GameState, now: number): GameState {
  const attempts = state.attempts + 1;
  const activeSeat = (state.activeSeat + 1) % state.playerCount;
  if (state.boardMode === 'choice') {
    const turnNumber = (state.turnNumber ?? 1) + 1;
    const shiftQueue = turnNumber > state.playerCount && remainingMineShifts(state.players[activeSeat]) > 0 ? [activeSeat] : [];
    return nextState(state, { event: null, activeSeat, attempts: attempts % state.playerCount, position: null,
      blessingSeat: null, selectedBoardSeat: null, turnNumber, shiftQueue });
  }
  if (attempts < state.playerCount) return nextState(state, { event: null, activeSeat, attempts, position: null, blessingSeat: null });

  // A full circuit returns everyone's own board. Skip it together and go to one.
  const ownBoardsReturn = state.rotation === state.playerCount - 1;
  const shiftQueue = ownBoardsReturn
    ? Array.from({ length: state.playerCount }, (_, index) => (state.starterSeat + index) % state.playerCount)
      .filter((seat) => remainingMineShifts(state.players[seat]) > 0)
    : [];
  if (shiftQueue.length) {
    return nextState(state, { event: null, activeSeat: state.starterSeat, attempts: 0, position: null, blessingSeat: null, shiftQueue });
  }
  return rotateBoards(state, ownBoardsReturn ? 1 : state.rotation + 1, now);
}

function rotateBoards(state: GameState, rotation: number, now: number): GameState {
  const rotated = { ...state, rotation, activeSeat: state.starterSeat };
  return nextState(state, {
    event: eventFor(rotated, 'rotation', now + ROTATION_MS),
    activeSeat: state.starterSeat,
    attempts: 0,
    position: null,
    rotation,
    blessingSeat: null,
    shiftQueue: [],
  });
}

function beginPlacement(original: GameState, starterSeat: number, restart = false): GameState {
  const state = capRoomSeats(original);
  const newGame = restart || original.phase === 'waiting';
  const retainBoards = !newGame && state.placementMode === 'retained' && state.scoringMode === 'transfer';
  const losingSeat = state.winner?.ownerSeat;
  const rebuildSeats = retainBoards
    ? (state.winner?.coinsTransferred ?? 0) > 0 && losingSeat !== undefined && state.players.some(player => player.seat === losingSeat) ? [losingSeat] : []
    : state.players.map(player => player.seat);
  // If the old next seat was demoted, continue clockwise at the first seat.
  if (starterSeat >= state.playerCount) starterSeat = 0;
  return nextState(state, {
    phase: 'placing',
    placementRevision: state.revision + 1,
    round: restart ? 1 : state.round,
    rotation: 0,
    boardMode: 'choice',
    ...(newGame ? { scoringMode: 'transfer' as const, placementMode: 'retained' as const } : {}),
    rebuildSeats,
    selectedBoardSeat: null,
    turnNumber: 1,
    players: state.players.map((player) => ({ ...player, role: undefined, roleRevision: undefined, memoRevision: state.revision + 1, blessings: 0, peeks: 0, shifts: 0,
      score: newGame ? INITIAL_VICTORY_COINS : player.score, coins: state.hintCoins, ready: false })),
    boards: retainBoards ? state.boards : {},
    concealedBoards: retainBoards ? state.concealedBoards ?? {} : {},
    memos: {},
    blessingSeat: null,
    shiftQueue: [],
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

function requireOwnTurn(state: GameState, player: Player) {
  requirePhase(state, 'playing');
  if (state.activeSeat !== player.seat) throw new GameError('지금은 다른 플레이어의 차례입니다.', 409);
  if (state.event) throw new GameError('진행 중인 동작이 끝날 때까지 기다려주세요.', 409);
  if (state.blessingSeat != null) throw new GameError('가호를 사용할지 먼저 선택해주세요.', 409);
  if (state.shiftQueue?.length) throw new GameError('지뢰 이동 선택이 끝날 때까지 기다려주세요.', 409);
}

function notesFor(state: GameState, playerId: string): Array<MemoEntry | null> {
  return state.memos && Object.hasOwn(state.memos, playerId) ? state.memos[playerId] : [];
}

export function canRebuildBoard(state: Pick<GameState, 'placementMode' | 'rebuildSeats'>, seat: number): boolean {
  return state.placementMode !== 'retained' || !!state.rebuildSeats?.includes(seat);
}

export function applyAction(original: GameState, playerId: string, action: GameAction, now = Date.now()): ActionResult {
  requireParticipant(original, playerId);
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') throw new GameError('행동 정보가 올바르지 않습니다.');
  const state = advanceTime(upgradeWaitingRoom(original), now);
  const player = state.players.find((participant) => participant.id === playerId);
  const board = getBoard(state.gridSize);
  if (['chooseRole', 'place', 'ready', 'chooseBoard', 'spawn', 'move', 'hint', 'memo', 'peek', 'blessing', 'shiftMine'].includes(action.type) && !player) throw new GameError('관전 중에는 플레이할 수 없습니다.', 403);

  switch (action.type) {
    case 'settings': {
      requireHost(state, playerId);
      requirePhase(state, 'waiting');
      if (!isValidRoomSettings(action.settings)) throw new GameError('인원 2~6명, 힌트 0~10개, 라운드 1~20회, 그리드 3~6등분으로 설정해주세요.');
      const retained = state.players.slice(0, action.settings.playerCount);
      const promoted = action.settings.playerCount > state.playerCount
        ? state.spectators.slice(0, action.settings.playerCount - retained.length) : [];
      return {
        state: nextState(state, {
          ...action.settings,
          players: [...retained, ...promoted.map((guest, index) => validatedPlayer(guest, retained.length + index, action.settings.hintCoins))]
            .map((participant) => ({ ...participant, coins: action.settings.hintCoins })),
          spectators: [...state.spectators.slice(promoted.length), ...state.players.slice(action.settings.playerCount).map(({ id, name }) => ({ id, name }))],
        }),
      };
    }
    case 'seat': {
      requireHost(state, playerId);
      requirePhase(state, 'waiting');
      if (typeof action.playerId !== 'string' || typeof action.seated !== 'boolean') throw new GameError('자리 변경 정보를 확인해주세요.');
      if (action.seated) {
        const guest = state.spectators.find((participant) => participant.id === action.playerId);
        if (!guest) throw new GameError('대기 중인 참가자를 선택해주세요.', 409);
        if (state.players.length >= state.playerCount) throw new GameError('플레이 자리가 모두 찼습니다.', 409);
        return { state: nextState(state, {
          players: [...state.players, validatedPlayer(guest, state.players.length, state.hintCoins)],
          spectators: state.spectators.filter((participant) => participant.id !== guest.id),
        }) };
      }
      const seated = state.players.find((participant) => participant.id === action.playerId);
      if (!seated) throw new GameError('플레이 중인 참가자를 선택해주세요.', 409);
      return { state: nextState(state, {
        players: state.players.filter((participant) => participant.id !== seated.id).map((participant, seat) => ({ ...participant, seat })),
        spectators: [...state.spectators, { id: seated.id, name: seated.name }],
      }) };
    }
    case 'start': {
      requireHost(state, playerId);
      requirePhase(state, 'waiting');
      if (state.players.length !== state.playerCount) throw new GameError(`${state.playerCount}명이 모두 모이면 시작할 수 있습니다.`, 409);
      return { state: beginPlacement(state, Math.floor(Math.random() * state.playerCount)) };
    }
    case 'chooseRole': {
      requirePhase(state, 'placing');
      if (!state.rolesEnabled) throw new GameError('이번 라운드는 특수 능력 없이 진행합니다.', 409);
      if (player!.ready) throw new GameError('배치를 완료한 뒤에는 특수 능력을 바꿀 수 없습니다.', 409);
      if (!availableRoles(state.playerCount).includes(action.role)) throw new GameError('이번 게임에서 사용할 수 있는 특수 능력을 선택해주세요.');
      return { state: nextState(state, {
        players: state.players.map((participant) => participant.id === playerId ? { ...participant, role: action.role,
          roleRevision: state.revision + 1, memoRevision: state.revision + 1, coins: roundHintCoins(state.hintCoins, action.role), blessings: action.role === 'guardian' ? 2 : 0, peeks: action.role === 'thief' ? 2 : 0, shifts: action.role === 'shifter' ? MAX_MINE_SHIFTS : 0 } : participant),
        concealedBoards: state.placementMode === 'retained' ? state.concealedBoards : { ...state.concealedBoards, [playerId]: [] },
        memos: { ...state.memos, [playerId]: [] },
      }) };
    }
    case 'place': {
      requirePhase(state, 'placing');
      if (!canRebuildBoard(state, player!.seat)) throw new GameError('이번 라운드는 기존 판을 그대로 사용합니다. 능력을 고른 뒤 준비 완료해주세요.', 409);
      if (player!.ready) throw new GameError('이미 배치를 완료했습니다.', 409);
      if (state.rolesEnabled && !player!.role) throw new GameError('배치를 완료하기 전에 특수 능력을 선택해주세요.', 409);
      if (!Array.isArray(action.mines) || action.mines.length > board.edges.length || action.mines.some((id) => typeof id !== 'string')) {
        throw new GameError('지뢰 배치 정보가 올바르지 않습니다.');
      }
      for (const id of action.mines) {
        const edge = board.edgeLookup.get(id);
        if (!edge) throw new GameError('판에 없는 길에는 지뢰를 놓을 수 없습니다.');
        if (edge.base) throw new GameError('출발점 사이에는 지뢰를 놓을 수 없습니다.');
      }
      const mines = [...new Set(action.mines)];
      if (mines.length > maxMines(state.gridSize)) throw new GameError(`지뢰는 최대 ${maxMines(state.gridSize)}개까지 놓을 수 있습니다.`);
      if (!hasSafePath(mines, state.gridSize)) throw new GameError('정상까지 이어지는 안전한 길을 하나 이상 남겨주세요.');
      const concealed = action.concealed === undefined ? [] : action.concealed;
      if (!Array.isArray(concealed) || concealed.length > MAX_CONCEALED_EDGES || concealed.some((id) => typeof id !== 'string' || !board.edgeLookup.has(id) || board.edgeLookup.get(id)!.base)) {
        throw new GameError(`위장할 길은 출발점 사이를 제외하고 최대 ${MAX_CONCEALED_EDGES}개까지 선택해주세요.`);
      }
      if (concealed.length && player!.role !== 'trapper') throw new GameError('기만의 장막 능력이 있어야 길을 위장할 수 있습니다.', 403);
      const players = state.players.map((participant) => participant.id === playerId ? { ...participant, ready: true } : participant);
      const everyoneReady = players.every((participant) => participant.ready);
      return {
        state: nextState(state, {
          players,
          boards: { ...state.boards, [playerId]: mines },
          concealedBoards: { ...state.concealedBoards, [playerId]: [...new Set(concealed)] },
          phase: everyoneReady ? 'playing' : 'placing',
          rotation: state.boardMode === 'choice' ? 0 : everyoneReady ? 1 : 0,
        }),
      };
    }
    case 'ready': {
      requirePhase(state, 'placing');
      if (canRebuildBoard(state, player!.seat)) throw new GameError('이번 라운드는 지뢰 배치를 완료해주세요.', 409);
      if (player!.ready) throw new GameError('이미 준비를 완료했습니다.', 409);
      if (state.rolesEnabled && !player!.role) throw new GameError('준비를 완료하기 전에 특수 능력을 선택해주세요.', 409);
      if (!Array.isArray(state.boards[playerId])) throw new GameError('유지할 판을 확인할 수 없습니다.', 409);
      const players = state.players.map(participant => participant.id === playerId ? { ...participant, ready: true } : participant);
      const everyoneReady = players.every(participant => participant.ready);
      return { state: nextState(state, { players, phase: everyoneReady ? 'playing' : 'placing',
        rotation: state.boardMode === 'choice' ? 0 : everyoneReady ? 1 : 0 }) };
    }
    case 'chooseBoard': {
      requireOwnTurn(state, player!);
      if (state.boardMode !== 'choice') throw new GameError('이번 라운드는 기존 판 전달 규칙으로 진행합니다.', 409);
      if (state.selectedBoardSeat != null) throw new GameError('이번 차례에 도전할 판을 이미 골랐습니다.', 409);
      if (!Number.isInteger(action.ownerSeat) || action.ownerSeat < 0 || action.ownerSeat >= state.playerCount) throw new GameError('도전할 판을 선택해주세요.');
      const owner = state.players[action.ownerSeat];
      if (!owner || owner.id === playerId) throw new GameError('본인이 만든 판에는 도전할 수 없습니다.', 409);
      if (!Array.isArray(state.boards[owner.id])) throw new GameError('배치가 완료되지 않은 판입니다.', 409);
      return { state: nextState(state, { selectedBoardSeat: owner.seat }) };
    }
    case 'spawn':
    case 'move':
    case 'hint': {
      requireOwnTurn(state, player!);
      if (state.boardMode === 'choice' && state.selectedBoardSeat == null) throw new GameError('먼저 도전할 판을 선택해주세요.', 409);
      const owner = state.players[boardOwnerSeat(state)];
      if (!owner || owner.id === playerId) throw new GameError('현재 판을 사용할 수 없습니다.', 409);
      const mines = state.boards[owner.id];
      if (!Array.isArray(mines)) throw new GameError('배치가 완료되지 않은 판입니다.', 409);

      if (action.type === 'hint') {
        const edge = board.edgeLookup.get(action.edgeId);
        if (!edge || edge.base) throw new GameError('힌트는 지뢰를 놓을 수 있는 길에만 사용할 수 있습니다.');
        if (player!.coins <= 0) throw new GameError('이번 라운드의 힌트 코인을 모두 사용했습니다.', 409);
        return {
          state: nextState(state, {
            players: state.players.map((participant) => participant.id === playerId ? { ...participant, coins: participant.coins - 1 } : participant),
          }),
          privateResult: { edgeId: edge.id, mined: state.concealedBoards?.[owner.id]?.includes(edge.id) ? null : mines.includes(edge.id) },
        };
      }

      if (action.type === 'spawn') {
        if (state.position !== null) throw new GameError('이미 출발했습니다. 연결된 점으로 이동해주세요.', 409);
        if (!board.starts.includes(action.nodeId)) throw new GameError('밑변의 출발점에서 시작해주세요.');
        return { state: nextState(state, { position: action.nodeId }) };
      }

      if (state.position === null) throw new GameError('먼저 출발점을 선택해주세요.', 409);
      if (typeof action.nodeId !== 'string') throw new GameError('이동할 점이 올바르지 않습니다.');
      const edge = board.edgeLookup.get(edgeId(state.position, action.nodeId));
      if (!edge) throw new GameError('현재 위치와 연결된 점으로만 이동할 수 있습니다.');
      if (mines.includes(edge.id)) {
        return {
          state: nextState(state, {
            position: null,
            event: eventFor(state, 'explosion', now + EXPLOSION_MS, { from: state.position, to: action.nodeId, edgeId: edge.id }),
          }),
        };
      }

      if (action.nodeId === board.goal) {
        const transfer = state.scoringMode === 'transfer';
        const points = transfer ? Math.min(1, Math.max(0, owner.score)) : 1 + player!.coins;
        const players = state.players.map((participant) => {
          if (participant.id === playerId) return { ...participant, score: participant.score + points };
          if (transfer && participant.id === owner.id) return { ...participant, score: participant.score - points };
          return participant;
        });
        const finished = state.round >= state.totalRounds;
        const bestScore = Math.max(...players.map((participant) => participant.score));
        return {
          state: nextState(state, {
            phase: finished ? 'finished' : 'roundEnd',
            position: board.goal,
            event: null,
            players,
            winner: transfer ? { seat: player!.seat, points, ownerSeat: owner.seat, coinsTransferred: points }
              : { seat: player!.seat, points, remainingCoins: player!.coins },
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
    case 'memo': {
      requirePhase(state, 'playing');
      const capacity = memoCapacity(state.playerCount, player!.role);
      if (!Number.isInteger(action.slot) || action.slot < 0 || action.slot >= capacity) throw new GameError('사용할 수 있는 메모 슬롯을 선택해주세요.');
      let entry: MemoEntry | null = null;
      if (action.entry !== null) {
        const input = action.entry;
        if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).some((key) => !['boardOwnerId', 'edgeId', 'status'].includes(key))
          || !state.players.some((owner) => owner.id === input.boardOwnerId)
          || typeof input.edgeId !== 'string' || !board.edgeLookup.has(input.edgeId)
          || !['safe', 'mine', 'unsure'].includes(input.status)) throw new GameError('메모할 판과 길, 상태를 확인해주세요.');
        entry = { boardOwnerId: input.boardOwnerId, edgeId: input.edgeId, status: input.status };
      }
      const notes = Array.from({ length: capacity }, (_, index) => notesFor(state, playerId)[index] ?? null);
      notes[action.slot] = entry;
      return { state: nextState(state, {
        memos: { ...state.memos, [playerId]: notes },
        players: state.players.map((participant) => participant.id === playerId
          ? { ...participant, memoRevision: state.revision + 1 } : participant),
      }, false) };
    }
    case 'peek': {
      requireOwnTurn(state, player!);
      if (player!.role !== 'thief') throw new GameError('타인의 기억 능력이 있어야 다른 사람의 메모를 볼 수 있습니다.', 403);
      if ((player!.peeks ?? 0) <= 0) throw new GameError('이번 라운드의 훔쳐보기 기회를 모두 사용했습니다.', 409);
      const limit = baseMemoSlots(state.playerCount);
      if (!Array.isArray(action.targets) || action.targets.length < 1 || action.targets.length > limit) throw new GameError(`다른 사람의 메모를 1~${limit}개 선택해주세요.`);
      const selected = new Set<string>();
      const peekResult: PeekEntry[] = action.targets.map((target) => {
        if (!target || typeof target !== 'object' || typeof target.playerId !== 'string'
          || target.playerId === playerId || !state.players.some((owner) => owner.id === target.playerId)
          || !Number.isInteger(target.slot) || target.slot < 0) throw new GameError('다른 사람의 사용 중인 메모를 선택해주세요.');
        const key = JSON.stringify([target.playerId, target.slot]);
        if (selected.has(key)) throw new GameError('같은 메모를 여러 번 선택할 수 없습니다.');
        selected.add(key);
        const note = notesFor(state, target.playerId)[target.slot];
        if (!note) throw new GameError('선택한 메모가 비어 있습니다.', 409);
        return { playerId: target.playerId, slot: target.slot, boardOwnerId: note.boardOwnerId, edgeId: note.edgeId, status: note.status };
      });
      return {
        state: nextState(state, { players: state.players.map((participant) => participant.id === playerId ? { ...participant, peeks: (participant.peeks ?? 0) - 1 } : participant) }),
        peekResult,
      };
    }
    case 'blessing': {
      requirePhase(state, 'playing');
      if (state.blessingSeat !== player!.seat || player!.role !== 'guardian' || state.event) throw new GameError('폭발이 끝난 뒤 가호를 선택할 수 있습니다.', 409);
      if (typeof action.use !== 'boolean') throw new GameError('가호 사용 여부를 선택해주세요.');
      if (!action.use) return { state: finishTurn(state, now) };
      if ((player!.blessings ?? 0) <= 0) throw new GameError('이번 라운드의 가호를 모두 사용했습니다.', 409);
      return { state: nextState(state, {
        blessingSeat: null, position: null,
        players: state.players.map((participant) => participant.id === playerId ? { ...participant, blessings: (participant.blessings ?? 0) - 1 } : participant),
      }) };
    }
    case 'shiftMine': {
      requirePhase(state, 'playing');
      if (!state.shiftQueue?.length || state.shiftQueue[0] !== player!.seat || player!.role !== 'shifter' || state.event) throw new GameError('지뢰 이동 선택 시간에만 지뢰를 옮길 수 있습니다.', 409);
      let boards = state.boards;
      let players = state.players;
      if (action.fromEdgeId !== undefined || action.toEdgeId !== undefined) {
        const remaining = remainingMineShifts(player!);
        if (remaining <= 0) throw new GameError(`이번 라운드의 지뢰 이동 ${MAX_MINE_SHIFTS}회를 모두 사용했습니다.`, 409);
        const from = typeof action.fromEdgeId === 'string' ? board.edgeLookup.get(action.fromEdgeId) : undefined;
        const to = typeof action.toEdgeId === 'string' ? board.edgeLookup.get(action.toEdgeId) : undefined;
        const current = state.boards[playerId];
        if (!from || !to || from.base || to.base || !current.includes(from.id) || current.includes(to.id)) throw new GameError('내 지뢰 하나와 지뢰가 없는 이동할 길을 선택해주세요.');
        const mines = current.map((id) => id === from.id ? to.id : id);
        if (mines.length > maxMines(state.gridSize)) throw new GameError(`지뢰는 최대 ${maxMines(state.gridSize)}개까지 놓을 수 있습니다.`);
        if (!hasSafePath(mines, state.gridSize)) throw new GameError('정상까지 이어지는 안전한 길을 하나 이상 남겨주세요.');
        boards = { ...boards, [playerId]: mines };
        players = players.map((participant) => participant.id === playerId ? { ...participant, shifts: remaining - 1 } : participant);
      }
      const shiftQueue = state.shiftQueue.slice(1);
      if (state.boardMode === 'choice') return { state: nextState(state, { boards, players, shiftQueue: [] }) };
      return { state: shiftQueue.length
        ? nextState(state, { boards, players, shiftQueue })
        : rotateBoards({ ...state, boards, players }, 1, now) };
    }
    case 'nextRound': {
      requireHost(state, playerId);
      requirePhase(state, 'roundEnd');
      if (!state.winner) throw new GameError('라운드 결과를 확인할 수 없습니다.', 409);
      return { state: beginPlacement({ ...state, round: state.round + 1 }, (state.winner.seat + 1) % state.playerCount) };
    }
    case 'restart': {
      requireHost(state, playerId);
      requirePhase(state, 'finished');
      if (state.demo) return { state: beginPlacement(state, Math.floor(Math.random() * state.playerCount), true) };
      const reset = beginPlacement(state, 0, true);
      return { state: { ...reset, phase: 'waiting', players: reset.players.map((participant) => ({ ...participant, role: undefined, coins: state.hintCoins, blessings: 0, peeks: 0, shifts: 0 })) } };
    }
    default:
      throw new GameError('알 수 없는 행동입니다.');
  }
}

/** Explicit allowlist prevents unrevealed boards or hint answers crossing the API. */
export function viewFor(original: GameState, playerId: string, now = Date.now()): RoomView {
  requireParticipant(original, playerId);
  const state = advanceTime(original, now);
  const self = state.players.find((player) => player.id === playerId);
  const capacity = self ? memoCapacity(state.playerCount, self.role) : 0;
  const shiftSeat = state.shiftQueue?.[0];
  const ownerSeat = boardOwnerSeat(state);
  const owner = state.players[ownerSeat];
  return {
    code: state.code,
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds,
    playerCount: state.playerCount,
    hintCoins: state.hintCoins,
    gridSize: state.gridSize,
    rolesEnabled: state.rolesEnabled ?? false,
    ...(state.scoringMode === 'transfer' ? { scoringMode: state.scoringMode } : {}),
    ...(state.placementMode === 'retained' ? { placementMode: state.placementMode, rebuildSeats: [...(state.rebuildSeats ?? [])] } : {}),
    spectators: state.spectators.map(({ id, name }) => ({ id, name })),
    rotation: state.rotation,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      score: player.score,
      ready: player.ready,
      ...(player.role ? { role: player.role } : {}),
      ...(player.id === playerId ? { coins: player.coins, blessings: player.blessings ?? 0, peeks: player.peeks ?? 0, shifts: remainingMineShifts(player) } : {}),
    })),
    selfId: playerId,
    hostId: state.hostId,
    starterSeat: state.starterSeat,
    activeSeat: state.activeSeat,
    boardOwnerSeat: ownerSeat,
    ...(state.boardMode === 'choice' ? { boardMode: state.boardMode, turnNumber: state.turnNumber ?? 1 } : {}),
    position: state.position,
    ...(state.phase === 'placing' && self && canRebuildBoard(state, self.seat) ? { ownMines: [...(Object.hasOwn(state.boards, playerId) ? state.boards[playerId] : [])] } : {}),
    ...(state.phase === 'placing' && self?.role === 'trapper' && canRebuildBoard(state, self.seat) ? { ownConcealed: [...(state.concealedBoards?.[playerId] ?? [])] } : {}),
    ...(self ? {
      memoCapacity: capacity,
      selfMemos: Array.from({ length: capacity }, (_, index) => {
        const note = notesFor(state, playerId)[index];
        return note ? { boardOwnerId: note.boardOwnerId, edgeId: note.edgeId, status: note.status } : null;
      }),
    } : {}),
    ...(state.phase === 'playing' && self?.role === 'thief' ? {
      peekableMemos: state.players.filter((player) => player.id !== playerId).flatMap((player) =>
        notesFor(state, player.id).flatMap((note, slot) => note ? [{ playerId: player.id, slot }] : [])),
    } : {}),
    ...(state.blessingSeat != null ? { blessingSeat: state.blessingSeat } : {}),
    ...(shiftSeat !== undefined ? { shiftSeat } : {}),
    ...(shiftSeat !== undefined && self?.seat === shiftSeat ? { shiftMines: [...state.boards[playerId]] } : {}),
    ...(state.phase === 'playing' && owner && !state.shiftQueue?.length
      ? { activeBoardMineCount: state.boards[owner.id].length } : {}),
    ...(state.phase === 'roundEnd' || state.phase === 'finished'
      ? { revealedBoards: Object.fromEntries(state.players
        .filter(player => state.phase === 'finished' || state.placementMode !== 'retained' || player.seat === state.winner?.ownerSeat)
        .map((player) => [player.id, [...state.boards[player.id]]])) } : {}),
    event: state.event ? { ...state.event } : null,
    winner: state.winner ? { ...state.winner } : null,
    champions: [...state.champions],
    revision: state.revision,
    serverNow: now,
  };
}
