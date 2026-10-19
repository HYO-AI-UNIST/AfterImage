import type { ApiReply, GameAction, GameState, Player } from './contracts';
import { addPlayer, advanceTime, applyAction, createRoom, GameError, upgradeWaitingRoom, viewFor } from './game.ts';
import { DEFAULT_ROOM_SETTINGS, isValidRoomSettings } from './settings.ts';
import { ROLE_IDS } from './roles.ts';
import type { RoleId } from './contracts';

const ROOM_TTL = 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL = 60 * 1000;
const MAX_RETRIES = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const MAX_BODY_BYTES = 4096;

export class RoomError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'RoomError';
    this.status = status;
  }
}

export interface RoomRecord {
  code: string;
  version: number;
  payload: string;
  updatedAt: number;
}

export interface RoomStorage {
  get(code: string): Promise<RoomRecord | null>;
  create(record: RoomRecord): Promise<boolean>;
  compareAndSwap(record: RoomRecord, previousVersion: number): Promise<boolean>;
  deleteExpired(before: number, limit: number): Promise<void>;
}

interface PrivateRoom {
  state: GameState;
  // A possession token can resume exactly one participant. Raw tokens never reach D1.
  identities: Record<string, string>;
}

export class D1RoomStorage implements RoomStorage {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  async get(code: string): Promise<RoomRecord | null> {
    return this.db.prepare(
      'SELECT code, version, payload, updated_at AS updatedAt FROM rooms WHERE code = ?',
    ).bind(code).first<RoomRecord>();
  }

  async create(record: RoomRecord): Promise<boolean> {
    const result = await this.db.prepare(
      'INSERT OR IGNORE INTO rooms (code, version, payload, updated_at) VALUES (?, ?, ?, ?)',
    ).bind(record.code, record.version, record.payload, record.updatedAt).run();
    return result.meta.changes === 1;
  }

  async compareAndSwap(record: RoomRecord, previousVersion: number): Promise<boolean> {
    const result = await this.db.prepare(
      'UPDATE rooms SET version = ?, payload = ?, updated_at = ? WHERE code = ? AND version = ?',
    ).bind(record.version, record.payload, record.updatedAt, record.code, previousVersion).run();
    return result.meta.changes === 1;
  }

  async deleteExpired(before: number, limit: number): Promise<void> {
    await this.db.prepare(
      'DELETE FROM rooms WHERE code IN (SELECT code FROM rooms WHERE updated_at < ? ORDER BY updated_at LIMIT ?)',
    ).bind(before, limit).run();
  }
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function tokenHash(token: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new RoomError('다시 입장해 주세요.', 401);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function roomCode(): string {
  // Rejection sampling keeps all characters equally likely.
  let result = '';
  while (result.length < 6) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      if (byte < Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length) {
        result += CODE_ALPHABET[byte % CODE_ALPHABET.length];
        if (result.length === 6) break;
      }
    }
  }
  return result;
}

function validCode(code: string): string {
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) throw new RoomError('방 코드는 영문과 숫자 6자리예요.');
  return code;
}

function validName(name: unknown): string {
  if (typeof name !== 'string') throw new RoomError('이름을 입력해 주세요.');
  const trimmed = name.trim();
  if (Array.from(trimmed).length < 1 || Array.from(trimmed).length > 12 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new RoomError('이름은 1~12자로 입력해 주세요.');
  }
  return trimmed;
}

function newPlayer(name: string, seat: number, coins = DEFAULT_ROOM_SETTINGS.hintCoins): Player {
  return { id: crypto.randomUUID(), name, seat, score: 0, coins, ready: false };
}

