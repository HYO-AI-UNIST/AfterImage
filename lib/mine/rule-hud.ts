import type { MineHud, HudModel } from './hud';
import { getBoard, canRebuildBoard, maxMines, hasSafePath } from '../game';
import { availableRoles, ROLE_DETAILS, baseMemoSlots, roundHintCoins } from '../roles';
import { ROOM_SETTING_LIMITS } from '../settings';
import type { RoomSettings } from '../contracts';
import { boardPosition } from './board-layout';
import { choosingBoard, ownBlessing, ownShift, edgeLabel } from './rule-ui';
import { ROLE_ART } from './presentation';
import { drawRoleAura } from './role-aura';

const white = '#ffffff', muted = '#99a3a8', red = '#c28174';
export const RULE_OVERLAYS = ['roles', 'memos', 'peek', 'peek-result', 'settings', 'roster', 'reveal'];

function sheet(h: MineHud, title: string, width = 740, height = 630) {
    h.scrim(.84);
    const w = Math.min(h.width - 24, width), hh = Math.min(h.height - 24, height), x = (h.width - w) / 2, y = (h.height - hh) / 2;
    h.frame('panel', x, y, w, hh);
    const archive=title.includes('기억')||title.includes('메모');
    if(archive)h.surface('texture-paper',x+14,y+65,w-28,hh-80,.95);
    const g=h.context;g.strokeStyle='#91a9b32c';g.lineWidth=1;g.beginPath();g.moveTo(x+24,y+63);g.lineTo(x+w-24,y+63);g.stroke();
    h.text(title, x + 23, y + 34, w < 500 ? 21 : 25, white, 700, 'left', w - 90);
    h.iconButton('close','닫기','close',x+w-60,y+12,44);
    return {x,y,w,h:hh, compact: hh < 500};
}

/** Draw only public geometry or an explicitly authorized private projection. */
export function diagram(h: MineHud, m: HudModel, x: number, y: number, w: number, height: number, options: {mines?: string[]; edge?: string | null; interactive?: string} = {}) {
    const board = getBoard(m.session.view?.gridSize ?? 4), size = m.session.view?.gridSize ?? 4;
    const scale = Math.min((w - 30) / 14.4, (height - 24) / 12.4708), center = x + w / 2;
    const p = (id: string) => { const [px,pz] = boardPosition(id,size); return {x:center+px*scale,y:y+12+(pz+7.2)*scale}; };
    const g = h.context;
    if(options.interactive)h.memoMap={x,y,w,h:height,points:board.nodes.map(n=>({id:n.id,...p(n.id)})),edges:board.edges};
    for (const edge of board.edges) {
        const a=p(edge.a),b=p(edge.b),selected=edge.id===options.edge,mined=options.mines?.includes(edge.id);
        g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.lineWidth=selected?7:mined?3:options.interactive?3:1.4;g.strokeStyle=selected?(options.interactive?m.rule.memoStatus==='mine'?'#ff8c78':m.rule.memoStatus==='safe'?'#8ee7cb':white:white):mined?red:'#637985';g.stroke();
        if (mined) h.imageAt('mine',(a.x+b.x)/2-8,(a.y+b.y)/2-8,16,16);
        if (options.interactive) {
            // Middle segments avoid ambiguous taps at dense junctions.
            const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
            h.regions.push({id:`${options.interactive}:${edge.id}`,label:edgeLabel(edge.id),x:mx-22,y:my-22,w:44,h:44,disabled:m.session.busy});
        }
    }
    for (const node of board.nodes) {const a=p(node.id);g.beginPath();g.arc(a.x,a.y,node.start?3.5:2.5,0,Math.PI*2);g.fillStyle='#b9c4cb';g.fill();}
    if(options.interactive&&m.rule.memoNode){const from=m.rule.memoNode;for(const node of board.nodes){const connected=board.edges.some(e=>(e.a===from&&e.b===node.id)||(e.b===from&&e.a===node.id));if(node.id===from||connected){const a=p(node.id);g.beginPath();g.arc(a.x,a.y,node.id===from?12:9,0,Math.PI*2);g.strokeStyle=node.id===from?'#ffffff':'#8ee7cb';g.lineWidth=2;g.stroke();}}}
}

