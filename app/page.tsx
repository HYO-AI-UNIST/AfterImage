'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, BookOpen, Check, ChevronRight, Coins, Copy, Crown, DoorOpen, Eye, Flag, LoaderCircle, LockKeyhole, NotebookPen, Play, Plus, RotateCcw, Shuffle, Search, Users, X } from 'lucide-react';
import { Board } from '@/components/afterimage/board';
import { BoardChoice } from '@/components/afterimage/board-choice';
import { CoinTransfer, VictoryWallet } from '@/components/afterimage/victory-coins';
import { playerColor, playerColorStyle } from '@/lib/player-colors';
import { PlayExample } from '@/components/afterimage/play-example';
import { Modal } from '@/components/afterimage/modal';
import { ThemeSwitcher } from '@/components/afterimage/theme-switcher';
import { RoomSettingsPanel } from '@/components/afterimage/room-settings';
import { RoundReveal } from '@/components/afterimage/round-reveal';
import { RetainedBoard } from '@/components/afterimage/retained-board';
import { CharacterGallery } from '@/components/afterimage/character-gallery';
import { MemoPanel, PeekResultView } from '@/components/afterimage/memo-panel';
import { RolePanel, BlessingChoice, MineShift } from '@/components/afterimage/role-panel';
import { ROLE_DETAILS, roundHintCoins } from '@/lib/roles';
import { DEFAULT_ROOM_SETTINGS } from '@/lib/settings';
import { viewFor } from '@/lib/game';
import { getBoard, hasSafePath, maxMines, randomBoard } from '@/lib/geometry';
import { createDemo, tickDemo, demoAction, DEMO_SELF_ID } from '@/lib/demo';
import type { ApiReply, GameAction, GameState, PrivateResult, RoomView, RoomSettings, RoleId, PeekEntry } from '@/lib/contracts';

const SESSION_KEY = 'mindminer.membership.v1';
type Session = { code: string; token: string };
type Hint = PrivateResult & { round: number; seat: number; code: string; selfId: string; rotation: number; ownerSeat: number; turnNumber?: number };

function Mark({ small = false }: { small?: boolean }) {
  return <svg width={small ? 25 : 34} height={small ? 27 : 36} viewBox="0 0 36 38" fill="none" aria-hidden="true"><path d="M18 3 34 32H2L18 3Z" stroke="currentColor" strokeWidth="1.6"/><path d="M18 3v19L2 32m16-10 16 10M10 17h16M10 17l8 15 8-15" stroke="currentColor" strokeWidth="1.3"/><circle cx="18" cy="22" r="2.5" fill="currentColor"/></svg>;
}
function CoinsDisplay({ count, total }: { count: number; total: number }) {
  if (!total) return null;
  return <div className="coin-row" aria-label={`남은 힌트 코인 ${count}개`}>{Array.from({ length: total }, (_, index) => <span className={`coin ${index >= count ? 'coin-spent' : ''}`} key={index}></span>)}</div>;
}
function Avatar({ name, seat }: { name: string; seat: number }) {
  return <span className="avatar player-color" style={playerColorStyle(seat)} aria-label={`${seat + 1}번 자리, ${playerColor(seat).label}, ${name}`}>{String(seat + 1).padStart(2, '0')}</span>;
}