function unpack(record: RoomRecord): PrivateRoom {
  try {
    const room = JSON.parse(record.payload) as PrivateRoom;
    if (room.state.code !== record.code || !Array.isArray(room.state.players) || !room.identities || typeof room.identities !== 'object') throw new Error();
    // Existing rooms predate configurable settings. Fill only absent fields;
    // preserve live turns, accumulated scores, remaining coins, and round count.
    room.state.playerCount ??= DEFAULT_ROOM_SETTINGS.playerCount;
    room.state.hintCoins ??= DEFAULT_ROOM_SETTINGS.hintCoins;
    room.state.gridSize ??= DEFAULT_ROOM_SETTINGS.gridSize;
    room.state.spectators ??= [];
    room.state = upgradeWaitingRoom(room.state);
    // Upgrade old rooms at a round boundary, never during an active attempt.
    if (['waiting', 'roundEnd', 'finished'].includes(room.state.phase)) room.state.rolesEnabled ??= true;
    if (room.state.phase === 'placing') {
      room.state.placementRevision ??= room.state.revision - room.state.players.filter((player) => player.ready).length;
    }
    return room;
  } catch {
    throw new RoomError('방 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 503);
  }
}

function recordFor(room: PrivateRoom, version: number, now: number): RoomRecord {
  return { code: room.state.code, version, payload: JSON.stringify(room), updatedAt: now };
}

function playerFor(room: PrivateRoom, hash: string): string {
  const playerId = room.identities[hash];
  if (!playerId || ![...room.state.players, ...room.state.spectators].some((player) => player.id === playerId)) throw new RoomError('이 방의 참가 정보가 없어요. 다시 입장해 주세요.', 401);
  return playerId;
}

export class RoomService {
  private readonly storage: RoomStorage;
  private readonly now: () => number;
  constructor(storage: RoomStorage, now: () => number = Date.now) {
    this.storage = storage;
    this.now = now;
  }

  private async load(code: string, now: number): Promise<RoomRecord> {
    const record = await this.storage.get(validCode(code));
    if (!record || now - record.updatedAt >= ROOM_TTL) {
      if (record) await this.storage.deleteExpired(now - ROOM_TTL + 1, 8);
      throw new RoomError('방을 찾을 수 없어요. 코드를 확인하거나 새 방을 만들어 주세요.', 404);
    }
    return record;
  }

  async create(nameInput: unknown): Promise<ApiReply & { token: string }> {
    const name = validName(nameInput);
    const now = this.now();
    await this.storage.deleteExpired(now - ROOM_TTL, 8);
    const token = randomHex(32);
    const hash = await tokenHash(token);
    const host = newPlayer(name, 0);
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const state = createRoom(roomCode(), host, now);
      const room = { state, identities: { [hash]: host.id } };
      if (await this.storage.create(recordFor(room, 0, now))) return { view: viewFor(state, host.id, now), token };
    }
    throw new RoomError('방을 만들지 못했어요. 잠시 후 다시 시도해 주세요.', 503);
  }

  async join(code: string, nameInput: unknown): Promise<ApiReply & { token: string }> {
    const name = validName(nameInput);
    validCode(code);
    const token = randomHex(32);
    const hash = await tokenHash(token);
    const playerId = crypto.randomUUID();
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const now = this.now();
      const record = await this.load(code, now);
      const room = unpack(record);
      const player = { ...newPlayer(name, room.state.players.length, room.state.hintCoins), id: playerId };
      room.state = addPlayer(room.state, player);
      room.identities[hash] = player.id;
      if (await this.storage.compareAndSwap(recordFor(room, record.version + 1, now), record.version)) {
        return { view: viewFor(room.state, player.id, now), token };
      }
    }
    throw new RoomError('다른 참가자가 입장 중이에요. 잠시 후 다시 시도해 주세요.', 409);
  }

  async get(code: string, token: string): Promise<ApiReply> {
    const hash = await tokenHash(token);
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const now = this.now();
      const record = await this.load(code, now);
      const room = unpack(record);
      const playerId = playerFor(room, hash);
      const previousState = room.state;
      room.state = advanceTime(previousState, now);
      if (room.state !== previousState || now - record.updatedAt >= TOUCH_INTERVAL) {
        if (!await this.storage.compareAndSwap(recordFor(room, record.version + 1, now), record.version)) continue;
      }
      return { view: viewFor(room.state, playerId, now) };
    }
    throw new RoomError('방 상태를 갱신 중이에요. 잠시 후 다시 시도해 주세요.', 409);
  }

  async act(code: string, token: string, actionInput: unknown, revision: unknown): Promise<ApiReply> {
    const action = parseAction(actionInput);
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new RoomError('현재 판 정보를 다시 불러와 주세요.', 400);
    const hash = await tokenHash(token);
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const now = this.now();
      const record = await this.load(code, now);
      const room = unpack(record);
      const playerId = playerFor(room, hash);
      const previousState = room.state;
      room.state = advanceTime(previousState, now);
      // Placement commits are independent within one placement phase. Its
      // starting revision also tolerates audience arrivals between commits,
      // while never accepting a previous round's placement or stale hint.
      const placementRevision = room.state.placementRevision
        ?? room.state.revision - room.state.players.filter((player) => player.ready).length;
      const actor = room.state.players.find((player) => player.id === playerId);
      const canRebasePlacement = (action.type === 'place' || action.type === 'ready' || action.type === 'chooseRole')
        && room.state.phase === 'placing'
        && actor && !actor.ready
        && revision >= placementRevision
        && revision >= (actor.roleRevision ?? placementRevision)
        && revision <= room.state.revision;
      // Notes target explicit boards and edges, so another player's turn or
      // note edit does not invalidate them. Preserve round and owner ordering:
      // a delayed save must never overwrite that owner's newer notes.
      const canRebaseMemo = action.type === 'memo'
        && room.state.phase === 'playing'
        && actor
        && revision >= (room.state.placementRevision ?? room.state.revision)
        && revision >= (actor.roleRevision ?? room.state.placementRevision ?? room.state.revision)
        && revision >= (actor.memoRevision ?? room.state.revision)
        && revision <= room.state.revision;
      // Private note writes should not interrupt another player's pending
      // move, hint or ability. Peek reads those notes, so it still requires an
      // exact revision to avoid charging for a selection that changed.
      const canRebaseOverMemos = action.type !== 'memo' && action.type !== 'peek'
        && revision >= (room.state.actionRevision ?? room.state.revision)
        && revision <= room.state.revision;
      if (room.state.revision !== revision && !canRebasePlacement && !canRebaseMemo && !canRebaseOverMemos) {
        // A delayed animation transition must be committed even when this
        // client's action is stale. The client refreshes before trying again.
        if (room.state !== previousState && !await this.storage.compareAndSwap(recordFor(room, record.version + 1, now), record.version)) continue;
        throw new RoomError('판이 갱신되었어요. 현재 화면에서 다시 선택해 주세요.', 409);
      }
      const result = applyAction(room.state, playerId, action, now);
      room.state = result.state;
      if (await this.storage.compareAndSwap(recordFor(room, record.version + 1, now), record.version)) {
        return { view: viewFor(room.state, playerId, now), ...(result.privateResult ? { privateResult: result.privateResult } : {}), ...(result.peekResult ? { peekResult: result.peekResult } : {}) };
      }
    }
    throw new RoomError('다른 행동을 처리 중이에요. 화면을 갱신한 뒤 다시 시도해 주세요.', 409);
  }
}

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RoomError('요청 형식을 확인해 주세요.');
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new RoomError('요청 형식을 확인해 주세요.');
}