export function ruleLobby(h: MineHud, m: HudModel) {
    const v=m.session.view!, p=sheet(h,'원정대 대기실',700,650),{x,y,w}=p,short=p.h<500;
    // Closing the lobby is not a game action; replace the sheet's close with the game menu.
    h.regions=h.regions.filter(r=>r.id!=='close');h.button('pause','',x+w-55,y+13,38,38,false,false,'pause');
    h.text(v.code,x+24,y+82,27,white,700);h.button('copy','초대 링크',x+w-151,y+61,128,40,false,false,'link');
    h.text(`${v.players.length}/${v.playerCount}명 · 관전 ${v.spectators.length}명`,x+25,y+119,12,muted);
    const cols=short?v.playerCount:Math.min(3,v.playerCount),rows=Math.ceil(v.playerCount/cols),gap=8;
    const cw=(w-48-gap*(cols-1))/cols,rh=Math.min(short?88:132,(p.h-(short?235:260))/rows),top=y+143;
    for(let i=0;i<v.playerCount;i++){
        const xx=x+24+(i%cols)*(cw+gap),yy=top+Math.floor(i/cols)*(rh+8),player=v.players[i];
        h.frame('panel-light',xx,yy,cw,rh);
        if(player){h.imageAt(`portrait-${i}`,xx+cw/2-16,yy+8,32,36);h.text(player.name,xx+cw/2,yy+Math.min(61,rh-18),12,white,600,'center',cw-10);if(rh>100)h.text(player.id===v.hostId?'방장':'참가',xx+cw/2,yy+87,10,muted,500,'center');}
        else h.text('빈 자리',xx+cw/2,yy+rh/2,12,muted,500,'center');
    }
    h.text(`힌트 ${v.hintCoins}개 · ${v.totalRounds}라운드 · ${v.gridSize}등분`,x+w/2,y+p.h-117,12,muted,500,'center');
    const bw=(w-60)/2;
    h.button('settings','방 규칙',x+24,y+p.h-99,bw,38,false,!m.session.host);
    h.button('roster','참가석 / 관전',x+36+bw,y+p.h-99,bw,38);
    if(m.session.host)h.button('start','탐험 시작',x+24,y+p.h-53,w-48,40,true,v.players.length!==v.playerCount||m.session.blocked);
    else h.text(m.session.self?'방장이 시작하기를 기다려요.':'관전 중 · 경기에는 개입할 수 없어요.',x+w/2,y+p.h-31,12,muted,500,'center');
}

