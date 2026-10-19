'use client';
import { useEffect, useRef } from 'react';
import type { MineGame } from '@/lib/mine/engine';
export default function Home() {
    const canvas = useRef<HTMLCanvasElement>(null), input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        let game: MineGame | undefined, cancelled = false;
        void import('@/lib/mine/engine').then(({ MineGame }) => {
            if (cancelled || !canvas.current || !input.current)
                return;
            game = new MineGame(canvas.current, input.current);
        }).catch(error => {
            console.error(error);
            const c = canvas.current;
            if (!c || cancelled)
                return;
            c.setAttribute('aria-label', '3D 게임을 시작하지 못했습니다. WebGL이 지원되는 브라우저에서 다시 열어주세요.');
            const g = c.getContext('2d');
            if (g) {
                c.width = innerWidth;
                c.height = innerHeight;
                g.fillStyle = '#0b1118';
                g.fillRect(0, 0, c.width, c.height);
                g.textAlign = 'center';
                g.fillStyle = '#eee3cf';
                g.font = '20px sans-serif';
                g.fillText('WebGL이 지원되는 브라우저에서 다시 열어주세요.', c.width / 2, c.height / 2);
            }
        });
        return () => { cancelled = true; game?.dispose(); };
    }, []);
    return <main className="game-shell"><canvas ref={canvas} className="game-canvas" tabIndex={0} role="application" aria-label="MindMiner 3D 게임을 불러오는 중" data-phase="home"/><input ref={input} className="game-keyboard-input" type="text" autoComplete="off" spellCheck={false} aria-label="게임 내 이름 또는 방 코드 입력" tabIndex={-1}/></main>;
}
