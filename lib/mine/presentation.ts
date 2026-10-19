import type { RoleId } from '../contracts';
import type { MineHud, HudModel } from './hud';
import { hintRevealSeconds } from './hint-scan';

export const ROLE_ART: Record<RoleId, {color: string}> = {
    illuminator: {color:'#ffbf52'}, guardian:{color:'#53efc4'},
    trapper:{color:'#c280ff'}, thief:{color:'#ec759c'},
    shifter:{color:'#ff7850'}, recorder:{color:'#7cafff'},
};
export function playAbility(m: HudModel, role: RoleId | 'hint' | 'memo', title: string, actor = '', origin?: {x:number;y:number}) {
    m.rule.fx = {role,title,actor,origin,at:performance.now()};
}
export function drawAbilityEffect(h: MineHud, m: HudModel, time: number) {
    const fx=m.rule.fx;if(!fx)return;
    const age=(time-fx.at)/1000,reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration=fx.role==='memo'?1.25:2.7;
    if(age<0||age>duration)return;
    const role=fx.role,art=role==='hint'?{color:'#93e4ff'}:role==='memo'?ROLE_ART.recorder:ROLE_ART[role];
    const enter=Math.min(1,age/.4),exit=Math.min(1,(duration-age)/.65),alpha=Math.max(0,enter*exit);
    const mobile=h.width<700,small=h.height<500,cy=small?h.height*.38:h.height*.36;
    const rise=reduce?0:Math.sin(enter*Math.PI/2)*18+Math.max(0,age-1.8)*24;
    let x=h.width/2,y=cy-rise;
    if(role==='memo')y=h.height-80-rise*.25;
    if(role==='hint'&&fx.origin&&!reduce){const t=Math.min(1,age/.65),ease=1-(1-t)**3;x=fx.origin.x+(x-fx.origin.x)*ease;y=fx.origin.y+(y-fx.origin.y)*ease;}
    const size=role==='memo'?64:role==='hint'?110:small?105:mobile?135:172,g=h.context;
    g.save();g.globalAlpha=alpha;
    if(role!=='hint'){
        const glow=g.createRadialGradient(x,y,4,x,y,size*1.4);glow.addColorStop(0,art.color+'30');glow.addColorStop(.5,art.color+'10');glow.addColorStop(1,art.color+'00');g.fillStyle=glow;g.fillRect(x-size*1.4,y-size*1.4,size*2.8,size*2.8);
    }
    g.globalCompositeOperation='lighter';
    for(let i=0;i<(reduce?10:58);i++){
        const a=i*2.39996,r0=20+(i%9)*9,phase=(age*.3+i*.071)%1;
        const r=reduce?r0:r0*(1.8-enter*.8)+Math.max(0,age-1.7)*55;
        const xx=x+Math.cos(a+age*.13)*r,yy=y+Math.sin(a+age*.13)*r*.8-(reduce?0:phase*22);
        g.globalAlpha=alpha*(.3+(i%4)*.15);g.fillStyle=art.color;g.shadowBlur=8;g.shadowColor=art.color;g.fillRect(xx,yy,i%5===0?3:1.5,i%5===0?3:1.5);
    }
    g.shadowBlur=0;g.globalAlpha=alpha;
    h.imageAt(role==='hint'?'lens':role==='memo'?'role-recorder':`role-${role}`,x-size/2,y-size/2,size,size,alpha);
    g.globalCompositeOperation='source-over';
    if(role!=='hint'&&fx.title){
        const label=fx.actor?`${fx.actor} · ${fx.title}`:fx.title,tw=Math.min(h.width-36,Math.max(190,label.length*15));
        const grad=g.createLinearGradient(x-tw/2,0,x+tw/2,0);grad.addColorStop(0,'#00000000');grad.addColorStop(.2,'#050809e8');grad.addColorStop(.8,'#050809e8');grad.addColorStop(1,'#00000000');g.fillStyle=grad;g.fillRect(x-tw/2,y+size*.48,tw,51);
        h.text(label,x,y+size*.48+25.5,mobile?14:18,'#ffffff',700,'center',tw-16);
    }
    g.restore();
}
/** A world-anchored result: no scrim, window, or duplicate board. */
export function drawHintInstrument(h:MineHud,m:HudModel){
    const anchor=m.rule.scanAnchor;
    if(!m.hint||!anchor)return;
    const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const age=Math.max(0,(performance.now()-m.rule.scanAt)/1000),revealAt=hintRevealSeconds(reduce);
    const g=h.context,unknown=m.hint.mined===null;
    const accent=unknown?ROLE_ART.trapper.color:m.hint.mined?'#ff8467':'#7ee3c6';
    const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
    if(age<revealAt){
        const x=clamp(anchor.x,65,h.width-65),y=clamp(anchor.y+64,115,h.height-100);
        g.save();g.shadowColor='#000000';g.shadowBlur=9;
        h.text('조사 중'+(reduce?'':'.'.repeat(1+Math.floor(age*4)%3)),x,y,14,'#ffffff',600,'center',140);
        g.restore();return;
    }
    const elapsed=age-revealAt,enter=reduce?1:Math.min(1,elapsed/.18);
    const pop=reduce?1:1-Math.exp(-elapsed*13)*Math.cos(elapsed*20);
    const x=clamp(anchor.x,116,h.width-116);
    const minTop=h.height<500?92:125;
    const top=clamp(anchor.y<minTop+170?anchor.y+66:anchor.y-184,minTop,h.height-178);
    const y=top+36,below=y>anchor.y;
    // The tether keeps the inspected rail legible when the label is clamped on mobile.
    g.save();g.strokeStyle=accent;g.globalAlpha=.45*enter;g.lineWidth=1.5;
    g.setLineDash([3,5]);g.beginPath();g.moveTo(anchor.x,anchor.y+(below?32:-26));g.lineTo(x,below?top-6:top+159);g.stroke();g.setLineDash([]);
    const glow=g.createRadialGradient(x,y,8,x,y,112);
    glow.addColorStop(0,accent+'35');glow.addColorStop(1,accent+'00');g.fillStyle=glow;g.globalAlpha=enter;g.fillRect(x-112,y-112,224,224);
    // Short outward burst, never clipped to the icon's image bounds.
    if(!reduce&&elapsed<.85){
        const t=elapsed/.85;
        g.globalCompositeOperation='lighter';g.fillStyle=accent;g.shadowColor=accent;g.shadowBlur=10;
        for(let i=0;i<32;i++){
            const a=i*2.39996,r=30+(1-(1-t)**3)*(36+i%6*9),size=(i%3?2:4)*(1-t);
            g.globalAlpha=(1-t)*enter;g.fillRect(x+Math.cos(a)*r-size/2,y+Math.sin(a)*r*.7-size/2,size,size);
        }
        g.globalCompositeOperation='source-over';g.shadowBlur=0;
    }
    g.translate(x,y);g.scale(pop,pop);
    h.imageAt('scan-ring',-47,-47,94,94,enter*.8);
    h.imageAt(unknown?'role-trapper':m.hint.mined?'mine':'check',-29,-29,58,58,enter);
    g.restore();
    g.save();g.shadowColor='#000000';g.shadowBlur=12;
    h.text(unknown?'판독 불가':m.hint.mined?'지뢰 있음':'지뢰 없음',x,top+87,h.width<700?23:27,'#ffffff',700,'center',220);
    g.restore();
    if(elapsed>.16||reduce)h.button('close','확인',x-64,top+111,128,48,true,false,'check');
    // Private, temporary evidence. Closing never writes to the notebook.
}
