'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, NotebookPen, Plus, Trash2 } from 'lucide-react';
import type { GameAction, MemoEntry, MemoTarget, PeekEntry, RoomView } from '@/lib/contracts';
import { baseMemoSlots } from '@/lib/roles';
import { playerColor, playerColorStyle } from '@/lib/player-colors';
import { Board } from './board';
import { Modal } from './modal';
import styles from './memo-panel.module.css';

const memoStates = [
  { value: 'safe', symbol: '✓', label: '안전', description: '안전하다고 기억해요' },
  { value: 'mine', symbol: '!', label: '지뢰', description: '지뢰라고 기억해요' },
  { value: 'unsure', symbol: '?', label: '미확인', description: '아직 확신이 없어요' },
] as const;

function edgeDescription(edgeId: string) {
  return edgeId.split('~').map(node => {
    const [row, col] = node.split('-').map(Number);
    return `${row + 1}행 ${col + 1}열`;
  }).join(' ↔ ');
}

function targetKey(target: MemoTarget) { return `${target.playerId}:${target.slot}`; }

export function MemoPanel({ view, disabled, disabledReason, peekDisabled, onAction }: { view: RoomView; disabled: boolean; disabledReason?: string; peekDisabled?: boolean; onAction: (action: GameAction) => Promise<unknown> | void }) {
  // A draft belongs to its author and round, even as turns and boards change.
  return <MemoPanelContent key={`${view.code}:${view.round}:${view.selfId}`} view={view} disabled={disabled} disabledReason={disabledReason} peekDisabled={peekDisabled} onAction={onAction}/>;
}

