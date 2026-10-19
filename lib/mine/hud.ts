import * as THREE from 'three';
import { EDGES, NODES, hasSafePath } from '../game';
import type { PrivateResult } from '../contracts';
import type { MineSession } from './session';
export type Overlay = 'entry' | 'help' | 'pause' | 'leave' | 'hint' | 'assets' | null;
export interface HudModel {
    session: MineSession;
    draft: string[];
    hintMode: boolean;
    overlay: Overlay;
    entry: 'create' | 'join';
    name: string;
    code: string;
    field: string | null;
    hint: PrivateResult | null;
    toast: string;
    loading: boolean;
    hover: string | null;
    focus: string | null;
    muted: boolean;
    turnAt: number;
}
export interface HitRegion {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    disabled: boolean;
    label: string;
}
type Frame = {
    x: number;
    y: number;
    w: number;
    h: number;
};
const C = { ivory: '#eee3cf', muted: '#a7b2b6', amber: '#e6ae55', teal: '#84bbb8', danger: '#d58773', coal: '#0b1118' };
export class MineHud {
    canvas = document.createElement('canvas');
    context = this.canvas.getContext('2d')!;
    texture = new THREE.CanvasTexture(this.canvas);
    regions: HitRegion[] = [];
    width = 1;
    height = 1;
    ready: Promise<void>;
    private image = new Image();
    private frames: Record<string, Frame> = {};
    private loaded = false;
    private model: HudModel | null = null;
    private dpr = 1;
    constructor() {
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.generateMipmaps = false;
        this.ready = Promise.all([fetch('/game/ui/atlas.json').then(r => { if (!r.ok)
                throw new Error('UI 이미지 정보를 불러올 수 없습니다.'); return r.json() as Promise<Record<string, Frame>>; }).then(f => this.frames = f), new Promise<void>((resolve, reject) => { this.image.onload = () => resolve(); this.image.onerror = () => reject(new Error('UI 이미지를 불러올 수 없습니다.')); this.image.src = '/game/ui/atlas.png'; }), document.fonts.load('500 16px Pretendard')]).then(() => { this.loaded = true; });
    }
    resize(w: number, h: number) { this.width = w; this.height = h; this.dpr = Math.min(devicePixelRatio, 1.5); this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr); }
    hit(x: number, y: number) { return [...this.regions].reverse().find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h); }
    private imageAt(name: string, x: number, y: number, w: number, h: number, alpha = 1) {
        const f = this.frames[name];
        if (!f || !this.loaded)
            return;
        const g = this.context;
        g.save();
        g.globalAlpha = alpha;
        g.drawImage(this.image, f.x, f.y, f.w, f.h, x, y, w, h);
        g.restore();
    }
    private frame(name: string, x: number, y: number, w: number, h: number, alpha = 1) {
        const f = this.frames[name];
        if (!f || !this.loaded)
            return;
        const g = this.context, b = 12, s = 12;
        g.save();
        g.globalAlpha = alpha;
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++) {
                const sx = f.x + (i === 0 ? 0 : i === 1 ? s : f.w - s), sy = f.y + (j === 0 ? 0 : j === 1 ? s : f.h - s), sw = i === 1 ? f.w - s * 2 : s, sh = j === 1 ? f.h - s * 2 : s;
                const dx = x + (i === 0 ? 0 : i === 1 ? b : w - b), dy = y + (j === 0 ? 0 : j === 1 ? b : h - b), dw = i === 1 ? w - b * 2 : b, dh = j === 1 ? h - b * 2 : b;
                if (dw > 0 && dh > 0)
                    g.drawImage(this.image, sx, sy, sw, sh, dx, dy, dw, dh);
            }
        g.restore();
    }
    private text(s: string, x: number, y: number, size = 14, color = C.ivory, weight = 500, align: CanvasTextAlign = 'left', max?: number) {
        const g = this.context;
        g.fillStyle = color;
        g.font = `${weight} ${size}px ${/^[\x00-\x7F]*$/.test(s) ? 'Menlo, monospace' : 'Pretendard, sans-serif'}`;
        g.textAlign = align;
        g.textBaseline = 'middle';
        if (max)
            g.fillText(s, x, y, max);
        else
            g.fillText(s, x, y);
    }
    private wrap(s: string, x: number, y: number, width: number, size = 14, color = C.muted, lh = 23) {
        const g = this.context;
        g.font = `500 ${size}px Pretendard, sans-serif`;
        let row = '', yy = y;
        for (const c of s) {
            if (c === '\n' || g.measureText(row + c).width > width) {
                this.text(row, x, yy, size, color);
                row = c === '\n' ? '' : c;
                yy += lh;
            }
            else
                row += c;
        }
        if (row)
            this.text(row, x, yy, size, color);
        return yy + lh;
    }
    private button(id: string, label: string, x: number, y: number, w: number, h = 46, primary = false, disabled = false, icon?: string) {
        const hover = this.model?.hover === id || this.model?.focus === id;
        this.frame(disabled ? 'button-disabled' : primary ? (hover ? 'button-hover' : 'button') : 'button-quiet', x, y, w, h);
        if (hover && !disabled) {
            this.context.strokeStyle = C.amber;
            this.context.lineWidth = 1;
            this.context.strokeRect(x + 1, y + 1, w - 2, h - 2);
        }
        if (icon)
            this.imageAt(icon, x + 12, y + (h - 22) / 2, 22, 22, disabled ? .4 : 1);
        if (label)
            this.text(label, x + w / 2 + (icon ? 9 : 0), y + h / 2, Math.min(14, w < 100 ? 12 : 14), disabled ? C.muted : primary ? C.coal : C.ivory, 700, 'center', w - 20);
        this.regions.push({ id, label: label || icon || id, x, y, w, h, disabled });
    }
    private scrim(alpha = .78) { this.context.fillStyle = `rgba(5,10,17,${alpha})`; this.context.fillRect(0, 0, this.width, this.height); }
    private panel(title: string, w: number, h: number) {
        this.scrim();
        const x = (this.width - w) / 2, y = Math.max(84, (this.height - h) / 2);
        this.frame('panel', x, y, w, h);
        this.text(title, x + 25, y + 35, 23, C.ivory, 700);
        this.button('close', '', x + w - 56, y + 12, 40, 40, false, false, 'close');
        this.context.fillStyle = '#3d4b55';
        this.context.fillRect(x + 22, y + 64, w - 44, 1);
        return { x, y, w, h };
    }
    draw(m: HudModel, time: number) {
        this.model = m;
        const { width: w, height: h } = this, g = this.context;
        g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        this.regions = [];
        const mobile = w < 700, v = m.session.view;
        // A raster vignette is part of the canvas HUD, never an HTML overlay.
        const vignette = g.createRadialGradient(w * .54, h * .44, h * .17, w * .5, h * .5, Math.max(w, h) * .7);
        vignette.addColorStop(0, 'rgba(3,8,14,0)');
        vignette.addColorStop(1, 'rgba(3,8,14,.66)');
        g.fillStyle = vignette;
        g.fillRect(0, 0, w, h);
        if (m.loading) {
            this.scrim(.7);
            this.text('MINDMINER', w / 2, h / 2 - 24, 32, C.ivory, 700, 'center');
            this.text('갱도에 작은 불을 켜는 중', w / 2, h / 2 + 26, 14, C.muted, 500, 'center');
            this.texture.needsUpdate = true;
            return;
        }
        if (!v)
            this.home(m, mobile);
        else {
            this.chrome(m, mobile);
            if (v.phase === 'waiting')
                this.lobby(m, mobile);
            else if (v.phase === 'roundEnd' || v.phase === 'finished')
                this.results(m, mobile);
            else
                this.game(m, mobile, time);
        }
        if (m.overlay)
            this.regions = [];
        if (m.overlay === 'entry')
            this.entry(m, mobile);
        if (m.overlay === 'help')
            this.help(mobile);
        if (m.overlay === 'pause')
            this.pause(m);
        if (m.overlay === 'leave')
            this.leave(m);
        if (m.overlay === 'hint')
            this.hint(m);
        if (m.overlay === 'assets')
            this.assets();
        if (m.session.error || m.session.connection) {
            const msg = m.session.error || m.session.connection, ww = Math.min(w - 32, 630);
            this.frame('panel', (w - ww) / 2, mobile ? 80 : 91, ww, 50);
            this.text(msg, (w) / 2, (mobile ? 80 : 91) + 25, 12, m.session.error ? C.danger : C.muted, 600, 'center', ww - 30);
        }
        if (m.toast) {
            const ww = Math.min(w - 32, 510);
            this.frame('panel-private', (w - ww) / 2, Math.max(80, h - 192), ww, 44);
            this.text(m.toast, w / 2, Math.max(80, h - 192) + 22, 12, C.ivory, 500, 'center', ww - 26);
        }
        this.texture.needsUpdate = true;
    }
    private home(m: HudModel, mobile: boolean) {
        const w = this.width, h = this.height, g = this.context;
        const shade = g.createLinearGradient(0, 0, w, 0);
        shade.addColorStop(0, 'rgba(6,12,20,.96)');
        shade.addColorStop(mobile ? .4 : .32, 'rgba(6,12,20,.8)');
        shade.addColorStop(1, 'rgba(6,12,20,0)');
        g.fillStyle = shade;
        g.fillRect(0, 0, w, h);
        const x = mobile ? 26 : Math.max(55, w * .075), y = mobile ? h * .34 : h * .30, logoW = mobile ? Math.min(w - 32, 440) : Math.min(w * .52, 680);
        this.text('QUIET MINE  /  MEMORY STRATEGY', x, mobile ? 32 : 44, 10, C.muted, 500);
        this.button('sound', '', w - 110, 20, 40, 40, false, false, m.muted ? 'muted' : 'sound');
        this.button('help', '', w - 60, 20, 40, 40, false, false, 'help');
        this.imageAt('logo', x - 3, y - 12, logoW, logoW * .236);
        this.text('빛은 잠깐, 기억은 오래.', x, y + logoW * .236 + 24, mobile ? 19 : 23, C.ivory, 600);
        this.text('다른 사람의 길을 보고, 나만의 출구를 찾으세요.', x, y + logoW * .236 + 59, mobile ? 12 : 14, C.muted, 400, 'left', w - x - 20);
        const by = y + logoW * .236 + 110, bw = mobile ? w - 52 : 294;
        this.button('practice', '혼자 탐험하기', x, by, bw, 52, true, false, 'compass');
        this.button('online', '친구와 플레이', x, by + 65, bw, 48);
        if (m.session.saved)
            this.button('resume', '이전 방으로 돌아가기', x, by + 126, bw, 44, false, m.session.restoring);
        this.text('6명의 광부  ·  7번의 탐험  ·  단 하나의 출구', x, h - 41, 11, C.muted, 400, 'left', w - x - 24);
        if (!mobile) {
            this.text('DRAG TO LOOK AROUND', w - 36, h - 43, 9, C.muted, 500, 'right');
            this.text('01 / THE FORGOTTEN SHAFT', w - 36, h - 63, 10, C.ivory, 600, 'right');
        }
    }
    private chrome(m: HudModel, mobile: boolean) {
        const w = this.width, v = m.session.view!;
        this.frame('panel', mobile ? 10 : 22, 14, w - (mobile ? 20 : 44), 52);
        this.text('MINDMINER', mobile ? 25 : 42, 40, mobile ? 14 : 18, C.ivory, 700);
        if (!mobile)
            this.text(m.session.demo ? 'SOLO EXPEDITION' : `ROOM ${v.code}`, w / 2, 40, 12, C.muted, 500, 'center');
        this.button('help', '', w - 114, 20, 38, 38, false, false, 'help');
        this.button('pause', '', w - 67, 20, 38, 38, false, false, 'pause');
        if (v.phase === 'waiting' || v.phase === 'roundEnd' || v.phase === 'finished')
            return;
        const cw = mobile ? (w - 30) / 6 : Math.min(112, (w - 300) / 6), gap = mobile ? 0 : 8, total = cw * 6 + gap * 5, sx = (w - total) / 2, sy = mobile ? 83 : 88;
        for (const p of v.players) {
            const x = sx + p.seat * (cw + gap), active = v.phase === 'playing' && p.seat === v.activeSeat, ww = cw - (mobile ? 4 : 0);
            if (active) {
                this.frame('button', x - 2, sy - 2, ww + 4, mobile ? 64 : 57, 1);
                this.frame('panel', x, sy, ww, mobile ? 60 : 53);
            }
            else
                this.frame('panel', x, sy, ww, mobile ? 60 : 53, .82);
            this.imageAt(`portrait-${p.seat}`, x + (mobile ? (ww - 32) / 2 : 5), sy + 3, mobile ? 32 : 36, mobile ? 36 : 41);
            if (mobile)
                this.text(p.name, x + ww / 2, sy + 48, 9, active ? C.amber : C.muted, 600, 'center', ww - 5);
            else {
                this.text(p.name, x + 48, sy + 17, 12, active ? C.amber : C.ivory, 600, 'left', ww - 51);
                this.text(v.phase === 'placing' ? (p.ready ? '준비 완료' : '배치 중') : `${p.score} pt`, x + 48, sy + 36, 10, C.muted, 400, 'left', ww - 51);
            }
            if (v.phase === 'placing' && p.ready)
                this.imageAt('check', x + ww - 15, sy + 2, 13, 13);
        }
        const owner = v.players.find(p => p.seat === v.boardOwnerSeat);
        this.text(v.phase === 'placing' ? '나의 갱도 · 비공개' : `${owner?.name ?? ''}의 갱도`, w / 2, mobile ? 166 : 163, 12, v.phase === 'placing' ? C.teal : C.muted, 500, 'center');
        this.text(`ROUND ${String(v.round).padStart(2, '0')} / ${String(v.totalRounds).padStart(2, '0')}`, mobile ? 17 : 42, mobile ? 165 : 103, mobile ? 9 : 11, C.muted, 500);
        if (!mobile)
            this.text(`전달 ${String(v.rotation).padStart(2, '0')}`, w - 44, 103, 10, C.muted, 500, 'right');
    }
    private game(m: HudModel, mobile: boolean, time: number) {
        const w = this.width, h = this.height, v = m.session.view!, self = m.session.self!, place = v.phase === 'placing', mine = m.session.ownTurn;
        const bw = Math.min(w - 28, 790), x = (w - bw) / 2, boxH = mobile ? 154 : 111, y = h - boxH - (mobile ? 18 : 25);
        this.frame('panel', x, y, bw, boxH);
        const t = place ? (self.ready ? '당신의 갱도가 준비됐어요' : '수렛길에 지뢰를 배치하세요') : v.event?.type === 'explosion' ? '폭발한 위치를 기억하세요' : v.event?.type === 'rotation' ? '판을 왼쪽으로 전달합니다' : mine ? (m.hintMode ? '확인할 선로를 고르세요' : v.position ? '연결된 분기점으로 이동하세요' : '출발역을 선택하세요') : `${v.players[v.activeSeat]?.name}의 탐험을 지켜보세요`;
        const titleColor = place ? C.ivory : mine ? C.amber : C.ivory;
        this.text(t, x + 21, y + 29, mobile ? 16 : 18, titleColor, 700, 'left', mobile ? bw - 38 : bw - 220);
        const desc = place ? self.ready ? '모두 준비하면 탐험이 시작됩니다.' : hasSafePath(m.draft) ? '탈출 승강기까지 안전한 길이 남아 있어요.' : '탈출 승강기까지 가는 길을 남겨주세요.' : m.hintMode ? '힌트는 나에게만 보이고, 코인 하나를 사용해요.' : v.event ? '잠시 후 다음 탐험이 이어집니다.' : '지나간 길은 사라져도, 기억은 남습니다.';
        this.text(desc, x + 21, y + 56, mobile ? 10 : 12, place && !hasSafePath(m.draft) ? C.danger : C.muted, 400, 'left', mobile ? bw - 36 : bw - 220);
        if (place) {
            this.text(`${self.ready ? v.ownMines?.length ?? 0 : m.draft.length}개 설치  ·  ${v.players.filter(p => p.ready).length}/6 준비`, x + 21, y + (mobile ? 80 : 84), 11, C.muted);
            const yy = mobile ? y + 101 : y + 30;
            this.button('random', '', mobile ? x + 16 : x + bw - 265, yy, 44, 44, false, self.ready || m.session.busy, 'random');
            this.button('clear', '', mobile ? x + 70 : x + bw - 213, yy, 44, 44, false, self.ready || m.session.busy, 'clear');
            this.button('ready', self.ready ? '준비 완료' : '이 배치로 출발', mobile ? x + 126 : x + bw - 158, yy, mobile ? bw - 142 : 139, 44, true, self.ready || !hasSafePath(m.draft) || m.session.blocked);
        }
        else {
            const coins = self.coins ?? 0;
            for (let i = 0; i < 3; i++)
                this.imageAt('hint', x + 20 + i * 26, y + (mobile ? 76 : 72), 20, 20, i < coins ? 1 : .18);
            this.text(`${coins} / 3`, x + 109, y + (mobile ? 87 : 83), 11, C.muted);
            this.button('hint', m.hintMode ? '선택 취소' : '힌트 사용 −1', mobile ? x + 18 : x + bw - 187, mobile ? y + 104 : y + 30, mobile ? bw - 36 : 166, 44, true, !mine || m.session.blocked || (!m.hintMode && coins <= 0));
        }
        if (v.event?.type === 'rotation') {
            this.frame('panel', w / 2 - 150, h * .43, 300, 86);
            this.text('←  ←  ←', w / 2, h * .43 + 30, 25, C.amber, 600, 'center');
            this.text('새로운 갱도로', w / 2, h * .43 + 61, 14, C.ivory, 500, 'center');
        }
        const turnAge = time - m.turnAt;
        if (mine && !place && turnAge < 1500 && !m.overlay && turnAge > 0) {
            const a = Math.min(1, turnAge / 250, (1500 - turnAge) / 350);
            this.context.save();
            this.context.globalAlpha = Math.max(0, a);
            this.text('YOUR TURN', w / 2, mobile ? h * .29 : h * .28, mobile ? 27 : 39, C.amber, 700, 'center');
            this.context.restore();
        }
    }
    private lobby(m: HudModel, mobile: boolean) {
        const w = Math.min(this.width - 28, 608), h = mobile ? 550 : 568, x = (this.width - w) / 2, y = Math.max(85, (this.height - h) / 2), v = m.session.view!;
        this.frame('panel', x, y, w, h);
        this.text('원정대를 기다리는 중', x + w / 2, y + 40, mobile ? 23 : 28, C.ivory, 700, 'center');
        this.text(`${v.players.length} / 6명 합류`, x + w / 2, y + 73, 12, C.muted, 400, 'center');
        this.text(v.code, x + w / 2, y + 115, 30, C.amber, 700, 'center');
        this.button('copy', '초대 링크 복사', x + w / 2 - 90, y + 143, 180, 42, false, false, 'link');
        const gap = 10, cw = (w - 48 - gap * 2) / 3;
        for (let i = 0; i < 6; i++) {
            const xx = x + 24 + (i % 3) * (cw + gap), yy = y + 211 + Math.floor(i / 3) * 119, p = v.players.find(p => p.seat === i);
            this.frame('panel-light', xx, yy, cw, 107, .8);
            if (p) {
                this.imageAt(`portrait-${i}`, xx + cw / 2 - 20, yy + 10, 40, 45);
                this.text(p.name, xx + cw / 2, yy + 71, 12, C.ivory, 600, 'center', cw - 12);
                this.text(p.id === v.hostId ? '방장' : '합류 완료', xx + cw / 2, yy + 92, 10, C.muted, 400, 'center');
            }
            else {
                this.text('+', xx + cw / 2, yy + 38, 29, C.muted, 400, 'center');
                this.text('빈 자리', xx + cw / 2, yy + 78, 11, C.muted, 400, 'center');
            }
        }
        if (m.session.host)
            this.button('start', '탐험 시작하기', x + 24, y + h - 68, w - 48, 46, true, v.players.length !== 6 || m.session.blocked);
        else
            this.text('방장이 탐험을 시작하기를 기다립니다.', x + w / 2, y + h - 42, 12, C.muted, 500, 'center');
    }
    private results(m: HudModel, mobile: boolean) {
        const w = Math.min(this.width - 28, 550), h = Math.min(this.height - 103, 622), x = (this.width - w) / 2, y = Math.max(84, (this.height - h) / 2), v = m.session.view!, final = v.phase === 'finished';
        this.scrim(.48);
        this.frame('panel', x, y, w, h);
        this.text(final ? 'EXPEDITION COMPLETE' : 'ROUND CLEAR', x + w / 2, y + 41, mobile ? 17 : 22, C.amber, 700, 'center');
        const winner = v.players.find(p => p.seat === v.winner?.seat), champions = v.players.filter(p => v.champions.includes(p.seat)).map(p => p.name).join(', ');
        this.text(final ? (v.champions.length > 1 ? '함께 찾은 출구' : '가장 깊은 기억') : `${winner?.name}, 출구에 도착!`, x + w / 2, y + 88, mobile ? 24 : 29, C.ivory, 700, 'center', w - 40);
        this.text(final ? `${champions} ${v.champions.length > 1 ? '공동 우승' : '우승'}` : `도착 1 + 남은 힌트 ${v.winner?.remainingCoins} = +${v.winner?.points}점`, x + w / 2, y + 127, 13, C.muted, 500, 'center', w - 40);
        const sorted = [...v.players].sort((a, b) => b.score - a.score || a.seat - b.seat), rowHeight = Math.min(49, (h - 283) / 6);
        sorted.forEach((p, i) => { const yy = y + 165 + i * rowHeight; this.frame(p.id === v.selfId ? 'panel-private' : 'panel-light', x + 24, yy, w - 48, rowHeight - 4, .8); this.text(String(i + 1).padStart(2, '0'), x + 39, yy + rowHeight / 2, 12, C.muted); this.imageAt(`portrait-${p.seat}`, x + 77, yy + 4, 26, 29); this.text(p.name, x + 118, yy + rowHeight / 2, 13, C.ivory, 600, 'left', w - 225); this.text(`${p.score} pt`, x + w - 42, yy + rowHeight / 2, 15, C.amber, 700, 'right'); });
        if (m.session.host || m.session.demo)
            this.button('next', final ? '다시 탐험하기' : '다음 갱도로 출발', x + 24, y + h - 88, w - 48, 48, true, m.session.blocked);
        else
            this.text('방장이 다음 탐험을 준비하고 있습니다.', x + w / 2, y + h - 61, 12, C.muted, 500, 'center');
        this.text(final ? '7번의 탐험, 당신은 얼마나 기억했나요?' : '다음 첫 차례는 승자의 왼쪽 광부입니다.', x + w / 2, y + h - 21, 10, C.muted, 400, 'center');
    }
    private entry(m: HudModel, mobile: boolean) {
        const p = this.panel('친구와 플레이', Math.min(this.width - 28, 490), m.entry === 'join' ? 545 : 480), { x, y, w } = p;
        this.button('create-tab', '방 만들기', x + 24, y + 83, (w - 58) / 2, 41, m.entry === 'create');
        this.button('join-tab', '코드로 참가', x + 34 + (w - 58) / 2, y + 83, (w - 58) / 2, 41, m.entry === 'join');
        this.text('플레이어 이름', x + 26, y + 158, 12, C.muted);
        this.field('name', m.name || '이름을 입력하세요', x + 24, y + 178, w - 48, 48, m.field === 'name');
        if (m.entry === 'join') {
            this.text('초대받은 6자리 코드', x + 26, y + 257, 12, C.muted);
            this.field('code', m.code || 'A B 1 2 C D', x + 24, y + 276, w - 48, 52, m.field === 'code');
        }
        else {
            this.text('6명이 모이면 방장이 탐험을 시작합니다.', x + 26, y + 264, 12, C.muted);
            this.text('초대 링크는 대기실에서 공유할 수 있어요.', x + 26, y + 289, 12, C.muted);
        }
        this.button('enter', m.session.busy ? '갱도에 연결 중…' : m.entry === 'create' ? '방 만들기' : '입장하기', x + 24, y + p.h - 108, w - 48, 48, true, m.session.busy || !m.name.trim() || (m.entry === 'join' && m.code.length !== 6));
        this.text(mobile ? '입력란을 누르면 키보드가 열립니다.' : 'Enter 키로도 입장할 수 있습니다.', x + w / 2, y + p.h - 32, 11, C.muted, 400, 'center');
    }
    private field(id: string, value: string, x: number, y: number, w: number, h: number, focus: boolean) { this.frame(focus ? 'panel-private' : 'panel-light', x, y, w, h); this.text(value + (focus ? ' │' : ''), x + 16, y + h / 2, 16, focus ? C.ivory : C.muted, 500, 'left', w - 32); this.regions.push({ id: `field:${id}`, label: id === 'name' ? '플레이어 이름' : '방 코드', x, y, w, h, disabled: false }); }
    private help(mobile: boolean) {
        const p = this.panel('어둠 속에서 길을 기억하세요', Math.min(this.width - 28, 555), Math.min(this.height - 103, 614)), { x, y, w, h } = p;
        const items = [['나만의 갱도를 만드세요', '선로에 지뢰를 놓으세요. 출구로 이어지는 길 하나는 남겨야 합니다.'], ['다른 광부의 길을 기억하세요', '밑변의 역에서 출발해 연결된 분기점으로 이동합니다. 폭발하면 다음 차례가 됩니다.'], ['잠깐 보이는 것을 기억하세요', '이동과 폭발은 모두에게 보이지만 흔적은 남지 않습니다.'], ['나만의 단서를 찾으세요', '자기 차례에 코인 하나로 선로 하나를 확인합니다. 답은 닫으면 사라집니다.'], ['출구에 먼저 도착하세요', '도착 1점과 남은 코인만큼 득점합니다. 7라운드의 누적 점수로 승리합니다.']];
        const step = (h - 158) / 5;
        items.forEach(([a, b], i) => { const yy = y + 97 + i * step; this.text(String(i + 1).padStart(2, '0'), x + 25, yy, 12, C.amber, 700); this.text(a, x + 60, yy, mobile ? 14 : 16, C.ivory, 600); this.wrap(b, x + 60, yy + 27, w - 91, 12, C.muted, 19); });
        this.button('close', '기억했어요', x + 24, y + h - 64, w - 48, 44, true);
    }
    private pause(m: HudModel) {
        const p = this.panel('잠깐 쉬어가기', Math.min(this.width - 28, 420), 440), { x, y, w } = p;
        this.button('close', '탐험 계속하기', x + 24, y + 90, w - 48, 48, true);
        this.button('sound', m.muted ? '소리 켜기' : '소리 끄기', x + 24, y + 153, w - 48, 44, false, false, m.muted ? 'muted' : 'sound');
        this.button('camera', '시점 원래대로', x + 24, y + 210, w - 48, 44, false, false, 'compass');
        this.button('assets', '갱도 에셋 보기', x + 24, y + 267, w - 48, 44);
        this.button('leave', '홈으로 돌아가기', x + 24, y + 343, w - 48, 44, false, false, 'back');
    }
    private leave(m: HudModel) {
        const p = this.panel('홈으로 돌아갈까요?', Math.min(this.width - 28, 450), 315), { x, y, w } = p;
        this.wrap(m.session.demo ? '지금의 연습은 종료됩니다. 새로운 갱도에서 다시 탐험할 수 있어요.' : '탐험은 계속되고 내 자리는 유지됩니다. 같은 브라우저에서 다시 연결할 수 있어요.', x + 25, y + 100, w - 50, 14, C.muted, 26);
        this.button('close', '계속 플레이', x + 24, y + 210, (w - 60) / 2, 48);
        this.button('confirm-leave', '홈으로 이동', x + 36 + (w - 60) / 2, y + 210, (w - 60) / 2, 48, true);
    }
    private hint(m: HudModel) {
        if (!m.hint)
            return;
        const p = this.panel('당신만의 단서', Math.min(this.width - 28, 475), Math.min(this.height - 104, 530)), { x, y, w, h } = p;
        this.text('PRIVATE CLUE', x + 25, y + 89, 11, C.teal, 600);
        this.text(m.hint.mined ? '지뢰가 있어요' : '지뢰가 없어요', x + w / 2, y + 128, 27, m.hint.mined ? C.danger : C.teal, 700, 'center');
        const center = x + w / 2, top = y + 172, step = Math.min(36, (h - 300) / 4), unit = step * .64;
        const pts = new Map(NODES.map(n => [n.id, { x: center + (n.col - n.row / 2) * unit * 2, y: top + n.row * step }]));
        const g = this.context;
        for (const e of EDGES) {
            const a = pts.get(e.a)!, b = pts.get(e.b)!;
            g.beginPath();
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
            g.lineWidth = e.id === m.hint.edgeId ? 5 : 1.5;
            g.strokeStyle = e.id === m.hint.edgeId ? (m.hint.mined ? C.danger : C.teal) : '#566873';
            g.stroke();
        }
        for (const p of pts.values()) {
            g.fillStyle = C.coal;
            g.strokeStyle = '#9aa5a9';
            g.lineWidth = 1;
            g.beginPath();
            g.arc(p.x, p.y, 4, 0, Math.PI * 2);
            g.fill();
            g.stroke();
        }
        this.text('이 선로의 위치를 기억하세요.', x + w / 2, y + h - 143, 13, C.ivory, 500, 'center');
        this.text('닫으면 사라져요. 다시 물으면 코인 −1', x + w / 2, y + h - 114, 11, C.muted, 400, 'center');
        this.button('close', '기억했어요 · 닫기', x + 24, y + h - 79, w - 48, 48, true);
    }
    private assets() {
        const p = this.panel('QUIET MINE · 에셋 도감', Math.min(this.width - 28, 620), Math.min(this.height - 104, 580)), { x, y, w, h } = p;
        this.text('ORIGINAL GAME ASSET KIT', x + 24, y + 96, 12, C.amber, 600);
        for (let i = 0; i < 6; i++)
            this.imageAt(`portrait-${i}`, x + 24 + i * (w - 48) / 6, y + 130, (w - 66) / 6, (w - 66) / 6 * 1.125);
        this.wrap('Blender 원본 모델 · 광부 수레 / 목재 지지대 / 갱도 랜턴 / 보급 상자 / 암벽', x + 24, y + 260, w - 48, 14, C.ivory, 26);
        this.wrap('PNG 이미지 UI · 9-slice 패널과 버튼 / 광부 초상화 / 아이콘 / 타이틀 로고', x + 24, y + 340, w - 48, 13, C.muted, 23);
        this.wrap('이펙트 · 수레 이동 / 불꽃 파편 / 충격파 / 먼지 / 등불 / 카메라 진동', x + 24, y + 410, w - 48, 13, C.muted, 23);
        this.button('close', '탐험으로 돌아가기', x + 24, y + h - 69, w - 48, 46, true);
    }
    dispose() { this.texture.dispose(); }
}
