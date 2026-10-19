import { createDemo, demoAction, tickDemo, DEMO_SELF_ID } from '../demo';
import { viewFor } from '../game';
import type { ApiReply, GameAction, GameState, PrivateResult, RoomView } from '../contracts';
type Membership = {
    code: string;
    token: string;
};
const KEY = 'mindminer.membership.v1';
export class MineSession {
    view: RoomView | null = null;
    demo = false;
    busy = false;
    restoring = false;
    error = '';
    connection = '';
    saved: Membership | null = null;
    onChange = () => { };
    private state: GameState | null = null;
    private member: Membership | null = null;
    private generation = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;
    private request: AbortController | null = null;
    constructor() {
        try {
            const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
            if (saved && typeof saved.code === 'string' && typeof saved.token === 'string')
                this.saved = saved;
        }
        catch { }
    }
    get ownTurn() { return this.view?.phase === 'playing' && this.view.players[this.view.activeSeat]?.id === this.view.selfId; }
    get self() { return this.view?.players.find(p => p.id === this.view?.selfId); }
    get host() { return !!this.view && this.view.selfId === this.view.hostId; }
    get blocked() { const v = this.view; return this.busy || !!this.connection || !!v?.event; }
    private emit() { if (!this.disposed)
        this.onChange(); }
    private accept(view: RoomView) { if (this.view?.code === view.code && this.view.revision > view.revision)
        return; this.view = view; this.emit(); }
    private clearTimer() { if (this.timer)
        clearTimeout(this.timer); this.timer = null; this.request?.abort(); this.request = null; }
    practice() {
        this.generation++;
        this.clearTimer();
        this.member = null;
        this.demo = true;
        this.busy = false;
        this.error = '';
        this.connection = '';
        this.state = createDemo();
        this.accept(viewFor(this.state, DEMO_SELF_ID));
        this.tick();
    }
    private tick() {
        this.timer = setTimeout(() => {
            if (!this.demo || !this.state || this.disposed)
                return;
            this.state = tickDemo(this.state, Date.now());
            if (this.state.revision !== this.view?.revision)
                this.accept(viewFor(this.state, DEMO_SELF_ID));
            this.tick();
        }, 250);
    }
    async enter(mode: 'create' | 'join', name: string, code: string) {
        if (this.busy)
            return;
        this.busy = true;
        this.error = '';
        this.emit();
        const g = ++this.generation;
        try {
            const response = await fetch(mode === 'create' ? '/api/rooms' : `/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
            const reply = await response.json() as ApiReply & {
                error?: string;
            };
            if (g !== this.generation || this.disposed)
                return;
            if (!response.ok || !reply.token)
                throw new Error(reply.error ?? '방에 연결할 수 없습니다.');
            this.clearTimer();
            this.demo = false;
            this.state = null;
            this.member = { code: reply.view.code, token: reply.token };
            this.saved = this.member;
            this.view = null;
            this.accept(reply.view);
            try {
                localStorage.setItem(KEY, JSON.stringify(this.member));
            }
            catch { }
            this.poll(g);
        }
        catch (e) {
            if (g === this.generation)
                this.error = e instanceof Error ? e.message : '연결을 확인해주세요.';
        }
        finally {
            if (g === this.generation) {
                this.busy = false;
                this.emit();
            }
        }
    }
    resume() {
        if (!this.saved)
            return;
        this.clearTimer();
        this.generation++;
        this.demo = false;
        this.member = this.saved;
        this.view = null;
        this.restoring = true;
        this.emit();
        this.poll(this.generation);
    }
    private async poll(g: number) {
        if (!this.member || g !== this.generation || this.disposed)
            return;
        this.request = new AbortController();
        try {
            const response = await fetch(`/api/rooms/${this.member.code}`, { headers: { Authorization: `Bearer ${this.member.token}` }, cache: 'no-store', signal: this.request.signal });
            const reply = await response.json() as ApiReply & {
                error?: string;
            };
            if (g !== this.generation || this.disposed)
                return;
            if (response.status === 401 || response.status === 404) {
                this.saved = null;
                this.member = null;
                this.view = null;
                this.restoring = false;
                this.error = reply.error ?? '이전 방이 만료되었습니다.';
                try {
                    localStorage.removeItem(KEY);
                }
                catch { }
                this.emit();
                return;
            }
            if (!response.ok)
                throw new Error(reply.error);
            this.connection = '';
            this.restoring = false;
            this.accept(reply.view);
        }
        catch {
            if (g !== this.generation || this.disposed)
                return;
            this.restoring = false;
            this.connection = '연결 확인 중 · 자동으로 다시 연결합니다';
            this.emit();
        }
        if (g === this.generation && !this.disposed)
            this.timer = setTimeout(() => void this.poll(g), this.view?.phase === 'playing' ? 350 : 1000);
    }
    async act(action: GameAction): Promise<PrivateResult | undefined> {
        if (!this.view || this.busy)
            return;
        this.busy = true;
        this.error = '';
        this.emit();
        const g = this.generation;
        try {
            if (this.demo && this.state) {
                const reply = demoAction(this.state, action, Date.now());
                this.state = reply.state;
                this.accept(viewFor(reply.state, DEMO_SELF_ID));
                return reply.privateResult;
            }
            if (!this.member)
                return;
            const response = await fetch(`/api/rooms/${this.member.code}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.member.token}` }, body: JSON.stringify({ action, revision: this.view.revision }) });
            const reply = await response.json() as ApiReply & {
                error?: string;
            };
            if (g !== this.generation || this.disposed)
                return;
            if (!response.ok)
                throw new Error(reply.error ?? '잠시 후 다시 시도해주세요.');
            this.accept(reply.view);
            return reply.privateResult;
        }
        catch (e) {
            if (g === this.generation)
                this.error = e instanceof Error ? e.message : '행동을 처리할 수 없습니다.';
        }
        finally {
            if (g === this.generation) {
                this.busy = false;
                this.emit();
            }
        }
    }
    leave() { this.generation++; this.clearTimer(); this.member = null; this.view = null; this.demo = false; this.state = null; this.busy = false; this.restoring = false; this.error = ''; this.connection = ''; this.emit(); }
    dispose() { this.disposed = true; this.generation++; this.clearTimer(); }
}