function MemoPanelContent({ view, disabled, disabledReason, peekDisabled, onAction }: { view: RoomView; disabled: boolean; disabledReason?: string; peekDisabled?: boolean; onAction: (action: GameAction) => Promise<unknown> | void }) {
  const self = view.players.find(player => player.id === view.selfId);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<MemoEntry | null>(null);
  const [choosingPeek, setChoosingPeek] = useState(false);
  const [targets, setTargets] = useState<MemoTarget[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const capacity = view.memoCapacity ?? 0;
  const entries = view.selfMemos ?? [];
  const ownTurn = !!self && view.phase === 'playing' && view.activeSeat === self.seat;
  const canEdit = !disabled && !saving;
  const canPeek = ownTurn && canEdit && !peekDisabled && !view.event && view.blessingSeat === undefined && view.shiftSeat === undefined;
  const unavailable = disabled ? disabledReason ?? '연결을 다시 확인하고 있어요.' : '';
  const baseSlots = baseMemoSlots(view.playerCount);
  const peekable = view.peekableMemos ?? [];
  const selectedTargets = targets.filter(target => peekable.some(available => targetKey(available) === targetKey(target)));
  const ownerName = (id: string) => view.players.find(player => player.id === id)?.name ?? '알 수 없는 플레이어';
  const draftOwner = view.players.find(player => player.id === draft?.boardOwnerId);

  const turnScope = `${view.activeSeat}:${view.rotation}:${view.turnNumber}:${view.blessingSeat}:${view.shiftSeat}`;
  const [peekScope, setPeekScope] = useState(turnScope);
  // Reset only the private peek selection; a manually edited memo survives turns.
  if (peekScope !== turnScope) {
    setPeekScope(turnScope);
    setChoosingPeek(false);
    setTargets([]);
  }

  if (!self || view.phase !== 'playing') return null;

  function openEditor(slot: number) {
    setSaveError('');
    const fallbackOwner = view.players.find(player => player.seat === view.boardOwnerSeat) ?? self!;
    setDraft(entries[slot] ?? { boardOwnerId: fallbackOwner.id, edgeId: '', status: 'unsure' });
    setEditing(slot);
  }

  async function save(entry: MemoEntry | null) {
    if (!canEdit || editing === null) return;
    setSaving(true);
    try {
      const saved = await onAction({ type: 'memo', slot: editing, entry });
      if (saved === false) { setSaveError('저장되지 않았어요. 작성한 내용은 유지됩니다. 연결 상태를 확인하고 다시 시도해주세요.'); return; }
      setEditing(null);
      setDraft(null);
    } finally { setSaving(false); }
  }

  async function peek() {
    if (!canPeek || selectedTargets.length === 0 || selectedTargets.length > baseSlots) return;
    setSaving(true);
    // Close the selection dialog before the parent's private result dialog opens.
    setChoosingPeek(false);
    try { await onAction({ type: 'peek', targets: selectedTargets }); }
    finally { setSaving(false); setTargets([]); }
  }

  return <section className={styles.panel} id="my-memos" tabIndex={-1} data-testid="memo-panel" aria-label="내 메모">
    <div className={styles.heading}><h2><NotebookPen size={16}/>내 메모</h2><span>{entries.filter(Boolean).length} / {capacity}</span></div>
    {capacity === 0 ? <p className={styles.note}>2인 게임에서는 메모를 사용하지 않아요.</p> : <>
      <p className={styles.note}>차례와 관계없이 언제든 기록하고 고칠 수 있어요.<br/>내 차례에는 현재 판 위에도 표시됩니다.</p>
      {unavailable && <p className={styles.availability} role="status">{unavailable}</p>}
      <div className={styles.slots}>
        {Array.from({ length: capacity }, (_, slot) => {
          const entry = entries[slot];
          const status = memoStates.find(state => state.value === entry?.status);
          const owner = view.players.find(player => player.id === entry?.boardOwnerId);
          return <button type="button" className={styles.slot} key={slot} onClick={() => openEditor(slot)} disabled={!canEdit} aria-label={`메모 ${slot + 1}${entry ? `, ${ownerName(entry.boardOwnerId)}의 판, ${status?.label}, 수정` : ', 새로 기록'}`}>
            <span className={styles.slotNumber}>{String(slot + 1).padStart(2, '0')}</span>
            {entry ? <><span className={styles.slotContent}><strong>{owner && <span className="player-color player-color-dot" style={playerColorStyle(owner.seat)} aria-hidden="true"/>}{ownerName(entry.boardOwnerId)}의 판</strong><small>{owner ? `${owner.seat + 1}번 ${playerColor(owner.seat).label} · ` : ''}{edgeDescription(entry.edgeId)}</small></span><span className={styles.statusMark} aria-label={status?.label}>{status?.symbol}</span></> : <><span className={styles.empty}>빈 메모</span><Plus size={15}/></>}
          </button>;
        })}
      </div>
      <p className={styles.footnote}>메모는 나에게만 보여요. 지뢰가 옮겨져도 자동으로 바뀌지 않아요.</p>
    </>}
    {self.role === 'thief' && <div className={styles.peekAbility}>
      <button type="button" className="button button-outline full-width" disabled={!canPeek || !self.peeks || !baseSlots || !peekable.length} onClick={() => { setChoosingPeek(true); setTargets([]); }}><Eye size={16}/>메모 훔쳐보기<span>{self.peeks ?? 0}회</span></button>
      <p className={styles.footnote}>한 번에 다른 사람의 메모를 {baseSlots}개까지 골라 봐요.</p>
      {!ownTurn && <p className={styles.footnote}>훔쳐보기는 내 차례에만 사용할 수 있어요.</p>}
      {ownTurn && (self.peeks ?? 0) > 0 && baseSlots > 0 && peekable.length === 0 && <p className={styles.footnote}>아직 다른 사람이 작성한 메모가 없어요.</p>}
    </div>}

    {editing !== null && draft && <Modal title={`메모 ${editing + 1} 기록하기`} onClose={() => { if (!saving) setEditing(null); }} className={styles.editor}>
      <div className={styles.editorContent} data-testid="memo-editor-scroll">
      <p className={styles.intro}>판과 길을 골라 기억을 적어 두세요. 여기서는 말이 움직이지 않아요.</p>
      <label className={styles.ownerSelect}><span>어느 판인가요?</span><select aria-label="메모할 판" value={draft.boardOwnerId} disabled={!canEdit} onChange={event => setDraft({ ...draft, boardOwnerId: event.target.value, edgeId: '' })}>
        {view.players.map(player => <option key={player.id} value={player.id}>{player.seat + 1}번 {playerColor(player.seat).label} · {player.name}의 판{player.id === self.id ? ' (내가 만든 판)' : ''}</option>)}
      </select></label>
      <div className={styles.editorBoard} data-testid="memo-editor-board"><Board gridSize={view.gridSize} ownerSeat={draftOwner?.seat} selectedEdge={draft.edgeId} onEdge={edgeId => setDraft({ ...draft, edgeId })} allowBaseEdges easyEdgeSelection disabled={!canEdit} edgeActionLabel="메모할 길 선택" ariaLabel={`${ownerName(draft.boardOwnerId)}의 판 메모 편집. 기록할 선분을 선택하세요.`}/></div>
      <p className={styles.footnote}>정답을 확인하는 기능이 아니에요. 틀린 추측도 그대로 기록됩니다.</p>
      </div>
      <div className={styles.editorControls}>
      <p className={styles.selectedEdge} aria-live="polite">{draft.edgeId ? edgeDescription(draft.edgeId) : '판에서 기록할 선분 하나를 선택하세요.'}</p>
      <div className={styles.statuses} role="group" aria-label="기록할 상태">
        {memoStates.map(state => <button type="button" key={state.value} aria-pressed={draft.status === state.value} aria-label={state.description} disabled={!canEdit} onClick={() => setDraft({ ...draft, status: state.value })}><span>{state.symbol}</span>{state.label}</button>)}
      </div>
      {saveError && <p className="error-message" role="alert">{saveError}</p>}
      <div className={styles.editorActions}>
        <button type="button" className="button button-outline" disabled={!canEdit || !entries[editing]} onClick={() => void save(null)}><Trash2 size={15}/>비우기</button>
        <button type="button" className="button button-primary" disabled={!canEdit || !draft.edgeId} onClick={() => void save(draft)}><Check size={16}/>{saving ? '기록 중' : '기록하기'}</button>
      </div>
      </div>
    </Modal>}

    {choosingPeek && ownTurn && <Modal title="어떤 메모를 볼까요?" onClose={() => setChoosingPeek(false)} className={styles.peekDialog}>
      <p className={styles.intro}>최대 {baseSlots}개를 고를 수 있어요. 내용을 확인하면 훔쳐보기 1회를 사용합니다.</p>
      <div className={styles.peekPlayers}>
        {view.players.filter(player => player.id !== self.id).map(player => {
          const available = peekable.filter(target => target.playerId === player.id);
          if (!available.length) return null;
          return <fieldset key={player.id}><legend>{player.name}<span>{available.length}개의 메모</span></legend><div>{available.map(target => {
            const selected = selectedTargets.some(item => targetKey(item) === targetKey(target));
            return <button type="button" key={target.slot} aria-pressed={selected} disabled={!canPeek || (!selected && selectedTargets.length >= baseSlots)} onClick={() => setTargets(selected ? selectedTargets.filter(item => targetKey(item) !== targetKey(target)) : [...selectedTargets, target])}><span>메모 {target.slot + 1}</span>{selected ? <Check size={15}/> : <span aria-hidden="true">?</span>}</button>;
          })}</div></fieldset>;
        })}
        {!peekable.length && <p className={styles.note}>지금 확인할 수 있는 메모가 없어요.</p>}
      </div>
      <p className={styles.footnote}>다른 사람의 기억도 틀릴 수 있어요. 선택하기 전에는 메모 내용을 알 수 없어요.</p>
      <button type="button" className="button button-primary full-width" disabled={!canPeek || !selectedTargets.length} onClick={() => void peek()}><Eye size={16}/>{selectedTargets.length}개 확인 · 1회 사용</button>
    </Modal>}
  </section>;
}

export function PeekResultView({ view, entries, onClose }: { view: RoomView; entries: PeekEntry[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const entry = entries[Math.min(index, entries.length - 1)];
  if (!entry) return null;
  const author = view.players.find(player => player.id === entry.playerId);
  const owner = view.players.find(player => player.id === entry.boardOwnerId);
  const status = memoStates.find(state => state.value === entry.status)!;

  return <Modal title="잠깐 빌려 본 기억" onClose={onClose} className={styles.peekDialog}>
    <div data-testid="peek-result">
      <p className={styles.intro}>{author?.name ?? '플레이어'}의 메모 {entry.slot + 1}</p>
      <div className={styles.resultHeading}><strong>{owner && <span className="player-color player-color-dot" style={playerColorStyle(owner.seat)} aria-hidden="true"/>}{owner?.name ?? '플레이어'}의 판{owner ? ` · ${owner.seat + 1}번 ${playerColor(owner.seat).label}` : ''}</strong><span className={styles.resultStatus}>{status.symbol} {status.label}로 기록</span></div>
      <div className={styles.editorBoard}><Board gridSize={view.gridSize} ownerSeat={owner?.seat} memoMarks={[entry]} memoLabel="훔쳐본 메모" disabled ariaLabel={`${owner?.name ?? '플레이어'}의 판에 남긴 메모. ${status.label}라는 추측입니다.`}/></div>
      <p className={styles.selectedEdge}>{edgeDescription(entry.edgeId)}</p>
      {entries.length > 1 && <div className={styles.resultPaging}><button type="button" aria-label="이전 메모" className="icon-button" disabled={index === 0} onClick={() => setIndex(index - 1)}><ArrowLeft size={18}/></button><span>{index + 1} / {entries.length}</span><button type="button" aria-label="다음 메모" className="icon-button" disabled={index >= entries.length - 1} onClick={() => setIndex(index + 1)}><ArrowRight size={18}/></button></div>}
      <p className={styles.resultWarning}>다른 사람이 적은 추측이며, 정답을 보장하지 않아요.<br/>닫으면 사라져요. 기억한 내용은 내 메모에 직접 옮길 수 있어요.</p>
      <button type="button" className="button button-primary full-width" onClick={onClose}>기억했어요. 닫기<Check size={16}/></button>
    </div>
  </Modal>;
}
