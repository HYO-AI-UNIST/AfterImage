import type { MineHud, HudModel } from './hud';
import { getBoard, canRebuildBoard, maxMines, hasSafePath } from '../game';
import { availableRoles, ROLE_DETAILS, baseMemoSlots, roundHintCoins } from '../roles';
import { ROOM_SETTING_LIMITS } from '../settings';
import type { RoomSettings } from '../contracts';
import { boardPosition } from './board-layout';
import { choosingBoard, ownBlessing, ownShift, edgeLabel } from './rule-ui';

const white = '#ffffff', muted = '#99a3a8', red = '#c28174';
export const RULE_OVERLAYS = ['roles', 'memos', 'peek', 'peek-result', 'settings', 'roster', 'reveal'];

function sheet(h: MineHud, title: string, width = 740, height = 630) {
    h.scrim(.84);
    const w = Math.min(h.width - 24, width), hh = Math.min(h.height - 24, height), x = (h.width - w) / 2, y = (h.height - hh) / 2;
    h.frame('panel', x, y, w, hh); h.text(title, x + 23, y + 34, w < 500 ? 21 : 25, white, 700, 'left', w - 90);
    h.button('close', '', x + w - 55, y + 13, 38, 38, false, false, 'close');
    return {x,y,w,h:hh, compact: hh < 500};
}

