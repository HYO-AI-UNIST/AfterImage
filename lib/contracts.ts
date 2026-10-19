export type Phase = 'waiting' | 'placing' | 'playing' | 'roundEnd' | 'finished';
export type NodeId = string;
export interface BoardNode { id: NodeId; row: number; col: number; x: number; y: number; start: boolean; goal: boolean }
export interface BoardEdge { id: string; a: NodeId; b: NodeId; base: boolean }
export interface Spectator { id: string; name: string }
export type RoleId = 'illuminator' | 'guardian' | 'trapper' | 'thief' | 'shifter' | 'recorder';
export type MemoStatus = 'safe' | 'mine' | 'unsure';
export interface MemoEntry { boardOwnerId: string; edgeId: string; status: MemoStatus }
export interface MemoTarget { playerId: string; slot: number }
export interface PeekEntry extends MemoEntry, MemoTarget {}
export interface Player { id: string; name: string; seat: number; score: number; coins: number; ready: boolean; role?: RoleId; blessings?: number; peeks?: number; shifts?: number; roleRevision?: number; memoRevision?: number }
export interface GameEvent { id: string; type: 'move' | 'explosion' | 'rotation'; actorSeat: number; ownerSeat: number; until: number; from?: NodeId; to?: NodeId; edgeId?: string }
export interface RoundWinner { seat: number; points: number; remainingCoins?: number; ownerSeat?: number; coinsTransferred?: number }
/** Public activation only. Contains no mine, hint, note or target information. */
export interface AbilityCue { id: string; role: 'guardian' | 'shifter'; actorSeat: number; until: number }
export interface RoomSettings { playerCount: number; hintCoins: number; totalRounds: number; gridSize: number }
export interface GameState {
  code: string; phase: Phase; round: number; totalRounds: number; playerCount: number; hintCoins: number; gridSize: number; rotation: number;
  players: Player[]; spectators: Spectator[]; hostId: string; boards: Record<string, string[]>;
  starterSeat: number; activeSeat: number; attempts: number; position: NodeId | null;
  /** Absent in saved rounds that still use automatic rotation. */
  boardMode?: 'choice'; selectedBoardSeat?: number | null; turnNumber?: number;
  /** Absent in saved games using the original cumulative hint-bonus score. */
  scoringMode?: 'transfer';
  /** Only a maker who lost a victory coin rebuilds after the first round. */
  placementMode?: 'retained'; rebuildSeats?: number[];
  event: GameEvent | null; winner: RoundWinner | null; champions: number[];
  revision: number; placementRevision?: number; demo?: boolean;
  /** Last revision that changed play rather than a participant's private notes. */
  actionRevision?: number;
  /** Absent in saved games created before roles were introduced. */
  rolesEnabled?: boolean;
  concealedBoards?: Record<string, string[]>;
  memos?: Record<string, Array<MemoEntry | null>>;
  blessingSeat?: number | null;
  /** Only the first queued owner may privately change their own board. */
  shiftQueue?: number[];
  abilityCue?: AbilityCue;
}
export interface RoomView {
  code: string; phase: Phase; round: number; totalRounds: number; playerCount: number; hintCoins: number; gridSize: number; rotation: number;
  players: Array<Omit<Player, 'coins' | 'roleRevision' | 'memoRevision'> & { coins?: number }>;
  spectators: Spectator[];
  selfId: string; hostId: string; starterSeat: number; activeSeat: number; boardOwnerSeat: number;
  boardMode?: 'choice'; turnNumber?: number;
  scoringMode?: 'transfer';
  placementMode?: 'retained'; rebuildSeats?: number[];
  position: NodeId | null; ownMines?: string[];
  /** Public total for the currently displayed board during play; never includes mine locations. */
  activeBoardMineCount?: number;
  revealedBoards?: Record<string, string[]>; event: GameEvent | null;
  winner: RoundWinner | null; champions: number[]; revision: number; serverNow: number;
  selfMemos?: Array<MemoEntry | null>; memoCapacity?: number; peekableMemos?: MemoTarget[];
  blessingSeat?: number; shiftSeat?: number; shiftMines?: string[]; ownConcealed?: string[];
  rolesEnabled?: boolean;
  abilityCue?: AbilityCue;
}
export type GameAction =
  | { type: 'settings'; settings: RoomSettings }
  | { type: 'seat'; playerId: string; seated: boolean }
  | { type: 'start' }
  | { type: 'chooseRole'; role: RoleId }
  | { type: 'place'; mines: string[]; concealed?: string[] }
  | { type: 'ready' }
  | { type: 'chooseBoard'; ownerSeat: number }
  | { type: 'spawn'; nodeId: NodeId }
  | { type: 'move'; nodeId: NodeId }
  | { type: 'hint'; edgeId: string }
  | { type: 'memo'; slot: number; entry: MemoEntry | null }
  | { type: 'peek'; targets: MemoTarget[] }
  | { type: 'blessing'; use: boolean }
  | { type: 'shiftMine'; fromEdgeId?: string; toEdgeId?: string }
  | { type: 'nextRound' }
  | { type: 'restart' };
export interface PrivateResult { edgeId: string; mined: boolean | null }
export interface ActionResult { state: GameState; privateResult?: PrivateResult; peekResult?: PeekEntry[] }
export interface ApiReply { view: RoomView; token?: string; privateResult?: PrivateResult; peekResult?: PeekEntry[] }
