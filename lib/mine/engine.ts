import { MineHud, type HudModel } from './hud';
import { MineWorld } from './world';
import { MineSession } from './session';
import { MineAudio } from './audio';
import { randomBoard } from '../game';
export class MineGame {
    private session = new MineSession();
    private hud = new MineHud();
    private world: MineWorld;
    private audio = new MineAudio();
    private model: HudModel = { session: this.session, draft: [], hintMode: false, overlay: null, entry: 'create', name: '', code: '', field: null, hint: null, toast: '', loading: true, hover: null, focus: null, muted: false, turnAt: 0 };
    private raf = 0;
    private lastHud = 0;
    private lastGeometry = 0;
    private lastTurn = '';
    private lastEvent = '';
    private lastPhase = '';
    private viewKey = '';
    private dirty = true;
    private disposed = false;
    private toastTimer: ReturnType<typeof setTimeout> | null = null;
    private pointers = new Map<number, {
        x: number;
        y: number;
    }>();
    private down = { x: 0, y: 0 };
    private dragging = false;
    private resizeObserver: ResizeObserver;
    private abort = new AbortController();
    constructor(private canvas: HTMLCanvasElement, private input: HTMLInputElement) {
        this.world = new MineWorld(canvas, this.hud.texture);
        this.session.onChange = () => this.sync();
        const options = { signal: this.abort.signal };
        canvas.addEventListener('pointerdown', this.pointerDown, options);
        canvas.addEventListener('pointermove', this.pointerMove, options);
        canvas.addEventListener('pointerup', this.pointerUp, options);
        canvas.addEventListener('pointercancel', this.pointerCancel, options);
        canvas.addEventListener('wheel', this.wheel, { ...options, passive: false });
        window.addEventListener('keydown', this.key, options);
        input.addEventListener('input', this.inputChanged, options);
        input.addEventListener('blur', () => { this.model.field = null; this.dirty = true; }, options);
        document.fonts.addEventListener('loadingdone', () => this.dirty = true, options);
        this.resizeObserver = new ResizeObserver(this.resize);
        this.resizeObserver.observe(canvas);
        this.resize();
        this.raf = requestAnimationFrame(this.frame);
        void Promise.all([this.hud.ready, this.world.ready]).then(() => {
            if (this.disposed)
                return;
            this.model.loading = false;
            this.dirty = true;
            this.canvas.dataset.ready = 'true';
            this.sync();
            const code = new URLSearchParams(location.search).get('room');
            if (code) {
                this.model.code = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
                this.model.entry = 'join';
                if (this.session.saved?.code === this.model.code)
                    this.session.resume();
                else
                    this.model.overlay = 'entry';
            }
            else if (this.session.saved)
                this.session.resume();
        }).catch(e => { if (this.disposed)
            return; this.model.loading = false; this.session.error = e instanceof Error ? e.message : '게임 에셋을 불러오지 못했습니다.'; this.dirty = true; console.error(e); });
    }
    private resize = () => { const r = this.canvas.getBoundingClientRect(); this.world.resize(Math.max(1, r.width), Math.max(1, r.height)); this.hud.resize(Math.max(1, r.width), Math.max(1, r.height)); this.dirty = true; };
    private sync() {
        if (this.disposed)
            return;
        const v = this.session.view, phase = v?.phase ?? 'home', turn = v ? `${v.code}:${v.round}:${v.activeSeat}:${v.rotation}` : '';
        if (turn !== this.lastTurn) {
            this.model.hint = null;
            this.model.hintMode = false;
            if (this.model.overlay === 'hint')
                this.model.overlay = null;
            this.model.turnAt = performance.now();
            if (this.session.ownTurn && v?.phase === 'playing')
                this.audio.play('turn');
            this.lastTurn = turn;
        }
        if (phase !== this.lastPhase) {
            if (phase !== 'playing') this.lastEvent = '';
            if (phase === 'placing')
                this.model.draft = v?.ownMines ?? [];
            if (phase !== 'playing') {
                this.model.hint = null;
                this.model.hintMode = false;
            }
            if (phase === 'roundEnd' || phase === 'finished') {
                this.audio.play('win');
                this.model.overlay = null;
            }
            this.lastPhase = phase;
        }
        if (v && this.model.overlay === 'entry') {
            this.model.overlay = null;
            this.input.blur();
        }
        if (v?.phase === 'placing' && this.session.self?.ready)
            this.model.draft = v.ownMines ?? [];
        if (v?.event && v.event.id !== this.lastEvent) {
            this.audio.play(v.event.type === 'explosion' ? 'explosion' : v.event.type === 'move' ? 'move' : 'turn');
            this.lastEvent = v.event.id;
        }
        this.viewKey = turn;
        this.updateWorld();
        this.dirty = true;
        this.canvas.dataset.phase = phase;
        this.canvas.dataset.position = v?.position ?? '';
        this.canvas.dataset.round = String(v?.round ?? 0);
        this.canvas.setAttribute('aria-label', `MindMiner 3D 게임. ${phase === 'home' ? '홈 메뉴' : phase === 'placing' ? '선로에 지뢰 배치' : phase === 'playing' ? this.session.ownTurn ? '내 차례. 화살표로 이동 대상을 고르고 Enter로 이동. H로 힌트 사용.' : '다른 광부 탐색 중' : '게임 결과'}. Tab으로 메뉴 선택, Escape로 메뉴.`);
    }
    private updateWorld() { this.world.setState(this.session.view, this.model.draft, this.model.hintMode, this.model.hint?.edgeId ?? null); }
    private frame = (time: number) => {
        if (this.disposed)
            return;
        const animated = time - this.model.turnAt < 1600 && this.session.ownTurn;
        if (this.dirty || animated && time - this.lastHud > 45 || time - this.lastHud > 1000) {
            this.hud.draw(this.model, time);
            this.lastHud = time;
            this.dirty = false;
            this.canvas.dataset.controls = JSON.stringify(this.hud.regions.filter(r => !r.disabled).map(({ id, x, y, w, h }) => ({ id, x, y, w, h })));
            this.canvas.dataset.overlay = this.model.overlay ?? '';
            this.canvas.dataset.event = this.session.view?.event?.type ?? '';
        }
        this.world.frame(time);
        if (time - this.lastGeometry > 100) {
            this.canvas.dataset.nodes = JSON.stringify(Object.fromEntries(this.world.projected));
            this.canvas.dataset.inputMode = this.model.hintMode ? 'hint' : this.session.view?.phase === 'placing' ? 'placement' : 'movement';
            this.lastGeometry = time;
        }
        this.raf = requestAnimationFrame(this.frame);
    };
    private toast(s: string) { this.model.toast = s; this.dirty = true; if (this.toastTimer)
        clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { this.model.toast = ''; this.dirty = true; }, 3000); }
    private close() { this.model.overlay = null; this.model.hint = null; this.model.field = null; this.model.focus = null; this.input.blur(); this.updateWorld(); this.dirty = true; }
    private async run(id: string) {
        if (this.hud.regions.find(r => r.id === id)?.disabled)
            return;
        void this.audio.unlock();
        this.audio.play('click');
        if (id.startsWith('field:')) {
            this.model.field = id.slice(6);
            this.input.value = this.model.field === 'name' ? this.model.name : this.model.code;
            this.input.maxLength = this.model.field === 'name' ? 12 : 6;
            this.input.inputMode = 'text';
            this.input.enterKeyHint = this.model.field === 'name' && this.model.entry === 'join' ? 'next' : 'go';
            this.input.autocapitalize = this.model.field === 'name' ? 'words' : 'characters';
            this.input.setAttribute('aria-label', this.model.field === 'name' ? '플레이어 이름' : '방 코드');
            this.input.focus({ preventScroll: true });
            this.dirty = true;
            return;
        }
        if (id === 'practice') {
            this.close();
            this.session.practice();
            this.world.resetCamera();
        }
        else if (id === 'online') {
            this.session.error = '';
            this.model.overlay = 'entry';
        }
        else if (id === 'resume')
            this.session.resume();
        else if (id === 'help')
            this.model.overlay = 'help';
        else if (id === 'pause')
            this.model.overlay = 'pause';
        else if (id === 'assets')
            this.model.overlay = 'assets';
        else if (id === 'camera') {
            this.world.resetCamera();
            this.close();
        }
        else if (id === 'close')
            this.close();
        else if (id === 'sound') {
            this.audio.toggle();
            this.model.muted = this.audio.muted;
        }
        else if (id === 'leave')
            this.model.overlay = 'leave';
        else if (id === 'confirm-leave') {
            this.close();
            this.model.draft = [];
            this.session.leave();
        }
        else if (id === 'create-tab') {
            this.model.entry = 'create';
            this.session.error = '';
            this.input.blur();
        }
        else if (id === 'join-tab') {
            this.model.entry = 'join';
            this.session.error = '';
            this.input.blur();
        }
        else if (id === 'enter') {
            this.input.blur();
            await this.session.enter(this.model.entry, this.model.name, this.model.code);
        }
        else if (id === 'copy') {
            const url = new URL(location.href);
            url.search = '';
            url.hash = '';
            url.searchParams.set('room', this.session.view!.code);
            try {
                await navigator.clipboard.writeText(url.toString());
                this.toast('초대 링크를 복사했어요. 친구에게 보내주세요.');
            }
            catch {
                this.toast(`초대 코드 ${this.session.view!.code}`);
            }
        }
        else if (id === 'start')
            await this.session.act({ type: 'start' });
        else if (id === 'random') {
            this.model.draft = randomBoard();
            this.updateWorld();
        }
        else if (id === 'clear') {
            this.model.draft = [];
            this.updateWorld();
        }
        else if (id === 'ready')
            await this.session.act({ type: 'place', mines: this.model.draft });
        else if (id === 'hint') {
            this.model.hintMode = !this.model.hintMode;
            this.updateWorld();
        }
        else if (id === 'next')
            await this.session.act({ type: this.session.view!.phase === 'finished' ? 'restart' : 'nextRound' });
        this.dirty = true;
    }
    private inputChanged = () => { if (this.model.field === 'name')
        this.model.name = this.input.value;
    else if (this.model.field === 'code') {
        this.model.code = this.input.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
        this.input.value = this.model.code;
    } this.dirty = true; };
    private pointerDown = (e: PointerEvent) => { if (this.model.loading)
        return; void this.audio.unlock(); this.canvas.focus({ preventScroll: true }); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.down = { x: e.clientX, y: e.clientY }; this.dragging = false; this.canvas.setPointerCapture(e.pointerId); };
    private pointerMove = (e: PointerEvent) => {
        const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        this.world.pointer(x, y);
        const prev = this.pointers.get(e.pointerId);
        if (prev) {
            if (this.pointers.size === 2) {
                const other = [...this.pointers].find(([id]) => id !== e.pointerId)?.[1];
                if (other) {
                    const before = Math.hypot(prev.x - other.x, prev.y - other.y), after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
                    if (after > 1)
                        this.world.dolly(before / after);
                }
                this.dragging = true;
            }
            else if (!this.model.overlay && !this.hud.hit(this.down.x - r.left, this.down.y - r.top) && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 7) {
                this.dragging = true;
                this.world.orbit((e.clientX - prev.x) * .002);
            }
            this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
        const hit = this.hud.hit(x, y), hover = hit && !hit.disabled ? hit.id : null;
        if (hover !== this.model.hover) {
            this.model.hover = hover;
            this.dirty = true;
        }
        const target = !this.model.overlay && !this.session.blocked ? this.world.pick(x, y, this.session.view?.phase === 'placing' || this.model.hintMode) : null;
        this.world.hoverAt(target);
        this.canvas.style.cursor = hover || target ? 'pointer' : this.dragging ? 'grabbing' : 'default';
    };
    private pointerUp = (e: PointerEvent) => {
        this.pointers.delete(e.pointerId);
        if (this.canvas.hasPointerCapture(e.pointerId))
            this.canvas.releasePointerCapture(e.pointerId);
        if (this.dragging || this.model.loading)
            return;
        const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hit = this.hud.hit(x, y);
        if (hit) {
            if (!hit.disabled)
                void this.run(hit.id);
            return;
        }
        if (this.model.overlay)
            return;
        const target = this.world.pick(x, y, this.session.view?.phase === 'placing' || this.model.hintMode);
        this.canvas.dataset.lastPick = target ?? 'none';
        if (target)
            void this.worldAction(target);
    };
    private pointerCancel = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.dragging = true; };
    private wheel = (e: WheelEvent) => { if (!this.model.overlay) {
        e.preventDefault();
        this.world.dolly(Math.exp(e.deltaY * .0005));
    } };
    private async worldAction(target: string) {
        const v = this.session.view;
        if (!v || this.session.blocked || this.model.overlay)
            return;
        if (v.phase === 'placing' && !this.session.self?.ready) {
            this.model.draft = this.model.draft.includes(target) ? this.model.draft.filter(id => id !== target) : [...this.model.draft, target];
            this.audio.play('click');
            this.updateWorld();
            this.dirty = true;
        }
        else if (this.session.ownTurn && this.model.hintMode) {
            const at = this.viewKey, result = await this.session.act({ type: 'hint', edgeId: target });
            if (result && at === this.viewKey && this.session.ownTurn) {
                this.model.hint = result;
                this.model.hintMode = false;
                this.model.overlay = 'hint';
                this.audio.play('hint');
                this.updateWorld();
                this.dirty = true;
            }
        }
        else if (this.session.ownTurn)
            await this.session.act({ type: v.position ? 'move' : 'spawn', nodeId: target });
    }
    private key = (e: KeyboardEvent) => {
        if (this.model.loading)
            return;
        if (document.activeElement === this.input) {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                void this.run(this.model.field === 'name' && this.model.entry === 'join' ? 'field:code' : 'enter');
            }
            if (e.key === 'Escape')
                this.input.blur();
            return;
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            const items = this.hud.regions.filter(r => !r.disabled), i = items.findIndex(r => r.id === this.model.focus), next = (i + (e.shiftKey ? -1 : 1) + items.length) % items.length;
            this.model.focus = items[next]?.id ?? null;
            this.dirty = true;
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            if (this.model.overlay)
                this.close();
            else if (this.model.hintMode) {
                this.model.hintMode = false;
                this.updateWorld();
            }
            else
                this.model.overlay = 'pause';
            this.dirty = true;
            return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && this.model.focus) {
            e.preventDefault();
            void this.run(this.model.focus);
            return;
        }
        if (this.model.overlay)
            return;
        if (e.key.toLowerCase() === 'h') {
            const r = this.hud.regions.find(r => r.id === 'hint');
            if (r && !r.disabled)
                void this.run('hint');
        }
        if (e.key.toLowerCase() === 'r' && this.session.view?.phase === 'placing' && !this.session.self?.ready)
            void this.run('random');
        if (e.key.toLowerCase() === 'm')
            void this.run('sound');
        if (e.key.toLowerCase() === 'c')
            this.world.resetCamera();
        const available = this.world.available();
        if (/^[1-5]$/.test(e.key) && available.includes(`4-${Number(e.key) - 1}`))
            void this.worldAction(`4-${Number(e.key) - 1}`);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            this.model.focus = null;
            this.dirty = true;
            const idx = available.indexOf(this.canvas.dataset.keyboardNode ?? ''), next = available[(idx + (e.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length];
            if (next) {
                this.canvas.dataset.keyboardNode = next;
                this.world.hoverAt(next);
            }
        }
        if (e.key === 'Enter' && this.canvas.dataset.keyboardNode && available.includes(this.canvas.dataset.keyboardNode))
            void this.worldAction(this.canvas.dataset.keyboardNode);
    };
    dispose() { this.disposed = true; cancelAnimationFrame(this.raf); this.abort.abort(); this.resizeObserver.disconnect(); this.session.dispose(); this.world.dispose(); this.hud.dispose(); this.audio.dispose(); if (this.toastTimer)
        clearTimeout(this.toastTimer); }
}