/** Draw only public geometry or an explicitly authorized private projection. */
export function diagram(h: MineHud, m: HudModel, x: number, y: number, w: number, height: number, options: {mines?: string[]; edge?: string | null; interactive?: string} = {}) {
    const board = getBoard(m.session.view?.gridSize ?? 4), size = m.session.view?.gridSize ?? 4;
    const scale = Math.min((w - 30) / 14.4, (height - 24) / 12.4708), center = x + w / 2;
    const p = (id: string) => { const [px,pz] = boardPosition(id,size); return {x:center+px*scale,y:y+12+(pz+7.2)*scale}; };
    const g = h.context;
    for (const edge of board.edges) {
        const a=p(edge.a),b=p(edge.b),selected=edge.id===options.edge,mined=options.mines?.includes(edge.id);
        g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.lineWidth=selected?5:mined?3:1.4;g.strokeStyle=selected?white:mined?red:'#52616a';g.stroke();
        if (mined) h.imageAt('mine',(a.x+b.x)/2-8,(a.y+b.y)/2-8,16,16);
        if (options.interactive) {
            // Middle segments avoid ambiguous taps at dense junctions.
            const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
            h.regions.push({id:`${options.interactive}:${edge.id}`,label:edgeLabel(edge.id),x:mx-13,y:my-13,w:26,h:26,disabled:false});
        }
    }
    for (const node of board.nodes) {const a=p(node.id);g.beginPath();g.arc(a.x,a.y,node.start?3.5:2.5,0,Math.PI*2);g.fillStyle='#b9c4cb';g.fill();}
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
    const v=m.session.view!,self=m.session.self,mobile=h.width<700,placing=v.phase==='placing',shift=ownShift(v);
    if(choosingBoard(v)&&!m.overlay){boardChoice(h,m);return;}
    const w=Math.min(h.width-24,900),hh=mobile?(h.height<600?185:211):145,x=(h.width-w)/2,y=h.height-hh-14;
    h.frame('panel',x,y,w,hh);
    const rebuild=!!self&&canRebuildBoard(v,self.seat),ready=!!self?.ready,guard=ownBlessing(v);
    let title=placing?(self?rebuild?'수렛길에 지뢰를 배치하세요':'기존 갱도를 유지합니다':'광부들이 갱도를 준비하고 있어요'):shift?'도전 전에 내 지뢰를 옮길까요?':guard?'가호 사용 여부를 결정하세요':v.shiftSeat!==undefined?'다른 광부가 지뢰를 옮기고 있어요':v.blessingSeat!==undefined?'귀환의 가호를 결정하고 있어요':v.event?.type==='explosion'?'폭발 위치를 기억하세요':m.session.ownTurn?(m.hintMode?'확인할 선로를 고르세요':v.position?'연결된 분기점으로 이동':'출발역을 고르세요'):`${v.players[v.activeSeat]?.name}의 탐험`;
    if(placing&&ready)title='준비 완료 · 다른 광부를 기다려요';
    h.text(title,x+20,y+25,mobile?17:21,white,700,'left',w-40);
    const info=placing?`${v.players.filter(p=>p.ready).length}/${v.playerCount} 준비 · ${rebuild?`${m.draft.length}/${maxMines(v.gridSize)} 지뢰`:'배치 비공개 유지'}${m.rule.tool==='conceal'?` · 위장 ${m.rule.concealed.length}/4`:''}`:shift?`남은 이동 ${self?.shifts??0}/7 · ${!m.rule.shiftFrom?'내 지뢰를 선택':!m.rule.shiftTo?'빈 선로를 선택':'안전 경로를 확인 후 확정'}`:self?`힌트 ${self.coins??0}/${roundHintCoins(v.hintCoins,self.role)} · 승점 코인 ${self.score}${v.activeBoardMineCount===undefined?'':` · 이 판 지뢰 ${v.activeBoardMineCount}개`}`:`관전 중${v.activeBoardMineCount===undefined?'':` · 이 판 지뢰 ${v.activeBoardMineCount}개`} · 공개 정보만 보여요`;
    h.text(info,x+20,y+53,11,muted,500,'left',w-40);
    if(self?.role)h.text(ROLE_DETAILS[self.role].name,x+20,y+(mobile?79:78),12,white,600);
    const by=y+hh-53,bh=39,gap=7;
    if(placing&&self){
        if(mobile){const ty=y+(hh<200?89:98);h.button('roles','능력 선택',x+16,ty,(w-39)/2,35,false,ready||m.session.blocked);h.button('tool',m.rule.tool==='conceal'?'위장 선택 중':'지뢰 선택 중',x+23+(w-39)/2,ty,(w-39)/2,35,false,ready||!rebuild||self.role!=='trapper');}
        else{h.button('roles','능력',x+w-312,y+17,86,37,false,ready||m.session.blocked);h.button('tool',m.rule.tool==='conceal'?'위장 중':'지뢰 도구',x+w-217,y+17,101,37,false,ready||!rebuild||self.role!=='trapper');}
        const left=x+16;
        if(rebuild){h.button('random','',left,by,39,bh,false,ready||m.session.blocked,'random');h.button('clear','',left+46,by,39,bh,false,ready||m.session.blocked,'clear');}
        const bx=rebuild?left+92:left,bw=w-(bx-x)-16;
        h.button('ready',ready?'준비 완료':rebuild?'이 배치로 준비':'이 판을 유지하고 준비',bx,by,bw,bh,true,ready||m.session.blocked||!!v.rolesEnabled&&!self.role||rebuild&&(!hasSafePath(m.draft,v.gridSize)||m.draft.length>maxMines(v.gridSize)));
    }else if(shift&&self){
        if(v.memoCapacity)h.button('memos','내 메모',x+w-113,y+45,96,32,false,m.session.busy);
        const preview=m.rule.shiftFrom&&m.rule.shiftTo?(v.shiftMines??[]).map(id=>id===m.rule.shiftFrom?m.rule.shiftTo!:id):[];
        h.button('shift-skip','건너뛰기',x+16,by,(w-39)/2,bh,false,m.session.blocked);
        h.button('shift-confirm','옮기고 판 선택 −1',x+23+(w-39)/2,by,(w-39)/2,bh,true,m.session.blocked||!m.rule.shiftFrom||!m.rule.shiftTo||!hasSafePath(preview,v.gridSize));
    }else if(self&&!placing){
        const buttons=[['hint',m.hintMode?'힌트 취소':'힌트 −1'],['memos','내 메모'],['roles','능력']];
        if(self.role==='thief')buttons.push(['peek',`훔쳐보기 ${self.peeks??0}`]);
        const bw=(w-32-gap*(buttons.length-1))/buttons.length;
        buttons.forEach(([id,label],i)=>h.button(id,label,x+16+i*(bw+gap),by,bw,bh,id==='hint',id==='hint'?(!m.session.ownTurn||m.session.blocked||v.boardOwnerSeat<0||v.blessingSeat!==undefined||v.shiftSeat!==undefined||!m.hintMode&&(self.coins??0)<=0):id==='peek'?(!m.session.ownTurn||m.session.blocked||v.blessingSeat!==undefined||v.shiftSeat!==undefined||(self.peeks??0)<=0):id==='memos'?(m.session.busy||!v.memoCapacity):false));
    }
    if(guard&&!m.overlay){h.regions=[];blessing(h,m);}
    if(m.session.ownTurn&&!placing&&!guard&&!shift&&time-m.turnAt<1300&&!m.overlay&&!m.cinematic&&v.boardOwnerSeat>=0){h.text('YOUR TURN',h.width/2,h.height*.29,mobile?25:36,white,700,'center');}
}