export default function Home() {
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<RoomView | null>(null);
  const viewRef = useRef<RoomView | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [savedSession, setSavedSession] = useState<Session | null>(null);
  const [demo, setDemo] = useState(false);
  const demoRef = useRef<GameState | null>(null);
  const sessionGeneration = useRef(0);
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [rules, setRules] = useState(false);
  const [characters, setCharacters] = useState<RoleId | 'all' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [concealed, setConcealed] = useState<string[]>([]);
  const [concealMode, setConcealMode] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<RoomSettings>(DEFAULT_ROOM_SETTINGS);
  const [hintMode, setHintMode] = useState(false);
  const [hint, setHint] = useState<Hint | null>(null);
  const [peek, setPeek] = useState<{ entries: PeekEntry[]; code: string; selfId: string; round: number; seat: number; rotation: number; turnNumber?: number } | null>(null);
  const [toast, setToast] = useState('');
  const [clock, setClock] = useState(0);
  const serverOffset = useRef(0);

  const accept = useCallback((next: RoomView) => {
    const previous = viewRef.current;
    if (previous && previous.code === next.code && previous.selfId === next.selfId && previous.revision > next.revision) return;
    serverOffset.current = next.serverNow - Date.now();
    viewRef.current = next;
    setView(next);
  }, []);

  useEffect(() => {
    setHydrated(true);
    const requested = new URLSearchParams(window.location.search).get('room');
    if (requested) {setCode(requested.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6)); setTab('join');}
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Session;
        if (typeof saved.code === 'string' && typeof saved.token === 'string') {
          setSavedSession(saved);
          if (!requested || requested.toUpperCase() === saved.code) {setSession(saved); setRestoring(true);}
        }
      }
    } catch { /* Private browsing still supports nonpersistent sessions. */ }
  }, []);

  useEffect(() => {
    if (!session || demo) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`/api/rooms/${session.code}`, { headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', signal: controller.signal });
        const data = await response.json() as ApiReply & { error?: string };
        if (cancelled) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 404) {
            sessionGeneration.current += 1;
            busyRef.current = false; setBusy(false);
            setSession(null); setView(null); viewRef.current = null;
            setHint(null); setHintMode(false); setDraft([]); setConnection('');
            setSavedSession(previous => previous?.code === session.code && previous.token === session.token ? null : previous);
            try {
              const stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
              if (stored?.code === session.code && stored.token === session.token) localStorage.removeItem(SESSION_KEY);
            } catch { /* The expired membership is already cleared in memory. */ }
            setError(data.error ?? '저장된 방에 다시 연결할 수 없습니다. 새 방을 만들거나 초대 코드로 참가해주세요.');
            setRestoring(false); return;
          }
          throw new Error(data.error ?? '방 연결을 확인하고 있어요.');
        }
        accept(data.view); setConnection(''); setRestoring(false);
      } catch (failure) {
        if (!cancelled) {setConnection('연결을 다시 확인하고 있어요. 잠시 후 자동으로 재시도합니다.'); setRestoring(false);}
      }
      if (!cancelled) timeout = setTimeout(poll, viewRef.current?.phase === 'playing' ? 350 : 1000);
    };
    void poll();
    return () => {cancelled = true; controller.abort(); clearTimeout(timeout);};
  }, [session, demo, accept]);

  useEffect(() => {
    if (!demo) return;
    const timer = setInterval(() => {
      if (!demoRef.current) return;
      const before = demoRef.current;
      const next = tickDemo(before, Date.now());
      demoRef.current = next;
      if (next.revision !== viewRef.current?.revision) accept(viewFor(next, DEMO_SELF_ID, Date.now()));
    }, 250);
    return () => clearInterval(timer);
  }, [demo, accept]);

  useEffect(() => {
    if (!view?.event) return;
    const timer = setInterval(() => setClock(Date.now()), 150);
    return () => clearInterval(timer);
  }, [view?.event]);
  useEffect(() => {
    setHint(null); setHintMode(false); setPeek(null);
  }, [view?.code, view?.selfId, view?.round, view?.activeSeat, view?.phase, view?.rotation, view?.turnNumber, view?.boardOwnerSeat, view?.shiftSeat, view?.blessingSeat]);
  useEffect(() => {setDraft(view?.phase === 'placing' ? view.ownMines ?? [] : []);}, [view?.round, view?.selfId, view?.phase]);
  useEffect(() => {setConcealed(view?.phase === 'placing' ? view.ownConcealed ?? [] : []); setConcealMode(false);}, [view?.round, view?.selfId, view?.phase]);
  useEffect(() => {
    if (view?.phase === 'waiting') setSettingsDraft({ playerCount: view.playerCount, hintCoins: view.hintCoins, totalRounds: view.totalRounds, gridSize: view.gridSize });
  }, [view?.code, view?.selfId, view?.phase, view?.playerCount, view?.hintCoins, view?.totalRounds, view?.gridSize]);
  useEffect(() => {if (toast) {const timer = setTimeout(() => setToast(''), 2600);return () => clearTimeout(timer);}}, [toast]);

  const persist = (membership: Session) => {
    setSavedSession(membership);
    try {localStorage.setItem(SESSION_KEY, JSON.stringify(membership));} catch { /* Membership is kept in memory if storage is unavailable. */ }
  };
  const enterRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busyRef.current || !name.trim()) return;
    busyRef.current = true; setBusy(true); setError('');
    const generation = sessionGeneration.current;
    try {
      const response = await fetch(tab === 'create' ? '/api/rooms' : `/api/rooms/${code.trim().toUpperCase()}/join`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: name.trim()})});
      const data = await response.json() as ApiReply & {error?: string};
      if (generation !== sessionGeneration.current) return;
      if (!response.ok || !data.token) throw new Error(data.error ?? '방에 입장하지 못했습니다. 다시 시도해주세요.');
      const membership = {code: data.view.code, token: data.token};
      viewRef.current = null; setDemo(false); demoRef.current = null; accept(data.view); persist(membership); setSession(membership); setConnection(''); setDraft([]);
    } catch (failure) {if (generation === sessionGeneration.current) setError(failure instanceof Error ? failure.message : '네트워크 연결을 확인해주세요.');}
    finally {if (generation === sessionGeneration.current) {busyRef.current = false; setBusy(false);}}
  };
  const startDemo = (role?: RoleId) => {
    sessionGeneration.current += 1;
    const state = createDemo(role);
    demoRef.current = state; viewRef.current = null;
    setSession(null); setDemo(true); setError(''); setConnection(''); setDraft([]); setConcealed([]); setConcealMode(false); setHint(null); setPeek(null); setHintMode(false); accept(viewFor(state, DEMO_SELF_ID, Date.now()));
  };
  const act = async (action: GameAction) => {
    if (busyRef.current || !viewRef.current) return false;
    busyRef.current = true; setBusy(true); setError('');
    const at = viewRef.current;
    const generation = sessionGeneration.current;
    const showHint = (result: PrivateResult) => {
      const current = viewRef.current;
      if (generation !== sessionGeneration.current || !current || current.code !== at.code || current.selfId !== at.selfId || current.phase !== 'playing' || current.round !== at.round || current.activeSeat !== at.activeSeat || current.rotation !== at.rotation || current.turnNumber !== at.turnNumber || current.boardOwnerSeat !== at.boardOwnerSeat) return;
      setHint({...result, round: at.round, seat: at.activeSeat, code: at.code, selfId: at.selfId, rotation: at.rotation, ownerSeat: at.boardOwnerSeat, turnNumber: at.turnNumber}); setHintMode(false);
    };
    const showPeek = (entries: PeekEntry[]) => {
      const current = viewRef.current;
      if (generation !== sessionGeneration.current || !current || current.code !== at.code || current.selfId !== at.selfId || current.phase !== 'playing' || current.round !== at.round || current.activeSeat !== at.activeSeat || current.rotation !== at.rotation || current.turnNumber !== at.turnNumber) return;
      setPeek({ entries, code: at.code, selfId: at.selfId, round: at.round, seat: at.activeSeat, rotation: at.rotation, turnNumber: at.turnNumber });
      setHintMode(false);
    };
    try {
      if (demo && demoRef.current) {
        const result = demoAction(demoRef.current, action, Date.now());
        demoRef.current = result.state; accept(viewFor(result.state, DEMO_SELF_ID, Date.now()));
        if (result.privateResult) showHint(result.privateResult);
        if (result.peekResult) showPeek(result.peekResult);
      } else if (session) {
        let response: Response;
        let data: ApiReply & {error?: string};
        let revision = at.revision;
        for (let attempt = 0; ; attempt++) {
          response = await fetch(`/api/rooms/${session.code}/actions`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${session.token}`}, body: JSON.stringify({action, revision})});
          data = await response.json() as ApiReply & {error?: string};
          if (generation !== sessionGeneration.current) return;
          if (response.ok) break;
          // A new arrival can race a host control. Refresh before retrying the
          // same choice; private hints and board actions are never retried.
          if ((action.type === 'settings' || action.type === 'seat' || action.type === 'start') && response.status === 409) {
            const refreshed = await fetch(`/api/rooms/${session.code}`, { headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store' });
            if (generation !== sessionGeneration.current) return;
            if (refreshed.ok) {
              const current = await refreshed.json() as ApiReply;
              if (generation !== sessionGeneration.current) return;
              accept(current.view);
              const sameSetup = current.view.playerCount === at.playerCount
                && current.view.hintCoins === at.hintCoins
                && current.view.totalRounds === at.totalRounds
                && current.view.gridSize === at.gridSize
                && current.view.players.map(player => player.id).join(',') === at.players.map(player => player.id).join(',');
              // Audience arrivals must not interrupt Start, but a changed
              // lineup or rule still needs the host to review the fresh lobby.
              if (attempt < 2 && current.view.phase === 'waiting' && current.view.revision !== revision && (action.type !== 'start' || sameSetup)) {
                revision = current.view.revision;
                continue;
              }
            }
          }
          throw new Error(data.error ?? '요청을 처리하지 못했습니다. 다시 시도해주세요.');
        }
        accept(data.view);
        if (data.privateResult) showHint(data.privateResult);
        if (data.peekResult) showPeek(data.peekResult);
      }
      if (action.type === 'place') {setDraft([]); setConcealed([]); setConcealMode(false);}
      if (action.type === 'chooseRole') {setConcealed(action.role === 'trapper' ? viewRef.current?.ownConcealed ?? [] : []); setConcealMode(false);}
      return true;
    } catch (failure) {
      if (generation === sessionGeneration.current) {
        setError(failure instanceof Error ? failure.message : '요청을 처리하지 못했습니다.');
        const current = viewRef.current;
        if (action.type === 'settings' && current) setSettingsDraft({ playerCount: current.playerCount, hintCoins: current.hintCoins, totalRounds: current.totalRounds, gridSize: current.gridSize });
      }
      return false;
    }
    finally {if (generation === sessionGeneration.current) {busyRef.current = false; setBusy(false);}}
  };
  const leave = () => {
    sessionGeneration.current += 1;
    busyRef.current = false; setBusy(false);
    setLeaving(false); setDemo(false); demoRef.current = null; setSession(null); setView(null); viewRef.current = null; setHint(null); setHintMode(false); setDraft([]); setError(''); setConnection('');
    setPeek(null); setConcealed([]); setConcealMode(false);
  };
  const copyLink = async () => {
    if (!view) return;
    const link = new URL(window.location.href); link.search = ''; link.hash = ''; link.searchParams.set('room', view.code);
    try {await navigator.clipboard.writeText(link.toString()); setToast('초대 링크를 복사했어요. 친구에게 보내주세요.');}
    catch {setToast(`방 코드 ${view.code}를 친구에게 알려주세요.`);}
  };

  const self = view?.players.find(player => player.id === view.selfId);
  const active = view?.players.find(player => player.seat === view.activeSeat);
  const owner = view?.players.find(player => player.seat === view.boardOwnerSeat);
  const ownTurn = !!view && view.phase === 'playing' && active?.id === view.selfId;
  const serverNow = Math.max(clock, Date.now()) + serverOffset.current;
  const event = view?.event && view.event.until > serverNow ? view.event : null;
  const endingTurn = view?.event?.type === 'explosion';
  const nextSeat = view ? (view.activeSeat + 1) % view.playerCount : 0;
  const nextPlayer = view?.players.find(player => player.seat === nextSeat);
  const rotationNext = !!view && view.boardMode !== 'choice' && nextSeat === view.starterSeat;
  const transitionSeconds = endingTurn ? Math.max(0, Math.ceil((view.event!.until - serverNow) / 1000)) : 0;
  const specialDecision = view?.blessingSeat !== undefined || view?.shiftSeat !== undefined;
  const choosingBoard = view?.phase === 'playing' && view.boardMode === 'choice' && view.boardOwnerSeat < 0;
  const canTakeTurnAction = ownTurn && !view?.event && !specialDecision && !busy && !hint && !peek && !connection;
  const canAct = canTakeTurnAction && !choosingBoard;
  const myBlessing = !!self && view?.blessingSeat === self.seat;
  const myShift = !!self && view?.shiftSeat === self.seat;
  const shiftPlayer = view?.players.find(player => player.seat === view.shiftSeat);
  const totalHints = view ? roundHintCoins(view.hintCoins, self?.role) : 0;
  const grid = getBoard(view?.gridSize ?? 4);
  const available = view?.position ? grid.edges.filter(edge => edge.a === view.position || edge.b === view.position).map(edge => edge.a === view.position ? edge.b : edge.a) : grid.starts;
  const safe = hasSafePath(draft, view?.gridSize ?? 4);
  const mineLimit = maxMines(view?.gridSize ?? 4);
  const placedCount = self?.ready ? view?.ownMines?.length ?? 0 : draft.length;
  const privateHint = hint && view?.phase === 'playing' && hint.round === view.round && hint.seat === view.activeSeat && hint.code === view.code && hint.selfId === view.selfId && hint.rotation === view.rotation && hint.turnNumber === view.turnNumber && hint.ownerSeat === view.boardOwnerSeat && ownTurn ? hint : null;
  const privatePeek = peek && view?.phase === 'playing' && peek.round === view.round && peek.seat === view.activeSeat && peek.code === view.code && peek.selfId === view.selfId && peek.rotation === view.rotation && peek.turnNumber === view.turnNumber && ownTurn ? peek.entries : null;
  const memoMarks = ownTurn && !specialDecision ? (view?.selfMemos ?? []).filter(entry => entry?.boardOwnerId === owner?.id).flatMap(entry => entry ? [{edgeId: entry.edgeId, status: entry.status}] : []) : [];
  const host = view?.selfId === view?.hostId;
  const winner = view?.players.find(player => player.seat === view.winner?.seat);
  const transferScoring = view?.scoringMode === 'transfer';
  const currentPhase = view?.phase;
  const spectator = !!view && !self;
  const placingParticipant = currentPhase === 'placing' && !!self;
  const keepingBoard = placingParticipant && view?.placementMode === 'retained' && !view.rebuildSeats?.includes(self.seat);
  const canPlace = placingParticipant && !keepingBoard;
  useEffect(() => {
    if (placingParticipant) window.scrollTo(0, 0);
  }, [placingParticipant, view?.code, view?.selfId, view?.round]);
  useEffect(() => {
    if (choosingBoard && ownTurn && !specialDecision && !document.querySelector('dialog[open]')) document.getElementById('board-choice')?.scrollIntoView({ block: 'start' });
  }, [choosingBoard, ownTurn, specialDecision, view?.turnNumber]);
  const settingsChanged = !!view && (settingsDraft.playerCount !== view.playerCount || settingsDraft.hintCoins !== view.hintCoins || settingsDraft.totalRounds !== view.totalRounds || settingsDraft.gridSize !== view.gridSize);
  const lobbyCount = host ? settingsDraft.playerCount : view?.playerCount ?? 6;
  // Preview the same ordered seating rules while an automatic save is in flight.
  const addedSeats = view && lobbyCount > view.playerCount ? Math.min(lobbyCount - view.players.length, view.spectators.length) : 0;
  const lobbyPlayers = view ? [...view.players.slice(0, lobbyCount), ...view.spectators.slice(0, addedSeats).map((person, index) => ({ ...person, seat: view.players.length + index }))] : [];
  const lobbyWaiting = view ? [...view.spectators.slice(addedSeats), ...view.players.slice(lobbyCount)] : [];
  const changeSettings = (settings: RoomSettings) => {
    if (busyRef.current) return;
    setSettingsDraft(settings);
    void act({ type: 'settings', settings });
  };

  const preparingAbility = currentPhase === 'placing' && !spectator && !!view?.rolesEnabled;
  const FieldHeading = preparingAbility ? 'h2' : 'h1';

  return <main data-hydrated={hydrated} data-phase={view?.phase ?? 'home'} className={`afterimage ${view ? 'in-game' : 'on-home'}`}>
    <header className="site-header">
      <button className="brand" onClick={() => view ? setLeaving(true) : window.scrollTo({top: 0, behavior: 'smooth'})} aria-label="잔상 홈"><Mark/><span>잔상</span></button>
      <nav className="header-nav"><ThemeSwitcher/><button className="text-button rules-button" aria-label="플레이 방법" onClick={() => setRules(true)}><BookOpen size={16}/><span>플레이 방법</span></button>{view && <button className="icon-button exit-button" onClick={() => setLeaving(true)} aria-label="홈으로 나가기"><DoorOpen size={19}/></button>}</nav>
    </header>

    {!view ? <>
      <section className="home-table" aria-label="잔상 게임 입장">
        <div className="home-intro">
          <p className="home-kicker">기억 전략 보드게임</p>
          <h1>잔상</h1>
          <p className="home-description">각자의 판에 지뢰를 숨기고, 서로의 판을 건넙니다.<br/>지나간 길을 기억해 정상에 먼저 도착하세요.</p>
          <dl className="home-facts"><div><dt>플레이어</dt><dd>2–6명</dd></div><div><dt>플레이 방식</dt><dd>온라인 · 관전 가능</dd></div></dl>
        </div>
        <div className="home-board">
          <PlayExample onShowAbilities={() => setCharacters('all')}/>
        </div>
        <div className="home-entry">
          <div className="entry-panel">
            <div className="entry-tabs" role="tablist" aria-label="게임 참가 방식"><button role="tab" aria-selected={tab === 'create'} onClick={() => {setTab('create');setError('');}} className={tab === 'create' ? 'selected' : ''}>방 만들기</button><button role="tab" aria-selected={tab === 'join'} onClick={() => {setTab('join');setError('');}} className={tab === 'join' ? 'selected' : ''}>코드로 참가</button></div>
            <form onSubmit={enterRoom} className="entry-form">
              <label htmlFor="nickname">플레이어 이름</label>
              <div className="entry-inputs"><input id="nickname" value={name} onChange={event => setName(event.target.value)} placeholder="이름을 입력하세요" maxLength={12} required autoComplete="nickname" disabled={!hydrated || busy || restoring}/>{tab === 'join' && <input value={code} onChange={event => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6))} placeholder="방 코드" aria-label="방 코드" className="code-input" required minLength={6} maxLength={6} disabled={!hydrated || busy || restoring}/>}<button className="button button-primary" type="submit" disabled={!hydrated || busy || restoring}>{busy || restoring ? <LoaderCircle className="spin" size={18}/> : <>{tab === 'create' ? '방 만들기' : '입장하기'}<ArrowRight size={17}/></>}</button></div>
              <p className="form-note">방을 만들고 친구에게 초대 코드를 보내세요.</p>
            </form>
          </div>
          <button className="demo-link" onClick={() => startDemo()} disabled={!hydrated || busy || restoring}><Play size={14}/><strong>혼자 연습하기</strong><span>봇 5명과 플레이</span><ArrowRight size={15}/></button>
          {savedSession && !restoring && <button className="resume-link" onClick={() => {setSession(savedSession);setRestoring(true);setError('');}}>이전 방 {savedSession.code}에 다시 연결 <ArrowRight size={12}/></button>}
          {(error || connection) && <div className="error-message" role="alert">{error || connection}</div>}
        </div>
      </section>
      <footer className="home-footer" aria-label="제작 및 문의">
        <p><span>제작</span><strong>Hyogi Kim</strong></p>
        <p><span>문의</span><a href="mailto:jeff4380@unist.ac.kr">jeff4380@unist.ac.kr</a></p>
      </footer>
    </> : <>
      <div className="game-topbar"><div className="breadcrumb">게임 <ChevronRight size={12}/><span>{currentPhase === 'waiting' ? '대기실' : currentPhase === 'placing' ? '라운드 준비' : currentPhase === 'playing' ? '탐색' : '결과'}</span></div><div className="game-topbar-right">{demo && <span className="demo-badge">나 + 봇 5명</span>}{currentPhase !== 'waiting' && <span className="round-counter">라운드 <b>{String(view.round).padStart(2, '0')}</b><span>/ {String(view.totalRounds).padStart(2, '0')}</span></span>}{spectator && currentPhase !== 'waiting' && <span className="spectator-badge"><Eye size={13}/>관전 중</span>}{!demo && currentPhase !== 'waiting' && <button className="text-button copy-code" onClick={copyLink}><Copy size={13}/>{view.code}</button>}</div></div>
      {(error || connection) && <div className={`game-alert ${connection ? 'connection-alert' : ''}`} role="alert">{connection && <LoaderCircle size={16} className="spin"/>}<span>{error || connection}</span>{error && <button className="icon-button" onClick={() => setError('')} aria-label="알림 닫기"><X size={15}/></button>}</div>}

      {preparingAbility && <div className="placement-ability"><RolePanel view={view} onOpen={setCharacters} disabled={busy || !!connection} onChooseRole={role => act({type:'chooseRole',role})}/></div>}

      {currentPhase === 'waiting' ? <section className="lobby">
        <div className="lobby-top"><div className="lobby-heading"><h1>게임 준비</h1><p className="section-description">참가석 {lobbyCount}명이 모이면 시작합니다. 대기석은 관전으로 함께합니다.</p></div>
        <div className="invite-box"><div><span className="eyebrow">방 코드</span><strong>{view.code}</strong></div><button className="button button-outline" onClick={copyLink}><Copy size={14}/>초대 링크 복사</button></div></div>
        <p className="lobby-role-note">각자 승점 코인 3개로 시작합니다. 매 라운드 특수 능력을 직접 고릅니다. 같은 능력도 선택할 수 있어요. <button onClick={() => setCharacters('all')}>특수 능력 보기 <ArrowRight size={13}/></button></p>
        <RoomSettingsPanel value={host ? settingsDraft : view} host={host} busy={busy} disabled={busy || !!connection} changed={settingsChanged} onChange={changeSettings}/>
        <div className="roster-heading"><h2>참가석 <span>{lobbyPlayers.length} / {lobbyCount}</span></h2><p>{host ? '인원을 줄이면 뒤쪽 자리부터 대기석으로 이동해요.' : '빈자리는 입장 순서대로 채워집니다.'}</p></div>
        <div className="lobby-seats" style={{ '--player-count': lobbyCount } as React.CSSProperties}>{Array.from({length: lobbyCount}, (_, seat) => {
          const player = lobbyPlayers.find(person => person.seat === seat);
          return <div className={`lobby-seat player-color ${player ? 'seat-filled' : ''}`} style={playerColorStyle(seat)} key={seat}>
            <span className="seat-index">{String(seat + 1).padStart(2, '0')}<small>{playerColor(seat).label}</small></span>
            {player ? <><h3>{player.name}{player.id === view.selfId && <span>나</span>}</h3><p>{player.id === view.hostId ? <><Crown size={12}/> 방장</> : '참가'}</p>{host && <button className="seat-control" aria-label={`${player.name} 대기석으로`} disabled={busy || !!connection || settingsChanged} onClick={() => void act({ type: 'seat', playerId: player.id, seated: false })}><ArrowDown size={13}/>대기석으로</button>}</> : <><h3>빈 자리</h3><p>입장 대기</p></>}
          </div>;
        })}</div>
        <section className="waiting-room" aria-label="대기석">
          <div className="roster-heading"><h2>대기석 <span>{lobbyWaiting.length}명</span></h2><p>게임이 시작되면 관전 모드로 함께합니다.</p></div>
          {lobbyWaiting.length ? <div className="waiting-members">{lobbyWaiting.map(person => <div className="waiting-member" key={person.id}>
            <span className="waiting-avatar"><Eye size={13}/></span><strong>{person.name}</strong>{person.id === view.selfId && <span className="you-tag">나</span>}{person.id === view.hostId && <Crown size={13} aria-label="방장"/>}
            {host ? <button className="seat-control" aria-label={`${person.name} 참가석으로`} disabled={busy || !!connection || settingsChanged || lobbyPlayers.length >= lobbyCount} onClick={() => void act({ type: 'seat', playerId: person.id, seated: true })}><ArrowUp size={13}/>참가석으로</button> : <span className="waiting-status">대기 중</span>}
          </div>)}</div> : <p className="waiting-empty">대기 중인 사람이 없어요. 참가석이 가득 차면 이곳에서 기다립니다.</p>}
        </section>
        <div className="lobby-bottom"><span><span className="live-dot"/>{lobbyPlayers.length}명 참가 · {lobbyWaiting.length}명 대기</span>{host ? <button className="button button-primary" disabled={view.players.length !== view.playerCount || busy || !!connection || settingsChanged} onClick={() => void act({type:'start'})}>{busy ? <LoaderCircle className="spin" size={18}/> : <><Flag size={17}/> 게임 시작하기<ArrowRight size={17}/></>}</button> : <div className="waiting-text">{spectator ? <><Eye size={16}/>게임이 시작되면 관전할 수 있어요.</> : <><LoaderCircle size={16} className="spin"/>방장이 시작하기를 기다리고 있어요.</>}</div>}</div>
      </section> : currentPhase === 'roundEnd' || currentPhase === 'finished' ? <section className="results">
        <div className="eyebrow">{currentPhase === 'finished' ? '최종 결과' : `라운드 ${view.round} 종료`}</div>
        <h1>{currentPhase === 'finished' ? <>{view.champions.map(seat => view.players.find(player => player.seat === seat)?.name).join(', ')}<br/><span>{view.champions.length > 1 ? '공동 우승!' : '최종 우승!'}</span></> : <>{winner?.name},<br/><span>정상에 도착했어요.</span></>}</h1>
        {view.winner && (transferScoring ? <CoinTransfer view={view}/> : <div className="score-equation"><span>정상 도착 <b>1</b></span><Plus size={16}/><span>남은 힌트 <b>{view.winner.remainingCoins ?? 0}</b></span><span className="equal-sign">=</span><strong>+{view.winner.points}<small>점</small></strong></div>)}
        <div className="leaderboard"><div className="leaderboard-header"><span>플레이어</span><span>{transferScoring ? '승점 코인' : '누적 점수'}</span></div>{[...view.players].sort((a,b) => b.score - a.score || a.seat - b.seat).map((player,index) => <div className={`leaderboard-row ${view.champions.includes(player.seat) ? 'champion' : ''}`} key={player.id}><span className="rank">{index && player.score === [...view.players].sort((a,b) => b.score - a.score || a.seat - b.seat)[index-1]?.score ? '=' : String(index+1).padStart(2,'0')}</span><strong>{player.name}</strong>{player.id === view.selfId && <span className="you-tag">나</span>}<b data-testid={`balance-${player.seat}`} aria-label={`${player.name} ${transferScoring ? '승점 코인' : '점수'} ${player.score}${transferScoring ? '개' : '점'}`}>{player.score}<small>{transferScoring ? '개' : 'pt'}</small></b></div>)}</div>
        <RoundReveal key={`${view.code}-${view.round}`} view={view}/>
        {host || demo ? <button className="button button-primary result-next" disabled={busy || !!connection} onClick={() => void act({type: currentPhase === 'finished' ? 'restart' : 'nextRound'})}>{busy ? <LoaderCircle className="spin" size={18}/> : <>{currentPhase === 'finished' ? demo ? '새 게임 시작' : '대기실로 돌아가기' : '다음 라운드 준비하기'}<ArrowRight size={18}/></>}</button> : <p className="waiting-text"><LoaderCircle className="spin" size={16}/>방장이 다음 라운드를 준비하고 있어요.</p>}
        {currentPhase === 'roundEnd' && <p className="result-note">{transferScoring && <>승점 코인은 그대로 이어집니다.<br/></>}다음 라운드는 완주자의 왼쪽 사람부터 시작합니다.</p>}
      </section> : <div className="play-layout">
        <aside className="players-panel"><div className="panel-label">플레이어 <span>{transferScoring ? '승점 코인' : `${view.playerCount}명`}</span></div><div className="players-list" style={{ '--player-count': view.playerCount } as React.CSSProperties}>{view.players.map(player => <div className={`player-row ${currentPhase === 'playing' && player.seat === view.activeSeat ? 'player-active' : ''} ${player.id === view.selfId ? 'player-self' : ''}`} key={player.id}><Avatar name={player.name} seat={player.seat}/><div className="player-details"><strong>{player.name}{player.id === view.selfId && <span className="you-tag">나</span>}</strong>{player.role && <small className="player-role" title={ROLE_DETAILS[player.role].name}>{ROLE_DETAILS[player.role].name}</small>}<span>{currentPhase === 'placing' ? player.ready ? '준비 완료' : view.placementMode === 'retained' && !view.rebuildSeats?.includes(player.seat) ? '기존 판 유지' : '배치 중' : player.seat === view.activeSeat ? view.blessingSeat !== undefined ? '가호 선택 중' : endingTurn ? player.role === 'guardian' ? '폭발 확인 중' : '탐색 종료' : view.shiftSeat !== undefined ? '지뢰 이동 선택' : choosingBoard ? '판 선택 중' : event?.type === 'rotation' ? '판 받는 중' : '지금 탐색 중' : endingTurn && active?.role !== 'guardian' && player.seat === nextSeat ? '다음 차례' : `${player.seat + 1}번 자리`}</span></div>{currentPhase === 'placing' && player.ready && <Check size={17} className="ready-check"/>}<span className="player-score" data-testid={`victory-coins-${player.seat}`} aria-label={`${player.name} ${transferScoring ? '승점 코인' : '점수'} ${player.score}${transferScoring ? '개' : '점'}`}>{player.score}<small>{transferScoring ? '개' : 'pt'}</small></span></div>)}</div></aside>
        <section className="field-panel">
          {myShift ? <MineShift key={`${view.round}-${view.turnNumber ?? view.rotation}-${view.shiftSeat}`} view={view} disabled={busy || !!connection} onAction={act}/> : <>
          <div className="field-heading"><div><FieldHeading className={preparingAbility ? 'placement-field-title' : undefined}>{preparingAbility && <span className="placement-step-number">02</span>}{currentPhase === 'placing' ? spectator ? '플레이어 준비 중' : keepingBoard ? '기존 판 유지' : self?.ready ? '배치 완료' : view.round > 1 && view.placementMode === 'retained' ? '내 판 다시 만들기' : '지뢰 배치' : view.shiftSeat !== undefined ? '지뢰 이동 선택 중' : view.blessingSeat !== undefined ? `${active?.name ?? '플레이어'} 가호 선택` : endingTurn ? `${active?.name ?? '플레이어'} 탐색 종료` : ownTurn ? '내 차례' : `${active?.name ?? '플레이어'} 차례`}</FieldHeading></div><span className={`phase-tag ${currentPhase === 'placing' ? 'secret-tag' : ''}`}>{currentPhase === 'placing' ? spectator ? '관전' : '비공개' : spectator ? '관전' : '탐색'}</span></div>
          <p className="field-description">{currentPhase === 'placing' ? spectator ? '플레이어들이 다음 탐색을 준비하고 있어요. 모두 준비하면 함께 볼 수 있습니다.' : keepingBoard ? self?.ready ? '준비를 마쳤어요. 모두 준비하면 탐색을 시작합니다.' : '코인을 빼앗기지 않은 판은 다음 라운드에도 그대로 사용합니다.' : self?.ready ? '모두 준비하면 도전할 판을 고릅니다.' : concealMode ? '힌트의 답을 숨길 선분을 최대 4개 선택하세요. 지뢰가 없어도 선택할 수 있어요.' : view.placementMode === 'retained' && view.round > 1 ? '코인을 빼앗긴 판을 수정할 수 있어요. 기존 배치를 그대로 확정해도 됩니다.' : '선분을 눌러 배치하세요. 정상까지 안전한 길 하나는 남겨두세요.' : view.shiftSeat !== undefined ? `${shiftPlayer?.name ?? '플레이어'}님이 ‘위험의 전이’로 지뢰를 옮길지 선택하고 있어요.` : view.blessingSeat !== undefined ? '폭발한 지뢰는 그대로 남습니다. 가호 사용 여부를 선택하고 있어요.' : hintMode ? '지뢰가 궁금한 선분을 선택하세요. 답변은 당신에게만 보입니다.' : endingTurn ? <span className="turn-transition" data-testid="turn-transition"><span>지뢰가 터졌어요. 이 위치를 기억하세요.</span><strong>{transitionSeconds > 0 ? <>{active?.role === 'guardian' ? '가호 선택 또는 다음 차례' : rotationNext ? '판 넘기기' : `${nextPlayer?.name ?? '다음 플레이어'} 차례`}까지 <span>{transitionSeconds}</span>초</> : active?.role === 'guardian' ? '곧 다음 진행을 확인합니다.' : rotationNext ? '곧 판을 넘깁니다.' : `곧 ${nextPlayer?.name ?? '다음 플레이어'} 차례입니다.`}</strong></span> : event?.type === 'rotation' ? '판을 왼쪽으로 전달합니다. 새 판의 주인을 확인하세요.' : choosingBoard ? ownTurn ? '본인이 만든 판을 제외하고 원하는 판을 선택하세요.' : '판이 정해지면 이동을 함께 볼 수 있어요.' : ownTurn ? view.position ? '연결된 점을 선택해 이동하세요.' : '밑변에서 출발점을 선택하세요.' : '이동과 폭발을 기억하세요. 지나간 길은 남지 않습니다.'}</p>
          {keepingBoard ? <RetainedBoard view={view}/> : choosingBoard ? <BoardChoice view={view} disabled={!canTakeTurnAction} onChoose={ownerSeat => void act({ type: 'chooseBoard', ownerSeat })}/> : <>
          <div data-testid="active-board" className={`board-stage ${currentPhase === 'placing' ? 'stage-placement' : ''} ${event?.type === 'explosion' ? 'stage-explosion' : ''}`}>
            <div className="board-toolbar"><div className="board-identity player-color" style={playerColorStyle(currentPhase === 'placing' ? self?.seat ?? -1 : owner?.seat ?? -1)}><span>{currentPhase === 'placing' && spectator ? <>변을 {view.gridSize}등분한 판</> : <><i className="owner-swatch"/>{currentPhase === 'placing' ? self?.name : owner?.name}<small>의 판 · {(currentPhase === 'placing' ? self?.seat ?? 0 : owner?.seat ?? 0) + 1}번{transferScoring && owner && currentPhase === 'playing' ? ` · 승점 ${owner.score}개` : ''}</small></>}</span></div>
            {currentPhase === 'playing' && typeof view.activeBoardMineCount === 'number' && <div className="board-mine-count" data-testid="board-mine-count" aria-label={`이 판의 총 지뢰 ${view.activeBoardMineCount}개`}><span>총 지뢰</span><strong>{view.activeBoardMineCount}<small>개</small></strong></div>}
            {currentPhase === 'placing' && <span className="board-spec">{view.gridSize}등분</span>}</div>
            <Board gridSize={view.gridSize} ownerSeat={currentPhase === 'placing' ? self?.seat : owner?.seat} maxMines={mineLimit}
              placement={canPlace}
              mines={currentPhase === 'placing' && !spectator ? self?.ready ? view.ownMines ?? [] : draft : []}
              concealedEdges={currentPhase === 'placing' && !spectator ? self?.ready ? view.ownConcealed ?? [] : concealed : []}
              concealmentMode={concealMode} memoMarks={memoMarks}
              position={currentPhase === 'playing' ? view.position : null} event={event}
              disabled={spectator || busy || (currentPhase === 'placing' && self?.ready) || !!connection}
              allowedNodes={canAct && !hintMode ? available : []}
              onNode={canAct && !hintMode ? nodeId => void act({type: view.position ? 'move' : 'spawn', nodeId}) : undefined}
              onEdge={canPlace && !self?.ready ? edgeId => {
                if (concealMode) setConcealed(previous => previous.includes(edgeId) ? previous.filter(id => id !== edgeId) : previous.length < 4 ? [...previous, edgeId] : previous);
                else setDraft(previous => previous.includes(edgeId) ? previous.filter(id => id !== edgeId) : previous.length >= mineLimit ? previous : [...previous, edgeId]);
              } : canAct && hintMode ? edgeId => void act({type:'hint',edgeId}) : undefined}
              hintMode={hintMode} selectedEdge={privateHint?.edgeId}/>

            {event?.type === 'rotation' && <div className="rotation-overlay"><span><RotateCcw size={28}/></span><strong>판을 왼쪽으로 넘깁니다.</strong><p>자기 판은 건너뛰고 왼쪽으로 전달해요.</p></div>}
            <div className="board-bottomline"><span><span className="legend-dot"/>출발점 {view.gridSize + 1}개</span><span><span className="legend-diamond"/>하나의 정상</span></div>
          </div>
          </>}
          <div className="field-caption"><LockKeyhole size={13}/>{currentPhase === 'placing' ? spectator ? '지뢰 배치는 관전자에게 공개되지 않습니다.' : keepingBoard ? '유지되는 판의 지뢰와 위장 위치는 다시 공개되지 않습니다.' : '탐색이 시작되면 배치한 지뢰가 숨겨집니다.' : memoMarks.length ? `내 메모 ${memoMarks.length}개 표시 중 · 직접 적은 추측이며 틀릴 수 있어요.` : '자동 기록은 남지 않습니다. 차례와 관계없이 메모를 직접 남길 수 있어요.'}</div>
          {!spectator && currentPhase === 'playing' && !!view.memoCapacity && <button className="button button-outline memo-jump" onClick={() => { const panel = document.getElementById('my-memos'); panel?.scrollIntoView({ block: 'start' }); panel?.focus({ preventScroll: true }); }}><NotebookPen size={16}/>내 메모로 이동<span>{view.selfMemos?.filter(Boolean).length ?? 0} / {view.memoCapacity}</span><ArrowDown size={16}/></button>}
          </>}
        </section>
        <aside className="action-panel">
          {!spectator && currentPhase !== 'placing' && <RolePanel view={view} onOpen={setCharacters} disabled={busy || !!connection} onChooseRole={role => act({type:'chooseRole',role})}/>}
          {!spectator && transferScoring && <VictoryWallet balance={self?.score ?? 0}/>}
          {canPlace && self?.role === 'trapper' && <div className="concealment-controls" data-testid="concealment-controls"><div className="placement-modes" aria-label="배치 도구"><button aria-pressed={!concealMode} disabled={self.ready || busy} onClick={() => setConcealMode(false)}>지뢰 배치</button><button aria-pressed={concealMode} disabled={self.ready || busy} onClick={() => setConcealMode(true)}>길 위장 <b>{self.ready ? (view.ownConcealed?.length ?? 0) : concealed.length}/4</b></button></div><p>마름모로 표시한 길은 힌트를 써도 판독할 수 없어요. 안전한 길도 위장할 수 있습니다.</p></div>}

          {spectator ? <>
            <div className="panel-label">관전 모드<Eye size={16}/></div>
            <h2 className="spectator-title">현재 판을 관전 중입니다.</h2>
            <p className="panel-description">{currentPhase === 'placing' ? '배치한 지뢰는 각 플레이어만 볼 수 있어요. 모두 준비하면 탐색이 시작됩니다.' : '현재 플레이어의 이동과 폭발을 실시간으로 볼 수 있어요. 개인 힌트는 공개되지 않습니다.'}</p>
            {currentPhase === 'placing' && <div className="placement-readiness"><span>{view.players.filter(player => player.ready).length} / {view.playerCount}명 준비 완료</span><div>{view.players.map(player => <i key={player.id} className={player.ready ? 'ready' : ''}/>)}</div></div>}
            <p className="spectator-note">참가석은 게임 종료 후 대기실에서 바꿀 수 있습니다.</p>
            <div className="turn-info"><span className="eyebrow">게임 설정</span><div><Users size={14}/><span>참가 인원</span><strong>{view.playerCount}<small>명</small></strong></div><div><Flag size={14}/><span>그리드</span><strong>{view.gridSize}<small>등분</small></strong></div></div>
          </> : keepingBoard ? <><div className="panel-label">라운드 준비<Check size={15}/></div><p className="panel-description">내 판은 이미 준비되어 있어요. 이번 라운드에 사용할 특수 능력을 선택한 뒤 준비를 완료하세요.</p>{self?.role === 'trapper' && <p className="retained-ability-note">새로운 길 위장은 내 판을 다시 만들 때 설정할 수 있어요. 기존 위장은 선택한 능력과 관계없이 그대로 남습니다.</p>}<button data-testid="confirm-ready" className="button button-primary full-width" disabled={self?.ready || (view.rolesEnabled && !self?.role) || busy || !!connection} onClick={() => void act({type:'ready'})}>{self?.ready ? <><Check size={17}/>준비 완료</> : busy ? <LoaderCircle className="spin" size={18}/> : <>{view.rolesEnabled && !self?.role ? '능력을 먼저 선택하세요' : '기존 판으로 준비 완료'}<ArrowRight size={16}/></>}</button><div className="placement-readiness"><span>{view.players.filter(player => player.ready).length} / {view.playerCount}명 준비 완료</span><div>{view.players.map(player => <i key={player.id} className={player.ready ? 'ready' : ''}/>)}</div></div></> : currentPhase === 'placing' ? <><div className="panel-label">지뢰 배치 <LockKeyhole size={13}/></div><div className="placement-counter" aria-label={`설치한 지뢰 ${placedCount}개 / 최대 ${mineLimit}개`}><span>설치한 지뢰</span><strong>{placedCount}<small> / {mineLimit}개</small></strong></div><p className={`mine-limit-note ${placedCount >= mineLimit && !self?.ready ? 'limit-reached' : ''}`} role="status">{placedCount > mineLimit ? self?.ready ? '규칙 변경 전에 완료한 배치는 유지됩니다.' : '제한보다 많아요. 지뢰를 제거해주세요.' : placedCount === mineLimit && !self?.ready ? '최대 개수예요. 위치를 바꾸려면 먼저 지뢰를 제거하세요.' : `이 판에는 최대 ${mineLimit}개까지 배치할 수 있어요.`}</p><div className={`path-status ${safe || self?.ready ? 'path-valid' : 'path-invalid'}`}>{safe || self?.ready ? <Check size={16}/> : <X size={16}/>}<span>{safe || self?.ready ? '정상까지 이어지는 길이 있어요' : '안전한 경로를 남겨주세요'}</span></div><p className="panel-description">밑변의 출발점 사이는 항상 열려 있어요. 지뢰는 배치 가능한 선분의 50%까지 설치할 수 있어요. 소수점은 버립니다.</p><div className="placement-tools"><button className="button button-subtle" disabled={self?.ready || busy} onClick={() => setDraft(randomBoard(Math.random, view.gridSize))}><Shuffle size={15}/>랜덤 배치</button><button className="icon-button clear-button" disabled={self?.ready || busy || !draft.length} onClick={() => setDraft([])} aria-label="배치 모두 지우기"><RotateCcw size={16}/></button></div><button data-testid="confirm-placement" className="button button-primary full-width" disabled={self?.ready || (view.rolesEnabled && !self?.role) || !safe || placedCount > mineLimit || busy || !!connection} onClick={() => void act({type:'place',mines:draft,...(self?.role === 'trapper' ? {concealed} : {})})}>{self?.ready ? <><Check size={17}/>배치 완료</> : busy ? <LoaderCircle className="spin" size={18}/> : <>{view.rolesEnabled && !self?.role ? '능력을 먼저 선택하세요' : '이 배치로 준비 완료'}<ArrowRight size={16}/></>}</button><div className="placement-readiness"><span>{view.players.filter(player => player.ready).length} / {view.playerCount}명 준비 완료</span><div>{view.players.map(player => <i key={player.id} className={player.ready ? 'ready' : ''}/>)}</div></div></> : <><div className="panel-label">내 힌트 <Coins size={15}/></div><div className="hint-heading"><h2>남은 힌트 코인</h2><span>{self?.coins ?? 0}<small> / {totalHints}</small></span></div><CoinsDisplay count={self?.coins ?? 0} total={totalHints}/><p className="panel-description">{totalHints ? '코인 1개로 선분 하나를 확인합니다. 답은 나에게만 보이고, 닫으면 사라져요.' : '이번 게임은 힌트 없이 진행합니다. 다른 사람의 이동과 폭발을 잘 기억하세요.'}</p><button data-testid="hint-button" className={`button ${hintMode ? 'button-cancel' : 'button-gold'} full-width`} disabled={!canAct || (!hintMode && !self?.coins)} onClick={() => setHintMode(previous => !previous)}>{hintMode ? <><X size={16}/>선분 선택 취소</> : <><Search size={16}/>힌트 사용하기<small>−1</small></>}</button><p className="hint-footnote">{!totalHints ? '힌트가 비활성화된 방입니다.' : ownTurn ? choosingBoard ? '도전할 판을 먼저 선택하세요.' : hintMode ? '판 위의 선분을 선택하세요.' : !self?.coins ? '이번 라운드의 코인을 모두 사용했어요.' : transferScoring ? '힌트 코인은 승점 코인과 별개예요.' : '남긴 코인은 승리 시 점수가 됩니다.' : '자기 차례에 힌트를 사용할 수 있어요.'}</p><div className="turn-info"><span className="eyebrow">진행 상황</span><div><Users size={14}/><span>{view.boardMode === 'choice' ? '이번 라운드 차례' : '로테이션'}</span><strong>{view.boardMode === 'choice' ? view.turnNumber : view.rotation}</strong></div><div><Flag size={14}/><span>라운드</span><strong>{view.round}<small> / {view.totalRounds}</small></strong></div></div></>}
          {!spectator && currentPhase === 'playing' && <MemoPanel view={view} disabled={busy || !!connection} peekDisabled={!canTakeTurnAction || hintMode} disabledReason={busy ? '요청을 처리하고 있어요. 잠시만 기다려주세요.' : undefined} onAction={act}/>}
          {view.spectators.length > 0 && <div className="spectators-list"><span><Eye size={14}/>관전자 {view.spectators.length}명</span><p>{view.spectators.map(person => `${person.name}${person.id === view.selfId ? ' (나)' : ''}`).join(' · ')}</p></div>}
        </aside>
      </div>}
      <footer className="game-footer"><span>잔상</span><p>{demo ? '연습 모드 · 봇 5명' : `참가 ${view.players.length}명 · 관전 ${view.spectators.length}명`}</p></footer>
    </>}

    {rules && <Modal title="플레이 방법" onClose={() => setRules(false)} className="rules-modal"><p className="modal-intro">지뢰를 배치하고 다른 사람의 판을 탐색합니다.<br/>자신이 만든 판은 플레이하지 않습니다.<br/>방장이 대기실에서 인원·힌트·라운드·그리드 크기를 정합니다. 대기석의 사람들은 게임을 관전합니다.</p><div className="rules-list"><div><span>01</span><section><h3>지뢰 배치</h3><p>삼각형 선분에 지뢰를 배치합니다. 밑변은 지뢰를 설치할 수 없고, 정상까지 이어지는 안전한 길이 하나 이상 있어야 해요. 지뢰는 밑변을 제외한 선분의 50%까지만 놓을 수 있습니다(소수점 버림). 판의 색은 제작자의 자리 색입니다. 첫 라운드에는 모두 판을 만들고, 다음부터는 승점 코인을 빼앗긴 제작자만 다시 만들 수 있습니다. 나머지 판의 지뢰와 위장은 그대로 유지됩니다. 제작자의 코인이 0개라 코인 이동이 없었다면 모든 판을 유지합니다. 배치가 끝나면 자기 차례에 도전할 판을 고릅니다.</p></section></div><div><span>02</span><section><h3>이동과 폭발</h3><p>밑변의 점에서 출발해 인접한 점으로 이동합니다. 모든 방향과 되돌아가기가 가능해요. 지뢰가 터지면 말만 사라지고 차례가 시계방향으로 넘어갑니다. 지뢰는 계속 남아 있어요. 현재 탐색 중인 판의 총 지뢰 수는 오른쪽 위에 모두에게 표시됩니다.</p></section></div><div><span>03</span><section><h3>원하는 판 고르기</h3><p>자기 차례마다 본인의 판을 제외한 원하는 판 하나를 고릅니다. 여러 사람이 같은 판에 도전하거나 다음 차례에 같은 판을 다시 골라도 됩니다. 선택한 판은 그 차례가 끝날 때까지 바꿀 수 없고, 가호를 써도 같은 판의 밑변에서 재출발합니다. 이동·폭발·힌트는 자동 기록되지 않습니다. ‘위험의 전이’는 두 번째 자기 차례부터 판을 고르기 전에 지뢰 하나를 옮기거나 건너뜁니다. 실제 이동만 라운드당 최대 7회로 제한합니다.</p></section></div><div><span>04</span><section><h3>힌트 사용</h3><p>라운드마다 방장이 정한 수의 힌트 코인을 받습니다(기본 3개). 자기 차례에 원하는 선분 하나의 지뢰 유무를 본인만 확인해요. 말이나 차례에 영향은 없고, 다시 확인하려면 코인을 또 사용해야 합니다.</p></section></div><div><span>05</span><section><h3>특수 능력과 내 메모</h3><p>매 라운드 준비할 때 특수 능력을 직접 고르며 중복 선택할 수 있습니다. ‘잔광의 인도’는 힌트 코인 2개를 더 받습니다. 힌트 코인은 승점 코인과 별개이며 남겨도 승점으로 바뀌지 않습니다. ‘귀환의 가호’를 쓰면 폭발 후 같은 차례에 밑변에서 다시 시작합니다. ‘기만의 장막’은 안전한 길과 지뢰가 있는 길 중 최대 4개 선분을 자유롭게 위장하며, 위장한 길은 힌트로 판독할 수 없습니다. 새 위장은 판을 만드는 라운드에만 설정하며, 유지되는 판의 기존 위장은 능력을 바꾸어도 남습니다.</p><p>메모는 2명 0칸, 3~4명 1칸, 5~6명 2칸이며 ‘기억의 각인’을 선택하면 두 배입니다. 탐색 중에는 차례와 관계없이 언제든 어느 판의 선분이든 직접 기록하고 고칩니다. 차례가 바뀌어도 작성 중인 메모는 유지됩니다. 추측은 틀릴 수 있고 지뢰 이동으로 자동 수정되지 않습니다. ‘타인의 기억’은 라운드당 두 번, 한 번에 기본 메모 수만큼 남의 메모를 잠깐 보여줍니다. 2인전은 메모 관련 능력을 제외합니다. 새 라운드에는 모든 메모와 능력 사용 횟수가 초기화됩니다.</p></section></div><div><span>06</span><section><h3>승점 코인과 승리</h3><p>게임 시작 시 각자 승점 코인 3개를 받습니다. 정상에 도착하면 라운드가 끝나고, 성공한 판의 제작자에게서 승점 코인 1개를 가져옵니다. 제작자가 0개라면 코인 이동 없이 라운드만 끝납니다. 승점 코인은 다음 라운드에도 유지되며, 힌트 코인을 사용해도 줄지 않습니다. 라운드가 끝나면 성공한 판의 정답만 공개합니다. 게임이 완전히 끝나면 모든 판을 공개하고, 모든 라운드 후 승점 코인이 가장 많은 사람이 우승합니다. 동점은 공동 우승입니다. 첫 시작은 무작위, 이후에는 이전 완주자의 왼쪽 사람부터 시작합니다.</p></section></div></div><button className="button button-primary full-width" onClick={() => setRules(false)}>확인했어요<Check size={16}/></button></Modal>}
    {privateHint && <Modal title="당신만의 단서입니다." onClose={() => setHint(null)} className="hint-modal"><div data-testid="hint-dialog" className={`hint-revelation ${privateHint.mined ? 'is-mined' : ''}`}><span>{privateHint.mined === null ? <LockKeyhole size={28}/> : privateHint.mined ? <X size={28}/> : <Check size={28}/>}</span><strong>{privateHint.mined === null ? '판독할 수 없어요.' : privateHint.mined ? '지뢰가 있어요.' : '지뢰가 없어요.'}</strong><p>{privateHint.mined === null ? '위장한 길입니다. 지뢰가 있을 수도, 없을 수도 있어요.' : '선택한 선분을 기억하세요.'}</p></div><div className="hint-preview"><Board gridSize={view?.gridSize} ownerSeat={privateHint.ownerSeat} selectedEdge={privateHint.edgeId}/></div><p className="hint-warning">닫으면 이 답변은 사라집니다.<br/>다시 묻는 데에도 코인 하나가 필요해요.</p><button className="button button-primary full-width" onClick={() => setHint(null)}>기억했어요. 닫기<Check size={17}/></button></Modal>}
    {myBlessing && currentPhase === 'playing' && <BlessingChoice disabled={busy || !!connection} remaining={self?.blessings ?? 0} message={connection || error} onAction={act}/>}
    {characters && <CharacterGallery initialRole={characters === 'all' ? undefined : characters} onClose={() => setCharacters(null)}/>}
    {privatePeek && view && <PeekResultView view={view} entries={privatePeek} onClose={() => setPeek(null)}/>}
    {leaving && <Modal title="홈으로 이동할까요?" onClose={() => setLeaving(false)}><p className="modal-intro">{demo ? '진행 중인 데모는 종료됩니다. 언제든 새 데모를 시작할 수 있어요.' : '게임은 계속 진행되고, 내 자리는 유지됩니다. 이 브라우저에서 이전 방으로 다시 연결할 수 있어요.'}</p><div className="modal-actions"><button className="button button-outline" onClick={() => setLeaving(false)}>계속 플레이</button><button className="button button-primary" onClick={leave}>홈으로 이동<ArrowRight size={16}/></button></div></Modal>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </main>;
}
