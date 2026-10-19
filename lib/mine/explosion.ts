import * as THREE from 'three';

type LayerKind = 'puff' | 'smoke' | 'ember';
const vertexShader = `
attribute vec3 launch;
attribute float delay;
attribute float lifetime;
attribute vec2 particleSize;
attribute vec3 tint;
attribute float spin;
uniform float age;
uniform float gravity;
uniform float drag;
uniform float strength;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
varying float vLife;
void main() {
    float t = max(0.0, age - delay);
    float life = clamp(t / lifetime, 0.0, 1.0);
    float alive = step(delay, age) * (1.0 - step(lifetime, t));
    float distance = (1.0 - exp(-t * drag)) / drag;
    vec3 center = vec3(launch.x * distance, .28 + launch.y * t - .5 * gravity * t * t, launch.z * distance);
    center *= strength;
    vec4 viewCenter = modelViewMatrix * vec4(center, 1.0);
    float angle = spin * t;
    mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    vec2 scale = particleSize * mix(.55, 1.65, life) * strength;
    viewCenter.xy += rotation * (position.xy * scale);
    gl_Position = projectionMatrix * viewCenter;
    vUv = uv;
    vTint = tint;
    vLife = life;
    vFade = alive * smoothstep(0.0, .075, t) * (1.0 - smoothstep(.38, 1.0, life));
}`;
const fragmentShader = `
uniform sampler2D sprite;
uniform float opacity;
uniform float fire;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
varying float vLife;
void main() {
    vec4 texel = texture2D(sprite, vUv);
    float alpha = texel.a * vFade * opacity;
    if (alpha < .008) discard;
    vec3 cooled = mix(vTint, vec3(.28, .30, .33), vLife * fire * .80);
    gl_FragColor = vec4(texel.rgb * cooled * mix(1.0, 1.55, fire), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

/** One-shot expanding cloud burst. Positions are evaluated from real age, never integrated per frame. */
export class MineExplosion {
    root = new THREE.Group();
    private layers: Array<{ kind: LayerKind; mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> }> = [];
    private textures: THREE.Texture[] = [];
    private startedAt = Number.NEGATIVE_INFINITY;
    private chunks: THREE.InstancedMesh;
    private launches: THREE.Vector3[] = [];
    private spins: THREE.Vector3[] = [];
    private sizes: number[] = [];
    private temp = new THREE.Object3D();

    constructor(private mobile: boolean, private reducedMotion: boolean) {
        const loader = new THREE.TextureLoader();
        for (const kind of ['smoke', 'puff', 'ember'] as const) {
            const texture = loader.load(`/game/fx/${kind === 'ember' ? 'ember-streak' : kind === 'puff' ? 'blast-puff' : kind}.png`);
            texture.colorSpace = THREE.SRGBColorSpace;
            this.textures.push(texture);
            const count = kind === 'puff' ? mobile ? 52 : 90 : kind === 'ember' ? mobile ? 52 : 90 : mobile ? 30 : 54;
            const plane = new THREE.PlaneGeometry(1, 1);
            const geometry = new THREE.InstancedBufferGeometry();
            geometry.index = plane.index!.clone();
            geometry.setAttribute('position', plane.attributes.position.clone());
            geometry.setAttribute('uv', plane.attributes.uv.clone());
            plane.dispose();
            geometry.instanceCount = count;
            for (const [name, itemSize] of [['launch', 3], ['delay', 1], ['lifetime', 1], ['particleSize', 2], ['tint', 3], ['spin', 1]] as const)
                geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(count * itemSize), itemSize));
            const material = new THREE.ShaderMaterial({
                vertexShader, fragmentShader, transparent: true, depthWrite: false,
                blending: kind === 'ember' ? THREE.AdditiveBlending : THREE.NormalBlending,
                uniforms: {
                    sprite: { value: texture }, age: { value: 99 },
                    gravity: { value: kind === 'ember' ? 6.5 : kind === 'smoke' ? -.10 : 3.8 },
                    drag: { value: kind === 'ember' ? .65 : 1.7 },
                    strength: { value: reducedMotion ? .55 : 1 },
                    opacity: { value: kind === 'smoke' ? .60 : 1 }, fire: { value: kind === 'ember' ? 1 : kind === 'puff' ? .55 : 0 }
                }
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.frustumCulled = false;
            mesh.renderOrder = kind === 'smoke' ? 1 : kind === 'puff' ? 2 : 3;
            this.layers.push({ kind, mesh }); this.root.add(mesh);
        }
        this.chunks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({
            color: 0x6b5850, roughness: .95, emissive: 0x6c1c08, emissiveIntensity: .55, transparent: true
        }), mobile ? 18 : 32);
        this.chunks.frustumCulled = false; this.root.add(this.chunks);
        this.root.visible = false;
    }

    start(time: number) {
        this.startedAt = time;
        for (const { kind, mesh } of this.layers) {
            const g = mesh.geometry;
            const a = Object.fromEntries(Object.entries(g.attributes).filter(([, value]) => value instanceof THREE.InstancedBufferAttribute)) as Record<string, THREE.InstancedBufferAttribute>;
            for (let i = 0; i < g.instanceCount; i++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * (kind === 'ember' ? 4.5 : kind === 'smoke' ? 2.1 : 3.5);
                // Pressure puffs expand together; larger, slower smoke lobes rise behind them.
                a.launch.setXYZ(i, Math.cos(angle) * radius, kind === 'puff' ? 3.0 + Math.random() * 3.2 : kind === 'ember' ? 4 + Math.random() * 4 : 1.5 + Math.random() * 2.2, Math.sin(angle) * radius);
                const delay = kind === 'smoke' ? .06 + Math.random() * .27 : Math.random() * (kind === 'puff' ? .12 : .20);
                a.delay.setX(i, delay);
                a.lifetime.setX(i, Math.min(1.75 - delay, kind === 'puff' ? .38 + Math.random() * .42 : kind === 'smoke' ? 1.05 + Math.random() * .40 : .6 + Math.random() * .55));
                const size = Math.random();
                a.particleSize.setXY(i, kind === 'puff' ? .9 + size * 1.2 : kind === 'smoke' ? 1.2 + size * 1.8 : .045 + size * .07, kind === 'puff' ? .9 + size * 1.2 : kind === 'smoke' ? 1.1 + size * 1.8 : .10 + size * .18);
                const hot = Math.random();
                a.tint.setXYZ(i, kind === 'smoke' ? .34 + hot * .22 : 1, kind === 'smoke' ? .37 + hot * .19 : .78 + hot * .21, kind === 'smoke' ? .40 + hot * .16 : .48 + hot * .38);
                a.spin.setX(i, kind === 'ember' ? (Math.random() - .5) * 2 : (Math.random() - .5) * 1.1);
            }
            for (const attribute of Object.values(a)) attribute.needsUpdate = true;
        }
        this.launches = []; this.spins = []; this.sizes = [];
        for (let i = 0; i < this.chunks.count; i++) {
            const angle = Math.random() * Math.PI * 2, speed = 2 + Math.random() * 3;
            this.launches.push(new THREE.Vector3(Math.cos(angle) * speed, 3.5 + Math.random() * 4.5, Math.sin(angle) * speed));
            this.spins.push(new THREE.Vector3(Math.random() * 8, Math.random() * 9, Math.random() * 7));
            this.sizes.push(.065 + Math.random() * .10);
        }
        this.update(time);
    }

    stop() { this.startedAt = Number.NEGATIVE_INFINITY; this.root.visible = false; }

    update(time: number) {
        const age = Math.max(0, (time - this.startedAt) / 1000);
        this.root.visible = Number.isFinite(age) && age < 1.8;
        if (!this.root.visible) return;
        for (const { mesh } of this.layers) mesh.material.uniforms.age.value = age;
        const strength = this.reducedMotion ? .55 : 1;
        for (let i = 0; i < this.chunks.count; i++) {
            const v = this.launches[i], spin = this.spins[i], flight = (1 - Math.exp(-age * .6)) / .6;
            const height = Math.max(.05, .3 + v.y * age - 6 * age * age);
            this.temp.position.set(v.x * flight * strength, height * strength, v.z * flight * strength);
            this.temp.rotation.set(spin.x * age, spin.y * age, spin.z * age);
            this.temp.scale.set(this.sizes[i], this.sizes[i] * .5, this.sizes[i] * 1.8).multiplyScalar(Math.max(0, 1 - Math.max(0, age - 1) / .65));
            this.temp.updateMatrix(); this.chunks.setMatrixAt(i, this.temp.matrix);
        }
        this.chunks.instanceMatrix.needsUpdate = true;
        (this.chunks.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - Math.max(0, age - .8) / .85);
    }

    dispose() {
        for (const { mesh } of this.layers) { mesh.geometry.dispose(); mesh.material.dispose(); }
        this.chunks.geometry.dispose(); (this.chunks.material as THREE.Material).dispose();
        this.textures.forEach(t => t.dispose());
    }
}
