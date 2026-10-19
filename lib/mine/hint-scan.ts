import * as THREE from 'three';

export const hintRevealSeconds = (reducedMotion: boolean) => reducedMotion ? .15 : 1.25;

/** The private survey instrument lives on the actual rail, in board coordinates. */
export class HintScan {
    readonly root = new THREE.Group();
    private lens = new THREE.Group();
    private reticle: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    private sweep: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
    private light = new THREE.PointLight(0x9deaff, 0, 4);
    private motes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    private at = 0;
    private active = false;
    private color = new THREE.Color();

    constructor(private reduce: boolean) {
        const metal = new THREE.MeshStandardMaterial({color:0xc5d5dc, metalness:.72, roughness:.3, emissive:0x496374, emissiveIntensity:.5});
        const glow = new THREE.MeshBasicMaterial({color:0xc8f6ff, toneMapped:false});
        const rim = new THREE.Mesh(new THREE.TorusGeometry(.66,.075,8,48),metal);
        const inner = new THREE.Mesh(new THREE.TorusGeometry(.56,.018,4,48),glow);
        const glass = new THREE.Mesh(new THREE.CircleGeometry(.56,48),new THREE.MeshBasicMaterial({color:0x9deaff,transparent:true,opacity:.12,side:THREE.DoubleSide,depthWrite:false}));
        this.lens.add(rim,inner,glass);
        const handle = new THREE.Mesh(new THREE.CapsuleGeometry(.095,.62,4,8),metal);
        handle.position.set(.73,-.73,0);handle.rotation.z=Math.PI/4;
        const grip = new THREE.Mesh(new THREE.CapsuleGeometry(.12,.35,4,8),new THREE.MeshStandardMaterial({color:0x1d2b32,roughness:.7}));
        grip.position.set(.88,-.88,0);grip.rotation.z=Math.PI/4;
        this.lens.add(handle,grip);this.lens.rotation.x=-Math.PI*.38;
        this.root.add(this.lens,this.light);
        this.reticle = new THREE.Mesh(new THREE.RingGeometry(.69,.72,64),new THREE.MeshBasicMaterial({color:0x9deaff,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));
        this.reticle.rotation.x=-Math.PI/2;this.reticle.position.y=.38;
        this.sweep = new THREE.Mesh(new THREE.CircleGeometry(.68,48,0,Math.PI*.45),new THREE.MeshBasicMaterial({color:0x9deaff,transparent:true,opacity:.24,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));
        this.sweep.rotation.x=-Math.PI/2;this.sweep.position.y=.39;
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(40*3),3));
        this.motes=new THREE.Points(geometry,new THREE.PointsMaterial({color:0xc4f4ff,size:.065,transparent:true,opacity:.8,depthWrite:false,blending:THREE.AdditiveBlending}));
        this.root.add(this.reticle,this.sweep,this.motes);this.root.visible=false;
    }

    set(edge: THREE.Vector3 | null, at: number, mined: boolean | null = false) {
        this.active=!!edge;this.root.visible=this.active;
        if(!edge)return;
        this.root.position.copy(edge);this.at=at;
        this.color.set(mined===null?0xc280ff:mined?0xff8467:0x7ee3c6);
    }

    update(time:number) {
        if(!this.active)return;
        const age=Math.max(0,(time-this.at)/1000),reveal=hintRevealSeconds(this.reduce),done=age>=reveal;
        const enter=this.reduce?1:Math.min(1,age/.32),burst=Math.max(0,(age-reveal)/.7);
        const settle=done?Math.min(1,(age-reveal)/.4):0;
        this.lens.scale.setScalar(enter*(1-settle*.22));
        this.lens.position.set(this.reduce?0:Math.sin(age*6)*.28*(1-settle),1.05+(1-enter)*1.1+(this.reduce?0:Math.cos(age*5)*.08),this.reduce?0:Math.cos(age*5)*.18*(1-settle));
        this.lens.rotation.z=this.reduce?0:Math.sin(age*4)*.12*(1-settle);
        this.reticle.material.color.set(done?this.color:0x9deaff);
        this.reticle.scale.setScalar(done?1+Math.sin(Math.min(1,burst)*Math.PI)*.4:1);
        this.reticle.material.opacity=done ? .55 : .5+Math.sin(age*9)*.2;
        this.sweep.visible=!done;this.sweep.rotation.z=this.reduce?0:-age*5;
        this.light.position.set(0,.9,0);this.light.color.set(done?this.color:0x9deaff);
        this.light.intensity=done?5:10;
        const positions=this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
        for(let i=0;i<positions.count;i++){
            const angle=i*2.39996+(this.reduce?0:age*.8),radius=done ? .35+Math.min(burst,1)*1.45 : .4+(i%7)*.055;
            positions.setXYZ(i,Math.cos(angle)*radius,.45+(done?Math.sin(Math.min(burst,1)*Math.PI)*(.4+i%4*.2):(this.reduce?i/50:(age*.7+i*.037)%1)),Math.sin(angle)*radius);
        }
        positions.needsUpdate=true;this.motes.material.color.set(done?this.color:0xc4f4ff);
        this.motes.material.opacity=this.reduce?0:done?Math.max(0,1-burst):.7;
    }
}
