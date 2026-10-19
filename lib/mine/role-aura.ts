import type { RoleId } from '../contracts';

/** Six distinct moving ribbon fields. The icon itself is never duplicated. */
export function drawRoleAura(g:CanvasRenderingContext2D,role:RoleId,color:string,x:number,y:number,size:number,time:number,reduced:boolean){
    const t=reduced?0:time/1000,r=size*.44;
    g.save();g.translate(x,y);g.strokeStyle=color;g.lineCap='round';g.lineJoin='round';
    const paths:Path2D[]=[];
    for(let band=0;band<4;band++){
        const p=new Path2D(),b=band*.15;
        for(let i=0;i<=96;i++){
            const u=i/96,a=u*Math.PI*2;
            let px=0,py=0;
            if(role==='illuminator'){
                const radius=r*(.65+b+.09*Math.sin(a*8-t*2+band));
                px=Math.cos(a)*radius;py=Math.sin(a)*radius;
            }else if(role==='guardian'){
                // A shield mantle with a pointed lower edge and breathing shoulders.
                const radius=r*(.64+b)*(1+.025*Math.sin(t*2+a*5));
                px=Math.sin(a)*radius*(.78-.18*Math.cos(a));
                py=-Math.cos(a)*radius*(Math.cos(a)<0?1.2:.78);
            }else if(role==='trapper'){
                px=(u*2-1)*r*1.12;
                py=r*((band-1.5)*.28+Math.sin(u*7+t*(band%2?-.8:.8)+band)*.2);
            }else if(role==='thief'){
                const phase=a+t*.22*(band%2?1:-1),radius=r*(.7+b);
                px=Math.cos(phase)*radius+Math.sin(a*3+t)*r*.07;
                py=Math.sin(phase)*radius*.5+Math.cos(a*2+t+band)*r*.14;
            }else if(role==='shifter'){
                const direction=band%2?1:-1;
                px=(u*2-1)*r;py=r*(Math.sin(u*Math.PI*2+t*direction+band*.4)*.36+(band-1.5)*.19);
            }else{
                const radius=r*(.58+b)/Math.max(Math.abs(Math.cos(a)),Math.abs(Math.sin(a)));
                px=Math.cos(a)*radius;py=Math.sin(a)*radius*.78+Math.sin(a*4+t*1.2+band)*r*.045;
            }
            if(i===0)p.moveTo(px,py);else p.lineTo(px,py);
        }
        if(role!=='trapper'&&role!=='shifter')p.closePath();paths.push(p);
    }
    g.globalCompositeOperation='lighter';
    paths.forEach((p,i)=>{
        g.setLineDash(role==='shifter'?[r*.23,r*.15]:role==='recorder'?[r*.12,r*.05]:[]);
        g.lineDashOffset=reduced?0:t*(i%2?16:-16);
        g.globalAlpha=.07;g.lineWidth=size*.055;g.stroke(p);
        g.shadowColor=color;g.shadowBlur=12;g.globalAlpha=.23+(reduced?0:Math.sin(t*1.6+i)*.08);g.lineWidth=1.5;g.stroke(p);
    });
    g.restore();
}
