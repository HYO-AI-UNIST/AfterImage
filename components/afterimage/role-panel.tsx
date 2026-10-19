'use client';

import { useState } from 'react';
import { ArrowRight, ArrowRightLeft, Shield, Sparkles } from 'lucide-react';
import { Board } from './board';
import { Modal } from './modal';
import { MAX_MINE_SHIFTS, remainingMineShifts, ROLE_DETAILS, ROLE_IDS } from '@/lib/roles';
import { hasSafePath } from '@/lib/geometry';
import type { GameAction, RoleId, RoomView } from '@/lib/contracts';

export function RolePanel({ view, onOpen, onChooseRole, disabled }: { view: RoomView; onOpen: (role: RoleId) => void; onChooseRole: (role: RoleId) => unknown; disabled: boolean }) {
  const self = view.players.find(player => player.id === view.selfId);
  if (!self || (!self.role && !view.rolesEnabled)) return null;
  const info = self.role ? ROLE_DETAILS[self.role] : null;
  const choices = view.playerCount === 2 ? ROLE_IDS.filter(role => role !== 'thief' && role !== 'recorder') : ROLE_IDS;
  const resources = <>
    {self.role === 'guardian' && <div className="role-resource"><Shield size={14}/><span>남은 가호</span><b>{self.blessings ?? 0} / 2</b></div>}
    {self.role === 'thief' && <div className="role-resource"><Sparkles size={14}/><span>남은 훔쳐보기</span><b>{self.peeks ?? 0} / 2</b></div>}
    {self.role === 'shifter' && <div className="role-resource" data-testid="shift-resource"><ArrowRightLeft size={14}/><span>남은 이동</span><b>{remainingMineShifts(self)} / {MAX_MINE_SHIFTS}</b></div>}
  </>;
  if (view.phase === 'placing') return <section className="role-panel role-panel-placement" data-testid="role-panel" data-role={self.role} aria-labelledby="placement-role-heading">
    <h1 className="placement-page-title">라운드 {view.round} 준비</h1>
    <div className="placement-role-heading"><h2 id="placement-role-heading"><span>01</span>특수 능력 선택</h2><button className="placement-role-guide" onClick={() => onOpen(self.role ?? choices[0])}>능력 살펴보기<ArrowRight size={16}/></button></div>
    <div className="placement-role-content">
      <div>
        {self.ready ? <div className="placement-role-selected"><span>선택 완료</span><strong>{info?.name}</strong></div> : <label className="demo-role-picker placement-role-picker"><span>이번 라운드의 능력 <small>필수</small></span><select aria-label="내 특수 능력 선택" aria-describedby="placement-role-help" required disabled={disabled} value={self.role ?? ''} onChange={event => void onChooseRole(event.target.value as RoleId)}><option value="" disabled>사용할 능력을 선택하세요</option>{choices.map(role => <option key={role} value={role}>{ROLE_DETAILS[role].name}</option>)}</select></label>}
        <p className="placement-role-help" id="placement-role-help">{self.ready ? '준비를 완료했어요. 모두 준비하면 탐색을 시작합니다.' : self.role ? '준비 완료 전까지 바꿀 수 있어요. 중복 선택도 가능합니다.' : '능력을 선택한 뒤 이번 라운드의 준비를 완료하세요.'}</p>
      </div>
      <div className="placement-role-effect" aria-live="polite"><span>{info ? '능력 효과' : '어떤 능력으로 길을 찾을까요?'}</span><p>{info?.description ?? `힌트를 더 받거나, 실패 후 다시 출발하거나. ${choices.length}가지 능력을 살펴보고 이번 라운드의 전략을 정하세요.`}</p>{resources}</div>
    </div>
  </section>;
  return <section className="role-panel" data-testid="role-panel" data-role={self.role} aria-label="내 특수 능력">
    <span className="eyebrow">이번 라운드의 능력</span>
    {info ? <><button className="role-title" onClick={() => onOpen(self.role!)}><strong>{info.name}</strong><ArrowRight size={15}/></button><p>{info.description}</p></> : <p>이번 판에서 사용할 특수 능력을 골라주세요. 다른 사람과 같은 능력도 선택할 수 있어요.</p>}
    {resources}
  </section>;
}

