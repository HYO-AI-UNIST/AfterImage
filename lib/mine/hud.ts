import * as THREE from 'three';
import { getBoard } from '../game';
import type { PrivateResult } from '../contracts';
import type { MineSession } from './session';
import { boardPosition } from './board-layout';
import type { RuleUi } from './rule-ui';
import { ruleGame, ruleLobby, ruleOverlay, transferResults, RULE_OVERLAYS } from './rule-hud';
import { GUIDE_PAGES, guidePage } from './guide';
export type Overlay = 'entry' | 'help' | 'pause' | 'leave' | 'hint' | 'assets' | 'roles' | 'memos' | 'peek' | 'peek-result' | 'settings' | 'roster' | 'reveal' | null;
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
    resultAt: number;
    pressed: string | null;
    routes: Array<{ id: string; x: number; y: number; angle: number; hot: boolean }>;
    cinematic: { progress: number; kind: 'turn' | 'shuffle'; seat: number } | null;
    rule: RuleUi;
    guidePage: number;
    guideScroll: number;
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
const C = { white: '#ffffff', muted: '#99a3a8', teal: '#abc1ce', danger: '#c28174', coal: '#0a0d10' };
export class MineHud {
    canvas = document.createElement('canvas');
    context = this.canvas.getContext('2d')!;
    texture = new THREE.CanvasTexture(this.canvas);
    regions: HitRegion[] = [];
    width = 1;
    height = 1;
    guideScrollMax = 0;
    ready: Promise<void>;
    private image = new Image();
    private frames: Record<string, Frame> = {};
    private loaded = false;
    private guideImages: HTMLImageElement[] = [];
    private model: HudModel | null = null;
    private dpr = 1;
    constructor() {
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.generateMipmaps = false;
        const guideReady = Promise.all(GUIDE_PAGES.map(page => new Promise<void>((resolve, reject) => {
            const image = new Image(); this.guideImages.push(image);
            image.onload = () => resolve(); image.onerror = () => reject(new Error('안내서 그림을 불러올 수 없습니다.'));
            image.src = `/game/guide/${page.id}.png`;
        })));
        this.ready = Promise.all([guideReady, fetch('/game/ui/atlas.json').then(r => { if (!r.ok)
                throw new Error('UI 이미지 정보를 불러올 수 없습니다.'); return r.json() as Promise<Record<string, Frame>>; }).then(f => this.frames = f), new Promise<void>((resolve, reject) => { this.image.onload = () => resolve(); this.image.onerror = () => reject(new Error('UI 이미지를 불러올 수 없습니다.')); this.image.src = '/game/ui/atlas.png'; }), document.fonts.load('500 16px Pretendard')]).then(() => { this.loaded = true; });
    }
    resize(w: number, h: number) {
        this.width = w; this.height = h; this.dpr = Math.min(devicePixelRatio, 1.5);
        const pixelsW = Math.round(w * this.dpr), pixelsH = Math.round(h * this.dpr);
        if (this.canvas.width !== pixelsW || this.canvas.height !== pixelsH) {
            // WebGL2 texture storage is immutable: release the old GPU allocation
            // before uploading the resized canvas, keeping the material's map reference.
            this.texture.dispose();
            this.canvas.width = pixelsW; this.canvas.height = pixelsH;
            this.texture.needsUpdate = true;
        }
    }
    hit(x: number, y: number) { return [...this.regions].reverse().find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h); }
    imageAt(name: string, x: number, y: number, w: number, h: number, alpha = 1) {
        const f = this.frames[name];
        if (!f || !this.loaded)
            return;
        const g = this.context;
        g.save();
        g.globalAlpha = alpha;
        g.drawImage(this.image, f.x, f.y, f.w, f.h, x, y, w, h);
        g.restore();
    }
    frame(name: string, x: number, y: number, w: number, h: number, alpha = 1) {
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
    text(s: string, x: number, y: number, size = 14, color = C.white, weight = 500, align: CanvasTextAlign = 'left', max?: number) {
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
    wrap(s: string, x: number, y: number, width: number, size = 14, color = C.muted, lh = 23) {
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
    button(id: string, label: string, x: number, y: number, w: number, h = 46, primary = false, disabled = false, icon?: string) {
        const hover = this.model?.hover === id || this.model?.focus === id;
        const pressed = !disabled && this.model?.pressed === id;
        const lift = pressed ? 3 : hover && !disabled ? -2 : 0;
        this.frame(disabled ? 'button-disabled' : primary ? pressed ? 'button-pressed' : hover ? 'button-hover' : 'button' : pressed ? 'button-quiet-pressed' : hover ? 'button-quiet-hover' : 'button-quiet', x, y + lift, w, h);
        if (icon)
            this.imageAt(icon, x + 12, y + lift + (h - 22) / 2, 22, 22, disabled ? .4 : 1);
        if (label)
            this.text(label, x + w / 2 + (icon ? 9 : 0), y + lift + h / 2, w < 100 ? 12 : primary ? 15 : 14, disabled ? C.muted : primary ? C.coal : C.white, 700, 'center', w - 20);
        this.regions.push({ id, label: label || icon || id, x, y, w, h, disabled });
    }
    scrim(alpha = .78) { this.context.fillStyle = `rgba(2,4,6,${alpha})`; this.context.fillRect(0, 0, this.width, this.height); }
    panel(title: string, w: number, h: number) {
        h = Math.min(h, this.height - 92);
        this.scrim();
        const x = (this.width - w) / 2, y = Math.max(74, (this.height - h) / 2);
        this.frame('panel', x, y, w, h);
        this.text(title, x + 25, y + 35, 23, C.white, 700);
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
        vignette.addColorStop(0, 'rgba(2,4,6,0)');
        vignette.addColorStop(1, 'rgba(2,4,6,.66)');
        g.fillStyle = vignette;
        g.fillRect(0, 0, w, h);
        if (m.loading) {
            this.scrim(.7);
            this.text('MINDMINER', w / 2, h / 2 - 24, 32, C.white, 700, 'center');
            this.text('갱도에 작은 불을 켜는 중', w / 2, h / 2 + 26, 14, C.muted, 500, 'center');
            this.texture.needsUpdate = true;
            return;
        }
        if (!v)
            this.home(m);
        else {
            if (!m.overlay && !m.cinematic) this.directions(m, time);
            this.chrome(m, mobile || w < 1000);
            if (v.phase === 'waiting')
                this.lobby(m);
            else if (v.phase === 'roundEnd' || v.phase === 'finished')
                this.results(m, mobile, time);
            else
                this.game(m, mobile, time);
        }
        if (m.cinematic && !m.overlay) {
            this.transition(m, mobile);
            this.regions = [];
        }
        if (m.overlay)
            this.regions = [];
        if (m.overlay === 'entry')
            this.entry(m, mobile);
        if (m.overlay === 'help')
            this.help(m);
        if (m.overlay === 'pause')
            this.pause(m);
        if (m.overlay === 'leave')
            this.leave(m);
        if (m.overlay === 'hint')
            this.hint(m);
        if (m.overlay === 'assets')
            this.assets();
        if (m.overlay && RULE_OVERLAYS.includes(m.overlay)) ruleOverlay(this, m);
        if (m.session.error || m.session.connection) {
            const msg = m.session.error || m.session.connection, ww = Math.min(w - 32, 630);
            this.frame('panel', (w - ww) / 2, mobile ? 80 : 91, ww, 50);
            this.text(msg, (w) / 2, (mobile ? 80 : 91) + 25, 12, m.session.error ? C.danger : C.muted, 600, 'center', ww - 30);
        }
        if (m.toast) {
            const ww = Math.min(w - 32, 510);
            const toastY = Math.max(80, h - (m.overlay ? 56 : 192));
            this.frame('panel-private', (w - ww) / 2, toastY, ww, 44);
            this.text(m.toast, w / 2, toastY + 22, 12, C.white, 500, 'center', ww - 26);
        }
        this.texture.needsUpdate = true;
    }
    private home(m: HudModel) {
        const w = this.width, h = this.height, cx = w / 2, g = this.context, compact = h < 590;
        const shade = g.createLinearGradient(0, 0, 0, h);
        shade.addColorStop(0, 'rgba(3,5,7,.72)'); shade.addColorStop(.28, 'rgba(3,5,7,.04)');
        shade.addColorStop(.60, 'rgba(3,5,7,.03)'); shade.addColorStop(1, 'rgba(3,5,7,.94)');
        g.fillStyle = shade; g.fillRect(0, 0, w, h);
        this.button('sound', '', w - 62, 22, 40, 40, false, false, m.muted ? 'muted' : 'sound');
        this.button('help', '', 22, 22, 40, 40, false, false, 'help');
        const logoW = Math.min(w - 40, compact ? 400 : 680), top = compact ? 22 : Math.max(64, h * .08);
        this.imageAt('logo', cx - logoW / 2, top, logoW, logoW * .16);
        const bw = Math.min(w - 52, 340), by = Math.min(h * .73, h - (m.session.saved ? 208 : 158) - 22), x = cx - bw / 2;
        this.button('online', '친구와 탐험하기', x, by, bw, 56, true);
        this.button('practice', '혼자 연습하기', x, by + 69, bw, 48, false, false, 'compass');
        if (m.session.saved) this.button('resume', '이전 갱도로 돌아가기', x, by + 128, bw, 42, false, m.session.restoring);
    }
    private directions(m: HudModel, time: number) {
        const g = this.context, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        for (const route of m.routes) {
            const pulse = reduce ? .5 : .5 + Math.sin(time / 180 + route.x * .02) * .5;
            const size = (this.width < 700 ? 48 : 58) + pulse * 7 + (route.hot ? 9 : 0);
            g.save(); g.translate(route.x, route.y); g.rotate(route.angle);
            const padded = size * 1.75;
            this.imageAt(route.hot ? 'route-arrow-hot' : 'route-arrow', -padded / 2, -padded / 2 - (reduce ? 0 : pulse * 4), padded, padded, .85 + pulse * .15);
            g.restore();
            // Arrow and landing node are both touch targets.
            this.regions.push({id: `route:${route.id}`, label: '이 분기점으로 이동', x: route.x - 28, y: route.y - 28, w: 56, h: 66, disabled: m.session.blocked});
        }
    }
    private transition(m: HudModel, mobile: boolean) {
        const flight = m.cinematic!;
        const g = this.context, w = this.width, h = this.height, p = flight.progress;
        const alpha = Math.min(1, p * 7, (1 - p) * 5);
        g.save(); g.globalAlpha = Math.max(0, alpha);
        if (flight.kind === 'shuffle') {
            this.scrim(.32);
            const scale = mobile ? .63 : .85, cx = w / 2, cy = h * .45;
            for (let i = 0; i < 6; i++) {
                const phase = (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : p * Math.PI * 3) + i * 1.05;
                const fan = Math.sin(p * Math.PI);
                g.save();
                g.translate(cx + (i - 2.5) * 42 * scale * fan + Math.sin(phase) * 35 * scale, cy + Math.cos(phase) * 23 * scale);
                g.rotate((i - 2.5) * .10 * fan + Math.sin(phase) * .14);
                this.imageAt('board-card', -90 * scale, -110 * scale, 180 * scale, 220 * scale);
                this.imageAt(`portrait-${i}`, -18 * scale, 43 * scale, 36 * scale, 40 * scale);
                g.restore();
            }
            this.text('갱도를 섞고 있어요', cx, cy + (mobile ? 115 : 150), mobile ? 23 : 30, C.white, 700, 'center');
            this.text('새로운 선로, 새로운 기억', cx, cy + (mobile ? 147 : 187), 12, C.white, 500, 'center');
        } else {
            const name = m.session.view?.players.find(player => player.seat === flight.seat)?.name ?? '다음 광부';
            const ww = Math.min(w - 34, 420), yy = h * .24;
            this.frame('panel', (w - ww) / 2, yy, ww, 92);
            this.text('NEXT MINE', w / 2, yy + 25, 11, C.white, 700, 'center');
            this.text(`${name}의 갱도로`, w / 2, yy + 58, mobile ? 22 : 27, C.white, 700, 'center');
        }
        g.restore();
    }
    private chrome(m: HudModel, mobile: boolean) {
        const w = this.width, v = m.session.view!;
        this.frame('panel', mobile ? 10 : 22, 14, w - (mobile ? 20 : 44), 52);
        this.text('MINDMINER', mobile ? 25 : 42, 40, mobile ? 14 : 18, C.white, 700);
        if (!mobile)
            this.text(m.session.demo ? 'SOLO EXPEDITION' : `ROOM ${v.code}`, w / 2, 40, 12, C.muted, 500, 'center');
        this.button('help', '', w - 114, 20, 38, 38, false, false, 'help');
        this.button('pause', '', w - 67, 20, 38, 38, false, false, 'pause');
        if (v.phase === 'waiting' || v.phase === 'roundEnd' || v.phase === 'finished')
            return;
        if (this.height < 560) {
            this.frame('panel', mobile ? 10 : 22, 75, w - (mobile ? 20 : 44), 31);
            this.text(`R${v.round}/${v.totalRounds}`, mobile ? 24 : 38, 91, 11, C.muted, 600);
            this.text(v.phase === 'placing' ? '지뢰 배치' : `${v.players[v.activeSeat]?.name}의 차례`, w/2, 91, 13, C.white, 700, 'center');
            return;
        }
        const cw = mobile ? (w - 30) / v.playerCount : Math.min(112, (w - 300) / v.playerCount), gap = mobile ? 0 : 8, total = cw * v.playerCount + gap * (v.playerCount - 1), sx = (w - total) / 2, sy = mobile ? 83 : 88;
        for (const p of v.players) {
            const x = sx + p.seat * (cw + gap), active = v.phase === 'playing' && p.seat === v.activeSeat, ww = cw - (mobile ? 4 : 0);
            if (active) {
                this.frame('button', x - 2, sy - 2, ww + 4, mobile ? 64 : 57, 1);
                this.frame('panel', x, sy, ww, mobile ? 60 : 53);
            }
            else
                this.frame('panel', x, sy, ww, mobile ? 60 : 53, .82);
            this.imageAt(`portrait-${p.seat}`, x + (mobile ? (ww - 32) / 2 : 5), sy + 3, mobile ? 32 : 36, mobile ? 36 : 41);
            if (p.role) {
                this.imageAt(`role-${p.role}`, x + ww - 18, sy + 3, 16, 16);
                this.regions.push({id:`player-role:${p.seat}`,label:`${p.name}의 능력`,x,y:sy,w:ww,h:mobile?60:53,disabled:false});
            }
            if (mobile)
                this.text(p.name, x + ww / 2, sy + 48, 9, active ? C.white : C.muted, 600, 'center', ww - 5);
            else {
                this.text(p.name, x + 48, sy + 17, 12, active ? C.white : C.white, 600, 'left', ww - 51);
                this.text(v.phase === 'placing' ? (p.ready ? '준비 완료' : '배치 중') : `${p.score} 코인`, x + 48, sy + 36, 10, C.muted, 400, 'left', ww - 51);
            }
            if (v.phase === 'placing' && p.ready)
                this.imageAt('check', x + ww - 15, sy + 2, 13, 13);
        }
        const owner = v.players.find(p => p.seat === v.boardOwnerSeat);
        this.text(v.phase === 'placing' ? '나의 갱도 · 비공개' : owner ? `${owner.name}의 갱도` : '상대 판 선택 대기', w / 2, mobile ? 166 : 163, 12, v.phase === 'placing' ? C.white : C.muted, 500, 'center');
        this.text(`ROUND ${String(v.round).padStart(2, '0')} / ${String(v.totalRounds).padStart(2, '0')}`, mobile ? 17 : 42, mobile ? 165 : 103, mobile ? 9 : 11, C.muted, 500);
        if (!mobile)
            this.text(v.boardMode === 'choice' ? `차례 ${v.turnNumber ?? 1}` : `전달 ${String(v.rotation).padStart(2, '0')}`, w - 44, 103, 10, C.muted, 500, 'right');
    }
    private game(m: HudModel, mobile: boolean, time: number) { ruleGame(this, m, time); }
    private lobby(m: HudModel) { ruleLobby(this, m); }
    private results(m: HudModel, mobile: boolean, time: number) {
        if (m.session.view?.scoringMode === 'transfer') { transferResults(this, m, time); return; }
        const v = m.session.view!, final = v.phase === 'finished', g = this.context;
        const age = Math.max(0, time - m.resultAt), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const progress = (start: number, duration: number) => reduce ? 1 : Math.max(0, Math.min(1, (age - start) / duration));
        const smooth = (p: number) => 1 - Math.pow(1 - p, 3);
        const w = Math.min(this.width - 28, 520), h = Math.min(this.height - 104, 660);
        const x = mobile || this.width < 1000 ? (this.width - w) / 2 : this.width - w - 30, y = Math.max(84, (this.height - h) / 2);
        const winner = v.players.find(p => p.seat === v.winner?.seat), award = v.winner?.points ?? 0;
        const champions = v.players.filter(p => v.champions.includes(p.seat)).map(p => p.name).join(', ');
        if (this.height < 560) {
            const ww = Math.min(this.width-28,800), xx=(this.width-ww)/2, yy=77, hh=this.height-92;
            this.frame('panel',xx,yy,ww,hh);
            this.text(final?'EXPEDITION COMPLETE':'ROUND CLEAR',xx+22,yy+29,18,C.white,700,'left',ww*.42-28);
            this.text(final?champions:winner?.name??'',xx+22,yy+70,22,C.white,700,'left',ww*.42-28);
            this.text(`+${Math.round(award*smooth(progress(400,950)))} pt`,xx+22,yy+113,30,C.white,700);
            const listX=xx+ww*.44, listW=ww*.53, rh=Math.min(37,(hh-48)/6);
            const ordered=[...v.players].sort((a,b)=>b.score-a.score||a.seat-b.seat);
            const previous=v.players.map(player=>({...player,score:player.score-(player.seat===v.winner?.seat?award:0)})).sort((a,b)=>b.score-a.score||a.seat-b.seat);
            const ranks=smooth(progress(1050,1300)), count=smooth(progress(450,1000));
            ordered.forEach((player,i)=>{
                const from=previous.findIndex(p=>p.seat===player.seat), ry=yy+22+(from+(i-from)*ranks)*rh;
                this.frame(player.seat===v.winner?.seat?'panel-private':'panel-light',listX,ry,listW,rh-4);
                this.text(String((ranks>.55?i:from)+1),listX+12,ry+(rh-4)/2,12,C.muted);
                this.text(player.name,listX+36,ry+(rh-4)/2,12,C.white,600,'left',listW-112);
                const before=previous.find(p=>p.seat===player.seat)!.score;
                this.text(String(Math.round(before+(player.score-before)*count)),listX+listW-13,ry+(rh-4)/2,15,C.white,700,'right');
            });
            if(m.session.host||m.session.demo)this.button('next',final?'다시 탐험':'다음 갱도로',xx+22,yy+hh-68,ww*.4-22,46,true,m.session.blocked||age<2450&&!reduce);
            return;
        }
        this.scrim(mobile ? .28 : .12);
        // Raster light shafts cross behind the presentation. The 3D winner is lit separately.
        const rayX = mobile ? x + w / 2 : this.width * .26;
        for (const side of [-1, 1]) {
            g.save(); g.translate(rayX + side * 65, 70); g.rotate(side * -.20);
            this.imageAt('stage-ray', -85, 0, 170, this.height * .8, .7 * smooth(progress(0, 500))); g.restore();
        }
        this.frame('panel', x, y, w, h, .96);
        const intro = smooth(progress(0, 650));
        g.save(); g.translate(x + w / 2, y + 47); g.scale(1.5 - intro * .5, 1.5 - intro * .5); g.globalAlpha = intro;
        this.imageAt('victory-badge', -29, -29, 58, 58); g.restore();
        this.text(final ? 'EXPEDITION COMPLETE' : 'ROUND CLEAR', x + w / 2, y + 95 - (1 - intro) * 18, mobile ? 22 : 29, C.white, 700, 'center');
        this.text(final ? `${champions} ${v.champions.length > 1 ? '공동 우승' : '우승'}` : `${winner?.name}, 출구에 도착!`, x + w / 2, y + 135, mobile ? 22 : 26, C.white, 700, 'center', w - 38);
        this.frame('panel-private', x + 22, y + 166, w - 44, 52);
        this.text(`탈출 1 + 남은 힌트 ${v.winner?.remainingCoins ?? 0}`, x + 37, y + 192, mobile ? 12 : 14, C.white, 600, 'left', w - 135);
        const counted = Math.round(award * smooth(progress(400, 950)));
        this.text(`+${counted}`, x + w - 39, y + 192, 30, C.white, 700, 'right');
        const old = v.players.map(p => ({ ...p, score: p.score - (p.seat === v.winner?.seat ? award : 0) })).sort((a,b) => b.score - a.score || a.seat - b.seat);
        const sorted = [...v.players].sort((a,b) => b.score - a.score || a.seat - b.seat);
        const rowHeight = Math.min(46, (h - 332) / 6), top = y + 237, rankProgress = smooth(progress(1050, 1300));
        // Reorder actual player rows from their old rank to their new rank.
        const rows = sorted.map((p,i) => ({p,i,from:old.findIndex(o => o.seat === p.seat)}));
        rows.sort((a,b) => Number(a.p.seat === v.winner?.seat) - Number(b.p.seat === v.winner?.seat));
        for (const {p,i,from} of rows) {
            const yy = top + (from + (i - from) * rankProgress) * rowHeight;
            const won = p.seat === v.winner?.seat, delta = from - i;
            if (won) this.frame('button', x + 20, yy - 2, w - 40, rowHeight, .85);
            this.frame(won || p.id === v.selfId ? 'panel-private' : 'panel-light', x + 23, yy, w - 46, rowHeight - 4, won ? 1 : .78);
            this.text(String(rankProgress > .55 ? i + 1 : from + 1).padStart(2,'0'), x + 37, yy + (rowHeight - 4) / 2, 13, won ? C.white : C.muted, 700);
            this.imageAt(`portrait-${p.seat}`, x + 72, yy + 3, Math.min(28, rowHeight - 9), Math.min(31, rowHeight - 6));
            this.text(p.name, x + 112, yy + (rowHeight - 4) / 2, 13, C.white, won ? 700 : 500, 'left', w - 236);
            const before = old.find(o => o.seat === p.seat)!.score;
            const score = Math.round(before + (p.score - before) * smooth(progress(450, 1000)));
            this.text(`${score} pt`, x + w - 39, yy + (rowHeight - 4) / 2, 16, won ? C.white : C.white, 700, 'right');
            if (delta && rankProgress > .15) this.text(`${delta > 0 ? '↑' : '↓'}${Math.abs(delta)}`, x + w - 113, yy + (rowHeight - 4) / 2, 12, delta > 0 ? C.white : C.muted, 700, 'right');
        }
        const sparkle = progress(200, 1900);
        if (!reduce && sparkle > 0 && sparkle < 1) for (let i = 0; i < 18; i++) {
            const angle = i * 2.4, radius = 35 + sparkle * (70 + (i % 5) * 14);
            const xx = x + w / 2 + Math.cos(angle) * radius, yy = y + 49 + Math.sin(angle) * radius * .5 + sparkle * 20;
            const size = 7 + i % 4 * 3;
            this.imageAt('reward-spark', xx - size/2, yy - size/2, size, size, (1 - sparkle) * .9);
        }
        const settled = age > 2450 || reduce;
        if (m.session.host || m.session.demo) this.button('next', settled ? final ? '다시 탐험하기' : '다음 갱도로 출발' : '점수와 순위를 집계하는 중', x + 23, y + h - 73, w - 46, 48, true, m.session.blocked || !settled);
        else this.text(settled ? '방장이 다음 탐험을 준비합니다.' : '점수와 순위를 집계하는 중', x + w/2, y + h - 48, 12, C.muted, 500, 'center');
        this.text(final ? '7번의 탐험, 당신이 남긴 기억.' : `ROUND ${v.round} / ${v.totalRounds}`, x + w/2, y + h - 13, 10, C.muted, 500, 'center');
    }
    private entry(m: HudModel, mobile: boolean) {
        const p = this.panel('친구와 플레이', Math.min(this.width - 28, 490), m.entry === 'join' ? 545 : 480), { x, y, w } = p;
        if (p.h >= 280) this.button('create-tab', '방 만들기', x + 24, y + 83, (w - 58) / 2, 41, m.entry === 'create');
        if (p.h >= 280) this.button('join-tab', '코드로 참가', x + 34 + (w - 58) / 2, y + 83, (w - 58) / 2, 41, m.entry === 'join');
        if (this.height < 600) {
            const split = m.entry === 'join', fieldW = split ? (w - 60) / 2 : w - 48, tiny = p.h < 280, labelY = tiny ? 82 : 137, fieldY = tiny ? 100 : 155, fieldH = tiny ? 38 : 44;
            this.text('플레이어 이름', x + 26, y + labelY, 12, C.muted);
            this.field('name', m.name || '이름', x + 24, y + fieldY, fieldW, fieldH, m.field === 'name');
            if (split) {
                this.text('방 코드', x + w / 2 + 8, y + labelY, 12, C.muted);
                this.field('code', m.code || '6자리 코드', x + w / 2 + 6, y + fieldY, fieldW, fieldH, m.field === 'code');
            }
            this.button('enter', m.session.busy ? '연결 중…' : split ? '입장하기' : '방 만들기', x + 24, y + p.h - 67, w - 48, 46, true, m.session.busy || !m.name.trim() || split && m.code.length !== 6);
            return;
        }
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
    private field(id: string, value: string, x: number, y: number, w: number, h: number, focus: boolean) { this.frame(focus ? 'panel-private' : 'panel-light', x, y, w, h); this.text(value + (focus ? ' │' : ''), x + 16, y + h / 2, 16, focus ? C.white : C.muted, 500, 'left', w - 32); this.regions.push({ id: `field:${id}`, label: id === 'name' ? '플레이어 이름' : '방 코드', x, y, w, h, disabled: false }); }
    private help(m: HudModel) {
        this.scrim(.87);
        const w = Math.min(this.width - 20, 1060), h = Math.min(this.height - 20, 790);
        const x = (this.width - w) / 2, y = (this.height - h) / 2, compact = h < 530;
        const pageIndex = guidePage(m.guidePage), page = GUIDE_PAGES[pageIndex], g = this.context;
        const split = w >= 740 || w >= 510 && compact, pad = w < 500 ? 19 : 30, header = compact ? 78 : 96, footer = compact && split ? 112 : 136;
        this.frame('panel', x, y, w, h);
        this.text(`광부의 안내서  /  ${page.label}`, x + pad, y + 25, 12, C.muted, 500);
        this.text(page.title, x + pad, y + (compact ? 53 : 63), w < 500 ? 22 : 29, C.white, 700, 'left', w - pad * 2 - 40);
        this.button('close', '', x + w - 54, y + 13, 38, 38, false, false, 'close');
        const bodyY = y + header, bodyH = h - header - footer;
        const artW = split ? (w - pad * 3) * .47 : w - pad * 2;
        let artH = split ? Math.min(bodyH - 32, artW * .62) : Math.min(205, bodyH * .36);
        const textX = split ? x + pad * 2 + artW : x + pad;
        const textW = split ? x + w - pad - textX : w - pad * 2;
        let font = compact ? 12 : split ? 15 : 13;
        const lines = (s: string, size: number) => {
            g.font = `500 ${size}px Pretendard, sans-serif`;
            let row = '', count = 1;
            for (const c of s) { if (g.measureText(row + c).width > textW - 30) { row = c; count++; } else row += c; }
            return count;
        };
        const needed = () => page.steps.reduce((sum, [, body]) => sum + (font + 2) + 7 + lines(body, font) * (font + 6) + (compact ? 9 : 16), 0);
        while (font > 11 && needed() > (split ? bodyH : bodyH - artH - 25)) font -= .5;
        if (!split) artH = Math.max(40, Math.min(artH, bodyH - needed() - 25));
        const image = this.guideImages[pageIndex];
        const imageW = Math.min(artW, artH * 800 / 440), imageH = imageW * 440 / 800;
        this.guideScrollMax = Math.max(0, (split ? needed() : imageH + 37 + needed()) - bodyH + 8);
        const scroll = Math.min(this.guideScrollMax, m.guideScroll);
        const imageX = x + pad + (artW - imageW) / 2, imageY = bodyY + (split ? Math.max(0, (bodyH - imageH - 40) / 2) : -scroll);
        g.save(); g.beginPath(); g.rect(x + pad, bodyY - 12, w - pad * 2, bodyH + 12); g.clip();
        if (image?.complete) g.drawImage(image, imageX, imageY, imageW, imageH);
        this.text(page.caption, x + pad + artW / 2, imageY + imageH + 14, compact ? 10 : 11, C.muted, 500, 'center', artW);
        let rowY = split ? bodyY + Math.max(4, (bodyH - needed()) / 2) - scroll : imageY + imageH + 37;
        for (const [i, [title, body]] of page.steps.entries()) {
            this.imageAt('panel-private', textX, rowY - 10, 22, 23);
            this.text(String(i + 1), textX + 11, rowY + 1, 11, C.white, 700, 'center');
            this.text(title, textX + 31, rowY, font + 2, C.white, 700, 'left', textW - 32);
            rowY = this.wrap(body, textX + 31, rowY + font + 9, textW - 31, font, C.muted, font + 6) + (compact ? 9 : 16);
        }
        g.restore();
        if (this.guideScrollMax > 0) {
            this.imageAt('button-quiet', x + w - pad + 6, bodyY, 3, bodyH);
            const thumb = Math.max(18, bodyH * bodyH / (bodyH + this.guideScrollMax));
            this.imageAt('button', x + w - pad + 6, bodyY + (bodyH - thumb) * scroll / this.guideScrollMax, 3, thumb);
        }
        const tipY = y + h - footer + 7;
        this.frame('panel-private', x + pad, tipY, w - pad * 2, footer - 82);
        this.wrap(page.tip, x + pad + 12, tipY + 14, w - pad * 2 - 24, compact && split ? 10.5 : 11, C.muted, 15);
        const chapterW = Math.min(36, (w - pad * 2) / GUIDE_PAGES.length), chaptersX = x + (w - chapterW * GUIDE_PAGES.length) / 2;
        for (let i = 0; i < GUIDE_PAGES.length; i++) {
            const cx = chaptersX + i * chapterW;
            this.imageAt(i === pageIndex ? 'button' : 'button-quiet', cx + 5, y + h - 74, chapterW - 10, 5, i === pageIndex ? 1 : .65);
            this.regions.push({id: `guide:${i}`, label: `${i + 1}. ${GUIDE_PAGES[i].label}`, x: cx, y: y + h - 85, w: chapterW, h: 26, disabled: false});
        }
        this.button('guide-prev', '이전', x + pad, y + h - 56, 83, 40, false, pageIndex === 0);
        this.text(`${String(pageIndex + 1).padStart(2, '0')} / ${String(GUIDE_PAGES.length).padStart(2, '0')}`, x + w / 2, y + h - 35, 11, C.muted, 500, 'center');
        const last = pageIndex === GUIDE_PAGES.length - 1;
        this.button(last ? m.session.view ? 'close' : 'practice' : 'guide-next', last ? m.session.view ? '돌아가기' : '연습 시작' : '다음', x + w - pad - 90, y + h - 56, 90, 40, true);
    }
    private pause(m: HudModel) {
        const p = this.panel('잠깐 쉬어가기', Math.min(this.width - 28, 420), 440), {x,y,w,h} = p;
        const gap = Math.min(61, (h - 96) / 5), buttonH = Math.min(46, gap - 8);
        const items: Array<[string,string,string?]> = [['close','탐험 계속하기'],['sound',m.muted ? '소리 켜기' : '소리 끄기',m.muted ? 'muted' : 'sound'],['camera','자동 연출 마치기','compass'],['assets','갱도 에셋 보기'],['leave','홈으로 돌아가기','back']];
        items.forEach(([id,label,icon],i) => this.button(id,label,x+24,y+82+i*gap,w-48,buttonH,i===0,false,icon));
    }
    private leave(m: HudModel) {
        const p = this.panel('홈으로 돌아갈까요?', Math.min(this.width - 28, 450), 315), { x, y, w } = p;
        this.wrap(m.session.demo ? '지금의 연습은 종료됩니다. 새로운 갱도에서 다시 탐험할 수 있어요.' : '탐험은 계속되고 내 자리는 유지됩니다. 같은 브라우저에서 다시 연결할 수 있어요.', x + 25, y + 100, w - 50, 14, C.muted, 26);
        this.button('close', '계속 플레이', x + 24, y + p.h - 70, (w - 60) / 2, 48);
        this.button('confirm-leave', '홈으로 이동', x + 36 + (w - 60) / 2, y + p.h - 70, (w - 60) / 2, 48, true);
    }
    private hint(m: HudModel) {
        if (!m.hint)
            return;
        this.scrim();
        const short = this.height < 560 && this.width > 650;
        const w = Math.min(this.width - 24, short ? 690 : 475), h = Math.min(this.height - 24, 560), x = (this.width - w) / 2, y = (this.height - h) / 2;
        this.frame('panel', x, y, w, h);
        this.text('당신만의 단서', x + 25, y + 34, 23, C.white, 700);
        this.button('close', '', x + w - 56, y + 12, 40, 40, false, false, 'close');
        const textCenter = x + (short ? w * .27 : w / 2);
        this.text(m.hint.mined === null ? '기만의 장막 · 코인 1개 사용' : '나에게만 보이는 답', textCenter, y + (short ? 113 : 79), 11, C.muted, 500, 'center');
        this.text(m.hint.mined === null ? '판독 불가' : m.hint.mined ? '지뢰가 있어요' : '지뢰가 없어요', textCenter, y + (short ? 151 : 115), short ? 23 : 27, m.hint.mined ? C.danger : C.white, 700, 'center');
        const center = short ? x + w * .75 : x + w / 2, top = y + (short ? 91 : 156);
        const scale = Math.max(1, Math.min((short ? w * .4 : w - 90) / 14.4, (h - (short ? 218 : 282)) / 12.47));
        const geometry = getBoard(m.session.view?.gridSize ?? 4);
        const pts = new Map(geometry.nodes.map(n => { const [px, pz] = boardPosition(n.id, m.session.view?.gridSize ?? 4); return [n.id, { x: center + px * scale, y: top + (pz + 7.2) * scale }]; }));
        const g = this.context;
        for (const e of geometry.edges) {
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
        this.text('밝게 표시된 선로의 위치를 기억하세요.', x + w / 2, y + h - 100, 12, C.white, 500, 'center', w - 40);
        this.text('닫으면 사라져요. 다시 물으면 코인 −1', x + w / 2, y + h - 78, 11, C.muted, 400, 'center', w - 40);
        this.button('close', '기억했어요 · 닫기', x + 24, y + h - 58, w - 48, 42, true);
    }
    private assets() {
        const p = this.panel('QUIET MINE · 에셋 도감', Math.min(this.width - 28, 620), Math.min(this.height - 104, 580)), { x, y, w, h } = p;
        if (h < 500) {
            this.text('Blender · 갱도 / 광부 / 홈 디오라마', x+24,y+98,13,C.white,600,'left',w-48);
            this.text('PNG · 패널 / 버튼 상태 / 초상화 / 화살표', x+24,y+141,12,C.muted,500,'left',w-48);
            this.text('연출 · 카메라 / 조명 / 이동 / 폭발 / 결과', x+24,y+184,12,C.muted,500,'left',w-48);
            this.button('close','탐험으로 돌아가기',x+24,y+h-63,w-48,44,true);
            return;
        }
        this.text('ORIGINAL GAME ASSET KIT', x + 24, y + 96, 12, C.white, 600);
        for (let i = 0; i < 6; i++)
            this.imageAt(`portrait-${i}`, x + 24 + i * (w - 48) / 6, y + 130, (w - 66) / 6, (w - 66) / 6 * 1.125);
        this.wrap('Blender 원본 모델 · 광부 수레 / 목재 지지대 / 갱도 랜턴 / 보급 상자 / 암벽', x + 24, y + 260, w - 48, 14, C.white, 26);
        this.wrap('PNG 이미지 UI · 9-slice 패널과 버튼 / 광부 초상화 / 아이콘 / 타이틀 로고', x + 24, y + 340, w - 48, 13, C.muted, 23);
        this.wrap('이펙트 · 수레 이동 / 불꽃 파편 / 충격파 / 먼지 / 등불 / 카메라 진동', x + 24, y + 410, w - 48, 13, C.muted, 23);
        this.button('close', '탐험으로 돌아가기', x + 24, y + h - 69, w - 48, 46, true);
    }
    dispose() { this.texture.dispose(); }
}
