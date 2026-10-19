'use client';

import { Check, LockKeyhole } from 'lucide-react';
import type { RoomView } from '@/lib/contracts';
import { playerColor, playerColorStyle } from '@/lib/player-colors';

export function RetainedBoard({ view }: { view: RoomView }) {
  const self = view.players.find(player => player.id === view.selfId)!;
  const rebuilding = view.players.filter(player => view.rebuildSeats?.includes(player.seat));
  return <div className="retained-board player-color" style={playerColorStyle(self.seat)} data-testid="retained-board">
    <div className="retained-board-owner"><i className="owner-swatch"/><span>{self.name}의 판 · {self.seat + 1}번 · {playerColor(self.seat).label}</span><LockKeyhole size={17}/></div>
    <div className="retained-board-message"><span className="retained-board-icon"><Check size={27}/></span><h2>내 판은 그대로 이어집니다.</h2><p>지난 라운드의 지뢰와 위장한 길을 유지합니다.<br/>이번에는 능력을 고르고 준비를 완료하세요.</p></div>
    <p className="retained-board-note">{rebuilding.length ? <><strong>{rebuilding.map(player => player.name).join(', ')}</strong>님만 코인을 잃은 판을 다시 만들 수 있어요.</> : '지난 라운드는 코인 이동이 없어 모든 판을 그대로 사용합니다.'}</p>
  </div>;
}
