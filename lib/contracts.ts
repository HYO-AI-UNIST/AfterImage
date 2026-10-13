export type Phase = 'waiting' | 'placing' | 'playing' | 'roundEnd' | 'finished';
export type NodeId = string;
export interface BoardNode { id: NodeId; row: number; col: number; x: number; y: number; start: boolean; goal: boolean }
export interface BoardEdge { id: string; a: NodeId; b: NodeId; base: boolean }
export interface Player { id: string; name: string; seat: number; score: number; coins: number; ready: boolean }
export interface GameEvent { id: string; type: 'move' | 'explosion' | 'rotation'; actorSeat: number; ownerSeat: number; until: number; from?: NodeId; to?: NodeId; edgeId?: string }
export interface RoundWinner { seat: number; points: number; remainingCoins: number }
export interface GameState {
  code: string; phase: Phase; round: number; totalRounds: number; rotation: number;
  players: Player[]; hostId: string; boards: Record<string, string[]>;
  starterSeat: number; activeSeat: number; attempts: number; position: NodeId | null;
  event: GameEvent | null; winner: RoundWinner | null; champions: number[];
  revision: number; demo?: boolean;
}
export interface RoomView {
  code: string; phase: Phase; round: number; totalRounds: number; rotation: number;
  players: Array<Omit<Player, 'coins'> & { coins?: number }>;
  selfId: string; hostId: string; starterSeat: number; activeSeat: number; boardOwnerSeat: number;
  position: NodeId | null; ownMines?: string[]; event: GameEvent | null;
  winner: RoundWinner | null; champions: number[]; revision: number; serverNow: number;
}
export type GameAction =
  | { type: 'start' }
  | { type: 'place'; mines: string[] }
  | { type: 'spawn'; nodeId: NodeId }
  | { type: 'move'; nodeId: NodeId }
  | { type: 'hint'; edgeId: string }
  | { type: 'nextRound' }
  | { type: 'restart' };
export interface PrivateResult { edgeId: string; mined: boolean }
export interface ActionResult { state: GameState; privateResult?: PrivateResult }
export interface ApiReply { view: RoomView; token?: string; privateResult?: PrivateResult }
