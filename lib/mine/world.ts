import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NODES, EDGES, STARTS } from '../game';
import type { RoomView } from '../contracts';
const position = (id: string) => { const n = NODES.find(n => n.id === id)!; return new THREE.Vector3((n.col - n.row / 2) * 3.6, 0, (n.row - 2) * 3.4); };
const ease = (t: number) => t * t * (3 - 2 * t);
export class MineWorld {
    renderer: THREE.WebGLRenderer;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-15, 15, 10, -10, .1, 120);
    ready: Promise<void>;
    width = 1;
    height = 1;
    projected = new Map<string, {
        x: number;
        y: number;
    }>();
    private rings = new Map<string, THREE.Mesh>();
    private mines = new Map<string, THREE.Sprite>();
    private hintLines = new Map<string, THREE.Mesh>();
    private lanterns: THREE.PointLight[] = [];
    private cart = new THREE.Group();
    private cartModel: THREE.Object3D | null = null;
    private wheels: THREE.Object3D[] = [];
    private uiScene = new THREE.Scene();
    private uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    private uiMaterial: THREE.MeshBasicMaterial;
    private look = new THREE.Vector3();
    private lastTime = 0;
    private shake = 0;
    private burstAge = 99;
    private burstAt = Number.NEGATIVE_INFINITY;
    private burst = new THREE.Group();
    private sparks: THREE.Points;
    private velocities: THREE.Vector3[] = [];
    private shock: THREE.Mesh;
    private dust: THREE.Points;
    private lastEvent = '';
    private lastRound = '';
    private view: RoomView | null = null;
    private serverOffset = 0;
    private draft: string[] = [];
    private hintMode = false;
    private selected: string | null = null;
    private mouse = new THREE.Vector2();
    private dragYaw = 0;
    private zoom = 1;
    private hover: string | null = null;
    private reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    private disposed = false;
    private frameBudget = 16;
    private qualityAt = 0;
    private geometries = new Set<THREE.BufferGeometry>();
    private materials = new Set<THREE.Material>();
    private textures = new Set<THREE.Texture>();
    constructor(canvas: HTMLCanvasElement, hudTexture: THREE.Texture) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.7 : 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.12;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.autoClear = false;
        this.scene.background = new THREE.Color(0x091019);
        this.scene.fog = new THREE.FogExp2(0x091019, .014);
        this.scene.add(new THREE.HemisphereLight(0xa7c9df, 0x15202b, 2.1));
        const key = new THREE.DirectionalLight(0xd4dce0, 2.5);
        key.position.set(-8, 20, 10);
        key.castShadow = true;
        key.shadow.mapSize.set(innerWidth < 700 ? 512 : 1024, innerWidth < 700 ? 512 : 1024);
        key.shadow.camera.left = -18;
        key.shadow.camera.right = 18;
        key.shadow.camera.top = 18;
        key.shadow.camera.bottom = -18;
        key.shadow.normalBias = .08;
        this.scene.add(key);
        this.mesh(new THREE.CylinderGeometry(17, 17.2, .65, 12), this.mat(0x182b39), [0, -.44, .1]).receiveShadow = true;
        const ground = this.mesh(new THREE.CircleGeometry(16.9, 12), this.mat(0x243642), [0, -.105, .1]);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        const outer = this.mesh(new THREE.PlaneGeometry(180, 180), this.mat(0x0e1822), [0, -.9, 0]);
        outer.rotation.x = -Math.PI / 2;
        outer.receiveShadow = true;
        this.buildTracks();
        this.buildRocks();
        this.scene.add(this.cart);
        this.cart.visible = false;
        const headlamp = new THREE.PointLight(0xffd18c, 2, 4, 2);
        headlamp.position.set(0, 1.6, .3);
        this.cart.add(headlamp);
        const loader = new THREE.TextureLoader();
        const mineTexture = loader.load('/game/ui/mine.png');
        mineTexture.colorSpace = THREE.SRGBColorSpace;
        this.textures.add(mineTexture);
        for (let i = 0; i < 5; i++) {
            const t = loader.load(`/game/ui/depot-${i + 1}.png`);
            t.colorSpace = THREE.SRGBColorSpace;
            this.textures.add(t);
            const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, fog: false }));
            label.position.copy(position(`4-${i}`));
            label.position.z += .96;
            label.position.y = .6;
            label.scale.set(.72, .72, .72);
            this.scene.add(label);
        }
        for (const edge of EDGES) {
            const a = position(edge.a), b = position(edge.b), mid = a.clone().add(b).multiplyScalar(.5);
            mid.y = .75;
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: mineTexture, color: 0xe08d77, transparent: true, depthTest: false }));
            s.position.copy(mid);
            s.scale.set(.62, .62, .62);
            s.visible = false;
            this.scene.add(s);
            this.mines.set(edge.id, s);
            const strip = this.mesh(new THREE.BoxGeometry(.11, .04, a.distanceTo(b)), new THREE.MeshBasicMaterial({ color: 0x84bbb8, transparent: true, opacity: .8 }), [mid.x, .29, mid.z]);
            strip.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
            strip.visible = false;
            this.hintLines.set(edge.id, strip);
        }
        const dustGeometry = new THREE.BufferGeometry(), dustPositions = new Float32Array(90 * 3);
        for (let i = 0; i < 90; i++) {
            dustPositions[i * 3] = (Math.sin(i * 51.3) * .5 + .5) * 30 - 15;
            dustPositions[i * 3 + 1] = .6 + (i % 11) * .25;
            dustPositions[i * 3 + 2] = (Math.sin(i * 7.73) * .5 + .5) * 24 - 12;
        }
        dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
        const dustTexture = loader.load('/game/fx/dust.png');
        this.textures.add(dustTexture);
        this.dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ map: dustTexture, color: 0xbcc7cc, size: .075, transparent: true, opacity: .3, depthWrite: false }));
        this.scene.add(this.dust);
        const sparksGeometry = new THREE.BufferGeometry();
        sparksGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(100 * 3), 3));
        const sparkTexture = loader.load('/game/fx/spark.png');
        this.textures.add(sparkTexture);
        this.sparks = new THREE.Points(sparksGeometry, new THREE.PointsMaterial({ map: sparkTexture, color: 0xffce7f, size: .20, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        this.burst.add(this.sparks);
        this.shock = new THREE.Mesh(new THREE.RingGeometry(.8, 1, 36), new THREE.MeshBasicMaterial({ color: 0xf0ba68, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
        this.shock.rotation.x = -Math.PI / 2;
        this.shock.position.y = .27;
        this.burst.add(this.shock);
        this.scene.add(this.burst);
        this.uiMaterial = new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
        const ui = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.uiMaterial);
        ui.position.z = -1;
        this.uiScene.add(ui);
        this.camera.position.set(4, 27, 18);
        this.camera.lookAt(0, 0, 0);
        this.ready = this.loadModels();
    }
    private mat(color: number) { const m = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true }); this.materials.add(m); return m; }
    private mesh(g: THREE.BufferGeometry, m: THREE.Material, pos: number[], parent: THREE.Object3D = this.scene) { this.geometries.add(g); this.materials.add(m); const o = new THREE.Mesh(g, m); o.position.set(pos[0], pos[1], pos[2]); parent.add(o); return o; }
    private buildTracks() {
        const rails = this.mat(0xa1a9a9), timber = this.mat(0x594537), dark = this.mat(0x101a23), plate = this.mat(0x3f505c);
        const matrices: THREE.Matrix4[] = [], ties: THREE.Matrix4[] = [];
        const temp = new THREE.Object3D();
        for (const e of EDGES) {
            const a = position(e.a), b = position(e.b), length = a.distanceTo(b), theta = Math.atan2(b.x - a.x, b.z - a.z), normal = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
            for (const side of [-1, 1]) {
                temp.position.copy(a).add(b).multiplyScalar(.5).addScaledVector(normal, side * .15);
                temp.position.y = .19;
                temp.rotation.set(0, theta, 0);
                temp.scale.set(.065, .09, length);
                temp.updateMatrix();
                matrices.push(temp.matrix.clone());
            }
            for (let t = .15; t < 1; t += .175) {
                temp.position.copy(a).lerp(b, t);
                temp.position.y = .07;
                temp.rotation.set(0, theta, 0);
                temp.scale.set(.64, .11, .17);
                temp.updateMatrix();
                ties.push(temp.matrix.clone());
            }
        }
        const unit = new THREE.BoxGeometry(1, 1, 1);
        this.geometries.add(unit);
        for (const [list, mat] of [[matrices, rails], [ties, timber]] as const) {
            const instance = new THREE.InstancedMesh(unit, mat, list.length);
            list.forEach((m, i) => instance.setMatrixAt(i, m));
            instance.receiveShadow = true;
            this.scene.add(instance);
        }
        for (const n of NODES) {
            const p = position(n.id);
            this.mesh(new THREE.CylinderGeometry(.47, .50, .18, 20), dark, [p.x, .15, p.z]);
            this.mesh(new THREE.CylinderGeometry(.405, .405, .04, 20), plate, [p.x, .265, p.z]);
            const rim = this.mesh(new THREE.TorusGeometry(.43, .025, 4, 24), rails, [p.x, .28, p.z]);
            rim.rotation.x = Math.PI / 2;
            const ring = this.mesh(new THREE.RingGeometry(.56, .60, 32), new THREE.MeshBasicMaterial({ color: 0xeee3cf, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false }), [p.x, .30, p.z]);
            ring.rotation.x = -Math.PI / 2;
            ring.visible = false;
            this.rings.set(n.id, ring);
        }
    }
    private buildRocks() {
        let seed = 1849;
        const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
        const rockGeo = new THREE.DodecahedronGeometry(1, 0);
        this.geometries.add(rockGeo);
        const mat = this.mat(0x293f4e);
        const rocks = new THREE.InstancedMesh(rockGeo, mat, 44), outlineMat = new THREE.MeshBasicMaterial({ color: 0x10202b, side: THREE.BackSide });
        this.materials.add(outlineMat);
        const outlines = new THREE.InstancedMesh(rockGeo, outlineMat, 44), temp = new THREE.Object3D();
        for (let i = 0; i < 44; i++) {
            const theta = i / 44 * Math.PI * 2, rad = 13 + rand() * 1.8;
            temp.position.set(Math.sin(theta) * rad, rand() * .8 + .3, Math.cos(theta) * rad * .89);
            temp.scale.set(1.3 + rand() * 1.1, 1.4 + rand() * 2.5, 1.1 + rand() * 1.2);
            temp.rotation.set(rand() * .5, rand() * 6, rand() * .3);
            temp.updateMatrix();
            rocks.setMatrixAt(i, temp.matrix);
            temp.scale.multiplyScalar(1.025);
            temp.updateMatrix();
            outlines.setMatrixAt(i, temp.matrix);
        }
        rocks.castShadow = true;
        rocks.receiveShadow = true;
        this.scene.add(rocks, outlines);
        const exit = this.mesh(new THREE.BoxGeometry(2.5, 3.2, .35), this.mat(0x101a23), [0, 1.4, -9.7]);
        exit.receiveShadow = true;
        this.mesh(new THREE.PlaneGeometry(1.9, 2.6), new THREE.MeshBasicMaterial({ color: 0xe4ab5d, fog: false }), [0, 1.25, -9.50]);
        const light = new THREE.PointLight(0xffbd64, 23, 11, 2);
        light.position.set(0, 2, -8.3);
        this.scene.add(light);
        this.mesh(new THREE.BoxGeometry(2.9, .12, 3.1), this.mat(0x4b4436), [0, .02, -8.8]);
    }
    private async loadModels() {
        const loader = new GLTFLoader();
        const [cart, arch, lantern, crate] = await Promise.all(['miner-cart', 'timber-arch', 'lantern', 'supply-crate'].map(n => loader.loadAsync(`/game/models/${n}.glb`)));
        if (this.disposed)
            return;
        this.cartModel = cart.scene;
        this.cartModel.scale.setScalar(.72);
        this.cart.add(cart.scene);
        cart.scene.traverse(o => { if (o.name.startsWith('Wheel'))
            this.wheels.push(o); if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const m = o.material as THREE.MeshStandardMaterial;
            m.roughness = 1;
            m.metalness = 0;
            m.flatShading = true;
        } });
        for (const [x, z, rot] of [[0, -9.35, 0], [-10, -4, Math.PI / 2], [10, -3, Math.PI / 2], [-10, 5, Math.PI / 2], [10, 6, Math.PI / 2]]) {
            const a = arch.scene.clone(true);
            a.position.set(x, 0, z);
            a.rotation.y = rot;
            if (x !== 0)
                a.scale.setScalar(1.15);
            this.scene.add(a);
        }
        const glowTexture = new THREE.TextureLoader().load('/game/fx/glow.png');
        this.textures.add(glowTexture);
        for (const [i, [x, z]] of [[-9, -7], [9, -6], [-9, 1], [9, 2], [-7, 9], [7, 9]].entries()) {
            const l = lantern.scene.clone(true);
            l.position.set(x, 1.5, z);
            l.scale.setScalar(1.3);
            l.traverse(o => { if (o instanceof THREE.Mesh && (o.material as THREE.Material).name.startsWith('Lamp'))
                (o.material as THREE.MeshStandardMaterial).fog = false; });
            this.scene.add(l);
            const light = new THREE.PointLight(0xffbd70, 24, 8.5, 2);
            light.position.set(x, 2, z);
            this.scene.add(light);
            this.lanterns.push(light);
            const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffbe67, transparent: true, opacity: .27, depthWrite: false, blending: THREE.AdditiveBlending }));
            halo.position.set(x, 2.1, z);
            halo.scale.set(2.2, 2.2, 2.2);
            this.scene.add(halo);
            const glow = new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), new THREE.MeshBasicMaterial({ map: glowTexture, color: 0xc18d4a, transparent: true, opacity: .19, depthWrite: false }));
            glow.rotation.x = -Math.PI / 2;
            glow.position.set(x, .01, z);
            this.scene.add(glow);
            if (i % 2 === 0) {
                const box = crate.scene.clone(true);
                box.position.set(x * .98, 0, z + .8);
                box.rotation.y = .3;
                this.scene.add(box);
            }
        }
        this.scene.traverse(o => { if (o instanceof THREE.Mesh) {
            o.receiveShadow = true;
        } });
    }
    resize(w: number, h: number) { this.width = w; this.height = h; this.renderer.setSize(w, h, false); }
    setState(view: RoomView | null, draft: string[], hintMode: boolean, selected: string | null) {
        if (!view) { this.lastEvent = ''; this.lastRound = ''; }
        if (view?.event?.type !== 'explosion') this.burstAt = Number.NEGATIVE_INFINITY;
        const previous = this.view;
        this.view = view;
        this.draft = draft;
        this.hintMode = hintMode;
        this.selected = selected;
        if (view)
            this.serverOffset = view.serverNow - Date.now();
        for (const [id, m] of this.mines)
            m.visible = view?.phase === 'placing' && draft.includes(id);
        for (const [id, m] of this.hintLines)
            m.visible = selected === id;
        if (view?.event && view.event.id !== this.lastEvent) {
            this.lastEvent = view.event.id;
            if (view.event.type === 'explosion' && view.event.edgeId)
                this.explode(view.event.edgeId);
        }
        if (view && `${view.code}-${view.round}` !== this.lastRound) {
            this.lastRound = `${view.code}-${view.round}`;
            this.dragYaw = 0;
        }
        if (previous?.phase !== 'playing' && view?.phase === 'playing')
            this.zoom = 1;
    }
    private explode(edgeId: string) {
        const e = EDGES.find(e => e.id === edgeId);
        if (!e)
            return;
        const p = position(e.a).add(position(e.b)).multiplyScalar(.5);
        this.burst.position.copy(p);
        this.burstAge = 0;
        this.burstAt = performance.now();
        this.shake = this.reduce ? 0 : .26;
        const pos = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
        this.velocities = [];
        for (let i = 0; i < 100; i++) {
            pos.setXYZ(i, 0, .25, 0);
            this.velocities.push(new THREE.Vector3((Math.random() - .5) * 5, Math.random() * 4 + 1, (Math.random() - .5) * 5));
        }
        pos.needsUpdate = true;
    }
    pointer(x: number, y: number) { this.mouse.set((x / this.width - .5) * 2, (y / this.height - .5) * 2); }
    orbit(delta: number) { const limit = this.width < 700 ? .25 : .45; this.dragYaw = THREE.MathUtils.clamp(this.dragYaw + delta, -limit, limit); }
    dolly(amount: number) { this.zoom = THREE.MathUtils.clamp(this.zoom * amount, this.width < 700 ? .96 : .86, 1.16); }
    resetCamera() { this.dragYaw = 0; this.zoom = 1; this.mouse.set(0, 0); }
    hoverAt(id: string | null) { this.hover = id; }
    available() {
        if (!this.view || this.view.phase !== 'playing' || this.view.players[this.view.activeSeat]?.id !== this.view.selfId || this.view.event || this.hintMode)
            return [];
        return this.view.position ? EDGES.filter(e => e.a === this.view!.position || e.b === this.view!.position).map(e => e.a === this.view!.position ? e.b : e.a) : STARTS;
    }
    project(id: string) { return this.projected.get(id); }
    pick(x: number, y: number, edges = false): string | null {
        const tolerance = innerWidth < 700 ? 25 : 20;
        if (!edges) {
            let best: string | null = null, dist = tolerance;
            for (const id of this.available()) {
                const p = this.projected.get(id);
                if (!p)
                    continue;
                const d = Math.hypot(p.x - x, p.y - y);
                if (d < dist) {
                    best = id;
                    dist = d;
                }
            }
            return best;
        }
        let best: string | null = null, dist = innerWidth < 700 ? 19 : 13;
        for (const e of EDGES.filter(e => !e.base)) {
            const a = this.projected.get(e.a), b = this.projected.get(e.b);
            if (!a || !b)
                continue;
            const dx = b.x - a.x, dy = b.y - a.y, t = THREE.MathUtils.clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy), .2, .8), d = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
            if (d < dist) {
                best = e.id;
                dist = d;
            }
        }
        return best;
    }
    frame(time: number) {
        const elapsed = this.lastTime ? time - this.lastTime : 16;
        this.frameBudget = this.frameBudget * .97 + Math.min(elapsed, 100) * .03;
        const dt = Math.min(elapsed / 1000, .05) || .016;
        this.lastTime = time;
        const t = time / 1000, view = this.view, home = !view, mobile = this.width < 700;
        if (time - this.qualityAt > 7000) {
            this.qualityAt = time;
            if (this.frameBudget > 31 && this.renderer.getPixelRatio() > 1.15) {
                this.renderer.setPixelRatio(1.1);
                this.renderer.setSize(this.width, this.height, false);
            }
        }
        const active = view?.phase === 'playing', result = view?.phase === 'roundEnd' || view?.phase === 'finished';
        const pawn = view?.position ? position(view.position) : new THREE.Vector3();
        const target = new THREE.Vector3(home && !mobile ? -5.4 : 0, 0, home ? -1 : mobile ? 1.0 : -.5);
        if (active && view?.position) {
            target.x += pawn.x * .045;
            target.z += pawn.z * .035;
        }
        if (result) {
            target.z = -2.7;
            target.x = mobile ? 0 : 2.0;
        }
        this.look.lerp(target, this.reduce ? 1 : 1 - Math.exp(-dt * 2.2));
        const rotation = view?.event?.type === 'rotation' ? Math.sin(t * 2) * .08 : 0;
        const yaw = (home ? .16 : .025) + this.dragYaw + rotation + (this.reduce ? 0 : this.mouse.x * .018);
        const desired = new THREE.Vector3(this.look.x + Math.sin(yaw) * 19, 27, this.look.z + Math.cos(yaw) * 19);
        this.camera.position.lerp(desired, this.reduce ? 1 : 1 - Math.exp(-dt * 3));
        this.shake *= Math.exp(-Math.min(elapsed, 1000) / 1000 * 9);
        this.camera.position.x += Math.sin(t * 90) * this.shake;
        this.camera.position.z += Math.cos(t * 77) * this.shake;
        this.camera.lookAt(this.look);
        const aspect = this.width / this.height, worldWidth = (mobile ? 19.5 : 32.5) * (home ? .96 : result ? 1.05 : 1) * this.zoom;
        const horizontal = Math.max(worldWidth, 15 * aspect), vertical = horizontal / aspect;
        this.camera.left = THREE.MathUtils.lerp(this.camera.left, -horizontal / 2, 1 - Math.exp(-dt * 4));
        this.camera.right = -this.camera.left;
        this.camera.top = THREE.MathUtils.lerp(this.camera.top, vertical / 2, 1 - Math.exp(-dt * 4));
        this.camera.bottom = -this.camera.top;
        this.camera.updateProjectionMatrix();
        const allowed = this.available();
        for (const [id, r] of this.rings) {
            r.visible = allowed.includes(id);
            r.scale.setScalar(1 + (id === this.hover ? .12 : this.reduce ? 0 : Math.sin(t * 2.5) * .025));
            (r.material as THREE.MeshBasicMaterial).color.setHex(id === this.hover ? 0xe6ae55 : 0xe3d9c4);
        }
        if (view?.phase === 'playing') {
            const event = view.event;
            if (event?.type === 'move' && event.from && event.to) {
                const start = position(event.from), end = position(event.to);
                const remaining = Math.max(0, event.until - (Date.now() + this.serverOffset));
                const progress = ease(THREE.MathUtils.clamp(1 - remaining / 650, 0, 1));
                this.cart.position.copy(start).lerp(end, progress);
                this.cart.rotation.y = THREE.MathUtils.lerp(this.cart.rotation.y, Math.atan2(end.x - start.x, end.z - start.z), .22);
                this.cart.visible = true;
                for (const w of this.wheels)
                    w.rotation.x += dt * 5;
            }
            else {
                this.cart.position.copy(pawn);
                this.cart.visible = !!view.position && !event;
            }
            this.cart.position.y = .30 + (!this.reduce && this.cart.visible ? Math.sin(t * 3) * .015 : 0);
        }
        else {
            this.cart.visible = home;
            this.cart.position.copy(position('4-2'));
            this.cart.position.y = .28;
            this.cart.rotation.y = .35;
        }
        this.cart.scale.setScalar(result ? 0 : 1);
        for (let i = 0; i < this.lanterns.length; i++)
            this.lanterns[i].intensity = 24 + (this.reduce ? 0 : Math.sin(t * 2.1 + i * 2) * 1.1);
        this.dust.rotation.y = Math.sin(t * .02) * .03;
        // Public effects expire by real time, even when a mobile GPU drops frames.
        this.burstAge = (time - this.burstAt) / 1000;
        if (this.burstAge < 1.6) {
            const p = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
            for (let i = 0; i < this.velocities.length; i++) {
                const v = this.velocities[i];
                v.y -= dt * 4;
                p.setXYZ(i, p.getX(i) + v.x * dt, p.getY(i) + v.y * dt, p.getZ(i) + v.z * dt);
            }
            p.needsUpdate = true;
            (this.sparks.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - this.burstAge / 1.2);
            this.shock.scale.setScalar(1 + this.burstAge * 3);
            (this.shock.material as THREE.MeshBasicMaterial).opacity = Math.max(0, .55 - this.burstAge);
        }
        else {
            (this.sparks.material as THREE.PointsMaterial).opacity = 0;
            (this.shock.material as THREE.MeshBasicMaterial).opacity = 0;
        }
        this.camera.updateMatrixWorld();
        for (const n of NODES) {
            const p = position(n.id);
            p.y = .34;
            p.project(this.camera);
            this.projected.set(n.id, { x: (p.x * .5 + .5) * this.width, y: (-p.y * .5 + .5) * this.height });
        }
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        this.renderer.clearDepth();
        this.renderer.render(this.uiScene, this.uiCamera);
    }
    dispose() {
        this.disposed = true;
        const release = (o: THREE.Object3D) => { if (o instanceof THREE.Sprite)
            this.materials.add(o.material);
        else if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.LineSegments) {
            this.geometries.add(o.geometry);
            for (const m of Array.isArray(o.material) ? o.material : [o.material])
                this.materials.add(m);
        } };
        this.scene.traverse(release);
        this.uiScene.traverse(release);
        for (const g of this.geometries)
            g.dispose();
        for (const m of this.materials)
            m.dispose();
        for (const t of this.textures)
            t.dispose();
        this.uiMaterial.dispose();
        this.renderer.dispose();
    }
}