function boardChoice(h:MineHud,m:HudModel){
    const v=m.session.view!,p=sheet(h,m.session.ownTurn?'어느 광부의 갱도에 도전할까요?':`${v.players[v.activeSeat]?.name}이 판을 고르고 있어요`,850,590),{x,y,w}=p;
    h.regions=h.regions.filter(r=>r.id!=='close');h.button('help','',x+w-55,y+13,38,38,false,false,'help');
    h.text('한 차례에 한 판 · 자기 판은 선택할 수 없어요',x+24,y+73,12,muted,500,'left',w-48);
    const choices=v.players.filter(p=>p.seat!==v.activeSeat),cols=p.compact?choices.length:Math.min(3,choices.length),rows=Math.ceil(choices.length/cols),gap=10,cw=(w-48-gap*(cols-1))/cols,rh=Math.min(180,(p.h-151-gap*(rows-1))/rows);
    choices.forEach((player,i)=>{const xx=x+24+(i%cols)*(cw+gap),yy=y+100+Math.floor(i/cols)*(rh+gap);h.button(`board:${player.seat}`,'',xx,yy,cw,rh,false,!m.session.ownTurn||m.session.blocked);const icon=Math.min(72,rh*.42);h.imageAt('board-card',xx+(cw-icon)/2,yy+9,icon,icon*1.22);h.imageAt(`portrait-${player.seat}`,xx+cw/2-11,yy+10+icon*.67,22,25);h.text(player.name,xx+cw/2,yy+rh*.66,13,white,700,'center',cw-15);if(player.role&&rh>155)h.text(ROLE_DETAILS[player.role].name,xx+cw/2,yy+rh-39,10,muted,500,'center',cw-12);h.text(`승점 ${player.score}`,xx+cw/2,yy+rh-18,11,muted,500,'center',cw-12);});
    if(m.session.self){
        const thief=m.session.self.role==='thief',bw=thief?(w-57)/2:w-48;
        h.button('memos','내 메모 살펴보기',x+24,y+p.h-45,bw,32,false,!v.memoCapacity||m.session.busy);
        if(thief)h.button('peek',`훔쳐보기 ${m.session.self.peeks??0}`,x+33+bw,y+p.h-45,bw,32,false,!m.session.ownTurn||m.session.blocked||!(m.session.self.peeks??0)||!v.peekableMemos?.length);
    }
}

function blessing(h:MineHud,m:HudModel){
    const p=sheet(h,'가호로 다시 출발할까요?',490,400),{x,y,w}=p;
    h.regions=h.regions.filter(r=>r.id!=='close');h.button('help','',x+w-55,y+13,38,38,false,false,'help');
    const short=p.h<400,icon=short?48:64;
    h.imageAt('role-guardian',x+w/2-icon/2,y+72,icon,icon);h.text(`남은 가호 ${m.session.self?.blessings??0} / 2`,x+w/2,y+(short?139:159),17,white,700,'center');
    h.wrap('같은 판, 같은 차례에서 출발역을 다시 골라요. 지뢰는 그대로 남습니다.',x+26,y+(short?167:191),w-52,13,muted,21);
    if(m.session.view?.memoCapacity)h.button('memos','결정 전에 내 메모 보기',x+24,y+p.h-151,w-48,32,false,m.session.busy);
    h.button('bless-use','가호로 다시 출발 −1',x+24,y+p.h-104,w-48,40,true,m.session.busy);
    h.button('bless-skip','가호를 아끼고 차례 넘기기',x+24,y+p.h-55,w-48,40,false,m.session.busy);
}

