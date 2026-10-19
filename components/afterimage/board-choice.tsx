'use client';

import { ArrowRight, LockKeyhole } from 'lucide-react';
import type { RoomView } from '@/lib/contracts';
import { playerColor, playerColorStyle } from '@/lib/player-colors';

export function BoardChoice({ view, disabled, onChoose }: { view: RoomView; disabled: boolean; onChoose: (seat: number) => void }) {
  const ownTurn = view.players[view.activeSeat]?.id === view.selfId;
  const active = view.players.find(player => player.seat === view.activeSeat);
  return <section className="board-choice" id="board-choice" data-testid="board-choice" aria-labelledby="board-choice-title">
    <div className="board-choice-heading"><h2 id="board-choice-title">{ownTurn ? '어느 판에 도전할까요?' : `${active?.name ?? '플레이어'}님이 판을 고르고 있어요.`}</h2><p>같은 판에 다시 도전해도 좋아요. 한 번 고르면 이번 차례 동안 유지됩니다.</p></div>
    <div className="board-choice-grid">
      {view.players.map(player => {
        const ownBoard = player.seat === view.activeSeat;
        return <button key={player.id} type="button" className="board-choice-card player-color" style={playerColorStyle(player.seat)} data-testid={`choose-board-${player.seat}`} data-owner-seat={player.seat} disabled={disabled || !ownTurn || ownBoard} onClick={() => onChoose(player.seat)} aria-label={`${player.seat + 1}번 ${player.name}의 판${ownBoard ? ', 본인 판은 선택할 수 없어요' : ' 선택'}`}>
          <span className="board-choice-number">{String(player.seat + 1).padStart(2, '0')}<svg viewBox="0 0 48 44" fill="none" aria-hidden="true"><path d="M24 3 46 41H2L24 3ZM13 22h22M13 22l11 19 11-19M24 3v38" stroke="currentColor" strokeWidth="1.8"/></svg></span>
          <strong>{player.name}<small>의 판</small></strong>
          {view.scoringMode === 'transfer' && <span className="board-choice-balance" aria-label={`${player.name} 승점 코인 ${player.score}개`}>승점 코인 <b>{player.score}</b>개</span>}
          <span className="board-choice-label">{ownBoard ? <><LockKeyhole size={12}/>{ownTurn ? '내가 만든 판' : '본인이 만든 판'}</> : <><i/>{playerColor(player.seat).label}<ArrowRight size={14}/></>}</span>
        </button>;
      })}
    </div>
  </section>;
}
