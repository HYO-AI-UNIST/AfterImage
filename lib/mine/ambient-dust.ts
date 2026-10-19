import * as THREE from 'three';

/** A single draw call of world-space motes, gently revealed by the mine lights. */
export class AmbientDust {
    readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

    constructor(mobile: boolean, private reducedMotion: boolean) {
        const count = mobile ? 130 : 260;
        const positions = new Float32Array(count * 3), seeds = new Float32Array(count * 3);
        // Stable placement avoids changing the atmosphere when a screen is reopened.
        const random = (i: number) => THREE.MathUtils.euclideanModulo(Math.sin(i * 127.1 + 311.7) * 43758.5453, 1);
        for (let i = 0; i < count; i++) {
            positions.set([(random(i * 6) - .5) * 54, random(i * 6 + 1) * 10, (random(i * 6 + 2) - .5) * 48], i * 3);
            seeds.set([random(i * 6 + 3), random(i * 6 + 4), random(i * 6 + 5)], i * 3);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
        const material = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, fog: true,
            uniforms: {
                ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
                time: { value: 0 }, focus: { value: new THREE.Vector3() },
                pixelsPerUnit: { value: 20 }, pixelRatio: { value: 1 },
                lamp: { value: new THREE.Vector3() }, lampStrength: { value: 0 },
                spot: { value: new THREE.Vector3() }, spotDirection: { value: new THREE.Vector3(0, -1, 0) },
                cone: { value: .82 }, spotStrength: { value: .5 }
            },
            vertexShader: `
                attribute vec3 seed;
                uniform float time, pixelsPerUnit, pixelRatio, lampStrength, cone, spotStrength;
                uniform vec3 focus, lamp, spot, spotDirection;
                varying float vAlpha, vLight;
                #include <fog_pars_vertex>
                void main() {
                    float phase = seed.x * 6.283185;
                    vec3 p = position;
                    p.x += time * (.025 + seed.y * .025) + sin(time * .13 + phase) * .48;
                    p.z += time * (.012 + seed.z * .025) + cos(time * .11 + phase) * .36;
                    p.xz = mod(p.xz - focus.xz + vec2(27., 24.), vec2(54., 48.)) - vec2(27., 24.) + focus.xz;
                    p.y = .45 + mod(p.y - time * (.025 + seed.x * .035), 10.);
                    vec2 edge = abs(p.xz - focus.xz) / vec2(27., 24.);
                    float fade = (1. - smoothstep(.65, 1., max(edge.x, edge.y)))
                        * smoothstep(.45, 1.3, p.y) * (1. - smoothstep(8., 10.45, p.y));
                    vec3 ray = p - spot;
                    float beam = smoothstep(cone, mix(cone, 1., .55), dot(normalize(ray), spotDirection));
                    float nearLamp = exp(-dot(p - lamp, p - lamp) * .13) * lampStrength;
                    vLight = .22 + beam * spotStrength + nearLamp * .55;
                    // Slow changes in visibility, without glittering or flashing.
                    vAlpha = fade * (.18 + seed.z * .22) * (.8 + .2 * sin(time * .32 + phase));
                    vec4 mvPosition = modelViewMatrix * vec4(p, 1.);
                    gl_Position = projectionMatrix * mvPosition;
                    gl_PointSize = clamp((.045 + seed.y * .065) * pixelsPerUnit, 1.1 * pixelRatio, 3.2 * pixelRatio);
                    #include <fog_vertex>
                }`,
            fragmentShader: `
                varying float vAlpha, vLight;
                #include <fog_pars_fragment>
                void main() {
                    float radius = length(gl_PointCoord - .5) * 2.;
                    float soft = 1. - smoothstep(.1, 1., radius);
                    float alpha = soft * vAlpha;
                    if (alpha < .008) discard;
                    gl_FragColor = vec4(vec3(.72, .78, .81) * vLight, alpha);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                    #include <fog_fragment>
                }`
        });
        this.points = new THREE.Points(geometry, material);
        this.points.frustumCulled = false;
    }

    update(time: number, focus: THREE.Vector3, camera: THREE.OrthographicCamera, height: number, pixelRatio: number, spot: THREE.SpotLight, lamp: THREE.PointLight, lampVisible: boolean) {
        const u = this.points.material.uniforms;
        u.time.value = this.reducedMotion ? 0 : time / 1000;
        u.focus.value.copy(focus);
        u.pixelRatio.value = pixelRatio;
        u.pixelsPerUnit.value = height * pixelRatio / (camera.top - camera.bottom);
        u.spot.value.copy(spot.position);
        u.spotDirection.value.subVectors(spot.target.position, spot.position).normalize();
        u.cone.value = Math.cos(spot.angle);
        u.spotStrength.value = Math.min(1.15, spot.intensity / 2600);
        lamp.getWorldPosition(u.lamp.value);
        u.lampStrength.value = lampVisible ? 1 : 0;
    }
}
