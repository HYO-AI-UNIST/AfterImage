'use client';

import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { Board } from './board';
import { edgeId } from '@/lib/geometry';
import type { GameEvent } from '@/lib/contracts';
import styles from './play-example.module.css';

const FIRST_MINES = [edgeId('1-0', '2-1'), edgeId('2-2', '3-2'), edgeId('3-0', '4-0')];
const SECOND_MINES = [edgeId('1-0', '2-0'), edgeId('2-0', '3-1'), edgeId('3-0', '4-1'), edgeId('3-3', '4-4')];
const HINT_EDGE = edgeId('3-2', '4-2');

interface ExampleFrame {
  duration: number;
  status: string;
  position?: string;
  mines?: string[];
  owner?: '민수' | '서연';
  event?: GameEvent;
  hint?: boolean;
  coins?: number;
  rotating?: boolean;
  completed?: boolean;
}

function move(from: string, to: string): GameEvent {
  return { id: `example-${from}-${to}`, type: 'move', actorSeat: 1, ownerSeat: 0, until: 0, from, to };
}

const STEPS: Array<{ label: string; title: string; description: string; frames: ExampleFrame[] }> = [
  {
    label: '배치',
    title: '지뢰 배치',
    description: '첫 라운드에는 모두 지뢰를 배치해요. 밑변을 제외한 선분의 절반까지 놓고, 정상까지 안전한 길은 하나 남깁니다.',
    frames: [
      { duration: 1000, status: '민수가 자기 판에 지뢰를 놓습니다.', mines: FIRST_MINES.slice(0, 1) },
      { duration: 1000, status: '출발점 사이에는 지뢰를 놓을 수 없어요.', mines: FIRST_MINES.slice(0, 2) },
      { duration: 2100, status: '지뢰 3개 배치 완료. 안전한 길도 남아 있어요.', mines: FIRST_MINES },
    ],
  },
  {
    label: '탐색',
    title: '남의 판 탐색',
    description: '나린이 민수의 판을 골랐어요. 밑변에서 출발해, 지뢰가 터지기 전까지 계속 이동합니다.',
    frames: [
      { duration: 1400, status: '나린이 출발점 2를 선택합니다.', position: '4-1' },
      { duration: 1400, status: '안전해요. 같은 차례에 계속 이동합니다.', position: '3-1', event: move('4-1', '3-1') },
      { duration: 1800, status: '지나온 길은 표시되지 않아요. 직접 기억하세요.', position: '2-1', event: move('3-1', '2-1') },
    ],
  },
  {
    label: '폭발',
    title: '지뢰를 밟으면 차례 종료',
    description: '말을 빼고 다음 사람에게 차례가 넘어가요. 지뢰는 그대로 남지만 폭발 흔적은 사라집니다.',
    frames: [
      { duration: 1700, status: '지뢰가 터졌어요. 나린의 말을 뺍니다.', event: { id: 'example-explosion', type: 'explosion', actorSeat: 1, ownerSeat: 0, until: 0, edgeId: FIRST_MINES[0] } },
      { duration: 2300, status: '다음 사람 차례. 방금 터진 위치를 기억하세요.' },
    ],
  },
  {
    label: '선택',
    title: '다음 사람도 원하는 판 선택',
    description: '서연도 민수의 판에 도전합니다. 자기 판만 아니라면 여러 사람이 같은 판을 골라도 좋아요.',
    frames: [
      { duration: 1800, status: '서연이 방금 본 민수의 판을 골랐어요.' },
      { duration: 2200, status: '차례가 한 바퀴 돌아 나린은 서연의 판을 고릅니다.', owner: '서연', rotating: true },
    ],
  },
  {
    label: '힌트',
    title: '힌트는 나만 잠깐 확인',
    description: '힌트 코인 1개로 선분 하나를 확인해요. 말과 차례는 그대로, 답은 사라지니 기억해야 합니다.',
    frames: [
      { duration: 1400, status: '나린이 새 판의 출발점 3에서 시작합니다.', position: '4-2' },
      { duration: 2400, status: '나린만 답을 확인합니다. 힌트 코인 3 → 2개.', position: '4-2', hint: true, coins: 2 },
      { duration: 1800, status: '답은 사라졌어요. 말은 움직이지 않았습니다.', position: '4-2', coins: 2 },
    ],
  },
  {
    label: '도착',
    title: '정상에 먼저 도착하기',
    description: '정상에 도착하면 판 주인에게서 승점 코인 1개를 받아요. 나린은 4개, 서연은 2개가 됩니다. 남은 힌트는 승점에 더하지 않아요.',
    frames: [
      { duration: 1000, status: '힌트로 확인한 길을 따라 정상으로 향합니다.', position: '4-2', coins: 2 },
      { duration: 1000, status: '안전한 선분을 건넜어요.', position: '3-2', coins: 2, event: move('4-2', '3-2') },
      { duration: 1000, status: '계속해서 위로 이동합니다.', position: '2-1', coins: 2, event: move('3-2', '2-1') },
      { duration: 1000, status: '이제 정상까지 한 걸음 남았어요.', position: '1-1', coins: 2, event: move('2-1', '1-1') },
      { duration: 1000, status: '나린이 정상에 먼저 도착했어요!', position: '0-0', coins: 2, event: move('1-1', '0-0') },
      { duration: 2700, status: '서연에게서 나린에게 승점 코인 1개 이동. 다음 라운드는 서연만 새로 배치하고 다른 판은 유지해요.', position: '0-0', coins: 2, mines: SECOND_MINES, completed: true },
    ],
  },
];