export function parseAction(input: unknown): GameAction {
  const value = objectInput(input);
  switch (value.type) {
    case 'settings': {
      onlyKeys(value, ['type', 'settings']);
      const settings = objectInput(value.settings);
      onlyKeys(settings, ['playerCount', 'hintCoins', 'totalRounds', 'gridSize']);
      if (!isValidRoomSettings(settings)) throw new RoomError('인원 2~6명, 힌트 0~10개, 라운드 1~20회, 그리드 3~6등분으로 설정해 주세요.');
      return { type: 'settings', settings: { playerCount: settings.playerCount, hintCoins: settings.hintCoins, totalRounds: settings.totalRounds, gridSize: settings.gridSize } };
    }
    case 'seat':
      onlyKeys(value, ['type', 'playerId', 'seated']);
      if (typeof value.playerId !== 'string' || !value.playerId.trim() || value.playerId.length > 200 || typeof value.seated !== 'boolean') throw new RoomError('자리 변경 정보를 확인해 주세요.');
      return { type: 'seat', playerId: value.playerId, seated: value.seated };
    case 'start':
    case 'ready':
    case 'nextRound':
    case 'restart':
      onlyKeys(value, ['type']);
      return { type: value.type };
    case 'chooseRole':
      onlyKeys(value, ['type', 'role']);
      if (typeof value.role !== 'string' || !ROLE_IDS.includes(value.role as RoleId)) throw new RoomError('사용할 특수 능력을 선택해 주세요.');
      return { type: 'chooseRole', role: value.role as RoleId };
    case 'chooseBoard':
      onlyKeys(value, ['type', 'ownerSeat']);
      if (!Number.isInteger(value.ownerSeat) || (value.ownerSeat as number) < 0 || (value.ownerSeat as number) >= DEFAULT_ROOM_SETTINGS.playerCount) throw new RoomError('도전할 판을 선택해 주세요.');
      return { type: 'chooseBoard', ownerSeat: value.ownerSeat as number };
    case 'place':
      onlyKeys(value, ['type', 'mines', 'concealed']);
      if (!Array.isArray(value.mines) || value.mines.length > 57 || value.mines.some((edge) => typeof edge !== 'string' || edge.length > 32) || new Set(value.mines).size !== value.mines.length) throw new RoomError('지뢰 배치를 확인해 주세요.');
      if (value.concealed !== undefined && (!Array.isArray(value.concealed) || value.concealed.length > 4 || value.concealed.some(edge => typeof edge !== 'string' || edge.length < 1 || edge.length > 32) || new Set(value.concealed).size !== value.concealed.length)) throw new RoomError('판독을 막을 선분은 최대 4개까지 선택해 주세요.');
      return { type: 'place', mines: value.mines as string[], ...(value.concealed === undefined ? {} : { concealed: value.concealed as string[] }) };
    case 'memo': {
      onlyKeys(value, ['type', 'slot', 'entry']);
      if (!Number.isInteger(value.slot) || (value.slot as number) < 0 || (value.slot as number) > 5) throw new RoomError('메모 칸을 선택해 주세요.');
      if (value.entry === null) return { type: 'memo', slot: value.slot as number, entry: null };
      const entry = objectInput(value.entry);
      onlyKeys(entry, ['boardOwnerId', 'edgeId', 'status']);
      if (typeof entry.boardOwnerId !== 'string' || !entry.boardOwnerId || entry.boardOwnerId.length > 200 || typeof entry.edgeId !== 'string' || !entry.edgeId || entry.edgeId.length > 32 || !['safe', 'mine', 'unsure'].includes(entry.status as string)) throw new RoomError('메모할 판, 선분과 상태를 선택해 주세요.');
      return { type: 'memo', slot: value.slot as number, entry: { boardOwnerId: entry.boardOwnerId, edgeId: entry.edgeId, status: entry.status as 'safe' | 'mine' | 'unsure' } };
    }
    case 'peek': {
      onlyKeys(value, ['type', 'targets']);
      if (!Array.isArray(value.targets) || value.targets.length < 1 || value.targets.length > 3) throw new RoomError('훔쳐볼 메모를 선택해 주세요.');
      const targets = value.targets.map(target => {
        const entry = objectInput(target);
        onlyKeys(entry, ['playerId', 'slot']);
        if (typeof entry.playerId !== 'string' || !entry.playerId || entry.playerId.length > 200 || !Number.isInteger(entry.slot) || (entry.slot as number) < 0 || (entry.slot as number) > 5) throw new RoomError('훔쳐볼 메모를 확인해 주세요.');
        return { playerId: entry.playerId, slot: entry.slot as number };
      });
      return { type: 'peek', targets };
    }
    case 'blessing':
      onlyKeys(value, ['type', 'use']);
      if (typeof value.use !== 'boolean') throw new RoomError('가호 사용 여부를 선택해 주세요.');
      return { type: 'blessing', use: value.use };
    case 'shiftMine':
      onlyKeys(value, ['type', 'fromEdgeId', 'toEdgeId']);
      if (value.fromEdgeId === undefined && value.toEdgeId === undefined) return { type: 'shiftMine' };
      if (typeof value.fromEdgeId !== 'string' || !value.fromEdgeId || value.fromEdgeId.length > 32 || typeof value.toEdgeId !== 'string' || !value.toEdgeId || value.toEdgeId.length > 32) throw new RoomError('옮길 지뢰와 도착 선분을 선택해 주세요.');
      return { type: 'shiftMine', fromEdgeId: value.fromEdgeId, toEdgeId: value.toEdgeId };
    case 'spawn':
    case 'move':
      onlyKeys(value, ['type', 'nodeId']);
      if (typeof value.nodeId !== 'string' || value.nodeId.length < 1 || value.nodeId.length > 32) throw new RoomError('이동할 점을 선택해 주세요.');
      return { type: value.type, nodeId: value.nodeId };
    case 'hint':
      onlyKeys(value, ['type', 'edgeId']);
      if (typeof value.edgeId !== 'string' || value.edgeId.length < 1 || value.edgeId.length > 32) throw new RoomError('질문할 선분을 선택해 주세요.');
      return { type: 'hint', edgeId: value.edgeId };
    default:
      throw new RoomError('지원하지 않는 행동이에요.');
  }
}

export function bearerToken(request: Request): string {
  const match = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/i);
  if (!match) throw new RoomError('참가 정보를 확인할 수 없어요. 다시 입장해 주세요.', 401);
  return match[1];
}

export async function readMutation(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new RoomError('같은 사이트에서 다시 시도해 주세요.', 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new RoomError('JSON 형식으로 요청해 주세요.', 415);
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) throw new RoomError('요청 내용이 너무 커요.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RoomError('요청 내용이 비어 있어요.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RoomError('요청 내용이 너무 커요.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return objectInput(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof RoomError) throw error;
    throw new RoomError('요청 내용을 읽을 수 없어요.');
  }
}

export async function apiResponse(work: () => Promise<ApiReply>, status = 200): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store, private', 'Vary': 'Authorization', 'X-Content-Type-Options': 'nosniff' };
  try {
    return Response.json(await work(), { status, headers });
  } catch (error) {
    if (error instanceof RoomError || error instanceof GameError) return Response.json({ error: error.message }, { status: error.status, headers });
    // Never serialize unexpected exceptions: database errors could contain the
    // private room payload, a query parameter, or authentication material.
    return Response.json({ error: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 503, headers });
  }
}
