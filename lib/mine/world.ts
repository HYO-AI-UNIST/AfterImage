import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getBoard, canRebuildBoard } from '../game';
import type { RoomView } from '../contracts';
import { boardPosition } from './board-layout';
import { MineExplosion } from './explosion';
import { AmbientDust } from './ambient-dust';
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
    private mines = new Map<string, THREE.Group>();
    private board = new THREE.Group();
    private scenery = new THREE.Group();
    private trackRoot = new THREE.Group();
    private memoRoot = new THREE.Group();
    private gridSize = 4;
    private get geometry() { return getBoard(this.gridSize); }
    private position(id: string) { const [x, z] = boardPosition(id, this.gridSize); return new THREE.Vector3(x, 0, z); }
    private buildingTracks = false;
    private hazardTexture!: THREE.Texture;
    private brokenModel: THREE.Object3D | null = null;
    private levels = new Map<number, THREE.Object3D>();
    private activeLevel: THREE.Object3D | null = null;
    private memoKey = '';
    private concealed: string[] = [];
    private concealMarks = new Map<string, THREE.Mesh>();
    private tables: THREE.Group[] = [];
    private center = new THREE.Vector3();
    private flightFrom = new THREE.Vector3();
    private flightTo = new THREE.Vector3();
    private flightAt = Number.NEGATIVE_INFINITY;
    private flightMs = 2200;
    private flightKind: 'turn' | 'shuffle' = 'turn';
    private flightSeat = 0;
    private rails: THREE.InstancedMesh | null = null;
    private railMatrices: THREE.Matrix4[] = [];
    private dangerSparks = new Map<string, THREE.Points>();
    private blastLight = new THREE.PointLight(0xffe2b5, 0, 12, 2);
    private flash: THREE.Sprite;
    private hintLines = new Map<string, THREE.Mesh>();
    private keyLight: THREE.DirectionalLight;
    private stageLight = new THREE.SpotLight(0xc8d5e0, 1250, 42, .60, .48, 2);
    private stageBeam: THREE.Mesh | null = null;
    private cueAt = Number.NEGATIVE_INFINITY;
    private placementStage = false;
    private platformRims = new THREE.MeshStandardMaterial({color: 0x718794, emissive: 0xb5d4e6, emissiveIntensity: .08, roughness: .7});
    private platformPools: THREE.MeshBasicMaterial[] = [];
    private cartLamp = new THREE.PointLight(0xdce8ed, 24, 6.5, 2);
    private cartHalo: THREE.Mesh;
    private menu = new THREE.Group();
    private menuCarts: THREE.Object3D[] = [];
    private menuFlashes: THREE.Sprite[] = [];
    private resultStage = new THREE.Group();
    private resultAt = Number.NEGATIVE_INFINITY;
    private projectionReset = true;
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
    private explosion: MineExplosion;
    private shock: THREE.Mesh;
    private dust: AmbientDust;
    private lastEvent = '';
    private lastRound = '';
    private view: RoomView | null = null;
    private serverOffset = 0;
    private draft: string[] = [];
    private hintMode = false;
    private selected: string | null = null;

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
        this.renderer.toneMappingExposure = .95;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.autoClear = false;
        this.scene.background = new THREE.Color(0x050709);
        this.scene.fog = new THREE.FogExp2(0x050709, .014);
        this.scene.add(this.board);
        this.scene.add(this.menu);
        this.menu.visible = false;
        this.board.add(this.scenery, this.trackRoot, this.memoRoot);
        this.scene.add(new THREE.HemisphereLight(0xa3b3c1, 0x07090b, .48));
        const key = new THREE.DirectionalLight(0x9cabb6, .62);
        key.position.set(-8, 20, 10);
        this.keyLight = key;
        this.scene.add(key.target);
        key.castShadow = false;
        key.shadow.mapSize.set(innerWidth < 700 ? 512 : 1024, innerWidth < 700 ? 512 : 1024);
        key.shadow.camera.left = -18;
        key.shadow.camera.right = 18;
        key.shadow.camera.top = 18;
        key.shadow.camera.bottom = -18;
        key.shadow.normalBias = .08;
        this.scene.add(key);
        this.stageLight.position.set(0, 17, -.8); this.stageLight.target.position.set(0, 0, -.8);
        this.stageLight.castShadow = true;
        this.stageLight.shadow.mapSize.copy(key.shadow.mapSize);
        this.stageLight.shadow.normalBias = .04;
        this.scene.add(this.stageLight, this.stageLight.target);
        const abyss = this.mesh(new THREE.PlaneGeometry(260, 260), this.mat(0x040608), [0, -5, -40], this.scene);
        abyss.rotation.x = -Math.PI / 2; abyss.receiveShadow = true;
        this.buildTracks();
        this.buildRocks();
        this.board.add(this.cart);
        this.cart.visible = false;
        this.cartLamp.position.set(0, 1.5, .2);
        this.cart.add(this.cartLamp);
        const loader = new THREE.TextureLoader();
        const hazardTexture = loader.load('/game/fx/glow.png'); this.textures.add(hazardTexture); this.hazardTexture = hazardTexture;
        this.cartHalo = this.mesh(new THREE.PlaneGeometry(4.6, 4.6), new THREE.MeshBasicMaterial({map: hazardTexture, color: 0xc4dbe6, transparent: true, opacity: .42, depthWrite: false, blending: THREE.AdditiveBlending}), [0, .03, 0], this.board);
        this.cartHalo.rotation.x = -Math.PI / 2;
        this.resultStage.position.copy(this.position('0-0'));
        this.board.add(this.resultStage);
        this.mesh(new THREE.CylinderGeometry(1.6, 1.85, .40, 12), this.mat(0x172027), [0, .05, 0], this.resultStage);
        const awardRim = new THREE.MeshStandardMaterial({color: 0xd8e5ec, emissive: 0xc7e5f5, emissiveIntensity: .8, roughness: .6});
        const rim = this.mesh(new THREE.TorusGeometry(1.63, .045, 5, 48), awardRim, [0, .27, 0], this.resultStage); rim.rotation.x = Math.PI / 2;
        const podiumGlow = this.mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({map: hazardTexture, color: 0xc5e1ef, transparent: true, opacity: .4, depthWrite: false, blending: THREE.AdditiveBlending}), [0, .28, 0], this.resultStage); podiumGlow.rotation.x = -Math.PI / 2;
        this.resultStage.visible = false;
        this.buildBoardDetails();
        this.dust = new AmbientDust(innerWidth < 700, this.reduce);
        this.scene.add(this.dust.points);
        this.explosion = new MineExplosion(innerWidth < 700, this.reduce);
        this.burst.add(this.explosion.root);
        this.shock = new THREE.Mesh(new THREE.RingGeometry(.8, 1, 36), new THREE.MeshBasicMaterial({ color: 0xf0ba68, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
        this.shock.rotation.x = -Math.PI / 2;
        this.shock.position.y = .27;
        this.burst.add(this.shock);
        this.board.add(this.burst);
        const flashTexture = loader.load('/game/fx/glow.png'); this.textures.add(flashTexture);
        this.flash = new THREE.Sprite(new THREE.SpriteMaterial({map: flashTexture, color: 0xffd598, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending}));
        this.flash.position.y = .6; this.burst.add(this.flash, this.blastLight);
        this.uiMaterial = new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
        const ui = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.uiMaterial);
        ui.position.z = -1;
        this.uiScene.add(ui);
        this.camera.position.set(4, 27, 18);
        this.camera.lookAt(0, 0, 0);
        this.ready = this.loadModels();
    }
    private buildBoardDetails() {
        this.buildingTracks = true;
        const loader = new THREE.TextureLoader(), hazardTexture = this.hazardTexture;
        for (let i = 0; i <= this.gridSize; i++) {
            const t = loader.load(`/game/ui/depot-${i + 1}.png`);
            t.colorSpace = THREE.SRGBColorSpace;
            this.textures.add(t);
            const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, fog: false }));
            label.position.copy(this.position(`${this.gridSize}-${i}`));
            label.position.z += .96;
            label.position.y = .6;
            label.scale.set(.72, .72, .72);
            this.trackRoot.add(label);
            const station = this.position(`${this.gridSize}-${i}`); station.z += .45;
            for (const side of [-1, 1]) {
                this.mesh(new THREE.BoxGeometry(.045, .035, 1.8), this.platformRims, [station.x + side * 1.10, .185, station.z]);
                this.mesh(new THREE.BoxGeometry(2.25, .035, .045), this.platformRims, [station.x, .185, station.z + side * .88]);
            }
            const poolMat = new THREE.MeshBasicMaterial({map: hazardTexture, color: 0xbed7e6, transparent: true, opacity: .05, depthWrite: false, blending: THREE.AdditiveBlending});
            this.platformPools.push(poolMat);
            const pool = this.mesh(new THREE.PlaneGeometry(3.4, 2.8), poolMat, [station.x, .17, station.z]); pool.rotation.x = -Math.PI / 2;
        }
        for (const edge of this.geometry.edges) {
            const a = this.position(edge.a), b = this.position(edge.b), mid = a.clone().add(b).multiplyScalar(.5);
            const hazard = new THREE.Group();
            hazard.position.copy(mid);
            hazard.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
            hazard.scale.z = a.distanceTo(b) / 3.3;
            const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.4), new THREE.MeshBasicMaterial({map: hazardTexture, color: 0xff3118, transparent: true, opacity: .8, depthWrite: false, blending: THREE.AdditiveBlending}));
            halo.rotation.x = -Math.PI / 2; halo.position.y = .32;
            hazard.add(halo);
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(28 * 3), 3));
            const sparks = new THREE.Points(geo, new THREE.PointsMaterial({map: hazardTexture, color: 0xff4c29, size: .28, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending}));
            hazard.add(sparks); this.dangerSparks.set(edge.id, sparks);
            const flame = new THREE.Sprite(new THREE.SpriteMaterial({map: hazardTexture, color: 0xff4123, transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending}));
            flame.position.y = .95; flame.scale.set(.75, 1.8, 1); hazard.add(flame);
            if (this.brokenModel) hazard.add(this.brokenModel.clone(true));
            const mark = this.mesh(new THREE.OctahedronGeometry(.22), new THREE.MeshBasicMaterial({color: 0xd2d7dd}), [mid.x, .62, mid.z], this.trackRoot);
            mark.visible = false; this.concealMarks.set(edge.id, mark);
            hazard.visible = false;
            this.trackRoot.add(hazard); this.mines.set(edge.id, hazard);
            const strip = this.mesh(new THREE.BoxGeometry(.11, .04, a.distanceTo(b)), new THREE.MeshBasicMaterial({ color: 0xb4cedd, transparent: true, opacity: .8 }), [mid.x, .29, mid.z]);
            strip.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
            strip.visible = false;
            this.hintLines.set(edge.id, strip);
        }
        this.buildingTracks = false;
    }
    private refreshTables() {
        for (const table of this.tables) table.removeFromParent();
        this.tables = [];
        for (let i = 0; i < (this.view?.playerCount ?? 6); i++) {
            const table = new THREE.Group(); table.add(this.scenery.clone(true), this.trackRoot.clone(true));
            const lights: THREE.Object3D[] = [];
            table.traverse(o => { if (o instanceof THREE.Light) lights.push(o); if (o instanceof THREE.Mesh) o.castShadow = false; });
            lights.forEach(o => o.removeFromParent());
            table.position.copy(this.tablePosition(i)); table.visible = false;
            this.tables.push(table); this.scene.add(table);
        }
    }
    private rebuildBoard(gridSize: number) {
        this.trackRoot.traverse(o => {
            if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite) {
                if ('geometry' in o) this.geometries.add(o.geometry);
                for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.materials.add(m);
            }
        });
        this.trackRoot.clear(); this.rings.clear(); this.mines.clear(); this.hintLines.clear(); this.concealMarks.clear(); this.dangerSparks.clear();
        this.platformPools = []; this.projected.clear(); this.gridSize = gridSize;
        this.activeLevel?.removeFromParent(); this.activeLevel = this.levels.get(gridSize) ?? null;
        if (this.activeLevel) this.scenery.add(this.activeLevel);
        this.buildTracks(); this.buildBoardDetails(); this.refreshTables(); this.memoKey = '';
    }
    private updateMemos(view: RoomView | null) {
        const owner = view?.players[view.boardOwnerSeat];
        const notes = view?.phase === 'playing' && view.players[view.activeSeat]?.id === view.selfId && view.shiftSeat === undefined && view.blessingSeat === undefined ? view.selfMemos?.filter(note => note?.boardOwnerId === owner?.id) ?? [] : [];
        const key = `${this.gridSize}:${JSON.stringify(notes)}`;
        if (key === this.memoKey) return;
        this.memoKey = key;
        this.memoRoot.traverse(o => { if (o instanceof THREE.Line) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
        this.memoRoot.clear();
        for (const note of notes) {
            const edge = note && this.geometry.edgeLookup.get(note.edgeId); if (!edge || !note) continue;
            const a = this.position(edge.a), b = this.position(edge.b); a.y = b.y = .37;
            const g = new THREE.BufferGeometry().setFromPoints([a, b]);
            const m = new THREE.LineDashedMaterial({color: note.status === 'mine' ? 0xc28174 : note.status === 'safe' ? 0xffffff : 0x858b90, dashSize: .20, gapSize: .12, transparent: true, opacity: .85, depthWrite: false});
            const line = new THREE.Line(g, m); line.computeLineDistances(); this.memoRoot.add(line);
        }
    }
    private mat(color: number) { const m = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true }); this.materials.add(m); return m; }
    private mesh(g: THREE.BufferGeometry, m: THREE.Material, pos: number[], parent: THREE.Object3D = this.buildingTracks ? this.trackRoot : this.scenery) { this.geometries.add(g); this.materials.add(m); const o = new THREE.Mesh(g, m); o.position.set(pos[0], pos[1], pos[2]); parent.add(o); return o; }
    private buildTracks() {
        this.buildingTracks = true;
        const rails = this.mat(0xaab2b7), timber = this.mat(0x39352e), dark = this.mat(0x090c0f), plate = this.mat(0x323b41);
        rails.emissive.setHex(0x72828b); rails.emissiveIntensity = .12;
        const matrices: THREE.Matrix4[] = [], ties: THREE.Matrix4[] = [];
        const temp = new THREE.Object3D();
        for (const e of this.geometry.edges) {
            const a = this.position(e.a), b = this.position(e.b), length = a.distanceTo(b), theta = Math.atan2(b.x - a.x, b.z - a.z), normal = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
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
            this.trackRoot.add(instance);
            if (list === matrices) { this.rails = instance; this.railMatrices = matrices; }
        }
        for (const n of this.geometry.nodes) {
            const p = this.position(n.id);
            this.mesh(new THREE.CylinderGeometry(.47, .50, .18, 20), dark, [p.x, .15, p.z]);
            this.mesh(new THREE.CylinderGeometry(.405, .405, .04, 20), plate, [p.x, .265, p.z]);
            const rim = this.mesh(new THREE.TorusGeometry(.43, .025, 4, 24), rails, [p.x, .28, p.z]);
            rim.rotation.x = Math.PI / 2;
            const ring = this.mesh(new THREE.RingGeometry(.56, .60, 32), new THREE.MeshBasicMaterial({ color: 0xeee3cf, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false }), [p.x, .30, p.z]);
            ring.rotation.x = -Math.PI / 2;
            this.trackRoot.attach(ring);
            ring.visible = false;
            this.rings.set(n.id, ring);
        }
        this.buildingTracks = false;
    }
    private buildRocks() {
        // The actual terrain and voids are modeled in Blender; only the lift light is runtime.
        this.mesh(new THREE.PlaneGeometry(1.75, 2.9), new THREE.MeshBasicMaterial({ color: 0x9c967f, fog: false }), [0, 1.5, -9.37]);
        const light = new THREE.PointLight(0xc8c0a5, 13, 9, 2);
        light.position.set(0, 2, -8.3); this.scenery.add(light);
    }
    private async loadModels() {
        const loader = new GLTFLoader();
        const [cart, arch, lantern, crate, level, broken, title] = await Promise.all(['miner-cart', 'timber-arch', 'lantern', 'supply-crate', 'mine-level', 'broken-track', 'main-menu-diorama'].map(n => loader.loadAsync(`/game/models/${n}.glb`)));
        if (this.disposed)
            return;
        this.levels.set(4, level.scene);
        const variants = await Promise.all([3,5,6].map(async n => [n, (await loader.loadAsync(`/game/models/mine-level-${n}.glb`)).scene] as const));
        if (this.disposed) return;
        for (const [n, model] of variants) this.levels.set(n, model);
        this.activeLevel = this.levels.get(this.gridSize)!; this.scenery.add(this.activeLevel);
        this.brokenModel = broken.scene;
        for (const side of [-1, 1]) {
            const fill = new THREE.SpotLight(0x9db0bf, 135, 16, .64, .8, 2);
            fill.position.set(side * 11.8, 7.5, side * 2);
            fill.target.position.set(side * 11.3, 0, side * 1.5);
            this.scenery.add(fill, fill.target);
        }
        this.stageBeam = this.mesh(new THREE.ConeGeometry(8.2, 16, 32, 1, true), new THREE.MeshBasicMaterial({color: 0x9aaebc, transparent: true, opacity: .017, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending}), [0, 8, -.8], this.board);
        this.stageBeam.renderOrder = 2;
        for (const group of this.mines.values()) group.add(broken.scene.clone(true));
        this.cartModel = cart.scene;
        this.cartModel.scale.setScalar(.72);
        this.cart.add(cart.scene);
        this.menu.add(title.scene);
        const flashTexture = new THREE.TextureLoader().load('/game/fx/glow.png'); this.textures.add(flashTexture);
        for (let i = 0; i < 6; i++) {
            const pawn = cart.scene.clone(true); pawn.scale.setScalar(.42); this.menu.add(pawn); this.menuCarts.push(pawn);
            const lamp = new THREE.PointLight(0xc3dbe8, 3.5, 3, 2); lamp.position.y = 1.4; pawn.add(lamp);
            const flash = new THREE.Sprite(new THREE.SpriteMaterial({map: flashTexture, color: 0xe7b0a4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending}));
            this.menu.add(flash); this.menuFlashes.push(flash);
        }
        for (const side of [-1, 1]) {
            const lamp = new THREE.PointLight(0xb9cfdd, 15, 8, 2); lamp.position.set(side * 6, 4, 1); this.menu.add(lamp);
        }
        cart.scene.traverse(o => { if (o.name.startsWith('Wheel'))
            this.wheels.push(o); if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const m = o.material as THREE.MeshStandardMaterial;
            m.roughness = 1;
            m.metalness = 0;
            m.flatShading = true;
        } });
        for (const [x, z, rot] of [[0, -9.15, 0], [-10, -4, Math.PI / 2], [10, -3, Math.PI / 2], [-10, 5, Math.PI / 2], [10, 6, Math.PI / 2]]) {
            const a = arch.scene.clone(true);
            a.position.set(x, 0, z);
            a.rotation.y = rot;
            if (x !== 0)
                a.scale.setScalar(1.15);
            this.scenery.add(a);
        }
        const glowTexture = new THREE.TextureLoader().load('/game/fx/glow.png');
        this.textures.add(glowTexture);
        for (const [i, [x, z]] of [[-9, -7], [9, -6], [-9, 1], [9, 2], [-7, 9], [7, 9]].entries()) {
            const l = lantern.scene.clone(true);
            l.position.set(x, 1.5, z);
            l.scale.setScalar(1.3);
            l.traverse(o => { if (o instanceof THREE.Mesh && (o.material as THREE.Material).name.startsWith('Lamp'))
                (o.material as THREE.MeshStandardMaterial).fog = false; });
            this.scenery.add(l);
            const light = new THREE.PointLight(0xb5c1c9, 7, 5.5, 2);
            light.position.set(x, 2, z);
            this.scenery.add(light);
            this.lanterns.push(light);
            const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xb8c9d2, transparent: true, opacity: .13, depthWrite: false, blending: THREE.AdditiveBlending }));
            halo.position.set(x, 2.1, z);
            halo.scale.set(2.2, 2.2, 2.2);
            this.scenery.add(halo);
            const glow = new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), new THREE.MeshBasicMaterial({ map: glowTexture, color: 0x788e9c, transparent: true, opacity: .10, depthWrite: false }));
            glow.rotation.x = -Math.PI / 2;
            glow.position.set(x, .01, z);
            this.scenery.add(glow);
            if (i % 2 === 0) {
                const box = crate.scene.clone(true);
                box.position.set(x * .98, 0, z + .8);
                box.rotation.y = .3;
                this.scenery.add(box);
            }
        }
        this.scene.traverse(o => { if (o instanceof THREE.Mesh) {
            o.receiveShadow = true;
        } });
        this.refreshTables();
    }
    private tablePosition(seat: number) { const angle = Math.max(0, seat) * Math.PI * 2 / (this.view?.playerCount ?? 6); return new THREE.Vector3(Math.sin(angle) * 43, 0, Math.cos(angle) * 43 - 43); }
    get cinematic() {
        const age = performance.now() - this.flightAt;
        const progress = THREE.MathUtils.clamp(age / this.flightMs, 0, 1);
        return age < this.flightMs + (this.reduce ? 0 : 350) ? { progress, kind: this.flightKind, seat: this.flightSeat } : null;
    }
    get inputLocked() { return !!this.cinematic; }
    resize(w: number, h: number) {
        this.width = w; this.height = h;
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, w < 700 ? 1.7 : 2));
        this.renderer.setSize(w, h, false); this.projectionReset = true;
    }
    setState(view: RoomView | null, draft: string[], hintMode: boolean, selected: string | null, concealed: string[] = []) {
        if (!view) { this.lastEvent = ''; this.lastRound = ''; }
        if (view?.event?.type !== 'explosion') { this.burstAt = Number.NEGATIVE_INFINITY; this.explosion.stop(); }
        const previous = this.view;
        if ((view?.phase === 'roundEnd' || view?.phase === 'finished') && previous?.phase !== view.phase) this.resultAt = performance.now();
        this.view = view;
        this.concealed = concealed;
        if (view && view.gridSize !== this.gridSize) this.rebuildBoard(view.gridSize);
        if (this.tables.length !== (view?.playerCount ?? 6)) this.refreshTables();
        this.draft = draft;
        this.hintMode = hintMode;
        this.selected = selected;
        if (view)
            this.serverOffset = view.serverNow - Date.now();
        this.geometry.edges.forEach((edge, index) => {
            const shown = (view?.phase === 'placing' && canRebuildBoard(view, view.players.find(p => p.id === view.selfId)?.seat ?? -1) || view?.shiftSeat !== undefined && view.players[view.shiftSeat]?.id === view.selfId) && draft.includes(edge.id) || view?.event?.type === 'explosion' && view.event.edgeId === edge.id;
            this.mines.get(edge.id)!.visible = shown;
            if (this.rails) for (let side = 0; side < 2; side++) this.rails.setMatrixAt(index * 2 + side, shown ? new THREE.Matrix4().makeScale(0, 0, 0) : this.railMatrices[index * 2 + side]);
        });
        if (this.rails) this.rails.instanceMatrix.needsUpdate = true;
        for (const [id, mark] of this.concealMarks) mark.visible = view?.phase === 'placing' && concealed.includes(id);
        this.updateMemos(view);
        for (const [id, m] of this.hintLines)
            m.visible = selected === id;
        if (view?.event && view.event.id !== this.lastEvent) {
            this.lastEvent = view.event.id;
            if (view.event.type === 'explosion' && view.event.edgeId)
                this.explode(view.event.edgeId);
        }
        const seat = view?.shiftSeat !== undefined ? view.shiftSeat : view?.phase === 'placing' ? view.players.find(p => p.id === view.selfId)?.seat ?? 0 : view?.boardOwnerSeat !== undefined && view.boardOwnerSeat >= 0 ? view.boardOwnerSeat : view?.activeSeat ?? 0;
        const nextCenter = view?.phase === 'playing' && view.boardMode === 'choice' && view.boardOwnerSeat < 0 && view.shiftSeat === undefined ? this.center.clone() : this.tablePosition(seat);
        const changed = previous && view && (previous.boardOwnerSeat !== view.boardOwnerSeat || previous.activeSeat !== view.activeSeat || previous.rotation !== view.rotation || previous.phase === 'placing' && view.phase === 'playing');
        if (changed && view.phase === 'playing' && (view.boardOwnerSeat >= 0 || view.shiftSeat !== undefined)) {
            this.flightFrom.copy(this.center);
            this.flightTo.copy(nextCenter);
            this.flightAt = performance.now();
            this.flightKind = view.boardMode !== 'choice' && (previous.rotation !== view.rotation || previous.phase === 'placing') ? 'shuffle' : 'turn';
            this.flightMs = this.reduce ? 650 : this.flightKind === 'shuffle' ? 2800 : 2100;
            this.flightSeat = seat;
        }
        this.center.copy(nextCenter); this.board.position.copy(this.center);
        if (!previous && view) {
            this.look.copy(this.center).add(new THREE.Vector3(0, 0, -.8));
            this.camera.position.copy(this.look).add(new THREE.Vector3(0, 27, 19));
            this.camera.lookAt(this.look); this.projectionReset = true;
        }
        const lightColors = [0xb5c1c9, 0xaabfbf, 0xc1beb6, 0xa8bacb, 0xb7b6c1, 0xc2c1b5];
        for (const lamp of this.lanterns) lamp.color.setHex(lightColors[seat]);
        this.keyLight.position.copy(this.center).add(new THREE.Vector3(-8, 20, 10));
        this.keyLight.target.position.copy(this.center);
        this.stageLight.position.copy(this.center).add(new THREE.Vector3(0, 17, -.8));
        this.stageLight.target.position.copy(this.center).add(new THREE.Vector3(0, 0, -.8));
        if (!view) { this.flightAt = Number.NEGATIVE_INFINITY; this.look.set(0, 0, 0); }
        this.lastRound = view ? `${view.code}-${view.round}` : '';
    }
    private explode(edgeId: string) {
        const e = this.geometry.edges.find(e => e.id === edgeId);
        if (!e)
            return;
        const p = this.position(e.a).add(this.position(e.b)).multiplyScalar(.5);
        this.burst.position.copy(p);
        this.burstAge = 0;
        this.burstAt = performance.now();
        this.shake = this.reduce ? 0 : .45;
        this.explosion.start(this.burstAt);
    }
    resetCamera() { this.flightAt = Number.NEGATIVE_INFINITY; }
    hoverAt(id: string | null) { this.hover = id; }
    available() {
        if (this.inputLocked || !this.view || this.view.phase !== 'playing' || this.view.players[this.view.activeSeat]?.id !== this.view.selfId || this.view.event || this.hintMode || this.view.boardOwnerSeat < 0 || this.view.blessingSeat !== undefined || this.view.shiftSeat !== undefined)
            return [];
        return this.view.position ? this.geometry.edges.filter(e => e.a === this.view!.position || e.b === this.view!.position).map(e => e.a === this.view!.position ? e.b : e.a) : this.geometry.starts;
    }
    keyboardTargets() {
        if (this.inputLocked || !this.view || this.view.event) return [];
        if (this.view.phase === 'placing' && canRebuildBoard(this.view, this.view.players.find(p => p.id === this.view!.selfId)?.seat ?? -1) && !this.view.players.find(p => p.id === this.view!.selfId)?.ready
            || this.view.shiftSeat !== undefined && this.view.players[this.view.shiftSeat]?.id === this.view.selfId
            || this.view.phase === 'playing' && this.hintMode && this.view.players[this.view.activeSeat]?.id === this.view.selfId)
            return this.geometry.edges.filter(edge => !edge.base).map(edge => edge.id);
        return this.available();
    }
    project(id: string) { return this.projected.get(id); }
    routes() {
        const from = this.view?.position ? this.projected.get(this.view.position) : null;
        return this.available().flatMap(id => {
            const p = this.projected.get(id); if (!p) return [];
            const dx = from ? p.x - from.x : 0, dy = from ? p.y - from.y : -1;
            return [{ id, x: p.x, y: p.y - 20, angle: Math.atan2(dy, dx) + Math.PI / 2, hot: this.hover === id }];
        });
    }
    pick(x: number, y: number, edges = false): string | null {
        if (this.inputLocked) return null;
        const tolerance = innerWidth < 700 ? 37 : 31;
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
        for (const e of this.geometry.edges.filter(e => !e.base)) {
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
    frame(time: number, render = true) {
        const elapsed = this.lastTime ? time - this.lastTime : 16;
        this.frameBudget = this.frameBudget * .97 + Math.min(elapsed, 100) * .03;
        const dt = Math.min(elapsed / 1000, .05) || .016;
        const cameraDt = Math.min(elapsed / 1000, .25) || .016;
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
        const pawn = view?.position ? this.position(view.position) : new THREE.Vector3();
        const target = this.center.clone().add(new THREE.Vector3(0, 0, home ? -1.5 : -.8));
        if (active && view?.position) target.addScaledVector(pawn, .04);
        if (result) { target.copy(this.center).add(this.position('0-0')); target.x += this.width < 1000 ? 0 : 8; target.z += this.width < 1000 ? 3 : 1.5; }
        const flight = this.cinematic;
        const placementFocus = !flight && (view?.phase === 'placing' && canRebuildBoard(view, view.players.find(p => p.id === view.selfId)?.seat ?? -1) || view?.shiftSeat !== undefined && view.players[view.shiftSeat]?.id === view.selfId);
        if (placementFocus && !this.placementStage) this.cueAt = time;
        this.placementStage = placementFocus;
        const cue = this.reduce ? 1 : ease(THREE.MathUtils.clamp((time - this.cueAt) / 850, 0, 1));
        const sweep = placementFocus ? 1 - cue : 0;
        const stageZ = result ? -7.2 : home ? -1 : -.8;
        this.stageLight.angle = result ? .34 : .60;
        this.stageLight.position.copy(this.center).add(new THREE.Vector3(-8 * sweep, home || result ? 13 : 17, stageZ + 4 * sweep));
        this.stageLight.target.position.copy(this.center).add(new THREE.Vector3(0, 0, stageZ));
        const overshoot = this.reduce ? 0 : Math.sin(cue * Math.PI) * 1700;
        const resultAge = (time - this.resultAt) / 1000;
        const stageIntensity = result ? 2600 + (this.reduce ? 0 : Math.max(0, 1 - resultAge) * 1500) : home ? 1500 : placementFocus ? 3200 + overshoot : 650;
        this.stageLight.visible = true;
        this.keyLight.intensity = active ? 1.15 : .62;
        this.stageLight.intensity = THREE.MathUtils.damp(this.stageLight.intensity, stageIntensity, 7, dt);
        this.platformRims.emissiveIntensity = placementFocus ? .65 + (1 - cue) * .35 : active && !view?.position ? .30 : .12;
        for (const pool of this.platformPools) pool.opacity = placementFocus ? .23 + (1 - cue) * .15 : .07;
        if (this.stageBeam) {
            this.stageBeam.visible = !home;
            const top = this.stageLight.position.clone().sub(this.center), bottom = new THREE.Vector3(0, 0, stageZ);
            this.stageBeam.position.copy(top).add(bottom).multiplyScalar(.5);
            this.stageBeam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bottom).normalize());
            this.stageBeam.scale.set(result ? .4 : 1, top.distanceTo(bottom) / 16, result ? .4 : 1);
            (this.stageBeam.material as THREE.MeshBasicMaterial).opacity = result ? .04 : placementFocus ? .026 + (1 - cue) * .02 : .005;
        }

        let pullback = 1, yaw = home ? -.18 : 0;
        if (flight) {
            const p = ease(flight.progress), arc = Math.sin(p * Math.PI);
            const from = Math.atan2(this.flightFrom.x, this.flightFrom.z + 43), to = Math.atan2(this.flightTo.x, this.flightTo.z + 43);
            const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
            const angle = from + delta * p;
            target.set(Math.sin(angle) * 43, 0, Math.cos(angle) * 43 - 43);
            pullback += this.reduce ? 0 : arc * .76;
            yaw += this.reduce ? 0 : arc * .45 * Math.sign(delta || 1);
        }
        // The blast is a directed shot: push in, hold the impact, then pull back.
        const blastAge = (time - this.burstAt) / 1000;
        let blast = 0;
        if (view?.event?.type === 'explosion' && blastAge < 1.8) {
            blast = this.reduce ? .12 : blastAge < .27 ? ease(Math.max(0, blastAge / .27)) : blastAge < 1.03 ? 1 : Math.max(0, 1 - ease((blastAge - 1.03) / .77));
            const impact = this.burst.position.clone().add(this.center); impact.y = this.reduce ? 0 : 1.1;
            target.lerp(impact, blast * .92);
            pullback *= 1 - blast * .47;
            yaw -= blast * .12;
        }
        this.look.lerp(target, this.reduce ? 1 : 1 - Math.exp(-cameraDt * (blast > 0 ? 15 : flight ? 9 : 3.5)));
        const desired = new THREE.Vector3(this.look.x + Math.sin(yaw) * 19, (home ? 26 : result ? 21 : 27) - blast * 6, this.look.z + Math.cos(yaw) * 19);
        this.camera.position.lerp(desired, this.reduce ? 1 : 1 - Math.exp(-cameraDt * (blast > 0 ? 13 : 6)));
        this.shake *= Math.exp(-Math.min(elapsed, 1000) / 1000 * 7);
        this.camera.position.x += Math.sin(t * 82) * this.shake;
        this.camera.position.z += Math.cos(t * 69) * this.shake;
        this.camera.lookAt(this.look);
        const aspect = this.width / this.height, worldWidth = (mobile ? home ? 26 : 20.5 : home ? 34 : 32.5) * (result ? 1.05 : 1) * pullback;
        const horizontal = Math.max(worldWidth, (blast > 0 ? 8 : this.height < 560 ? 21 : 15) * aspect * pullback), vertical = horizontal / aspect;
        this.camera.left = this.projectionReset ? -horizontal / 2 : THREE.MathUtils.lerp(this.camera.left, -horizontal / 2, 1 - Math.exp(-cameraDt * (blast > 0 ? 14 : 6)));
        this.camera.right = -this.camera.left;
        this.camera.top = this.projectionReset ? vertical / 2 : THREE.MathUtils.lerp(this.camera.top, vertical / 2, 1 - Math.exp(-cameraDt * (blast > 0 ? 14 : 6)));
        this.projectionReset = false;
        this.camera.bottom = -this.camera.top;
        this.camera.updateProjectionMatrix();
        const allowed = this.available();
        for (const [id, line] of this.hintLines) line.visible = this.selected === id || (view?.phase === 'placing' || this.hintMode) && id === this.hover;
        for (const [id, r] of this.rings) {
            r.visible = allowed.includes(id);
            r.scale.setScalar(1 + (id === this.hover ? .22 : this.reduce ? 0 : Math.sin(t * 5) * .09));
            (r.material as THREE.MeshBasicMaterial).color.setHex(id === this.hover ? 0xded8bc : 0xc9e0ed);
        }
        this.board.visible = !home && (view?.phase === 'playing' ? view.boardOwnerSeat >= 0 || view.shiftSeat !== undefined && view.players[view.shiftSeat]?.id === view.selfId : view?.phase === 'placing' ? canRebuildBoard(view, view.players.find(p => p.id === view.selfId)?.seat ?? -1) : view?.phase !== 'waiting'); this.menu.visible = home; this.resultStage.visible = result;
        if (home) this.animateMenu(t);
        if (view?.phase === 'playing') {
            const event = view.event;
            if (event?.type === 'move' && event.from && event.to) {
                const start = this.position(event.from), end = this.position(event.to);
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
            this.cart.position.y = .21 + (!this.reduce && this.cart.visible ? Math.sin(t * 3) * .015 : 0);
            if (event?.type === 'explosion') {
                this.cart.position.copy(this.burst.position);
                this.cart.position.y = .3 + (this.reduce ? 0 : Math.sin(Math.min(blastAge, .9) / .9 * Math.PI) * 1.5);
                this.cart.visible = blastAge < .9;
                this.cart.rotation.z = this.reduce ? 0 : blastAge * 2;
            } else this.cart.rotation.z = 0;
        }
        else {
            this.cart.visible = result;
            this.cart.position.copy(this.position(result ? '0-0' : `${this.gridSize}-${Math.floor(this.gridSize/2)}`));
            this.cart.position.y = .28;
            this.cart.rotation.y = result ? .24 + (this.reduce ? 0 : Math.sin(t * .7) * .05) : .35;
            this.cart.rotation.z = 0;
        }
        this.cart.scale.setScalar(result ? 2.8 : view?.event?.type === 'explosion' ? Math.max(0, 1 - blastAge / .9) : home ? mobile ? 3.3 : 2.45 : 1);
        this.cartHalo.position.set(this.cart.position.x, .178, this.cart.position.z);
        this.cartHalo.visible = this.cart.visible && view?.event?.type !== 'explosion';
        this.cartHalo.scale.setScalar(home ? 1.4 : 1);
        this.cartLamp.intensity = home ? 25 : 33;
        for (let i = 0; i < this.lanterns.length; i++)
            this.lanterns[i].intensity = 7 + (this.reduce ? 0 : Math.sin(t * 2.1 + i * 2) * .35);
        for (const [id, sparks] of this.dangerSparks) if (this.mines.get(id)?.visible) {
            const p = sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
            for (let i = 0; i < p.count; i++) {
                const age = this.reduce ? .3 : (t * .75 + i * .133) % 1;
                p.setXYZ(i, Math.sin(i * 7.1 + t * .8) * age * .42, .35 + age * 1.7, Math.cos(i * 4.3) * age * .55);
            }
            p.needsUpdate = true;
            const flame = this.mines.get(id)!.children[2];
            flame.scale.y = this.reduce ? 1.8 : 1.75 + Math.sin(t * 10) * .2;
            this.mines.get(id)!.children[0].scale.setScalar(this.reduce ? 1 : 1 + Math.sin(t * 8) * .14);
        }
        for (let i = 0; i < this.tables.length; i++) this.tables[i].visible = !home && this.tablePosition(i).distanceTo(this.center) > 1 && (flight !== null || this.tablePosition(i).distanceTo(this.look) < 70);
        this.dust.update(time, this.look, this.camera, this.height, this.renderer.getPixelRatio(), this.stageLight, this.cartLamp, this.board.visible && this.cart.visible);
        // Public effects expire by real time, even when a mobile GPU drops frames.
        this.burstAge = (time - this.burstAt) / 1000;
        this.explosion.update(time);
        this.flash.scale.setScalar(1.6 + Math.min(this.burstAge, .22) * 9);
        (this.flash.material as THREE.SpriteMaterial).opacity = (this.reduce ? .25 : 1) * Math.max(0, 1 - this.burstAge / .22);
        this.blastLight.intensity = Math.max(0, 160 * (1 - this.burstAge / .32)) + Math.max(0, 1 - this.burstAge / .85) * 18;
        this.shock.scale.setScalar(1 + Math.min(this.burstAge, 1.8) * 4);
        (this.shock.material as THREE.MeshBasicMaterial).opacity = Math.max(0, .48 - this.burstAge * .9);
        this.camera.updateMatrixWorld();
        for (const n of this.geometry.nodes) {
            const p = this.position(n.id);
            p.y = .34;
            p.add(this.center).project(this.camera);
            this.projected.set(n.id, { x: (p.x * .5 + .5) * this.width, y: (-p.y * .5 + .5) * this.height });
        }
        if (render) this.render();
    }
    render() {
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        this.renderer.clearDepth();
        this.renderer.render(this.uiScene, this.uiCamera);
    }
    private animateMenu(t: number) {
        const paths = [
            ['4-0','3-0','2-0','1-0','0-0'], ['4-4','3-3','2-2','1-1','0-0'],
            ['4-1','3-1','2-1','1-0','0-0'], ['4-3','3-2','2-1','1-1','0-0'],
            ['4-2','3-1','2-0','1-0','0-0'], ['4-2','3-2','2-2','1-1','0-0']
        ];
        for (let i = 0; i < this.menuCarts.length; i++) {
            const pawn = this.menuCarts[i], age = (t + i * 2.9) % 18;
            const travel = this.reduce ? i % 4 : THREE.MathUtils.clamp((age - 2) / 2, 0, 3.999);
            const step = Math.floor(travel), a = new THREE.Vector3(...[boardPosition(paths[i][step], 4)[0], 0, boardPosition(paths[i][step], 4)[1]]), b = new THREE.Vector3(...[boardPosition(paths[i][step + 1], 4)[0], 0, boardPosition(paths[i][step + 1], 4)[1]]);
            pawn.position.copy(a).lerp(b, ease(travel - step)).multiplyScalar(.58); pawn.position.y = 1.522;
            pawn.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
            pawn.visible = this.reduce || age < 12;
            const flash = this.menuFlashes[i], impact = !this.reduce && i % 2 === 0 && age > 7.1 && age < 7.7;
            flash.visible = impact; flash.position.copy(pawn.position); flash.position.y += .3;
            if (impact) { const p = (age - 7.1) / .6; flash.scale.setScalar(.4 + p * 2); (flash.material as THREE.SpriteMaterial).opacity = 1 - p; }
        }
    }
    dispose() {
        this.disposed = true;
        this.explosion.dispose(); this.explosion.root.removeFromParent();
        const release = (o: THREE.Object3D) => { if (o instanceof THREE.Sprite)
            this.materials.add(o.material);
        else if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
            this.geometries.add(o.geometry);
            for (const m of Array.isArray(o.material) ? o.material : [o.material])
                this.materials.add(m);
        } };
        this.scene.traverse(release);
        for (const level of this.levels.values()) level.traverse(release);
        this.uiScene.traverse(release);
        for (const g of this.geometries)
            g.dispose();
        for (const m of this.materials)
            m.dispose();
        for (const m of this.materials) if (m instanceof THREE.MeshStandardMaterial) for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.emissiveMap]) if (t) this.textures.add(t);
        for (const t of this.textures)
            t.dispose();
        this.uiMaterial.dispose();
        this.renderer.dispose();
    }
}
