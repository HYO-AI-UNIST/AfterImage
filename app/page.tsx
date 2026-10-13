'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowRight, BookOpen, Check, ChevronRight, Coins, Copy, Crown, DoorOpen, Flag, Footprints, LoaderCircle, LockKeyhole, Mountain, Play, Plus, RotateCcw, Shuffle, Sparkles, Triangle, Trophy, Users, VolumeX, X } from 'lucide-react';
import { Board } from '@/components/mindminer/board';
import { Modal } from '@/components/mindminer/modal';
import { EDGES, STARTS, hasSafePath, randomBoard, viewFor } from '@/lib/game';
import { createDemo, tickDemo, demoAction, DEMO_SELF_ID } from '@/lib/demo';
import type { ApiReply, GameAction, GameState, PrivateResult, RoomView } from '@/lib/contracts';

const SESSION_KEY = 'mindminer.membership.v1';
const COLORS = ['#b7e4c4', '#e8c68b', '#c2b8e9', '#9fcee0', '#e7afa4', '#cfca9a'];
type Session = { code: string; token: string };
type Hint = PrivateResult & { round: number; seat: number; code: string; selfId: string; rotation: number; ownerSeat: number };

function Mark({ small = false }: { small?: boolean }) {
  return <svg width={small ? 25 : 34} height={small ? 27 : 36} viewBox="0 0 36 38" fill="none" aria-hidden="true"><path d="M18 3 34 32H2L18 3Z" stroke="currentColor" strokeWidth="1.6"/><path d="M18 3v19L2 32m16-10 16 10M10 17h16M10 17l8 15 8-15" stroke="currentColor" strokeWidth="1.3"/><circle cx="18" cy="22" r="2.5" fill="currentColor"/></svg>;
}
function CoinsDisplay({ count = 3 }: { count?: number }) {
  return <div className="coin-row" aria-label={`남은 힌트 코인 ${count}개`}>{[0, 1, 2].map(index => <span className={`coin ${index >= count ? 'coin-spent' : ''}`} key={index}><span>✦</span></span>)}</div>;
}
function Avatar({ name, seat, large = false }: { name: string; seat: number; large?: boolean }) {
  return <span className={`avatar ${large ? 'avatar-large' : ''}`} style={{ '--seat-color': COLORS[seat % 6] } as React.CSSProperties}>{name.slice(0, 1)}</span>;
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
  const [leaving, setLeaving] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [hintMode, setHintMode] = useState(false);
  const [hint, setHint] = useState<Hint | null>(null);
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
    setHint(null); setHintMode(false);
  }, [view?.round, view?.activeSeat, view?.phase, view?.rotation]);
  useEffect(() => {setDraft(view?.phase === 'placing' ? view.ownMines ?? [] : []);}, [view?.round, view?.selfId, view?.phase]);
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
  const startDemo = () => {
    sessionGeneration.current += 1;
    const state = createDemo();
    demoRef.current = state; viewRef.current = null;
    setSession(null); setDemo(true); setError(''); setConnection(''); setDraft([]); setHint(null); setHintMode(false); accept(viewFor(state, DEMO_SELF_ID, Date.now()));
  };
  const act = async (action: GameAction) => {
    if (busyRef.current || !viewRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    const at = viewRef.current;
    const generation = sessionGeneration.current;
    const showHint = (result: PrivateResult) => {
      const current = viewRef.current;
      if (generation !== sessionGeneration.current || !current || current.code !== at.code || current.selfId !== at.selfId || current.phase !== 'playing' || current.round !== at.round || current.activeSeat !== at.activeSeat || current.rotation !== at.rotation || current.boardOwnerSeat !== at.boardOwnerSeat) return;
      setHint({...result, round: at.round, seat: at.activeSeat, code: at.code, selfId: at.selfId, rotation: at.rotation, ownerSeat: at.boardOwnerSeat}); setHintMode(false);
    };
    try {
      if (demo && demoRef.current) {
        const result = demoAction(demoRef.current, action, Date.now());
        demoRef.current = result.state; accept(viewFor(result.state, DEMO_SELF_ID, Date.now()));
        if (result.privateResult) showHint(result.privateResult);
      } else if (session) {
        const response = await fetch(`/api/rooms/${session.code}/actions`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${session.token}`}, body: JSON.stringify({action, revision: at.revision})});
        const data = await response.json() as ApiReply & {error?: string};
        if (generation !== sessionGeneration.current) return;
        if (!response.ok) throw new Error(data.error ?? '요청을 처리하지 못했습니다. 다시 시도해주세요.');
        accept(data.view);
        if (data.privateResult) showHint(data.privateResult);
      }
      if (action.type === 'place') setDraft([]);
    } catch (failure) {if (generation === sessionGeneration.current) setError(failure instanceof Error ? failure.message : '요청을 처리하지 못했습니다.');}
    finally {if (generation === sessionGeneration.current) {busyRef.current = false; setBusy(false);}}
  };
  const leave = () => {
    sessionGeneration.current += 1;
    busyRef.current = false; setBusy(false);
    setLeaving(false); setDemo(false); demoRef.current = null; setSession(null); setView(null); viewRef.current = null; setHint(null); setHintMode(false); setDraft([]); setError(''); setConnection('');
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
  const event = view?.event && view.event.until > (clock || Date.now()) + serverOffset.current ? view.event : null;
  const canAct = ownTurn && !view?.event && !busy && !hint && !connection;
  const available = view?.position ? EDGES.filter(edge => edge.a === view.position || edge.b === view.position).map(edge => edge.a === view.position ? edge.b : edge.a) : STARTS;
  const safe = hasSafePath(draft);
  const privateHint = hint && view?.phase === 'playing' && hint.round === view.round && hint.seat === view.activeSeat && hint.code === view.code && hint.selfId === view.selfId && hint.rotation === view.rotation && hint.ownerSeat === view.boardOwnerSeat && ownTurn ? hint : null;
  const host = view?.selfId === view?.hostId;
  const winner = view?.players.find(player => player.seat === view.winner?.seat);
  const currentPhase = view?.phase;

  return <main data-hydrated={hydrated} data-phase={view?.phase ?? 'home'} className={`mindminer ${view ? 'in-game' : 'on-home'}`}>
    <header className="site-header">
      <button className="brand" onClick={() => view ? setLeaving(true) : window.scrollTo({top: 0, behavior: 'smooth'})} aria-label="마인드마이너 홈"><Mark/><span>MINDMINER<span className="brand-dot">.</span></span></button>
      <div className="header-center"><span className="live-dot"/>{view ? demo ? 'SOLO DEMO' : `ROOM ${view.code}` : 'A GAME OF MEMORY & TRUST'}</div>
      <nav className="header-nav"><button className="text-button rules-button" onClick={() => setRules(true)}><BookOpen size={16}/><span>플레이 방법</span></button>{view && <button className="icon-button exit-button" onClick={() => setLeaving(true)} aria-label="홈으로 나가기"><DoorOpen size={19}/></button>}</nav>
    </header>

    {!view ? <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow hero-eyebrow"><span className="tiny-diamond"/> SIX MINDS. ONE SUMMIT.</div>
          <h1>길은 사라져도,<br/><span>기억은 남는다.</span></h1>
          <p className="hero-description">당신이 설계한 함정, 누군가가 남긴 한 걸음.<br/>오직 기억을 믿고 정상에 도달하세요.</p>
          <div className="hero-meta"><span><Users size={15}/> 6명의 탐험가</span><i/><span><Flag size={15}/> 7번의 라운드</span><i/><span><Coins size={15}/> 3개의 힌트</span></div>
          <div className="entry-panel">
            <div className="entry-tabs" role="tablist" aria-label="게임 참가 방식"><button role="tab" aria-selected={tab === 'create'} onClick={() => {setTab('create');setError('');}} className={tab === 'create' ? 'selected' : ''}><Plus size={16}/> 새로운 방 만들기</button><button role="tab" aria-selected={tab === 'join'} onClick={() => {setTab('join');setError('');}} className={tab === 'join' ? 'selected' : ''}><Users size={16}/> 친구의 방 참가하기</button></div>
            <form onSubmit={enterRoom} className="entry-form">
              <label htmlFor="nickname">탐험가 이름</label>
              <div className="entry-inputs"><input id="nickname" value={name} onChange={event => setName(event.target.value)} placeholder="어떤 이름으로 기억될까요?" maxLength={12} required autoComplete="nickname" disabled={!hydrated || busy || restoring}/>{tab === 'join' && <input value={code} onChange={event => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6))} placeholder="방 코드" aria-label="방 코드" className="code-input" required minLength={6} maxLength={6} disabled={!hydrated || busy || restoring}/>}<button className="button button-primary" type="submit" disabled={!hydrated || busy || restoring}>{busy || restoring ? <LoaderCircle className="spin" size={18}/> : <>{tab === 'create' ? '방 만들기' : '입장하기'}<ArrowRight size={17}/></>}</button></div>
              <p className="form-note"><LockKeyhole size={12}/> 설치 없이, 초대 링크 하나로 함께 플레이해요.</p>
            </form>
          </div>
          <button className="demo-link" onClick={startDemo} disabled={!hydrated || busy || restoring}><span className="play-circle"><Play size={12} fill="currentColor"/></span>먼저 혼자 둘러볼까요?<strong>데모 플레이</strong><ArrowRight size={15}/></button>
          {savedSession && !restoring && <button className="resume-link" onClick={() => {setSession(savedSession);setRestoring(true);setError('');}}>이전 방 {savedSession.code}에 다시 연결 <ArrowRight size={12}/></button>}
          {(error || connection) && <div className="error-message" role="alert">{error || connection}</div>}
        </div>
        <div className="hero-art">
          <div className="art-topline"><span>THE MIND FIELD</span><span>NO. 001 — ∆</span></div>
          <div className="hero-summit-tag"><span className="tag-line"/><span>하나의 정상,<br/><strong>여섯 개의 기억.</strong></span></div>
          <Board illustration/>
          <div className="art-coordinate coord-left">35° 16′ N<br/>MEMORY REQUIRED</div>
          <div className="art-coordinate coord-right"><span className="tiny-diamond"/> EXPLORE THE UNKNOWN</div>
          <div className="art-bottom"><span className="small-line"/><span>보이는 길을 걷고, 보이지 않는 길을 기억하세요.</span></div>
          <div className="floating-note"><span className="note-icon"><Footprints size={18}/></span><span>흔적은 남지 않아요.<br/><strong>다음 한 걸음은 당신의 기억으로.</strong></span></div>
        </div>
      </section>
      <section className="principles" aria-label="게임의 세 단계"><div><span className="principle-number">01</span><div><h3>설계하고 <Triangle size={15}/></h3><p>하나의 길을 남기고, 함정을 만드세요.</p></div></div><div><span className="principle-number">02</span><div><h3>기억하고 <Sparkles size={15}/></h3><p>모두의 한 걸음을 눈여겨보세요.</p></div></div><div><span className="principle-number">03</span><div><h3>정복하세요 <Mountain size={16}/></h3><p>먼저 정상에 오르는 기억이 승리합니다.</p></div></div></section>
      <footer className="home-footer"><span>CRAFTED FOR CURIOUS MINDS</span><span>기억을 나누는 여섯 명의 테이블 <span>© MINDMINER</span></span></footer>
    </> : <>
      <div className="game-topbar"><div className="breadcrumb">THE EXPEDITION <ChevronRight size={12}/><span>{currentPhase === 'waiting' ? '베이스캠프' : currentPhase === 'placing' ? '비밀 배치' : currentPhase === 'playing' ? '정상으로 가는 길' : '탐험의 기록'}</span></div><div className="game-topbar-right">{demo && <span className="demo-badge">나 + 데모 탐험가 5명</span>}{currentPhase !== 'waiting' && <span className="round-counter">ROUND <b>{String(view.round).padStart(2, '0')}</b><span>/ {String(view.totalRounds).padStart(2, '0')}</span></span>}{!demo && <button className="text-button copy-code" onClick={copyLink}><Copy size={13}/>{view.code}</button>}</div></div>
      {(error || connection) && <div className={`game-alert ${connection ? 'connection-alert' : ''}`} role="alert">{connection && <LoaderCircle size={16} className="spin"/>}<span>{error || connection}</span>{error && <button className="icon-button" onClick={() => setError('')} aria-label="알림 닫기"><X size={15}/></button>}</div>}

      {currentPhase === 'waiting' ? <section className="lobby">
        <div className="eyebrow"><span className="tiny-diamond"/> BASECAMP</div><h1>기억을 함께할<br/><span>탐험가를 기다려요.</span></h1><p className="section-description">여섯 명이 모이면, 첫 번째 탐험이 시작됩니다.</p>
        <div className="invite-box"><div><span className="eyebrow">INVITE CODE</span><strong>{view.code}</strong></div><button className="button button-outline" onClick={copyLink}><Copy size={16}/>초대 링크 복사</button></div>
        <div className="lobby-seats">{Array.from({length: 6}, (_, seat) => {const player = view.players.find(person => person.seat === seat);return <div className={`lobby-seat ${player ? 'seat-filled' : ''}`} key={seat}><span className="seat-index">EXPLORER 0{seat + 1}</span>{player ? <><Avatar name={player.name} seat={seat} large/><h3>{player.name}{player.id === view.selfId && <span>나</span>}</h3><p>{player.id === view.hostId ? <><Crown size={12}/> 방장</> : <><Check size={12}/> 합류 완료</>}</p></> : <><div className="empty-avatar"><Plus size={23}/></div><h3>빈 자리</h3><p>탐험가를 기다리는 중</p></>}</div>;})}</div>
        <div className="lobby-bottom"><span><span className="live-dot"/>{view.players.length} / 6명 합류</span>{host ? <button className="button button-primary" disabled={view.players.length !== 6 || busy || !!connection} onClick={() => void act({type:'start'})}>{busy ? <LoaderCircle className="spin" size={18}/> : <><Flag size={17}/> 탐험 시작하기<ArrowRight size={17}/></>}</button> : <div className="waiting-text"><LoaderCircle size={16} className="spin"/>방장이 탐험을 시작하면 함께 출발해요.</div>}</div>
      </section> : currentPhase === 'roundEnd' || currentPhase === 'finished' ? <section className="results">
        <div className="result-symbol"><Trophy size={38} strokeWidth={1.3}/></div><div className="eyebrow">{currentPhase === 'finished' ? 'THE EXPEDITION IS COMPLETE' : 'SUMMIT REACHED'}</div>
        <h1>{currentPhase === 'finished' ? <>{view.champions.map(seat => view.players.find(player => player.seat === seat)?.name).join(', ')}<br/><span>{view.champions.length > 1 ? '함께 정상에 서다.' : '최고의 기억을 증명하다.'}</span></> : <>{winner?.name},<br/><span>정상에 도착했어요.</span></>}</h1>
        {view.winner && <div className="score-equation"><span>정상 도착 <b>1</b></span><Plus size={16}/><span>남은 힌트 <b>{view.winner.remainingCoins}</b></span><span className="equal-sign">=</span><strong>+{view.winner.points}<small> POINTS</small></strong></div>}
        <div className="leaderboard"><div className="leaderboard-header"><span>탐험가</span><span>누적 점수</span></div>{[...view.players].sort((a,b) => b.score - a.score || a.seat - b.seat).map((player,index) => <div className={`leaderboard-row ${view.champions.includes(player.seat) ? 'champion' : ''}`} key={player.id}><span className="rank">{index && player.score === [...view.players].sort((a,b) => b.score - a.score || a.seat - b.seat)[index-1]?.score ? '=' : String(index+1).padStart(2,'0')}</span><Avatar name={player.name} seat={player.seat}/><strong>{player.name}</strong>{player.id === view.selfId && <span className="you-tag">나</span>}<b>{player.score}<small>pt</small></b></div>)}</div>
        {host || demo ? <button className="button button-primary result-next" disabled={busy || !!connection} onClick={() => void act({type: currentPhase === 'finished' ? 'restart' : 'nextRound'})}>{busy ? <LoaderCircle className="spin" size={18}/> : <>{currentPhase === 'finished' ? '새로운 탐험 시작' : '다음 라운드 배치하기'}<ArrowRight size={18}/></>}</button> : <p className="waiting-text"><LoaderCircle className="spin" size={16}/>방장이 다음 탐험을 준비하고 있어요.</p>}
        {currentPhase === 'roundEnd' && <p className="result-note">다음 라운드는 승자의 왼쪽 탐험가부터 시작합니다.</p>}
      </section> : <div className="play-layout">
        <aside className="players-panel"><div className="panel-label">EXPLORERS <span>06</span></div><div className="players-list">{view.players.map(player => <div className={`player-row ${currentPhase === 'playing' && player.seat === view.activeSeat ? 'player-active' : ''} ${player.id === view.selfId ? 'player-self' : ''}`} key={player.id}><Avatar name={player.name} seat={player.seat}/><div className="player-details"><strong>{player.name}{player.id === view.selfId && <span className="you-tag">나</span>}</strong><span>{currentPhase === 'placing' ? player.ready ? '배치 완료' : '필드를 설계하는 중' : player.seat === view.activeSeat ? '지금 탐색 중' : `SEAT 0${player.seat + 1}`}</span></div>{currentPhase === 'placing' && player.ready ? <Check size={17} className="ready-check"/> : <span className="player-score">{player.score}<small>pt</small></span>}</div>)}</div><div className="sidebar-note"><ArrowDownLeft size={18}/><p>판은 왼쪽으로,<br/>기억은 당신에게.</p></div><div className="seat-key"><span className="tiny-diamond"/> CLOCKWISE TURNS</div></aside>
        <section className="field-panel">
          <div className="field-heading"><div><span className="eyebrow">{currentPhase === 'placing' ? 'DESIGN YOUR FIELD' : 'TRUST YOUR MEMORY'}</span><h1>{currentPhase === 'placing' ? self?.ready ? '당신의 필드가 준비됐어요.' : '누군가의 길을 설계하세요.' : ownTurn ? '당신의 한 걸음입니다.' : `${active?.name ?? '탐험가'}의 한 걸음.`}</h1></div><span className={`phase-tag ${currentPhase === 'placing' ? 'secret-tag' : ''}`}>{currentPhase === 'placing' ? <><LockKeyhole size={12}/>나만 보는 판</> : <><span className="live-dot"/> 모두 함께 관전</>}</span></div>
          <p className="field-description">{currentPhase === 'placing' ? self?.ready ? '모두 배치를 마치면 판을 왼쪽으로 넘깁니다.' : '선분을 눌러 지뢰를 배치하세요. 정상으로 가는 길은 하나 이상 남겨두세요.' : hintMode ? '지뢰가 궁금한 선분을 선택하세요. 답변은 당신에게만 보입니다.' : event?.type === 'explosion' ? '지뢰가 터졌어요. 이 위치를 기억하세요.' : event?.type === 'rotation' ? '판을 왼쪽으로 전달합니다. 새로운 필드의 주인을 기억하세요.' : ownTurn ? view.position ? '연결된 점을 눌러 이동하세요. 기억이 당신의 길잡이입니다.' : '아래 다섯 출발점 중 하나를 골라 탐험을 시작하세요.' : '이동과 폭발을 잘 기억하세요. 지나간 길은 표시되지 않습니다.'}</p>
          <div className={`board-stage ${currentPhase === 'placing' ? 'stage-placement' : ''} ${event?.type === 'explosion' ? 'stage-explosion' : ''}`}>
            <div className="board-corner corner-tl"/><div className="board-corner corner-tr"/><div className="board-corner corner-bl"/><div className="board-corner corner-br"/>
            <div className="board-identity"><span className="mini-prism">△</span><span>{currentPhase === 'placing' ? self?.name : owner?.name}<small>의 필드</small></span></div><span className="field-id">FIELD / 0{(currentPhase === 'placing' ? self?.seat ?? 0 : view.boardOwnerSeat) + 1}</span>
            <Board placement={currentPhase === 'placing'} mines={currentPhase === 'placing' ? self?.ready ? view.ownMines ?? [] : draft : []} position={currentPhase === 'playing' ? view.position : null} event={event} disabled={busy || (currentPhase === 'placing' && self?.ready) || !!connection} allowedNodes={canAct && !hintMode ? available : []} onNode={canAct && !hintMode ? nodeId => void act({type: view.position ? 'move' : 'spawn', nodeId}) : undefined} onEdge={currentPhase === 'placing' && !self?.ready ? edgeId => setDraft(previous => previous.includes(edgeId) ? previous.filter(id => id !== edgeId) : [...previous,edgeId]) : canAct && hintMode ? edgeId => void act({type:'hint',edgeId}) : undefined} hintMode={hintMode} selectedEdge={privateHint?.edgeId}/>
            {event?.type === 'rotation' && <div className="rotation-overlay"><span><RotateCcw size={28}/></span><strong>기억을 가지고, 다음 판으로.</strong><p>자기 판은 건너뛰고 왼쪽으로 전달해요.</p></div>}
            <div className="board-bottomline"><span><span className="legend-dot"/>출발점 5개</span><span><span className="legend-diamond"/>하나의 정상</span><span className="board-scale">4 × TRIANGULAR GRID</span></div>
          </div>
          <div className="field-caption"><LockKeyhole size={13}/>{currentPhase === 'placing' ? '배치한 지뢰는 탐험이 시작되면 보이지 않습니다.' : '흔적도, 기록도 남지 않습니다. 당신의 기억만 남습니다.'}</div>
        </section>
        <aside className="action-panel">
          {currentPhase === 'placing' ? <><div className="panel-label">YOUR BLUEPRINT <LockKeyhole size={13}/></div><div className="placement-counter"><span>설치한 지뢰</span><strong>{self?.ready ? view.ownMines?.length ?? 0 : draft.length}<small>개</small></strong></div><div className={`path-status ${safe || self?.ready ? 'path-valid' : 'path-invalid'}`}>{safe || self?.ready ? <Check size={16}/> : <X size={16}/>}<span>{safe || self?.ready ? '정상까지 이어지는 길이 있어요' : '안전한 경로를 남겨주세요'}</span></div><p className="panel-description">밑변의 출발점 사이는 항상 열려 있어요. 지뢰는 나머지 선분에 자유롭게 설치할 수 있어요.</p><div className="placement-tools"><button className="button button-subtle" disabled={self?.ready || busy} onClick={() => setDraft(randomBoard())}><Shuffle size={15}/>랜덤 배치</button><button className="icon-button clear-button" disabled={self?.ready || busy || !draft.length} onClick={() => setDraft([])} aria-label="배치 모두 지우기"><RotateCcw size={16}/></button></div><button data-testid="confirm-placement" className="button button-primary full-width" disabled={self?.ready || !safe || busy || !!connection} onClick={() => void act({type:'place',mines:draft})}>{self?.ready ? <><Check size={17}/>배치 완료</> : busy ? <LoaderCircle className="spin" size={18}/> : <>이 배치로 준비 완료<ArrowRight size={16}/></>}</button><div className="placement-readiness"><span>{view.players.filter(player => player.ready).length} / 6명 준비 완료</span><div>{view.players.map(player => <i key={player.id} className={player.ready ? 'ready' : ''}/>)}</div></div><div className="tip-block"><span className="eyebrow">A SMALL STRATEGY</span><p>길을 막는 것보다,<br/>길을 헷갈리게 하는 것.<br/><strong>당신의 함정은 무엇인가요?</strong></p></div></> : <><div className="panel-label">YOUR POCKET <Coins size={15}/></div><div className="hint-heading"><h2>기억의 작은 단서</h2><span>{self?.coins ?? 0}<small> / 3</small></span></div><CoinsDisplay count={self?.coins ?? 0}/><p className="panel-description">코인 하나로 선분 하나의<br/>지뢰 유무를 확인할 수 있어요.<br/>답은 당신만, 딱 한 번.</p><button data-testid="hint-button" className={`button ${hintMode ? 'button-cancel' : 'button-gold'} full-width`} disabled={!canAct || (!hintMode && !self?.coins)} onClick={() => setHintMode(previous => !previous)}>{hintMode ? <><X size={16}/>선분 선택 취소</> : <><Sparkles size={16}/>힌트 사용하기<small>−1</small></>}</button><p className="hint-footnote">{ownTurn ? hintMode ? '판 위의 선분을 선택하세요.' : !self?.coins ? '이번 라운드의 코인을 모두 사용했어요.' : '남긴 코인은 승리 시 점수가 됩니다.' : '자기 차례에 힌트를 사용할 수 있어요.'}</p><div className="turn-info"><span className="eyebrow">CURRENT EXPEDITION</span><div><RotateCcw size={14}/><span>로테이션</span><strong>{view.rotation}</strong></div><div><Flag size={14}/><span>라운드</span><strong>{view.round}<small> / {view.totalRounds}</small></strong></div></div><div className="tip-block"><span className="eyebrow">REMEMBER THIS</span><p>누군가의 실패가<br/>당신의 길이 될 수 있어요.<br/><strong>모든 걸음을 지켜보세요.</strong></p></div></>}
        </aside>
      </div>}
      <footer className="game-footer"><span><Mark small/>MINDMINER</span><p>{demo ? '데모 탐험가는 자동으로 움직입니다. 실제 게임에서는 각자의 브라우저로 접속해요.' : '함께 보고, 각자 기억하는 게임.'}</p><span><VolumeX size={13}/> 집중하는 테이블</span></footer>
    </>}

    {rules && <Modal title="여섯 개의 기억, 하나의 정상." onClose={() => setRules(false)} className="rules-modal"><p className="modal-intro">설계하고, 관찰하고, 기억하세요.<br/>자신이 만든 판은 절대 탐색하지 않습니다.</p><div className="rules-list"><div><span>01</span><section><h3>하나의 길을 남겨두세요.</h3><p>삼각형 선분에 지뢰를 배치합니다. 밑변은 지뢰를 설치할 수 없고, 정상까지 이어지는 안전한 길이 하나 이상 있어야 해요. 배치가 끝나면 판을 왼쪽으로 전달합니다.</p></section></div><div><span>02</span><section><h3>터지기 전까지, 계속 전진.</h3><p>밑변의 점에서 출발해 인접한 점으로 이동합니다. 모든 방향과 되돌아가기가 가능해요. 지뢰가 터지면 말만 사라지고 차례가 시계방향으로 넘어갑니다. 지뢰는 계속 남아 있어요.</p></section></div><div><span>03</span><section><h3>판은 돌아가고, 기억은 쌓입니다.</h3><p>전원이 실패하면 판을 왼쪽으로 넘깁니다. 자기 판이 오면 모두 한 번 더 넘겨요. 재시도는 항상 출발점부터. 이동·폭발·힌트 기록은 남지 않습니다.</p></section></div><div><span>04</span><section><h3>세 개의 코인, 당신만의 단서.</h3><p>라운드마다 힌트 코인 3개를 받습니다. 자기 차례에 원하는 선분 하나의 지뢰 유무를 본인만 확인해요. 말이나 차례에 영향은 없고, 다시 확인하려면 코인을 또 사용해야 합니다.</p></section></div><div><span>05</span><section><h3>가장 먼저 도착한 기억이 승리.</h3><p>누군가 정상에 도착하면 라운드가 끝납니다. 도착 1점 + 남은 힌트 수만큼 득점해요. 7라운드 누적 점수로 승리하며 동점은 공동 우승입니다. 첫 시작은 무작위, 이후에는 이전 승자의 왼쪽 사람부터 시작합니다.</p></section></div></div><button className="button button-primary full-width" onClick={() => setRules(false)}>좋아요, 기억할게요<Check size={16}/></button></Modal>}
    {privateHint && <Modal title="당신만의 단서입니다." onClose={() => setHint(null)} className="hint-modal"><div data-testid="hint-dialog" className={`hint-revelation ${privateHint.mined ? 'is-mined' : ''}`}><span>{privateHint.mined ? <X size={28}/> : <Check size={28}/>}</span><strong>{privateHint.mined ? '지뢰가 있어요.' : '지뢰가 없어요.'}</strong><p>선택한 선분을 기억하세요.</p></div><div className="hint-preview"><Board selectedEdge={privateHint.edgeId}/></div><p className="hint-warning">닫으면 이 답변은 사라집니다.<br/>다시 묻는 데에도 코인 하나가 필요해요.</p><button className="button button-primary full-width" onClick={() => setHint(null)}>기억했어요. 닫기<Check size={17}/></button></Modal>}
    {leaving && <Modal title="테이블을 잠시 떠날까요?" onClose={() => setLeaving(false)}><p className="modal-intro">{demo ? '진행 중인 데모는 종료됩니다. 언제든 새 데모를 시작할 수 있어요.' : '게임은 계속 진행되고, 내 자리는 유지됩니다. 이 브라우저에서 이전 방으로 다시 연결할 수 있어요.'}</p><div className="modal-actions"><button className="button button-outline" onClick={() => setLeaving(false)}>계속 플레이</button><button className="button button-primary" onClick={leave}>홈으로 이동<ArrowRight size={16}/></button></div></Modal>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </main>;
}