export function ruleGame(h: MineHud,m: HudModel,time: number) {
    const v=m.session.view!,self=m.session.self,mobile=h.width<700,short=h.height<500,placing=v.phase==='placing',shift=ownShift(v),guard=ownBlessing(v);
    if(choosingBoard(v)&&!m.overlay){boardChoice(h,m);return;}
    const w=Math.min(h.width-24,850),hh=short?122:mobile?154:136,x=(h.width-w)/2,y=h.height-hh-14;
    const rebuild=!!self&&canRebuildBoard(v,self.seat),ready=!!self?.ready,retained=placing&&!!self&&!rebuild;
    const command=placing&&!retained||shift;
    if(command)h.frame('panel',x,y,w,hh);
    const title=placing?(ready?'준비 완료':self?rebuild?'지뢰 배치':'판 유지':'준비 중'):'지뢰 이동';
    if(command)h.text(title,x+20,y+24,mobile?17:20,white,700,'left',w-40);
    const info=placing?`${v.players.filter(p=>p.ready).length}/${v.playerCount} 준비 · ${rebuild?`${m.draft.length}/${maxMines(v.gridSize)} 지뢰`:'배치 비공개'}${m.rule.tool==='conceal'?` · 위장 ${m.rule.concealed.length}/4`:''}`:`${!m.rule.shiftFrom?'내 지뢰 선택':!m.rule.shiftTo?'빈 선로 선택':'이동 확정'} · ${self?.shifts??0}/7회`;
    if(command)h.text(info,x+20,y+49,11,muted,500,'left',w-40);
    const by=y+hh-62,bh=48;
    if(placing&&self&&rebuild){
        h.iconButton('random','지뢰 무작위 배치','random',x+14,by,bh,ready||m.session.blocked);h.iconButton('clear','현재 도구의 배치 지우기','clear',x+67,by,bh,ready||m.session.blocked);
        const bx=x+124;
        h.button('ready',ready?'준비 완료':'설계 완료',bx,by,w-(bx-x)-18,bh,true,ready||m.session.blocked||!!v.rolesEnabled&&!self.role||!hasSafePath(m.draft,v.gridSize)||m.draft.length>maxMines(v.gridSize), 'check');
    }else if(shift&&self){
        const preview=m.rule.shiftFrom&&m.rule.shiftTo?(v.shiftMines??[]).map(id=>id===m.rule.shiftFrom?m.rule.shiftTo!:id):[];
        h.button('shift-skip','유지',x+18,by,68,bh,false,m.session.blocked);
        h.iconButton('shift-undo','이동 선택 되돌리기','back',x+94,by,48,m.session.blocked||!m.rule.shiftFrom);
        h.button('shift-confirm','지뢰 이동',x+150,by,w-168,bh,true,m.session.blocked||!m.rule.shiftFrom||!m.rule.shiftTo||!hasSafePath(preview,v.gridSize));
    }
    // Field tools live beside the play space; resource meters are separate from commands.
    if(self){
        const ry=short?124:mobile?193:190,rx=short?32:mobile?32:52;
        if(!retained||!short){
            h.resource('coin-victory',self.score,rx,ry,'승점');
            h.resource('hint-charge',self.coins??0,rx+101,ry,'힌트',roundHintCoins(v.hintCoins,self.role));
            if(v.phase==='playing'&&v.activeBoardMineCount!==undefined)h.resource('mine',v.activeBoardMineCount,rx+202,ry,'이 판');
        }
        const size=retained&&short?38:short?44:mobile?56:60,dy=retained&&short?20:command?(short?112:y-size-20):h.height-size-22,icons:Array<[string,string,string,boolean,number?]>=[];
        if(v.phase==='playing'&&!shift&&!guard)icons.push(['hint',m.hintMode?'조사 취소':'선로 조사','lens',!m.session.ownTurn||m.session.blocked||v.boardOwnerSeat<0||v.blessingSeat!==undefined||v.shiftSeat!==undefined||!m.hintMode&&(self.coins??0)<=0,self.coins??0]);
        if(v.phase==='playing')icons.push(['memos','나의 기억 수첩','notebook',!v.memoCapacity||m.session.busy,v.selfMemos?.filter(Boolean).length??0]);
        if(self.role&&!(self.role==='thief'&&v.phase==='playing')&&!(self.role==='trapper'&&placing&&rebuild))icons.push(['roles',ROLE_DETAILS[self.role].name,`role-${self.role}`,false,self.role==='guardian'?self.blessings??0:self.role==='shifter'?self.shifts??0:undefined]);
        if(placing&&rebuild&&self.role==='trapper')icons.push(['tool',m.rule.tool==='conceal'?'지뢰 도구로 전환':'장막 도구로 전환',m.rule.tool==='conceal'?'mine':'role-trapper',ready]);
        if(v.phase==='playing'&&self.role==='thief')icons.push(['peek','타인의 메모 훔쳐보기','role-thief',!m.session.ownTurn||m.session.blocked||v.blessingSeat!==undefined||v.shiftSeat!==undefined||(self.peeks??0)<=0,self.peeks??0]);
        const sx=retained&&short?h.width-164-(icons.length-1)*(size+8):command?h.width-18-icons.length*(size+8):(h.width-icons.length*(size+8)+8)/2;
        icons.forEach(([id,label,icon,disabled,count],i)=>h.iconButton(id,label,icon,sx+i*(size+8),dy,size,disabled,count));
    }
    if(retained&&!m.overlay)retainedWaiting(h,m,time);
    if(guard&&!m.overlay){h.regions=[];blessing(h,m);}
    if(m.session.ownTurn&&!placing&&!guard&&!shift&&time-m.turnAt<1300&&!m.overlay&&!m.cinematic&&v.boardOwnerSeat>=0)h.text('YOUR TURN',h.width/2,h.height*.29,mobile?25:36,white,700,'center');
}

