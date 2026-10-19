import type { MemoStatus, MemoTarget, PeekEntry, RoleId, RoomSettings, RoomView } from '../contracts';
import { DEFAULT_ROOM_SETTINGS } from '../settings';

export interface RuleUi {
    role: RoleId;
    concealed: string[];
    tool: 'mine' | 'conceal';
    shiftFrom: string | null;
    shiftTo: string | null;
    memoSlot: number;
    memoOwner: number;
    memoEdge: string | null;
    memoStatus: MemoStatus;
    peekTargets: MemoTarget[];
    peekResult: PeekEntry[] | null;
    revealSeat: number;
    rosterPage: number;
    settings: RoomSettings;
    guideReturn: boolean;
}
export const createRuleUi = (): RuleUi => ({role: 'illuminator', concealed: [], tool: 'mine', shiftFrom: null, shiftTo: null, memoSlot: 0, memoOwner: 0, memoEdge: null, memoStatus: 'unsure', peekTargets: [], peekResult: null, revealSeat: 0, rosterPage: 0, settings: {...DEFAULT_ROOM_SETTINGS}, guideReturn:false});
export const turnKey = (v: RoomView | null) => v ? [v.code, v.selfId, v.round, v.phase, v.activeSeat, v.rotation, v.turnNumber, v.boardOwnerSeat, v.shiftSeat, v.blessingSeat].join(':') : '';
export const choosingBoard = (v: RoomView) => v.phase === 'playing' && v.boardMode === 'choice' && v.boardOwnerSeat < 0 && v.shiftSeat === undefined && v.blessingSeat === undefined;
export const ownShift = (v: RoomView) => v.shiftSeat !== undefined && v.players[v.shiftSeat]?.id === v.selfId;
export const ownBlessing = (v: RoomView) => v.blessingSeat !== undefined && v.players[v.blessingSeat]?.id === v.selfId;
export const edgeLabel = (id: string) => id.split('~').map(node=>{const [row,col]=node.split('-').map(Number);return `${row+1}행 ${col+1}열`;}).join(' ↔ ');
