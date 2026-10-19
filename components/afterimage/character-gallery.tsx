'use client';

import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { RoleId } from '@/lib/contracts';
import { ABILITY_PROLOGUE, ROLE_DETAILS, ROLE_IDS } from '@/lib/roles';
import { Modal } from './modal';
import styles from './character-gallery.module.css';

const ROLE_MEASURES: Record<RoleId, { label: string; value: string; note: string }> = {
  illuminator: { label: '매 라운드', value: '힌트 +2', note: '기본 설정에서는 5개' },
  guardian: { label: '매 라운드', value: '가호 2회', note: '터져도 같은 차례에 재출발' },
  trapper: { label: '배치할 때', value: '위장 4곳', note: '지뢰와 안전한 길 모두 가능' },
  thief: { label: '매 라운드', value: '훔쳐보기 2회', note: '내 차례에 다른 사람의 메모 확인' },
  shifter: { label: '매 라운드', value: '지뢰 이동 7회', note: '두 번째 자기 차례부터, 판 선택 전' },
  recorder: { label: '매 라운드', value: '메모 ×2', note: '기본 메모 슬롯의 두 배' },
};

/** Small engraved-style emblems, drawn in the same line language as the board. */
function CharacterEmblem({ role }: { role: RoleId }) {
  return <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false" className={styles.emblem}>
    <g className={styles.emblemGuide} fill="none" strokeWidth="1">
      <path d="M100 17 187 168H13Z" />
      <path d="M56.5 92.5h87M34.7 130.3h130.6M56.5 168 121.7 55M143.5 168 78.3 55" />
    </g>
    <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      {role === 'illuminator' && <>
        <path className={styles.emblemPaper} d="M76 76h48l10 63H66Z" />
        <path d="M78 76v-9a22 22 0 0 1 44 0v9M69 139h62M72 150h56M100 29v-9M146 54l7-7M54 54l-7-7M148 105h11M41 105h11" />
        <path className={styles.emblemAccent} d="M100 90c0 12-10 14-10 24a10 10 0 0 0 20 0c0-5-3-8-4-10-1 5-4 5-5 7 1-9 2-14-1-21Z" />
        <path d="M80 83 73 132M120 83l7 49" strokeWidth="1.4" />
      </>}
      {role === 'guardian' && <>
        <path className={styles.emblemPaper} d="M100 42c14 13 29 19 47 23v45c0 22-22 42-47 56-25-14-47-34-47-56V65c18-4 33-10 47-23Z" />
        <path d="M100 54c11 9 23 15 35 19v37c0 16-16 33-35 45-19-12-35-29-35-45V73c12-4 24-10 35-19Z" strokeWidth="1.3" />
        <path className={styles.emblemAccent} d="m100 76 6 20 20 6-20 6-6 21-6-21-20-6 20-6Z" />
        <path d="M44 40v14M37 47h14M153 127v12M147 133h12" />
      </>}
      {role === 'trapper' && <>
        <path className={styles.emblemPaper} d="m48 86 52-37 52 37-52 36Z" />
        <path d="m48 106 52 36 52-36M48 126l52 36 52-36" />
        <path className={styles.emblemAccent} d="m84 85 16-11 16 11-16 11Z" />
        <path d="m72 69 13 10M115 95l13 10M72 102l13-10M115 78l13-10" strokeWidth="1.5" />
        <path d="M37 72v-9h9M154 63h9v9M37 138v9h9M154 147h9v-9" strokeWidth="1.5" />
      </>}
      {role === 'thief' && <>
        <path className={styles.emblemPaper} d="M67 51h73v101H67Z" />
        <path d="M59 60h-9v101h73v-9M79 65h36M79 74h22M79 132h38M79 141h25" strokeWidth="1.5" />
        <path className={styles.emblemPaper} d="M37 103c17-19 38-29 63-29s46 10 63 29c-17 19-38 29-63 29s-46-10-63-29Z" />
        <circle className={styles.emblemAccent} cx="100" cy="103" r="18" />
        <circle cx="100" cy="103" r="5" fill="currentColor" stroke="none" />
      </>}
      {role === 'shifter' && <>
        <path className={styles.emblemPaper} d="M83 80a26 26 0 1 1 0 52 26 26 0 0 1 0-52Z" />
        <path d="M83 72v8M83 132v8M49 106h8M109 106h8M59 82l6 6M101 124l6 6M59 130l6-6M101 88l6-6" />
        <circle cx="83" cy="106" r="7" className={styles.emblemAccent} />
        <path d="M54 58c28-23 67-17 85 12M125 68l16 4 3-17M145 142c-20 16-39 20-60 12M94 145l-12 8 7 13" className={styles.emblemAccent} />
        <circle cx="139" cy="112" r="15" strokeDasharray="3 5" strokeWidth="1.5" />
      </>}
      {role === 'recorder' && <>
        <path className={styles.emblemPaper} d="M100 64c-14-12-33-15-56-11v92c23-4 42-1 56 11 14-12 33-15 56-11V53c-23-4-42-1-56 11Z" />
        <path d="M100 65v90M57 70c10-1 20 1 30 5M57 87c10-1 20 1 30 5M57 104c10-1 20 1 30 5M57 121c10-1 20 1 30 5M112 127c10-4 20-6 30-5" strokeWidth="1.5" />
        <path className={styles.emblemAccent} d="m115 107 3-15 33-38 12 10-33 38Z" />
        <path d="m118 92 12 10M145 62l12 10" strokeWidth="1.5" />
      </>}
    </g>
  </svg>;
}