function retainedWaiting(h:MineHud,m:HudModel,time:number){
    const v=m.session.view!,mobile=h.width<700,short=h.height<(mobile?740:650);
    const w=Math.min(h.width-32,620),hh=short?194:mobile?360:310,x=(h.width-w)/2;
    const y=short?Math.min(h.height-hh-16,Math.max(176,(h.height-hh)/2)):Math.max(mobile?255:235,(h.height-hh)/2);
    const g=h.context,done=v.players.filter(p=>p.ready).length,reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    h.frame('panel',x,y,w,hh);h.surface('texture-metal',x+14,y+14,w-28,hh-28,.8);
    const art=short?58:mobile?80:98,ax=mobile&&!short?x+w/2:x+70,ay=short?y+45:mobile?y+68:y+89;
    h.imageAt('board-card',ax-art/2,ay-art*.57,art,art*1.15,.85);
    h.imageAt('check',ax+art*.18,ay+art*.1,art*.42,art*.42);
    const tx=mobile&&!short?x+w/2:x+145,ty=short?y+30:mobile?y+139:y+46,align=mobile&&!short?'center':'left',tw=mobile&&!short?w-36:w-165;
    h.text('판 유지',tx,ty,short?19:25,white,700,align,tw);
    if(mobile&&!short){
        h.text('이번 라운드에는 판을 수정하지 않습니다.',tx,ty+39,13,white,500,'center',w-38);
        h.text('다른 광부의 준비를 기다리고 있어요.',tx,ty+64,12,muted,500,'center',w-38);
    }else{
        h.wrap('이번 라운드에는 판을 수정하지 않습니다.',tx,ty+35,tw,short?11:14,white,short?18:23);
        if(!short)h.text('다른 광부의 준비를 기다리고 있어요.',tx,ty+89,12,muted,500,'left',tw);
    }
    const rowY=short?y+99:mobile?y+239:y+184,cw=Math.min(74,(w-36)/v.playerCount),sx=x+(w-cw*v.playerCount)/2;
    v.players.forEach((player,i)=>{
        const xx=sx+(i+.5)*cw;
        h.imageAt(`portrait-${player.seat}`,xx-14,rowY,28,32,player.ready?1:.4);
        if(player.ready)h.imageAt('check',xx+4,rowY+20,18,18);
        h.text(player.name,xx,rowY+47,9,player.ready?white:muted,500,'center',cw-4);
    });
    const lineY=y+hh-29;
    g.save();g.fillStyle='#263138';g.fillRect(x+24,lineY,w-48,3);g.fillStyle='#dbeaf0';g.globalAlpha=reduce?1:.7+.3*Math.sin(time*.002);g.fillRect(x+24,lineY,(w-48)*done/v.playerCount,3);g.restore();
    h.text(`${done}/${v.playerCount} 준비`,x+w/2,lineY-13,10,muted,500,'center');
}

function boardChoice(h:MineHud,m:HudModel){
    const v=m.session.view!,p=sheet(h,m.session.ownTurn?'갱도 선택':`${v.players[v.activeSeat]?.name} · 갱도 선택`,850,590),{x,y,w}=p;
    h.regions=h.regions.filter(r=>r.id!=='close');h.button('help','',x+w-55,y+13,38,38,false,false,'help');
    const choices=v.players.filter(p=>p.seat!==v.activeSeat),cols=p.compact?choices.length:Math.min(3,choices.length),rows=Math.ceil(choices.length/cols),gap=10,cw=(w-48-gap*(cols-1))/cols,rh=Math.min(180,(p.h-178-gap*(rows-1))/rows);
    choices.forEach((player,i)=>{const xx=x+24+(i%cols)*(cw+gap),yy=y+100+Math.floor(i/cols)*(rh+gap);h.button(`board:${player.seat}`,'',xx,yy,cw,rh,false,!m.session.ownTurn||m.session.blocked);const icon=Math.min(72,rh*.42);h.imageAt('board-card',xx+(cw-icon)/2,yy+9,icon,icon*1.22);h.imageAt(`portrait-${player.seat}`,xx+cw/2-11,yy+10+icon*.67,22,25);h.text(player.name,xx+cw/2,yy+rh*.66,13,white,700,'center',cw-15);if(player.role&&rh>155)h.text(ROLE_DETAILS[player.role].name,xx+cw/2,yy+rh-39,10,muted,500,'center',cw-12);h.imageAt('coin-victory',xx+cw/2-22,yy+rh-28,20,20);h.text(String(player.score),xx+cw/2+9,yy+rh-18,12,white,700,'center');});
    if(m.session.self){
        const thief=m.session.self.role==='thief',sx=x+w/2-(thief?56:26);
        h.iconButton('memos','나의 기억 수첩','notebook',sx,y+p.h-68,52,!v.memoCapacity||m.session.busy,v.selfMemos?.filter(Boolean).length??0);
        if(thief)h.iconButton('peek','타인의 기억 훔쳐보기','role-thief',sx+62,y+p.h-68,52,!m.session.ownTurn||m.session.blocked||!(m.session.self.peeks??0)||!v.peekableMemos?.length,m.session.self.peeks??0);
    }
}

