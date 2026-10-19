import { ArrowRight, Coins } from 'lucide-react';
import type { RoomView } from '@/lib/contracts';
import { playerColorStyle } from '@/lib/player-colors';

export function VictoryWallet({ balance }: { balance: number }) {
  return <section className="victory-wallet" data-testid="victory-wallet" aria-label={`내 승점 코인 ${balance}개`}>
    <div><h2><Coins size={16}/>내 승점 코인</h2><strong>{balance}<small>개</small></strong></div>
    <p>다른 사람의 판을 완주하면 제작자에게서 1개를 가져와요. 라운드가 바뀌어도 유지됩니다.</p>
  </section>;
}

export function CoinTransfer({ view }: { view: RoomView }) {
  const result = view.winner;
  const winner = view.players.find(player => player.seat === result?.seat);
  const maker = view.players.find(player => player.seat === result?.ownerSeat);
  if (!result || !winner || !maker) return null;
  const amount = result.coinsTransferred ?? 0;
  return <section className="coin-transfer" data-testid="coin-transfer" data-from-seat={maker.seat} data-to-seat={winner.seat} data-amount={amount} aria-label={`승점 코인 이동 ${amount}개`}>
    <p className="coin-transfer-caption">{view.phase === 'finished' && '마지막 라운드 · '}{winner.name}님이 {maker.name}님의 판을 완주했어요.</p>
    <div className="coin-transfer-flow">
      <div className="coin-transfer-person player-color" style={playerColorStyle(maker.seat)}>
        <span>판 제작자</span><strong><i className="owner-swatch"/>{maker.name}</strong>
        <p aria-label={`제작자 승점 코인 ${maker.score + amount}개에서 ${maker.score}개`}><span>{maker.score + amount}</span><ArrowRight size={13}/><b>{maker.score}</b><small>개</small></p>
      </div>
      <div className="coin-transfer-arrow"><Coins size={21}/><span>{amount}개</span><ArrowRight size={22}/></div>
      <div className="coin-transfer-person player-color" style={playerColorStyle(winner.seat)}>
        <span>완주한 사람</span><strong><i className="owner-swatch"/>{winner.name}</strong>
        <p aria-label={`완주자 승점 코인 ${winner.score - amount}개에서 ${winner.score}개`}><span>{winner.score - amount}</span><ArrowRight size={13}/><b>{winner.score}</b><small>개</small></p>
      </div>
    </div>
    <p className="coin-transfer-note">{amount ? '제작자의 승점 코인 1개가 완주한 사람에게 이동했어요.' : '제작자의 승점 코인이 0개라 이번에는 코인 이동 없이 라운드를 마칩니다.'}</p>
  </section>;
}