export function CharacterGallery({ onClose, initialRole }: { onClose: () => void; initialRole?: RoleId }) {
  const [index, setIndex] = useState(() => initialRole ? Math.max(0, ROLE_IDS.indexOf(initialRole)) : 0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const total = ROLE_IDS.length;

  function changeSlide(direction: number) {
    setIndex(current => (current + direction + total) % total);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        setIndex(current => (current + direction + total) % total);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        setIndex(event.key === 'Home' ? 0 : total - 1);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [total]);

  function finishSwipe(event: TouchEvent<HTMLDivElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.3) changeSlide(dx < 0 ? 1 : -1);
  }

  return <Modal title="특수 능력" onClose={onClose} className={styles.modal}>
    <section className={styles.gallery} data-testid="character-gallery" data-character-index={index} data-character-id={ROLE_IDS[index]} aria-roledescription="캐러셀" aria-label="여섯 가지 특수 능력">
      <div className={styles.intro}>
        <p>정상으로 향하는 여섯 가지 방법.</p>
        <span className={styles.counter} aria-hidden="true">{String(index + 1).padStart(2, '0')} <span>/ {String(total).padStart(2, '0')}</span></span>
      </div>
      <details className={styles.prologue}><summary>{ABILITY_PROLOGUE.title}<span>이야기의 시작</span></summary><p>{ABILITY_PROLOGUE.text}</p></details>
      <div className={styles.viewport}
        onTouchStart={event => { const touch = event.touches[0]; touchStart.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null; }}
        onTouchMove={event => { if (event.touches.length > 1) touchStart.current = null; }}
        onTouchEnd={finishSwipe}
        onTouchCancel={() => { touchStart.current = null; }}>
        <div className={styles.track} style={{ transform: `translateX(-${index * 100}%)` }}>
          {ROLE_IDS.map((role, slideIndex) => {
            const character = ROLE_DETAILS[role];
            const measure = ROLE_MEASURES[role];
            return <article key={role} className={styles.slide} role="group" aria-roledescription="슬라이드" aria-label={`${slideIndex + 1} / ${total}. ${character.name}`} aria-hidden={index !== slideIndex} inert={index !== slideIndex} data-testid="character-slide" data-character={role} data-active={index === slideIndex}>
              <div className={styles.figure}>
                <CharacterEmblem role={role} />
                <div className={styles.measure}><span>{measure.label}</span><strong>{measure.value}</strong><p>{measure.note}</p></div>
                <p className={styles.approach}>{character.approach}</p>
              </div>
              <div className={styles.detail}>
                <span className={styles.subtitle}>{character.subtitle}</span>
                <h3>{character.name}</h3>
                <div className={styles.story} data-testid="ability-story">{character.story.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
                <div className={styles.effect}><h4>이 능력을 가지면</h4><p className={styles.description}>{character.description}</p><ul className={styles.rules}>{character.rules.map(rule => <li key={rule}>{rule}</li>)}</ul></div>
              </div>
            </article>;
          })}
        </div>
      </div>
      <div className={styles.navigation}>
        <button type="button" className={styles.arrow} onClick={() => changeSlide(-1)} aria-label="이전 능력"><ArrowLeft size={19} /><span>이전</span></button>
        <div className={styles.dots} aria-label="능력 소개 선택">{ROLE_IDS.map((role, slideIndex) => <button type="button" key={role} aria-label={`${slideIndex + 1}. ${ROLE_DETAILS[role].name}`} aria-pressed={index === slideIndex} onClick={() => setIndex(slideIndex)}><span /></button>)}</div>
        <button type="button" className={styles.arrow} onClick={() => changeSlide(1)} aria-label="다음 능력"><span>다음</span><ArrowRight size={19} /></button>
      </div>
      <p className={styles.help}>화살표 키로 이동하거나 옆으로 밀어서 둘러보세요.</p>
      <span className={styles.srOnly} aria-live="polite" aria-atomic="true">{index + 1} / {total}, {ROLE_DETAILS[ROLE_IDS[index]].name}</span>
    </section>
  </Modal>;
}