function blessing(h:MineHud,m:HudModel){
    const p=sheet(h,'귀환의 가호',540,480),{x,y,w}=p,short=p.h<430;
    h.regions=h.regions.filter(r=>r.id!=='close');h.iconButton('help','귀환의 가호 사용법','help',x+w-60,y+12,44);
    h.surface('texture-velvet',x+14,y+65,w-28,p.h-80,.95);
    const size=short?108:162,cx=short?x+w*.24:x+w/2,cy=y+(short?134:135);
    h.imageAt('sigil-guardian',cx-size*.7,cy-size*.7,size*1.4,size*1.4,.14);h.imageAt('role-guardian',cx-size/2,cy-size/2,size,size);
    const tx=short?x+w*.65:x+w/2,ty=short?y+109:y+235,tw=short?w*.54:w-52;
    for(let i=0;i<2;i++)h.imageAt('role-guardian',tx-34+i*37,ty+15,32,32,i<(m.session.self?.blessings??0)?1:.15);
    h.wrap('같은 판, 같은 차례에서 다시 출발해요. 지뢰는 그대로 남습니다.',short?x+w*.39:x+30,ty+67,tw,12,muted,21);
    if(m.session.view?.memoCapacity){h.iconButton('memos','결정 전에 기억 수첩 보기','notebook',x+24,y+p.h-130,48,m.session.busy);}
    h.button('bless-skip','넘기기',x+24,y+p.h-66,96,48,false,m.session.busy);
    h.button('bless-use','귀환',x+130,y+p.h-66,w-154,48,true,m.session.busy);
}