export function ruleOverlay(h:MineHud,m:HudModel){
    const v=m.session.view;
    if(!v)return;
    if(m.overlay==='roles'){
        const p=sheet(h,'이번 라운드의 능력',760,650),{x,y,w}=p,roles=availableRoles(v.playerCount),index=Math.max(0,roles.indexOf(m.rule.role)),id=roles[index],detail=ROLE_DETAILS[id],self=m.session.self,canChoose=v.phase==='placing'&&!!self&&!self.ready&&!!v.rolesEnabled;
        const split=w>600&&p.compact,tx=split?x+w*.34:x+24,tw=split?w*.62:w-48,top=split?y+91:y+174;
        h.imageAt(`role-${id}`,split?x+45:x+w/2-36,y+77,72,72);
        h.text(detail.name,tx,top,23,white,700,'left',tw);h.text(detail.subtitle,tx,top+31,12,muted,500,'left',tw);
        let yy=h.wrap(detail.description,tx,top+65,tw,13,white,22);
        if(!p.compact)for(const rule of detail.rules){if(yy>y+p.h-179)break;yy=h.wrap(`· ${rule}`,tx,yy+6,tw,12,muted,20);}
        h.button('role-guide','효과와 사용 방법 자세히',x+24,y+p.h-139,w-48,32);
        h.text(`${index+1} / ${roles.length}${self?.role===id?' · 현재 선택한 능력':''}`,x+w/2,y+p.h-91,11,muted,500,'center');
        h.button('role-prev','이전',x+24,y+p.h-61,75,42);
        h.button('role-next','다음',x+w-99,y+p.h-61,75,42);
        h.button(canChoose?'role-confirm':'close',canChoose?'이 능력 선택':'알겠어요',x+108,y+p.h-61,w-216,42,true,m.session.busy);
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
        const p=sheet(h,'나의 기억 수첩',720,740),{x,y,w}=p,split=w>600&&p.compact,owner=v.players[m.rule.memoOwner]??v.players[0],count=v.memoCapacity??0;
        const sx=split?x+24:x+24,sw=split?w*.45:w-48;
        h.text('직접 적은 추측 · 정답을 자동 확인하지 않아요',sx,y+78,11,muted,500,'left',w-48);
        const slotW=Math.min(74,(sw-7*Math.max(0,count-1))/Math.max(1,count));
        for(let i=0;i<count;i++)h.button(`memo-slot:${i}`,`${i+1}${v.selfMemos?.[i]?' ●':''}`,sx+i*(slotW+7),y+96,slotW,34,i===m.rule.memoSlot,m.session.busy);
        h.button('memo-owner-prev','〈',sx,y+141,37,35);h.text(owner?.name??'',sx+sw/2,y+159,14,white,600,'center',sw-88);h.button('memo-owner-next','〉',sx+sw-37,y+141,37,35);
        const mapX=split?x+w*.51:sx,mapY=split?y+91:y+184,mapW=split?w*.45:sw,mapH=split?p.h-158:Math.max(65,p.h-345);
        diagram(h,m,mapX,mapY,mapW,mapH,{edge:m.rule.memoEdge,interactive:'memo-edge'});
        const statusY=split?y+196:y+p.h-150,statusW=(sw-14)/3;
        for(const [i,[id,label]]of([['safe','안전'],['mine','지뢰'],['unsure','미확인']]as const).entries())h.button(`memo-status:${id}`,label,sx+i*(statusW+7),statusY,statusW,35,m.rule.memoStatus===id);
        h.text(m.rule.memoEdge?edgeLabel(m.rule.memoEdge):'그림에서 기록할 선로를 고르세요',sx,split?y+253:y+p.h-93,11,muted,500,'left',sw);
        const bw=(sw-8)/2,by=split?y+p.h-60:y+p.h-59;
        h.button('memo-delete','이 기록 삭제',sx,by,bw,40,false,m.session.busy||!v.selfMemos?.[m.rule.memoSlot]);h.button('memo-save','기록 저장',sx+bw+8,by,bw,40,true,m.session.busy||!m.rule.memoEdge||count===0);
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
