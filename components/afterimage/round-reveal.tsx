'use client';

import { useId, useState } from 'react';
import type { RoomView } from '@/lib/contracts';
import { playerColor, playerColorStyle } from '@/lib/player-colors';
import { Board } from './board';
import styles from './round-reveal.module.css';

export function RoundReveal({ view }: { view: RoomView }) {
  const headingId = useId();
  const roundKey = `${view.code}:${view.round}`;
  const revealedOwners = view.players.filter(player => Object.hasOwn(view.revealedBoards ?? {}, player.id));
  const defaultOwner = revealedOwners.find(player => player.seat === view.boardOwnerSeat) ?? revealedOwners[0];
  const [selection, setSelection] = useState({ roundKey, ownerId: defaultOwner?.id });
  const selectedOwner = selection.roundKey === roundKey
    ? revealedOwners.find(player => player.id === selection.ownerId) ?? defaultOwner
    : defaultOwner;

  if ((view.phase !== 'roundEnd' && view.phase !== 'finished') || !view.revealedBoards || !selectedOwner) return null;

  const mines = view.revealedBoards[selectedOwner.id];
  const allRevealed = revealedOwners.length === view.players.length;
  const nextRebuilder = view.placementMode === 'retained' && (view.winner?.coinsTransferred ?? 0) > 0
    ? view.players.find(player => player.seat === view.winner?.ownerSeat)
    : undefined;

  return <section className={styles.reveal} data-testid="round-reveal" aria-labelledby={headingId}>
    <div className={styles.heading}>
      <h2 id={headingId}>{view.phase === 'finished' ? '모든 판의 정답' : '이번 라운드 정답'}</h2>
      <p>{allRevealed ? '모두의 지뢰 위치가 공개됐어요. 이름을 눌러 각 판을 확인해 보세요.' : '이번에 정상에 도착한 판의 지뢰 위치만 공개해요. 다른 판의 배치는 그대로 숨겨집니다.'}</p>
    </div>

    <div className={styles.owners} role="group" aria-label="정답을 확인할 판 선택">
      {revealedOwners.map(player => <button
        type="button"
        key={player.id}
        style={playerColorStyle(player.seat)}
        aria-label={`${player.name}의 판 보기, ${player.seat + 1}번 자리 ${playerColor(player.seat).label}`}
        aria-pressed={player.id === selectedOwner.id}
        onClick={() => setSelection({ roundKey, ownerId: player.id })}
      >
        <span className={styles.seat}>{player.seat + 1}</span>
        <span className={styles.name}>{player.name}</span>
        {player.id === view.selfId && <small>나</small>}
      </button>)}
    </div>

    <div className={styles.board} style={playerColorStyle(selectedOwner.seat)} data-testid="revealed-board" role="region" aria-label={`${selectedOwner.name}의 판 정답`}>
      <div className={styles.boardHeading} aria-live="polite" aria-atomic="true">
        <h3>{selectedOwner.name}<span>의 판 · {selectedOwner.seat + 1}번 {playerColor(selectedOwner.seat).label}</span></h3>
        <span className={styles.count}>지뢰 <b>{mines.length}</b>개</span>
      </div>
      <Board gridSize={view.gridSize} ownerSeat={selectedOwner.seat} mines={mines} disabled/>
      <div className={styles.legend}>
        <span><i className={styles.mineMark} aria-hidden="true">×</i>지뢰가 있는 길</span>
        <span><i className={styles.safeMark} aria-hidden="true"/>안전한 길</span>
      </div>
    </div>

    {view.phase === 'roundEnd' && <p className={styles.note} data-testid="next-rebuild-notice" data-rebuild-seat={view.placementMode === 'retained' ? nextRebuilder?.seat ?? 'none' : 'all'}>{view.placementMode !== 'retained'
      ? '다음 라운드에서는 모두 지뢰를 새로 배치해요.'
      : nextRebuilder
        ? `다음 라운드에는 승점 코인을 잃은 ${nextRebuilder.name}님만 판을 다시 배치해요. 다른 판의 지뢰와 위장 위치는 그대로 유지됩니다.`
        : '이번에는 승점 코인이 이동하지 않아 다음 라운드에도 모든 판의 지뢰와 위장 위치를 그대로 유지해요.'}</p>}
  </section>;
}