export function ruleOverlay(h:MineHud,m:HudModel){
    const v=m.session.view;
    if(!v)return;
    if(m.overlay==='roles'){
        const self=m.session.self,canChoose=v.phase==='placing'&&!!self&&!self.role&&!!v.rolesEnabled;
        const roles=availableRoles(v.playerCount),index=Math.max(0,roles.indexOf(m.rule.role)),id=roles[index],detail=ROLE_DETAILS[id],art=ROLE_ART[id];
        const p=sheet(h,detail.name,900,620),{x,y,w}=p;
        const short=p.h<440,split=w>600,icon=short?112:split?240:p.h<600?112:144;
        const tx=split?x+w*.46:x+26,tw=split?w*.49:w-52,font=short?13:15,line=short?22:25;
        const lines=(text:string,size:number)=>{h.context.font=`500 ${size}px Pretendard, sans-serif`;let row='',count=1;for(const c of text){if(c==='\n'||h.context.measureText(row+c).width>tw){count++;row=c==='\n'?'':c;}else row+=c;}return count;};
        const contentTop=y+78,contentBottom=y+p.h-(canChoose?171:105),center=(contentTop+contentBottom)/2;
        let bodyH=lines(detail.description,font)*line;
        const rules:string[]=[];
        if(!short)for(const rule of detail.rules){const needed=lines(`· ${rule}`,12)*20+10;if(bodyH+needed+(split?0:icon+20)>contentBottom-contentTop)break;rules.push(rule);bodyH+=needed;}
        const blockH=split?bodyH:icon+20+bodyH,top=center-blockH/2;
        const ax=split?x+w*.23:x+w/2,baseY=split?center:top+icon/2,reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,t=performance.now()/1000,ay=baseY+(reduce?0:Math.sin(t*1.7)*4);
        h.surface('texture-velvet',x+14,y+64,w-28,p.h-80,.92);
        const g=h.context;g.save();g.beginPath();g.rect(x+15,y+65,w-30,p.h-(canChoose?230:165));g.clip();
        const auraSize=Math.min(icon,Math.max(0,contentBottom-contentTop-24)/1.3);
        drawRoleAura(g,id,art.color,ax,baseY,auraSize,t*1000,reduce);g.restore();
        h.imageAt(`role-${id}`,ax-icon/2,ay-icon/2,icon,icon);
        h.regions=h.regions.filter(r=>r.id!=='close');
        h.iconButton('role-guide','이 재능의 사용 방법','help',x+w-(canChoose?60:112),y+12,44);
        if(!canChoose)h.iconButton('close','닫기','close',x+w-60,y+12,44);
        let yy=h.wrap(detail.description,tx,split?top:top+icon+20,tw,font,white,line);
        for(const rule of rules)yy=h.wrap(`· ${rule}`,tx,yy+10,tw,12,muted,20);
        const size=Math.min(short?40:52,(w-48-(roles.length-1)*7)/roles.length),total=roles.length*size+(roles.length-1)*7,sx=x+(w-total)/2,sy=y+p.h-(canChoose?139:74);
        roles.forEach((role,i)=>{const xx=sx+i*(size+7),key=`role-preview:${role}`;h.iconButton(key,ROLE_DETAILS[role].name,`role-${role}`,xx,sy,size,m.session.busy);if(role===id){const lift=m.session.busy?0:m.pressed===key?3:m.hover===key||m.focus===key?-2:0;h.context.strokeStyle=art.color;h.context.lineWidth=2;h.context.beginPath();h.context.arc(xx+size/2,sy+size/2+lift,size*30/72,0,Math.PI*2);h.context.stroke();}});
        if(canChoose)h.button('role-confirm','선택',x+24,y+p.h-62,w-48,48,true,m.session.busy);
    }else if(m.overlay==='settings'){
        const p=sheet(h,'방 규칙 설정',560,500),{x,y,w}=p,fields:Array<[keyof RoomSettings,string]>=[['playerCount','참가 인원'],['hintCoins','기본 힌트'],['totalRounds','총 라운드'],['gridSize','삼각형 등분']];
        const gap=Math.min(72,(p.h-151)/4);
        fields.forEach(([key,label],i)=>{const yy=y+83+i*gap,limits=ROOM_SETTING_LIMITS[key];h.text(label,x+25,yy+18,14,white,600);h.button(`setting:${key}:-1`,'−',x+w-181,yy,40,36,false,m.rule.settings[key]<=limits.min);h.text(String(m.rule.settings[key]),x+w-102,yy+18,20,white,700,'center');h.button(`setting:${key}:1`,'+',x+w-65,yy,40,36,false,m.rule.settings[key]>=limits.max);});
        h.button('settings-apply','이 규칙 적용',x+24,y+p.h-61,w-48,42,true,m.session.busy||!m.session.host);
    }else if(m.overlay==='roster'){
        const p=sheet(h,'참가석과 관전자',620,650),{x,y,w}=p,list=[...v.players.map(p=>({...p,seated:true})),...v.spectators.map(p=>({...p,seated:false}))],page=Math.min(m.rule.rosterPage,Math.max(0,Math.ceil(list.length/5)-1)),rh=Math.min(78,(p.h-155)/5);
        list.slice(page*5,page*5+5).forEach((player,i)=>{const yy=y+80+i*rh;h.frame('panel-light',x+24,yy,w-48,rh-7);h.text(player.name,x+39,yy+(rh-7)/2,14,white,600,'left',w-205);h.button(`seat:${player.id}:${player.seated?'0':'1'}`,player.seated?'관전으로':'참가석으로',x+w-148,yy+5,110,rh-17,false,!m.session.host||v.phase!=='waiting'||m.session.busy||!player.seated&&v.players.length>=v.playerCount);});
        h.button('roster-prev','이전',x+24,y+p.h-58,90,38,false,page===0);h.text(`${page+1} / ${Math.max(1,Math.ceil(list.length/5))}`,x+w/2,y+p.h-39,12,muted,500,'center');h.button('roster-next','다음',x+w-114,y+p.h-58,90,38,false,(page+1)*5>=list.length);
    }else if(m.overlay==='memos'){
        const p=sheet(h,'메모',820,780),{x,y,w}=p,split=w>600&&p.compact,count=v.memoCapacity??0;
        const left=x+24,toolsW=split?w*.39:w-48,gap=6,paged=!split&&toolsW<290&&v.playerCount>3,cols=split||paged?3:v.playerCount,ownerW=(toolsW-(paged?48:0)-gap*(cols-1))/cols,ownerH=split?44:64;
        const owners=paged?v.players.slice(Math.floor(m.rule.memoOwner/3)*3,Math.floor(m.rule.memoOwner/3)*3+3):v.players;
        owners.forEach((player,i)=>{
            const xx=left+i%cols*(ownerW+gap),yy=y+80+Math.floor(i/cols)*(ownerH+gap),selected=player.seat===m.rule.memoOwner;
            h.button(`memo-owner:${player.seat}`,'',xx,yy,ownerW,ownerH,false,m.session.busy);
            if(selected){h.context.strokeStyle='#8bbce0';h.context.lineWidth=2;h.context.strokeRect(xx+3,yy+3,ownerW-6,ownerH-6);}
            const portrait=split?23:32;h.imageAt(`portrait-${player.seat}`,xx+(ownerW-portrait)/2,yy+4,portrait,portrait*1.12);
            h.text(player.name,xx+ownerW/2,yy+ownerH-9,split?8:9,selected?white:muted,600,'center',ownerW-8);
        });
        if(paged)h.button('memo-owner-page','›',left+toolsW-42,y+80,42,64);
        const slotsY=y+(split?182:155),slotW=(toolsW-gap*(Math.max(1,count)-1))/Math.max(1,count);
        for(let i=0;i<count;i++){const note=v.selfMemos?.[i],icon=!note?undefined:note.status==='safe'?'check':note.status==='mine'?'mine':'help';h.button(`memo-slot:${i}`,note?String(i+1):`+ ${i+1}`,left+i*(slotW+gap),slotsY,slotW,42,i===m.rule.memoSlot,m.session.busy,icon);}
        const mapX=split?x+w*.46:left,mapY=split?y+80:y+213,mapW=split?w*.51:toolsW,mapH=split?p.h-124:p.h-397;
        diagram(h,m,mapX,mapY,mapW,mapH,{edge:m.rule.memoEdge,interactive:'memo-edge'});
        const paletteY=split?y+234:y+p.h-130,paletteW=(toolsW-12)/3;
        for(const [i,[id,label,icon]]of([['safe','안전','check'],['mine','지뢰','mine'],['unsure','미확인','help']]as const).entries())h.button(`memo-status:${id}`,label,left+i*(paletteW+6),paletteY,paletteW,44,m.rule.memoStatus===id,m.session.busy,icon);
        if(m.rule.memoNode)h.text('연결할 분기점 선택',mapX+mapW/2,mapY+mapH+17,12,white,600,'center',mapW);
        else if(m.rule.memoEdge)h.text(edgeLabel(m.rule.memoEdge),split?left:mapX+mapW/2,split?y+291:y+p.h-153,10,muted,500,split?'left':'center',toolsW);
        const by=y+p.h-64;
        h.iconButton('memo-undo','되돌리기','back',left,by,48,m.session.busy||!m.rule.memoUndo);
        h.iconButton('memo-delete','이 메모 지우기','clear',left+59,by,48,m.session.busy||!v.selfMemos?.[m.rule.memoSlot]);
        h.iconButton('close','닫기','check',x+w-76,by,48);
    }else if(m.overlay==='peek'){
        const p=sheet(h,'타인의 기억 · 훔쳐볼 메모 선택',650,650),{x,y,w}=p,targets=v.peekableMemos??[],limit=baseMemoSlots(v.playerCount),page=m.rule.rosterPage,rh=Math.min(68,(p.h-190)/5);
        h.text(`남은 횟수 ${m.session.self?.peeks??0}/2 · 한 번에 ${limit}개까지`,x+24,y+78,12,muted);
        targets.slice(page*5,page*5+5).forEach((target,i)=>{const player=v.players.find(p=>p.id===target.playerId),selected=m.rule.peekTargets.some(t=>t.playerId===target.playerId&&t.slot===target.slot);h.button(`peek-target:${target.playerId}:${target.slot}`,`${selected?'✓ ':''}${player?.name} · 메모 ${target.slot+1}`,x+24,y+102+i*rh,w-48,rh-8,selected,m.session.busy);});
        if(!targets.length)h.text('아직 다른 광부가 작성한 메모가 없어요.',x+w/2,y+154,13,muted,500,'center');
        h.button('roster-prev','이전',x+24,y+p.h-108,90,34,false,page===0);h.button('roster-next','다음',x+w-114,y+p.h-108,90,34,false,(page+1)*5>=targets.length);
        h.button('peek-confirm',`${m.rule.peekTargets.length}개 잠깐 확인 −1회`,x+24,y+p.h-61,w-48,42,true,m.session.busy||!m.rule.peekTargets.length||m.rule.peekTargets.length>limit);
    }else if(m.overlay==='peek-result'){
        const entries=m.rule.peekResult??[],p=sheet(h,'잠깐 빌려온 기억',680,650),{x,y,w}=p,rh=(p.h-154)/Math.max(1,entries.length);
        entries.forEach((note,i)=>{const yy=y+80+i*rh,author=v.players.find(p=>p.id===note.playerId),owner=v.players.find(p=>p.id===note.boardOwnerId);h.text(`${author?.name}의 기록 · ${owner?.name}의 판`,x+24,yy+8,13,white,600,'left',w-48);diagram(h,m,x+24,yy+27,w*.57,Math.max(65,rh-42),{edge:note.edgeId});h.text(note.status==='safe'?'안전 추측':note.status==='mine'?'지뢰 추측':'미확인',x+w*.69,yy+rh*.5,15,white,700,'center',w*.27);});
        h.button('close','기억했어요 · 닫으면 사라져요',x+24,y+p.h-60,w-48,42,true);
    }else if(m.overlay==='reveal'){
        const p=sheet(h,'라운드의 공개된 갱도',730,650),{x,y,w}=p,players=v.players.filter(p=>v.revealedBoards&&Object.hasOwn(v.revealedBoards,p.id)),owner=players.find(p=>p.seat===m.rule.revealSeat)??players[0];
        h.text(owner?`${owner.name}의 갱도`:'공개할 수 있는 판이 없어요',x+w/2,y+82,19,white,700,'center');
        if(owner)diagram(h,m,x+24,y+107,w-48,p.h-200,{mines:v.revealedBoards?.[owner.id]});
        h.button('reveal-prev','이전 판',x+24,y+p.h-60,108,40,false,players.length<2);h.button('reveal-next','다음 판',x+w-132,y+p.h-60,108,40,false,players.length<2);
    }
}

