'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronRight, Coins, Copy, Crown, DoorOpen, Flag, LoaderCircle, LockKeyhole, Play, Plus, RotateCcw, Shuffle, Search, Trophy, Users, X } from 'lucide-react';
import { Board } from '@/components/mindminer/board';
import { Modal } from '@/components/mindminer/modal';
import { EDGES, STARTS, hasSafePath, randomBoard, viewFor } from '@/lib/game';
import { createDemo, tickDemo, demoAction, DEMO_SELF_ID } from '@/lib/demo';
import type { ApiReply, GameAction, GameState, PrivateResult, RoomView } from '@/lib/contracts';

const SESSION_KEY = 'mindminer.membership.v1';
const COLORS = ['#39765a', '#946721', '#7a5e9b', '#3f7691', '#a65d4e', '#79763a'];
type Session = { code: string; token: string };
type Hint = PrivateResult & { round: number; seat: number; code: string; selfId: string; rotation: number; ownerSeat: number };

function Mark({ small = false }: { small?: boolean }) {
  return <svg width={small ? 25 : 34} height={small ? 27 : 36} viewBox="0 0 36 38" fill="none" aria-hidden="true"><path d="M18 3 34 32H2L18 3Z" stroke="currentColor" strokeWidth="1.6"/><path d="M18 3v19L2 32m16-10 16 10M10 17h16M10 17l8 15 8-15" stroke="currentColor" strokeWidth="1.3"/><circle cx="18" cy="22" r="2.5" fill="currentColor"/></svg>;
}
function CoinsDisplay({ count = 3 }: { count?: number }) {
  return <div className="coin-row" aria-label={`남은 힌트 코인 ${count}개`}>{[0, 1, 2].map(index => <span className={`coin ${index >= count ? 'coin-spent' : ''}`} key={index}><Coins size={20} strokeWidth={1.7}/></span>)}</div>;
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
      <div className="header-center"><span className="live-dot"/>{view ? demo ? '혼자 연습' : `방 ${view.code}` : '함께 보고, 각자 기억하는 게임'}</div>
      <nav className="header-nav"><button className="text-button rules-button" onClick={() => setRules(true)}><BookOpen size={16}/><span>플레이 방법</span></button>{view && <button className="icon-button exit-button" onClick={() => setLeaving(true)} aria-label="홈으로 나가기"><DoorOpen size={19}/></button>}</nav>
    </header>

    {!view ? <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow hero-eyebrow">6인 기억 전략 보드게임</div>
          <h1>기억을 믿고,<br/><span>정상까지.</span></h1>
          <p className="hero-description">서로의 판에 숨은 지뢰를 피해 정상을 찾아가세요.<br/>지나간 길을 기억하는 것이 이 게임의 전부입니다.</p>
          <div className="hero-meta"><span><Users size={15}/> 6명</span><i/><span><Flag size={15}/> 7라운드</span><i/><span><Coins size={15}/> 힌트 3개</span></div>
          <div className="entry-panel">
            <div className="entry-tabs" role="tablist" aria-label="게임 참가 방식"><button role="tab" aria-selected={tab === 'create'} onClick={() => {setTab('create');setError('');}} className={tab === 'create' ? 'selected' : ''}><Plus size={16}/> 방 만들기</button><button role="tab" aria-selected={tab === 'join'} onClick={() => {setTab('join');setError('');}} className={tab === 'join' ? 'selected' : ''}><Users size={16}/> 코드로 참가</button></div>
            <form onSubmit={enterRoom} className="entry-form">
              <label htmlFor="nickname">플레이어 이름</label>
              <div className="entry-inputs"><input id="nickname" value={name} onChange={event => setName(event.target.value)} placeholder="이름을 입력하세요" maxLength={12} required autoComplete="nickname" disabled={!hydrated || busy || restoring}/>{tab === 'join' && <input value={code} onChange={event => setCode(event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6))} placeholder="방 코드" aria-label="방 코드" className="code-input" required minLength={6} maxLength={6} disabled={!hydrated || busy || restoring}/>}<button className="button button-primary" type="submit" disabled={!hydrated || busy || restoring}>{busy || restoring ? <LoaderCircle className="spin" size={18}/> : <>{tab === 'create' ? '방 만들기' : '입장하기'}<ArrowRight size={17}/></>}</button></div>
              <p className="form-note"><LockKeyhole size={12}/> 방을 만든 뒤 초대 링크를 친구들에게 보내세요.</p>
            </form>
          </div>
          <button className="demo-link" onClick={startDemo} disabled={!hydrated || busy || restoring}><span className="play-circle"><Play size={12} fill="currentColor"/></span><strong>혼자 연습하기</strong><span>봇 5명과 데모 플레이</span><ArrowRight size={15}/></button>
          {savedSession && !restoring && <button className="resume-link" onClick={() => {setSession(savedSession);setRestoring(true);setError('');}}>이전 방 {savedSession.code}에 다시 연결 <ArrowRight size={12}/></button>}
          {(error || connection) && <div className="error-message" role="alert">{error || connection}</div>}
        </div>
        <div className="hero-art">
          <Board illustration/>
          <p className="art-bottom">출발점은 다섯 곳. 목표는 하나.</p>
        </div>
      </section>
      <section className="principles" aria-label="게임의 세 단계">
        <div><span className="principle-number">1</span><div><h3>배치하기</h3><p>안전한 길 하나를 남기고 선분에 지뢰를 놓아요.</p></div></div>
        <div><span className="principle-number">2</span><div><h3>기억하기</h3><p>다른 사람의 이동과 폭발을 보고 기억해요.</p></div></div>
        <div><span className="principle-number">3</span><div><h3>정상에 도착하기</h3><p>먼저 도착하면 1점 + 남은 힌트만큼 득점해요.</p></div></div>
      </section>
      <footer className="home-footer"><span>MindMiner</span><span>6명 · 7라운드 · 가장 높은 점수가 승리</span></footer>
    </> : <>
      <div className="game-topbar"><div className="breadcrumb">게임 <ChevronRight size={12}/><span>{currentPhase === 'waiting' ? '대기실' : currentPhase === 'placing' ? '지뢰 배치' : currentPhase === 'playing' ? '탐색' : '결과'}</span></div><div className="game-topbar-right">{demo && <span className="demo-badge">나 + 봇 5명</span>}{currentPhase !== 'waiting' && <span className="round-counter">라운드 <b>{String(view.round).padStart(2, '0')}</b><span>/ {String(view.totalRounds).padStart(2, '0')}</span></span>}{!demo && <button className="text-button copy-code" onClick={copyLink}><Copy size={13}/>{view.code}</button>}</div></div>
      {(error || connection) && <div className={`game-alert ${connection ? 'connection-alert' : ''}`} role="alert">{connection && <LoaderCircle size={16} className="spin"/>}<span>{error || connection}</span>{error && <button className="icon-button" onClick={() => setError('')} aria-label="알림 닫기"><X size={15}/></button>}</div>}

      {currentPhase === 'waiting' ? <section className="lobby">
        <div className="eyebrow">대기실</div><h1>친구들을 초대하세요.</h1><p className="section-description">6명이 모두 모이면 방장이 게임을 시작할 수 있어요.</p>
        <div className="invite-box"><div><span className="eyebrow">초대 코드</span><strong>{view.code}</strong></div><button className="button button-outline" onClick={copyLink}><Copy size={16}/>초대 링크 복사</button></div>
        <div className="lobby-seats">{Array.from({length: 6}, (_, seat) => {const player = view.players.find(person => person.seat === seat);return <div className={`lobby-seat ${player ? 'seat-filled' : ''}`} key={seat}><span className="seat-index">{seat + 1}번 자리</span>{player ? <><Avatar name={player.name} seat={seat} large/><h3>{player.name}{player.id === view.selfId && <span>나</span>}</h3><p>{player.id === view.hostId ? <><Crown size={12}/> 방장</> : <><Check size={12}/> 합류 완료</>}</p></> : <><div className="empty-avatar"><Plus size={23}/></div><h3>빈 자리</h3><p>참가 대기 중</p></>}</div>;})}</div>
        <div className="lobby-bottom"><span><span className="live-dot"/>{view.players.length} / 6명 합류</span>{host ? <button className="button button-primary" disabled={view.players.length !== 6 || busy || !!connection} onClick={() => void act({type:'start'})}>{busy ? <LoaderCircle className="spin" size={18}/> : <><Flag size={17}/> 게임 시작하기<ArrowRight size={17}/></>}</button> : <div className="waiting-text"><LoaderCircle size={16} className="spin"/>방장이 게임을 시작하기를 기다리고 있어요.</div>}</div>
      </section> : currentPhase === 'roundEnd' || currentPhase === 'finished' ? <section className="results">
        <div className="result-symbol"><Trophy size={38} strokeWidth={1.3}/></div><div className="eyebrow">{currentPhase === 'finished' ? '최종 결과' : `라운드 ${view.round} 종료`}</div>
        <h1>{currentPhase === 'finished' ? <>{view.champions.map(seat => view.players.find(player => player.seat === seat)?.name).join(', ')}<br/><span>{view.champions.length > 1 ? '공동 우승!' : '최종 우승!'}</span></> : <>{winner?.name},<br/><span>정상에 도착했어요.</span></>}</h1>
        {view.winner && <div className="score-equation"><span>정상 도착 <b>1</b></span><Plus size={16}/><span>남은 힌트 <b>{view.winner.remainingCoins}</b></span><span className="equal-sign">=</span><strong>+{view.winner.points}<small>점</small></strong></div>}
        <div className="leaderboard"><div className="leaderboard-header"><span>플레이어</span><span>누적 점수</span></div>{[...view.players].sort((a,b) => b.score - a.score || a.seat - b.seat).map((player,index) => <div className={`leaderboard-row ${view.champions.includes(player.seat) ? 'champion' : ''}`} key={player.id}><span className="rank">{index && player.score === [...view.players].sort((a,b) => b.score - a.score || a.seat - b.seat)[index-1]?.score ? '=' : String(index+1).padStart(2,'0')}</span><Avatar name={player.name} seat={player.seat}/><strong>{player.name}</strong>{player.id === view.selfId && <span className="you-tag">나</span>}<b>{player.score}<small>pt</small></b></div>)}</div>
        {host || demo ? <button className="button button-primary result-next" disabled={busy || !!connection} onClick={() => void act({type: currentPhase === 'finished' ? 'restart' : 'nextRound'})}>{busy ? <LoaderCircle className="spin" size={18}/> : <>{currentPhase === 'finished' ? '새 게임 시작' : '다음 라운드 배치하기'}<ArrowRight size={18}/></>}</button> : <p className="waiting-text"><LoaderCircle className="spin" size={16}/>방장이 다음 라운드를 준비하고 있어요.</p>}
        {currentPhase === 'roundEnd' && <p className="result-note">다음 라운드는 승자의 왼쪽 사람부터 시작합니다.</p>}
      </section> : <div className="play-layout">
        <aside className="players-panel"><div className="panel-label">플레이어 <span>6명</span></div><div className="players-list">{view.players.map(player => <div className={`player-row ${currentPhase === 'playing' && player.seat === view.activeSeat ? 'player-active' : ''} ${player.id === view.selfId ? 'player-self' : ''}`} key={player.id}><Avatar name={player.name} seat={player.seat}/><div className="player-details"><strong>{player.name}{player.id === view.selfId && <span className="you-tag">나</span>}</strong><span>{currentPhase === 'placing' ? player.ready ? '배치 완료' : '배치 중' : player.seat === view.activeSeat ? '지금 탐색 중' : `${player.seat + 1}번 자리`}</span></div>{currentPhase === 'placing' && player.ready ? <Check size={17} className="ready-check"/> : <span className="player-score">{player.score}<small>pt</small></span>}</div>)}</div></aside>
        <section className="field-panel">
          <div className="field-heading"><div><h1>{currentPhase === 'placing' ? self?.ready ? '배치를 마쳤어요.' : '지뢰를 배치하세요.' : ownTurn ? '내 차례입니다.' : `${active?.name ?? '플레이어'}님의 차례`}</h1></div><span className={`phase-tag ${currentPhase === 'placing' ? 'secret-tag' : ''}`}>{currentPhase === 'placing' ? <><LockKeyhole size={12}/>나만 보는 판</> : <><span className="live-dot"/> 모두에게 공개</>}</span></div>
          <p className="field-description">{currentPhase === 'placing' ? self?.ready ? '모두 배치를 마치면 판을 왼쪽으로 넘깁니다.' : '선분을 눌러 지뢰를 배치하세요. 정상으로 가는 길은 하나 이상 남겨두세요.' : hintMode ? '지뢰가 궁금한 선분을 선택하세요. 답변은 당신에게만 보입니다.' : event?.type === 'explosion' ? '지뢰가 터졌어요. 이 위치를 기억하세요.' : event?.type === 'rotation' ? '판을 왼쪽으로 전달합니다. 새 판의 주인을 확인하세요.' : ownTurn ? view.position ? '연결된 점을 눌러 이동하세요. 지뢰가 터지기 전까지 계속 이동할 수 있어요.' : '밑변의 출발점 하나를 눌러 시작하세요.' : '이동과 폭발을 잘 기억하세요. 지나간 길은 표시되지 않습니다.'}</p>
          <div className={`board-stage ${currentPhase === 'placing' ? 'stage-placement' : ''} ${event?.type === 'explosion' ? 'stage-explosion' : ''}`}>
            <div className="board-identity"><span>{currentPhase === 'placing' ? self?.name : owner?.name}<small>의 판</small></span></div>
            <Board placement={currentPhase === 'placing'} mines={currentPhase === 'placing' ? self?.ready ? view.ownMines ?? [] : draft : []} position={currentPhase === 'playing' ? view.position : null} event={event} disabled={busy || (currentPhase === 'placing' && self?.ready) || !!connection} allowedNodes={canAct && !hintMode ? available : []} onNode={canAct && !hintMode ? nodeId => void act({type: view.position ? 'move' : 'spawn', nodeId}) : undefined} onEdge={currentPhase === 'placing' && !self?.ready ? edgeId => setDraft(previous => previous.includes(edgeId) ? previous.filter(id => id !== edgeId) : [...previous,edgeId]) : canAct && hintMode ? edgeId => void act({type:'hint',edgeId}) : undefined} hintMode={hintMode} selectedEdge={privateHint?.edgeId}/>
            {event?.type === 'rotation' && <div className="rotation-overlay"><span><RotateCcw size={28}/></span><strong>판을 왼쪽으로 넘깁니다.</strong><p>자기 판은 건너뛰고 왼쪽으로 전달해요.</p></div>}
            <div className="board-bottomline"><span><span className="legend-dot"/>출발점 5개</span><span><span className="legend-diamond"/>하나의 정상</span></div>
          </div>
          <div className="field-caption"><LockKeyhole size={13}/>{currentPhase === 'placing' ? '탐색이 시작되면 배치한 지뢰가 숨겨집니다.' : '이동·폭발·힌트 기록은 남지 않습니다.'}</div>
        </section>
        <aside className="action-panel">
          {currentPhase === 'placing' ? <><div className="panel-label">지뢰 배치 <LockKeyhole size={13}/></div><div className="placement-counter"><span>설치한 지뢰</span><strong>{self?.ready ? view.ownMines?.length ?? 0 : draft.length}<small>개</small></strong></div><div className={`path-status ${safe || self?.ready ? 'path-valid' : 'path-invalid'}`}>{safe || self?.ready ? <Check size={16}/> : <X size={16}/>}<span>{safe || self?.ready ? '정상까지 이어지는 길이 있어요' : '안전한 경로를 남겨주세요'}</span></div><p className="panel-description">밑변의 출발점 사이는 항상 열려 있어요. 지뢰는 나머지 선분에 자유롭게 설치할 수 있어요.</p><div className="placement-tools"><button className="button button-subtle" disabled={self?.ready || busy} onClick={() => setDraft(randomBoard())}><Shuffle size={15}/>랜덤 배치</button><button className="icon-button clear-button" disabled={self?.ready || busy || !draft.length} onClick={() => setDraft([])} aria-label="배치 모두 지우기"><RotateCcw size={16}/></button></div><button data-testid="confirm-placement" className="button button-primary full-width" disabled={self?.ready || !safe || busy || !!connection} onClick={() => void act({type:'place',mines:draft})}>{self?.ready ? <><Check size={17}/>배치 완료</> : busy ? <LoaderCircle className="spin" size={18}/> : <>이 배치로 준비 완료<ArrowRight size={16}/></>}</button><div className="placement-readiness"><span>{view.players.filter(player => player.ready).length} / 6명 준비 완료</span><div>{view.players.map(player => <i key={player.id} className={player.ready ? 'ready' : ''}/>)}</div></div></> : <><div className="panel-label">내 힌트 <Coins size={15}/></div><div className="hint-heading"><h2>남은 힌트 코인</h2><span>{self?.coins ?? 0}<small> / 3</small></span></div><CoinsDisplay count={self?.coins ?? 0}/><p className="panel-description">코인 1개로 선분 하나를 확인합니다. 답은 나에게만 보이고, 닫으면 사라져요.</p><button data-testid="hint-button" className={`button ${hintMode ? 'button-cancel' : 'button-gold'} full-width`} disabled={!canAct || (!hintMode && !self?.coins)} onClick={() => setHintMode(previous => !previous)}>{hintMode ? <><X size={16}/>선분 선택 취소</> : <><Search size={16}/>힌트 사용하기<small>−1</small></>}</button><p className="hint-footnote">{ownTurn ? hintMode ? '판 위의 선분을 선택하세요.' : !self?.coins ? '이번 라운드의 코인을 모두 사용했어요.' : '남긴 코인은 승리 시 점수가 됩니다.' : '자기 차례에 힌트를 사용할 수 있어요.'}</p><div className="turn-info"><span className="eyebrow">진행 상황</span><div><RotateCcw size={14}/><span>로테이션</span><strong>{view.rotation}</strong></div><div><Flag size={14}/><span>라운드</span><strong>{view.round}<small> / {view.totalRounds}</small></strong></div></div></>}
        </aside>
      </div>}
      <footer className="game-footer"><span><Mark small/>MINDMINER</span><p>{demo ? '봇 5명이 자동으로 플레이합니다. 온라인 게임은 각자의 브라우저로 접속하세요.' : '함께 보고, 각자 기억하는 게임.'}</p></footer>
    </>}

    {rules && <Modal title="플레이 방법" onClose={() => setRules(false)} className="rules-modal"><p className="modal-intro">지뢰를 배치하고 다른 사람의 판을 탐색합니다.<br/>자신이 만든 판은 플레이하지 않습니다.</p><div className="rules-list"><div><span>01</span><section><h3>지뢰 배치</h3><p>삼각형 선분에 지뢰를 배치합니다. 밑변은 지뢰를 설치할 수 없고, 정상까지 이어지는 안전한 길이 하나 이상 있어야 해요. 배치가 끝나면 판을 왼쪽으로 전달합니다.</p></section></div><div><span>02</span><section><h3>이동과 폭발</h3><p>밑변의 점에서 출발해 인접한 점으로 이동합니다. 모든 방향과 되돌아가기가 가능해요. 지뢰가 터지면 말만 사라지고 차례가 시계방향으로 넘어갑니다. 지뢰는 계속 남아 있어요.</p></section></div><div><span>03</span><section><h3>판 돌리기</h3><p>전원이 실패하면 판을 왼쪽으로 넘깁니다. 자기 판이 오면 모두 한 번 더 넘겨요. 재시도는 항상 출발점부터. 이동·폭발·힌트 기록은 남지 않습니다.</p></section></div><div><span>04</span><section><h3>힌트 사용</h3><p>라운드마다 힌트 코인 3개를 받습니다. 자기 차례에 원하는 선분 하나의 지뢰 유무를 본인만 확인해요. 말이나 차례에 영향은 없고, 다시 확인하려면 코인을 또 사용해야 합니다.</p></section></div><div><span>05</span><section><h3>점수와 승리</h3><p>누군가 정상에 도착하면 라운드가 끝납니다. 도착 1점 + 남은 힌트 수만큼 득점해요. 7라운드 누적 점수로 승리하며 동점은 공동 우승입니다. 첫 시작은 무작위, 이후에는 이전 승자의 왼쪽 사람부터 시작합니다.</p></section></div></div><button className="button button-primary full-width" onClick={() => setRules(false)}>확인했어요<Check size={16}/></button></Modal>}
    {privateHint && <Modal title="당신만의 단서입니다." onClose={() => setHint(null)} className="hint-modal"><div data-testid="hint-dialog" className={`hint-revelation ${privateHint.mined ? 'is-mined' : ''}`}><span>{privateHint.mined ? <X size={28}/> : <Check size={28}/>}</span><strong>{privateHint.mined ? '지뢰가 있어요.' : '지뢰가 없어요.'}</strong><p>선택한 선분을 기억하세요.</p></div><div className="hint-preview"><Board selectedEdge={privateHint.edgeId}/></div><p className="hint-warning">닫으면 이 답변은 사라집니다.<br/>다시 묻는 데에도 코인 하나가 필요해요.</p><button className="button button-primary full-width" onClick={() => setHint(null)}>기억했어요. 닫기<Check size={17}/></button></Modal>}
    {leaving && <Modal title="홈으로 이동할까요?" onClose={() => setLeaving(false)}><p className="modal-intro">{demo ? '진행 중인 데모는 종료됩니다. 언제든 새 데모를 시작할 수 있어요.' : '게임은 계속 진행되고, 내 자리는 유지됩니다. 이 브라우저에서 이전 방으로 다시 연결할 수 있어요.'}</p><div className="modal-actions"><button className="button button-outline" onClick={() => setLeaving(false)}>계속 플레이</button><button className="button button-primary" onClick={leave}>홈으로 이동<ArrowRight size={16}/></button></div></Modal>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </main>;
}
