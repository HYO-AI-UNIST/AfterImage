export class MineAudio {
    muted = false;
    private context: AudioContext | null = null;
    private master: GainNode | null = null;
    private ambient: AudioBufferSourceNode | null = null;
    async unlock() {
        if (!this.context) {
            this.context = new AudioContext();
            this.master = this.context.createGain();
            this.master.gain.value = this.muted ? 0 : .28;
            this.master.connect(this.context.destination);
            const buffer = this.context.createBuffer(1, this.context.sampleRate * 4, this.context.sampleRate), data = buffer.getChannelData(0);
            let last = 0;
            for (let i = 0; i < data.length; i++) {
                last = (last + (Math.random() * 2 - 1) * .025) / 1.025;
                data[i] = last;
            }
            const source = this.context.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            const filter = this.context.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 180;
            const gain = this.context.createGain();
            gain.gain.value = .3;
            source.connect(filter);
            filter.connect(gain);
            gain.connect(this.master);
            source.start();
            this.ambient = source;
        }
        if (this.context.state === 'suspended')
            await this.context.resume();
    }
    toggle() { this.muted = !this.muted; if (this.master && this.context)
        this.master.gain.setTargetAtTime(this.muted ? 0 : .28, this.context.currentTime, .08); }
    play(kind: 'click' | 'move' | 'explosion' | 'hint' | 'win' | 'turn') {
        const ctx = this.context;
        if (!ctx || !this.master || this.muted)
            return;
        const t = ctx.currentTime;
        if (kind === 'explosion') {
            const b = ctx.createBuffer(1, ctx.sampleRate * .55, ctx.sampleRate), d = b.getChannelData(0);
            for (let i = 0; i < d.length; i++)
                d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
            const s = ctx.createBufferSource();
            s.buffer = b;
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 750;
            const gain = ctx.createGain();
            gain.gain.value = .6;
            s.connect(filter);
            filter.connect(gain);
            gain.connect(this.master);
            s.start();
            return;
        }
        const notes = kind === 'win' ? [392, 494, 587, 784] : kind === 'hint' ? [440, 660] : kind === 'turn' ? [220, 330] : kind === 'move' ? [145, 180] : [310];
        notes.forEach((hz, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = kind === 'move' ? 'triangle' : 'sine'; o.frequency.value = hz; g.gain.setValueAtTime(0, t + i * .08); g.gain.linearRampToValueAtTime(kind === 'click' ? .16 : .12, t + i * .08 + .008); g.gain.exponentialRampToValueAtTime(.001, t + i * .08 + .21); o.connect(g); g.connect(this.master!); o.start(t + i * .08); o.stop(t + i * .08 + .23); });
    }
    dispose() { this.ambient?.stop(); void this.context?.close(); }
}