export function transferResults(h:MineHud,m:HudModel,time:number){
    const v=m.session.view!,final=v.phase==='finished',short=h.height<560;
    const w=Math.min(h.width-24,short?900:600),hh=Math.min(h.height-(short?24:104),short?450:740);
    const x=!short&&h.width>=1100?h.width-w-26:(h.width-w)/2,y=short?12:Math.max(82,(h.height-hh)/2);
    const split=short&&w>480,age=time-m.resultAt,amount=v.winner?.coinsTransferred??0;
    const winner=v.players.find(p=>p.seat===v.winner?.seat),owner=v.players.find(p=>p.seat===v.winner?.ownerSeat);
    h.scrim(h.width<700?.24:.10);
    if(h.width>=1100)h.imageAt('stage-ray',h.width*.12,40,220,h.height*.85,.30);
    h.frame('panel',x,y,w,hh,.97);
    h.text(final?'원정이 끝났습니다':'ROUND CLEAR',x+23,y+29,short?21:26,white,700,'left',split?w*.43:w-46);
    const heroW=split?w*.43:w,center=x+heroW/2,cy=y+(short?(split?90:70):118),distance=Math.min(split?82:160,heroW*.27),left=center-distance,right=center+distance;
    const t=Math.max(0,Math.min(1,(age-500)/1300)),smooth=t*t*(3-2*t);
    h.imageAt(`portrait-${owner?.seat??0}`,left-21,cy-14,42,47);h.imageAt(`portrait-${winner?.seat??0}`,right-21,cy-14,42,47);
    h.text(owner?.name??'',left,cy+50,11,white,600,'center',heroW*.32);h.text(winner?.name??'',right,cy+50,11,white,600,'center',heroW*.32);
    if(amount){
        h.imageAt('coin-victory',left+(right-left)*smooth-17,cy-12-Math.sin(t*Math.PI)*35,34,34,Math.max(0,1-Math.max(0,age-1900)/400));
        h.text('−1',left,cy-33,15,white,700,'center');h.text('+1',right,cy-33,15,white,700,'center');
    }else h.text('이동할 승점 코인 없음',center,cy+4,10,muted,500,'center',distance*1.5);
    const names=v.players.filter(p=>v.champions.includes(p.seat)).map(p=>p.name).join(', ');
    h.text(final?`${names} 우승`:`${winner?.name} 탈출 · ${amount}코인 획득`,center,y+(short?(split?168:143):203),short?15:21,white,700,'center',heroW-35);
    const listX=split?x+w*.46:x+24,listW=split?w*.51:w-48,top=y+(split?65:short?167:242);
    const bottom=y+hh-(split?20:115),rh=Math.max(16,Math.min(short?36:48,(bottom-top)/v.playerCount));
    const rankT=Math.max(0,Math.min(1,(age-1500)/1000));
    const before=(player:typeof v.players[number])=>player.score+(player.seat===owner?.seat?amount:0)-(player.seat===winner?.seat?amount:0);
    const old=[...v.players].sort((a,b)=>before(b)-before(a)||a.seat-b.seat),sorted=[...v.players].sort((a,b)=>b.score-a.score||a.seat-b.seat);
    sorted.forEach((player,i)=>{
        const from=old.findIndex(p=>p.id===player.id),yy=top+(from+(i-from)*rankT)*rh;
        if(rh<25)h.imageAt(player.id===winner?.id?'panel-private':'panel-light',listX,yy,listW,rh-3);else h.frame(player.id===winner?.id?'panel-private':'panel-light',listX,yy,listW,rh-4);
        h.text(String((rankT>.5?i:from)+1).padStart(2,'0'),listX+13,yy+rh/2,11,muted);
        h.text(player.name,listX+49,yy+rh/2,short?11:14,white,600,'left',listW-133);
        h.text(`${Math.round(before(player)+(player.score-before(player))*smooth)} 코인`,listX+listW-14,yy+rh/2,short?12:17,white,700,'right');
    });
    const actionsW=split?heroW-46:w-48;
    h.button('reveal',final?'모든 갱도 살펴보기':'상대 판 정답 보기',x+24,y+hh-101,actionsW,35,false,!v.revealedBoards||!Object.keys(v.revealedBoards).length);
    if(m.session.host)h.button('next',final?m.session.demo?'새 원정 시작':'대기실로 돌아가기':'다음 라운드 준비',x+24,y+hh-58,actionsW,41,true,m.session.blocked||age<2450);
    else h.text('방장이 다음 단계를 준비하고 있어요.',x+24+actionsW/2,y+hh-35,short?10:12,muted,500,'center',actionsW);
}
