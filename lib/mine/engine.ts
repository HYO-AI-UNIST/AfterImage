import { MineHud, type HudModel } from './hud';
import { MineWorld } from './world';
import { MineSession } from './session';
import { MineAudio } from './audio';
import { canRebuildBoard, maxMines } from '../game';
import { createRuleUi, turnKey, ownShift } from './rule-ui';
import { ruleAction } from './rule-actions';
import { availableRoles } from '../roles';
import { GUIDE_PAGES, guidePage } from './guide';
import { playAbility } from './presentation';
export class MineGame {
    private session = new MineSession();
    private hud = new MineHud();
    private world: MineWorld;
    private audio = new MineAudio();
    private model: HudModel = { session: this.session, draft: [], hintMode: false, overlay: null, entry: 'create', name: '', code: '', field: null, hint: null, toast: '', loading: true, hover: null, focus: null, muted: false, turnAt: 0, resultAt: 0, pressed: null, routes: [], cinematic: null, guidePage: 0, guideScroll: 0, rule: createRuleUi() };
    private raf = 0;
    private lastHud = 0;
    private lastGeometry = 0;
    private lastTurn = '';
    private lastEvent = '';
    private lastAbilityCue = '';
    private memoScope = '';
    private placementScope = '';
    private lastPhase = '';
    private viewKey = '';
    private dirty = true;
    private inCinematic = false;
    private disposed = false;
    private composing = false;
    private nextAutoReadyAt = 0;
    private toastTimer: ReturnType<typeof setTimeout> | null = null;
    private pointers = new Map<number, {
        x: number;
        y: number;
    }>();
    private down = { x: 0, y: 0, guideScroll: 0 };
    private dragging = false;
    private resizeObserver: ResizeObserver;
    private abort = new AbortController();
    constructor(private canvas: HTMLCanvasElement, private input: HTMLInputElement) {
        this.world = new MineWorld(canvas, this.hud.texture);
        this.session.presentationBusy = () => this.world.inputLocked || this.model.overlay === 'help';
        this.session.onChange = () => this.sync();
        const options = { signal: this.abort.signal };
        canvas.addEventListener('pointerdown', this.pointerDown, options);
        canvas.addEventListener('pointermove', this.pointerMove, options);
        canvas.addEventListener('pointerup', this.pointerUp, options);
        canvas.addEventListener('pointercancel', this.pointerCancel, options);
        canvas.addEventListener('wheel', this.wheel, { ...options, passive: false });
        canvas.addEventListener('pointerleave', () => { this.model.hover = null; this.model.pressed = null; this.world.hoverAt(null); this.dirty = true; }, options);
        window.addEventListener('keydown', this.key, options);
        input.addEventListener('input', this.inputChanged, options);
        input.addEventListener('compositionstart', () => { this.composing=true; }, options);
        input.addEventListener('compositionend', () => { this.composing=false;this.inputChanged(); }, options);
        document.addEventListener('selectionchange', () => {if(document.activeElement===input)this.inputSelection();},options);
        input.addEventListener('blur', () => { this.model.field = null;this.input.dataset.editing='false'; this.dirty = true; }, options);
        document.fonts.addEventListener('loadingdone', () => this.dirty = true, options);
        window.addEventListener('resize', this.resize, options);
        window.visualViewport?.addEventListener('resize', this.resize, options);
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
    private resize = () => {
        const r = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
        const w = Math.max(1, r.width), h = Math.max(1, Math.min(r.height, window.visualViewport?.height ?? r.height));
        if (Math.abs(this.canvas.getBoundingClientRect().height - h) > .5) this.canvas.style.height = `${h}px`;
        this.world.resize(w, h); this.hud.resize(w, h);
        this.lastHud = 0; this.lastGeometry = 0; this.dirty = true;
    };
    private sync() {
        if (this.disposed)
            return;
        const v = this.session.view, phase = v?.phase ?? 'home', turn = turnKey(v);
        const memoScope=v?`${v.code}:${v.selfId}:${v.round}`:'';
        if(memoScope!==this.memoScope){this.memoScope=memoScope;this.model.rule.memoUndo=null;this.model.rule.memoNode=null;}
        const placementScope=v?.phase==='placing'?`${v.code}:${v.selfId}:${v.round}`:'';
        if(placementScope&&placementScope!==this.placementScope){
            this.model.draft=v?.ownMines??[];this.model.rule.concealed=v?.ownConcealed??[];this.model.rule.tool='mine';this.model.rule.fx=null;
            if(v?.rolesEnabled&&this.session.self&&!this.session.self.role){this.model.rule.role=availableRoles(v.playerCount)[0];this.model.overlay='roles';this.model.focus=null;}
        }
        this.placementScope=placementScope;
        if (!v) { this.lastAbilityCue = ''; this.model.rule.fx = null; }
        if (v?.abilityCue && v.abilityCue.id !== this.lastAbilityCue) {
            this.lastAbilityCue = v.abilityCue.id;
            playAbility(this.model,v.abilityCue.role,v.abilityCue.role === 'guardian' ? '귀환의 가호' : '위험의 전이',v.players[v.abilityCue.actorSeat]?.name);
            this.audio.play('hint');
        }
        if (!v && this.model.overlay && !['entry','help','pause','assets'].includes(this.model.overlay)) this.model.overlay = null;
        if (!['roundEnd','finished'].includes(phase) && this.model.overlay === 'reveal') this.model.overlay = null;
        if (phase !== 'waiting' && (this.model.overlay === 'settings' || this.model.overlay === 'roster')) this.model.overlay = null;
        if (this.model.overlay === 'peek') this.model.rule.peekTargets = this.model.rule.peekTargets.filter(t=>v?.peekableMemos?.some(p=>p.playerId===t.playerId&&p.slot===t.slot));
        if (turn !== this.lastTurn) {
            this.model.hint = null;
            this.model.rule.peekResult = null; this.model.rule.shiftFrom = null; this.model.rule.shiftTo = null;
            this.model.hintMode = false;
            if (this.model.overlay === 'hint' || this.model.overlay === 'peek-result' || this.model.overlay === 'peek')
                this.model.overlay = null;
            this.model.turnAt = performance.now();
            if (this.session.ownTurn && v?.phase === 'playing')
                this.audio.play('turn');
            this.lastTurn = turn;
        }
        if (phase !== this.lastPhase) {
            if (phase !== 'placing') { this.model.draft = []; this.model.rule.concealed = []; this.model.rule.tool = 'mine'; }
            this.model.focus = null;
            this.model.pressed = null;
            if (phase !== 'playing') this.lastEvent = '';
            if (phase !== 'playing') {
                if (['memos','peek','peek-result'].includes(this.model.overlay ?? '')) this.model.overlay = null;
                this.model.hint = null;
                this.model.hintMode = false;
            }
            if (phase === 'roundEnd' || phase === 'finished') {
                this.model.resultAt = performance.now();
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
        if (v?.phase === 'placing' && v.rolesEnabled && this.session.self && !this.session.self.role && !['help','pause','leave'].includes(this.model.overlay ?? '')) this.model.overlay = 'roles';
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
        this.canvas.dataset.revision = String(v?.revision ?? 0);
        this.canvas.setAttribute('aria-label', `MindMiner 3D 게임. ${phase === 'home' ? '홈 메뉴' : phase === 'placing' ? '선로에 지뢰 배치' : v&&ownShift(v) ? '내 갱도. 옮길 지뢰와 빛나는 빈 선로를 선택하세요.' : phase === 'playing' ? this.session.ownTurn ? '내 차례. 화살표로 이동 대상을 고르고 Enter로 이동. H로 힌트 사용.' : '다른 광부 탐색 중' : '게임 결과'}. Tab으로 메뉴 선택, Escape로 메뉴.`);
    }
    private updateWorld() {
        const v = this.session.view, r = this.model.rule;
        const draft = v && ownShift(v) ? r.shiftFrom && r.shiftTo ? (v.shiftMines ?? []).map(id => id === r.shiftFrom ? r.shiftTo! : id) : v.shiftMines ?? [] : this.model.draft;
        this.world.setState(v, draft, this.model.hintMode, v && ownShift(v) ? r.shiftTo ?? r.shiftFrom : this.model.hint?.edgeId ?? null, r.concealed);
        this.world.setTransfer(v&&ownShift(v)?r.shiftFrom:null,r.shiftTo);
        this.world.setSurvey(this.model.overlay === 'hint' ? this.model.hint?.edgeId ?? null : null, r.scanAt, this.model.hint?.mined);
    }
    private frame = (time: number) => {
        if (this.disposed)
            return;
        const view=this.session.view,self=this.session.self;
        // Retaining a board is not a decision. Keep the server's readiness
        // handshake, after this round's mandatory role choice, without a button.
        if(!this.model.loading&&view?.phase==='placing'&&self&&!self.ready&&!canRebuildBoard(view,self.seat)&&(!view.rolesEnabled||!!self.role)&&!this.session.blocked&&time>=this.nextAutoReadyAt){
            this.nextAutoReadyAt=time+3000;
            void this.session.act({type:'ready'});
        }
        this.world.frame(time, false);
        this.model.rule.scanAnchor = this.world.surveyAnchor();
        this.model.cinematic = this.world.cinematic;
        this.model.routes = this.world.routes();
        if (this.inCinematic && !this.model.cinematic) { this.model.turnAt = time; this.dirty = true; }
        this.inCinematic = !!this.model.cinematic;
        const waiting=this.session.view?.phase==='placing'&&!!this.session.self&&!canRebuildBoard(this.session.view,this.session.self.seat);
        const animated = this.model.overlay === 'roles' && !matchMedia('(prefers-reduced-motion: reduce)').matches || !this.model.overlay && (!!this.model.cinematic || waiting || this.session.view?.phase==='playing' || (this.session.view?.phase === 'roundEnd' || this.session.view?.phase === 'finished') && time - this.model.resultAt < 3800 || this.model.routes.length > 0 || time - this.model.turnAt < 1600 && this.session.ownTurn) || !!this.model.rule.fx && time-this.model.rule.fx.at<2800 || this.model.overlay === 'hint';
        if (this.dirty || animated && time - this.lastHud > 40 || time - this.lastHud > 1000) {
            this.hud.draw(this.model, time);
            this.positionInput();
            this.lastHud = time;
            this.dirty = false;
            this.canvas.dataset.controls = JSON.stringify(this.hud.regions.filter(r => !r.disabled).map(({ id, x, y, w, h }) => ({ id, x, y, w, h })));
            this.canvas.dataset.overlay = this.model.overlay ?? '';
            this.canvas.dataset.guidePage = this.model.overlay === 'help' ? String(this.model.guidePage) : '';
            this.canvas.dataset.guideScroll = this.model.overlay === 'help' ? String(Math.min(this.hud.guideScrollMax, this.model.guideScroll)) : '';
            this.canvas.dataset.event = this.session.view?.event?.type ?? '';
            this.canvas.dataset.cinematic = this.model.cinematic?.kind ?? '';
        }
        this.world.render();
        if (time - this.lastGeometry > 100) {
            this.canvas.dataset.nodes = JSON.stringify(Object.fromEntries(this.world.projected));
            this.canvas.dataset.inputMode = this.model.hintMode ? 'hint' : this.session.view?.phase === 'placing' ? 'placement' : 'movement';
            this.lastGeometry = time;
        }
        this.raf = requestAnimationFrame(this.frame);
    };
    private toast(s: string) { this.model.toast = s; this.dirty = true; if (this.toastTimer)
        clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { this.model.toast = ''; this.dirty = true; }, 3000); }
    private close() { const v=this.session.view,required=v?.phase==='placing'&&v.rolesEnabled&&this.session.self&&!this.session.self.role;this.model.overlay = required || v && this.model.overlay === 'help' && this.model.rule.guideReturn ? 'roles' : null; this.model.rule.guideReturn = false; this.model.hint = null; this.model.rule.peekResult = null; this.model.toast = ''; this.model.field = null; this.model.focus = null; this.input.blur(); this.updateWorld(); this.dirty = true; }
    private async run(id: string) {
        if (this.hud.regions.find(r => r.id === id)?.disabled)
            return;
        void this.audio.unlock();
        this.audio.play('click');
        if (id.startsWith('route:')) { await this.worldAction(id.slice(6)); return; }
        if (id.startsWith('field:')) {
            this.model.field = id.slice(6);
            this.input.value = this.model.field === 'name' ? this.model.name : this.model.code;
            this.input.maxLength = this.model.field === 'name' ? 12 : 6;
            this.input.inputMode = 'text';
            this.input.enterKeyHint = this.model.field === 'name' && this.model.entry === 'join' ? 'next' : 'go';
            this.input.autocapitalize = this.model.field === 'name' ? 'words' : 'characters';
            this.input.setAttribute('aria-label', this.model.field === 'name' ? '플레이어 이름' : '방 코드');
            this.positionInput();
            this.input.focus({ preventScroll: true });
            this.inputSelection();
            this.dirty = true;
            return;
        }
        if (await ruleAction(id, this.model, () => this.close(), s => this.toast(s))) { this.updateWorld(); this.dirty = true; return; }
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
        else if (id === 'help') {
            this.model.rule.guideReturn = false;
            this.model.guidePage = this.session.view?.phase === 'placing' ? 1 : this.model.hintMode ? 4 : this.session.view?.phase === 'playing' ? 2 : this.session.view?.winner ? 6 : 0;
            this.model.focus = null;
            this.model.guideScroll = 0;
            this.model.overlay = 'help';
        }
        else if (this.model.overlay === 'help' && (id.startsWith('guide:') || id === 'guide-prev' || id === 'guide-next')) {
            this.model.guidePage = guidePage(id.startsWith('guide:') ? Number(id.slice(6)) : this.model.guidePage + (id === 'guide-prev' ? -1 : 1));
            this.model.guideScroll = 0;
            this.model.focus = null;
        }
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
        else if (id === 'hint') {
            this.model.hintMode = !this.model.hintMode;
            this.updateWorld();
        }
        else if (id === 'next')
            await this.session.act({ type: this.session.view!.phase === 'finished' ? 'restart' : 'nextRound' });
        this.dirty = true;
    }
    private positionInput(){
        const field=this.hud.regions.find(r=>r.id===`field:${this.model.field}`);
        this.input.dataset.editing=field?'true':'false';
        if(!field)return;
        const rect=this.canvas.getBoundingClientRect();
        Object.assign(this.input.style,{left:`${rect.left+field.x}px`,top:`${rect.top+field.y}px`,width:`${field.w}px`,height:`${field.h}px`});
    }
    private inputSelection(){this.model.selection={start:this.input.selectionStart??0,end:this.input.selectionEnd??0};this.dirty=true;}
    private inputChanged = () => { if (this.model.field === 'name')
        this.model.name = this.input.value;
    else if (this.model.field === 'code') {
        const cursor=this.input.selectionStart??0;
        this.model.code = this.composing?this.input.value:this.input.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
        if(!this.composing&&this.input.value!==this.model.code){const next=this.input.value.slice(0,cursor).replace(/[^a-z0-9]/gi,'').length;this.input.value=this.model.code;this.input.setSelectionRange(next,next);}
    } this.inputSelection(); };
    private pointerDown = (e: PointerEvent) => {
        if (this.model.loading) return;
        void this.audio.unlock(); this.canvas.focus({ preventScroll: true });
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.down = { x: e.clientX, y: e.clientY, guideScroll: this.model.guideScroll }; this.dragging = false;
        const r = this.canvas.getBoundingClientRect(), hit = this.hud.hit(e.clientX - r.left, e.clientY - r.top);
        this.model.pressed = hit && !hit.disabled ? hit.id : null; this.dirty = true;
        this.canvas.setPointerCapture(e.pointerId);
    };
    private pointerMove = (e: PointerEvent) => {
        const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        if (this.pointers.has(e.pointerId) && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 9) {
            this.dragging = true; this.model.pressed = null; this.dirty = true;
            if (this.model.overlay === 'help' && Math.abs(e.clientY - this.down.y) > Math.abs(e.clientX - this.down.x) * 1.4)
                this.scrollGuide(this.down.guideScroll + this.down.y - e.clientY);
        }
        const hit = this.hud.hit(x, y), hover = hit && !hit.disabled ? hit.id : null;
        if (hover !== this.model.hover) { this.model.hover = hover; this.dirty = true; }
        const target = !this.model.overlay && !this.session.blocked ? this.world.pick(x, y, this.session.view?.phase === 'placing' || !!this.session.view && ownShift(this.session.view) || this.model.hintMode) : null;
        this.world.hoverAt(hover?.startsWith('route:') ? hover.slice(6) : target);
        this.canvas.style.cursor = hover || target ? 'pointer' : 'default';
    };
    private pointerUp = (e: PointerEvent) => {
        this.model.pressed = null; this.dirty = true;
        this.pointers.delete(e.pointerId);
        if (this.canvas.hasPointerCapture(e.pointerId))
            this.canvas.releasePointerCapture(e.pointerId);
        if (this.model.overlay === 'help' && e.pointerType === 'touch') {
            const dx = e.clientX - this.down.x, dy = e.clientY - this.down.y;
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
                void this.run(dx < 0 ? 'guide-next' : 'guide-prev'); return;
            }
        }
        if (this.dragging || this.model.loading)
            return;
        const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hit = this.hud.hit(x, y);
        if (this.model.overlay === 'memos') {
            const pick=this.hud.memoPick(x,y,this.model.rule.memoNode);
            if(pick){if(!this.session.busy){if(pick.edge)void this.run(`memo-edge:${pick.edge}`);else if(pick.node){this.model.rule.memoNode=this.model.rule.memoNode===pick.node?null:pick.node;this.dirty=true;}}return;}
        }
        if (hit) {
            if (!hit.disabled)
                void this.run(hit.id);
            return;
        }
        if (this.model.overlay)
            return;
        const target = this.world.pick(x, y, this.session.view?.phase === 'placing' || !!this.session.view && ownShift(this.session.view) || this.model.hintMode);
        this.canvas.dataset.lastPick = target ?? 'none';
        if (target)
            void this.worldAction(target);
    };
    private pointerCancel = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.dragging = true; this.model.pressed = null; this.dirty = true; };
    private scrollGuide(value: number) { this.model.guideScroll = Math.max(0, Math.min(this.hud.guideScrollMax, value)); this.dirty = true; }
    private wheel = (e: WheelEvent) => {
        if (this.model.overlay !== 'help') return;
        e.preventDefault();
        this.scrollGuide(this.model.guideScroll + e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.hud.height : 1));
    };
    private async worldAction(target: string) {
        const v = this.session.view;
        if (!v || this.session.blocked || this.model.overlay || this.world.inputLocked)
            return;
        if(v.phase==='placing'&&v.rolesEnabled&&!this.session.self?.role)return;
        if (ownShift(v)) {
            const r = this.model.rule, mines = v.shiftMines ?? [];
            if (mines.includes(target)) { r.shiftFrom = r.shiftFrom === target ? null : target; r.shiftTo = null; }
            else if (r.shiftFrom && this.world.canTransferTo(target)) r.shiftTo = target;
            this.updateWorld(); this.dirty = true; return;
        }
        if (v.phase === 'placing' && this.session.self && !this.session.self.ready && canRebuildBoard(v, this.session.self.seat)) {
            if (this.model.rule.tool === 'conceal' && this.session.self.role === 'trapper') {
                const r = this.model.rule; r.concealed = r.concealed.includes(target) ? r.concealed.filter(id => id !== target) : r.concealed.length < 4 ? [...r.concealed, target] : r.concealed;
                this.updateWorld(); this.dirty = true; return;
            }
            if (!this.model.draft.includes(target) && this.model.draft.length >= maxMines(v.gridSize)) { this.toast(`지뢰는 최대 ${maxMines(v.gridSize)}개까지 놓을 수 있어요.`); return; }
            this.model.draft = this.model.draft.includes(target) ? this.model.draft.filter(id => id !== target) : [...this.model.draft, target];
            this.audio.play('click');
            this.updateWorld();
            this.dirty = true;
        }
        else if (this.session.ownTurn && this.model.hintMode) {
            const at = this.viewKey, reply = await this.session.act({ type: 'hint', edgeId: target }), result = reply?.privateResult;
            if (result && at === this.viewKey && this.session.ownTurn) {
                this.model.hint = result;
                this.model.hintMode = false;
                this.model.overlay = 'hint';
                this.model.rule.scanAt = performance.now();
                this.model.rule.fx = null;
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
            if(this.composing||e.isComposing)return;
            if(e.key==='Tab'){
                e.preventDefault();
                const fields=this.hud.regions.filter(r=>r.id.startsWith('field:')),index=fields.findIndex(r=>r.id===`field:${this.model.field}`),next=fields[index+(e.shiftKey?-1:1)];
                if(next)void this.run(next.id);
                else{this.input.blur();this.canvas.focus({preventScroll:true});this.model.focus=e.shiftKey?'create-tab':'enter';this.dirty=true;}
                return;
            }
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                void this.run(this.model.field === 'name' && this.model.entry === 'join' ? 'field:code' : 'enter');
            }
            if (e.key === 'Escape')
                this.input.blur();
            return;
        }
        if (e.key === 'F1' && (!this.model.overlay || this.model.overlay === 'pause')) {
            e.preventDefault(); void this.run('help'); return;
        }
        if (this.model.overlay === 'help' && ['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            const page = e.key === 'Home' ? 0 : e.key === 'End' ? GUIDE_PAGES.length - 1 : this.model.guidePage + (e.key === 'ArrowLeft' || e.key === 'PageUp' ? -1 : 1);
            void this.run(`guide:${guidePage(page)}`); return;
        }
        if (this.model.overlay === 'roles' && ['ArrowRight','ArrowLeft'].includes(e.key)) { e.preventDefault();void this.run(e.key==='ArrowRight'?'role-next':'role-prev');return; }
        if(this.model.overlay==='memos'&&['ArrowRight','ArrowLeft'].includes(e.key)){
            e.preventDefault();const edges=this.hud.memoMap?.edges??[],i=edges.findIndex(edge=>edge.id===this.model.rule.memoEdge);this.model.rule.memoEdge=edges[(i+(e.key==='ArrowRight'?1:-1)+edges.length)%edges.length]?.id??null;this.model.focus=null;this.dirty=true;return;
        }
        if(this.model.overlay==='memos'&&e.key==='Enter'&&!this.model.focus&&this.model.rule.memoEdge){e.preventDefault();void this.run(`memo-edge:${this.model.rule.memoEdge}`);return;}
        if (this.model.overlay === 'help' && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
            e.preventDefault(); this.scrollGuide(this.model.guideScroll + (e.key === 'ArrowDown' ? 50 : -50)); return;
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
        const available = this.world.keyboardTargets();
        if (!this.model.hintMode && /^[1-7]$/.test(e.key) && available.includes(`${this.session.view?.gridSize ?? 4}-${Number(e.key) - 1}`))
            void this.worldAction(`${this.session.view?.gridSize ?? 4}-${Number(e.key) - 1}`);
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