const TIMELINE = STEPS.flatMap((step, stepIndex) => step.frames.map((frame, frameIndex) => ({ ...frame, stepIndex, frameIndex })));
const STEP_STARTS = STEPS.map((_, stepIndex) => TIMELINE.findIndex(frame => frame.stepIndex === stepIndex));

/** An isolated, scripted example; it never creates a room or reveals a real board. */
export function PlayExample({ onShowAbilities }: { onShowAbilities?: () => void }) {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const remaining = useRef(TIMELINE[0].duration);
  const frame = TIMELINE[cursor];
  const step = STEPS[frame.stepIndex];
  const owner = frame.owner ?? (frame.stepIndex >= 4 ? '서연' : '민수');
  const coins = frame.coins ?? 3;
  const totalMines = frame.stepIndex === 0 ? frame.mines?.length ?? 0 : owner === '민수' ? FIRST_MINES.length : SECOND_MINES.length;

  useEffect(() => { remaining.current = TIMELINE[cursor].duration; }, [cursor, resetVersion]);

  useEffect(() => {
    if (!playing) return;
    const began = performance.now();
    const timer = window.setTimeout(() => {
      if (cursor === TIMELINE.length - 1) { setPlaying(false); setFinished(true); }
      else setCursor(current => current + 1);
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - began));
    };
  }, [cursor, playing, resetVersion]);

  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => !entry.isIntersecting)) setPlaying(false);
    });
    if (rootRef.current) observer?.observe(rootRef.current);
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenHidden);
      observer?.disconnect();
    };
  }, []);

  function selectFrame(index: number) {
    setPlaying(false);
    setStarted(false);
    setFinished(false);
    setResetVersion(current => current + 1);
    setCursor(index);
  }

  function togglePlayback() {
    if (playing) { setPlaying(false); return; }
    if (finished) {
      setFinished(false);
      setResetVersion(current => current + 1);
      setCursor(0);
    }
    setStarted(true);
    setPlaying(true);
  }

  return (
    <section ref={rootRef} className={styles.example} aria-labelledby="play-example-title" data-testid="play-example" data-step={frame.stepIndex} data-frame={frame.frameIndex} data-playing={playing} data-started={started}>
      <header className={styles.heading}>
        <div><h2 id="play-example-title">예시 플레이</h2><p>6인 · 승점 코인 3개씩 시작</p></div>
        <span>기본 판 · 4등분</span>
      </header>
      <div className={styles.tableMeta}>
        <div><strong>{owner}의 판</strong><span>{frame.stepIndex === 0 ? '배치 중' : frame.stepIndex === 3 ? '판 선택' : frame.completed ? '정답 공개' : frame.stepIndex === 2 ? '차례 종료' : '나린 차례'}</span></div>
        <p aria-label={`예시 판의 총 지뢰 ${totalMines}개`}>총 지뢰 <b>{totalMines}</b><span>개</span></p>
      </div>
      <div className={styles.stage}>
        <div key={owner} className={`${styles.board} ${frame.rotating ? styles.rotating : ''}`}>
          <Board ownerSeat={owner === '민수' ? 0 : 2} mines={frame.mines ?? []} position={frame.position} event={frame.event} selectedEdge={frame.hint ? HINT_EDGE : undefined} />
        </div>
        {frame.hint && <div className={styles.hint}><span>나린만 보는 힌트</span><strong>이 선분은 안전해요.</strong></div>}
        {frame.completed && <div className={styles.result} data-testid="example-coin-transfer"><span>승점 코인 1개 이동</span><strong>서연 → 나린</strong><dl><div><dt>서연</dt><dd>3 → 2개</dd></div><div><dt>나린</dt><dd>3 → 4개</dd></div></dl></div>}
      </div>
      <div className={styles.boardFoot}>
        <p>{frame.status}</p>
        <div className={styles.coins} aria-label={`나린의 남은 힌트 ${coins}개`}><span>힌트</span>{[0, 1, 2].map(coin => <i key={coin} data-spent={coin >= coins} aria-hidden="true" />)}<b>{coins}</b></div>
      </div>
      <nav className={styles.steps} aria-label="예시 플레이 단계">
        {STEPS.map((item, index) => <button key={item.label} type="button" aria-label={`${index + 1}단계: ${item.title}`} aria-current={frame.stepIndex === index ? 'step' : undefined} onClick={() => selectFrame(STEP_STARTS[index])}><span>{String(index + 1).padStart(2, '0')}</span>{item.label}</button>)}
      </nav>
      <div className={styles.explanation} aria-live="polite" aria-atomic="true">
        <h3>{step.title}</h3><p>{step.description}</p>
      </div>
      <div className={styles.controls}>
        <div className={styles.mainActions}>
          <button type="button" className={styles.play} aria-label={playing ? '예시 일시정지' : '예시 재생'} onClick={togglePlayback}>
            {playing ? <Pause size={14} /> : finished ? <RotateCcw size={14} /> : <Play size={14} />}
            {playing ? '일시정지' : finished ? '다시 재생' : started ? '이어서 재생' : '예시 재생'}
          </button>
          {onShowAbilities && <button type="button" className={styles.abilities} onClick={() => { setPlaying(false); onShowAbilities(); }}><BookOpen size={14} />특수 능력</button>}
        </div>
        <button type="button" className={styles.previous} aria-label="이전 장면" disabled={cursor === 0} onClick={() => selectFrame(cursor - 1)}><ChevronLeft size={15} />이전</button>
        <button type="button" className={styles.next} aria-label="다음 장면" disabled={cursor === TIMELINE.length - 1} onClick={() => selectFrame(cursor + 1)}>다음<ChevronRight size={15} /></button>
      </div>
    </section>
  );
}