export function BlessingChoice({ disabled, remaining, message, onAction }: { disabled: boolean; remaining: number; message?: string; onAction: (action: GameAction) => unknown }) {
  return <Modal title="가호로 다시 출발할까요?" className="blessing-modal"><section className="ability-choice" data-testid="blessing-choice" aria-label="가호 사용 선택">
    <div className="blessing-balance" data-testid="blessing-remaining"><Shield size={21}/><span>남은 가호</span><strong>{remaining}<small> / 2개</small></strong></div>
    <p>가호 1개를 쓰면 같은 차례에, 같은 판의 밑변에서 다시 시작합니다. 지뢰는 그대로 남아 있어요.</p>
    {message && <p className="error-message" role="alert">{message}</p>}
    <button className="button button-primary full-width" disabled={disabled} onClick={() => void onAction({ type: 'blessing', use: true })}>가호로 다시 출발 <small>−1</small></button>
    <button className="button button-outline full-width" disabled={disabled} onClick={() => void onAction({ type: 'blessing', use: false })}>가호를 아끼고 차례 넘기기</button>
  </section></Modal>;
}

export function MineShift({ view, disabled, onAction }: { view: RoomView; disabled: boolean; onAction: (action: GameAction) => unknown }) {
  const [from, setFrom] = useState<string>();
  const [to, setTo] = useState<string>();
  const self = view.players.find(player => player.id === view.selfId);
  const remaining = self ? remainingMineShifts(self) : 0;
  const mines = view.shiftMines ?? [];
  const preview = from && to ? mines.map(edge => edge === from ? to : edge) : mines;
  const valid = remaining > 0 && !!from && !!to && hasSafePath(preview, view.gridSize);
  const select = (edge: string) => {
    if (disabled || remaining <= 0) return;
    if (mines.includes(edge)) { setFrom(edge === from ? undefined : edge); setTo(undefined); }
    else if (from) setTo(edge);
  };
  return <section className="mine-shift" data-testid="mine-shift" aria-label="내 판 지뢰 이동">
    <div className="field-heading"><h2>도전 전에 내 판을 바꿀까요?</h2><div className="board-mine-count" data-testid="board-mine-count" aria-label={`이 판의 총 지뢰 ${mines.length}개`}><span>총 지뢰</span><strong>{mines.length}<small>개</small></strong></div></div>
    <div className="role-resource" data-testid="shift-remaining"><ArrowRightLeft size={14}/><span>남은 이동</span><b>{remaining} / {MAX_MINE_SHIFTS}</b></div>
    <p>{remaining <= 0 ? '이번 라운드의 이동 기회를 모두 사용했어요. 이번 이동을 건너뛰세요.' : !mines.length ? '옮길 지뢰가 없어요. 이번 이동을 건너뛰세요.' : !from ? '옮길 지뢰 하나를 선택하세요.' : !to ? '지뢰가 없는 도착 선분을 선택하세요.' : valid ? '이 위치로 옮겨도 정상까지 안전한 길이 남습니다.' : '안전한 길이 막혀요. 다른 위치를 선택하세요.'}</p>
    <Board ownerSeat={self?.seat} gridSize={view.gridSize} mines={preview} selectedEdge={from && !to ? from : to} onEdge={select} disabled={disabled || remaining <= 0} edgeActionLabel="지뢰 이동 위치 선택" ariaLabel="내 판 지뢰 이동: 지뢰와 빈 선분을 차례로 선택하세요."/>
    <div className="shift-actions"><button className="button button-outline" disabled={disabled} onClick={() => void onAction({ type: 'shiftMine' })}>이번에는 건너뛰기</button><button className="button button-primary" disabled={disabled || !valid} onClick={() => void onAction({ type: 'shiftMine', fromEdgeId: from, toEdgeId: to })}>옮기고 판 선택 <small>−1</small><ArrowRight size={15}/></button></div>
    <p className="shift-note">지뢰를 옮길 때만 1회를 사용합니다. 건너뛰면 횟수를 쓰지 않아요. 지뢰 수와 다른 사람의 메모는 그대로입니다.</p>
  </section>;
}
