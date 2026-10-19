import type { HudModel, Overlay } from './hud';
import type { MemoEntry, MemoStatus, RoomSettings } from '../contracts';
import { canRebuildBoard, randomBoard } from '../game';
import { availableRoles, baseMemoSlots, ROLE_DETAILS } from '../roles';
import { ROOM_SETTING_LIMITS } from '../settings';
import { turnKey } from './rule-ui';
import { GUIDE_PAGES } from './guide';
import { playAbility } from './presentation';

export function loadMemo(m: HudModel, slot: number) {
    const v=m.session.view!,note=v.selfMemos?.[slot];
    m.rule.memoSlot=slot;m.rule.memoOwner=note?v.players.find(p=>p.id===note.boardOwnerId)?.seat??0:Math.max(0,v.boardOwnerSeat);
    m.rule.memoEdge=note?.edgeId??null;m.rule.memoStatus=note?.status??'unsure';m.rule.memoNode=null;
}
async function recordMemo(m:HudModel,entry:MemoEntry|null){
    const scope=m.session.view;if(!scope)return;
    const slot=m.rule.memoSlot,owner=m.rule.memoOwner;
    while(m.session.busy)await m.session.whenIdle();
    const v=m.session.view;if(!v||v.code!==scope.code||v.round!==scope.round||v.selfId!==scope.selfId||v.phase!=='playing')return;
    const previous=v.selfMemos?.[slot]??null;
    const reply=await m.session.act({type:'memo',slot,entry});
    if(reply&&m.session.view?.code===v.code&&m.session.view?.round===v.round&&m.session.view?.selfId===v.selfId){
        m.rule.memoUndo={slot,entry:previous};if(m.rule.memoSlot===slot){loadMemo(m,slot);if(!entry)m.rule.memoOwner=owner;}playAbility(m,'memo','');
    }
}

export async function ruleAction(id:string,m:HudModel,close:()=>void,toast:(s:string)=>void):Promise<boolean>{
    const v=m.session.view,self=m.session.self;if(!v)return false;
    const r=m.rule,act=m.session.act.bind(m.session);
    if(id==='role-guide'){m.guidePage=Math.max(0,GUIDE_PAGES.findIndex(page=>page.id===r.role));m.guideScroll=0;r.guideReturn=true;m.overlay='help';m.focus=null;return true;}
    if(id.startsWith('player-role:')){
        const role=v.players[Number(id.slice(12))]?.role;
        if(role){r.role=role;m.overlay='roles';m.focus=null;}return true;
    }
    if(['roles','settings','roster','memos','peek','reveal'].includes(id)){
        if(id==='roles')r.role=self?.role??availableRoles(v.playerCount)[0];
        if(id==='settings')r.settings={playerCount:v.playerCount,hintCoins:v.hintCoins,totalRounds:v.totalRounds,gridSize:v.gridSize};
        if(id==='memos'){if(!v.memoCapacity||v.phase!=='playing')return true;loadMemo(m,0);}
        if(id==='peek'){r.peekTargets=[];r.peekResult=null;}
        if(id==='reveal')r.revealSeat=v.players.find(p=>v.revealedBoards&&Object.hasOwn(v.revealedBoards,p.id))?.seat??0;
        r.rosterPage=0;m.focus=null;m.overlay=id as Overlay;return true;
    }
    if(id==='role-prev'||id==='role-next'){
        if(m.session.busy)return true;
        const ids=availableRoles(v.playerCount),i=ids.indexOf(r.role);r.role=ids[(i+(id==='role-next'?1:-1)+ids.length)%ids.length];m.focus=null;return true;
    }
    if(id.startsWith('role-preview:')){if(m.session.busy)return true;const role=id.slice(13);if(availableRoles(v.playerCount).some(r=>r===role))r.role=role as typeof r.role;m.focus=null;return true;}
    if(id==='role-confirm'){
        if(v.phase!=='placing'||!self||self.role||self.ready)return true;
        const chosen=r.role,reply=await act({type:'chooseRole',role:chosen});
        if(reply){if(chosen!=='trapper'&&self&&canRebuildBoard(v,self.seat))r.concealed=[];r.tool='mine';close();playAbility(m,chosen,ROLE_DETAILS[chosen].name);}return true;
    }
    if(id==='tool'){r.tool=r.tool==='mine'?'conceal':'mine';return true;}
    if(id==='ready'){
        if(!self)return true;
        await act(canRebuildBoard(v,self.seat)?{type:'place',mines:m.draft,concealed:self.role==='trapper'?r.concealed:[]}:{type:'ready'});return true;
    }
    if(id==='random'||id==='clear'){
        if(v.phase!=='placing'||!self||self.ready||v.rolesEnabled&&!self.role||!canRebuildBoard(v,self.seat)||m.session.blocked)return true;
        if(id==='clear'&&r.tool==='conceal')r.concealed=[];
        else m.draft=id==='clear'?[]:randomBoard(Math.random,v.gridSize);return true;
    }
    if(id.startsWith('board:')){await act({type:'chooseBoard',ownerSeat:Number(id.slice(6))});return true;}
    if(id==='bless-use'||id==='bless-skip'){await act({type:'blessing',use:id==='bless-use'});return true;}
    if(id==='shift-undo'){if(r.shiftTo)r.shiftTo=null;else r.shiftFrom=null;return true;}
    if(id==='shift-skip'||id==='shift-confirm'){
        await act(id==='shift-skip'?{type:'shiftMine'}:{type:'shiftMine',fromEdgeId:r.shiftFrom??undefined,toEdgeId:r.shiftTo??undefined});return true;
    }
    if(id.startsWith('setting:')){
        const [,field,delta]=id.split(':'),key=field as keyof RoomSettings,limit=ROOM_SETTING_LIMITS[key];
        if(limit)r.settings[key]=Math.min(limit.max,Math.max(limit.min,r.settings[key]+Number(delta)));return true;
    }
    if(id==='settings-apply'){if(await act({type:'settings',settings:r.settings}))close();return true;}
    if(id.startsWith('seat:')){const [,playerId,seated]=id.split(':');await act({type:'seat',playerId,seated:seated==='1'});return true;}
    if(id==='roster-prev'||id==='roster-next'){r.rosterPage=Math.max(0,r.rosterPage+(id==='roster-prev'?-1:1));return true;}
    if(id.startsWith('memo-slot:')){loadMemo(m,Number(id.slice(10)));return true;}
    if(id==='memo-owner-page'){r.memoOwner=(r.memoOwner+3)%v.playerCount;r.memoEdge=null;r.memoNode=null;return true;}
    if(id.startsWith('memo-owner:')){r.memoOwner=Number(id.slice(11));r.memoEdge=null;r.memoNode=null;return true;}
    if(id==='memo-owner-prev'||id==='memo-owner-next'){r.memoOwner=(r.memoOwner+(id==='memo-owner-prev'?-1:1)+v.playerCount)%v.playerCount;r.memoEdge=null;return true;}
    if(id.startsWith('memo-edge:')){r.memoEdge=id.slice(10);r.memoNode=null;const owner=v.players[r.memoOwner];if(owner)await recordMemo(m,{boardOwnerId:owner.id,edgeId:r.memoEdge,status:r.memoStatus});return true;}
    if(id.startsWith('memo-status:')){r.memoStatus=id.slice(12) as MemoStatus;const owner=v.players[r.memoOwner];if(owner&&r.memoEdge)await recordMemo(m,{boardOwnerId:owner.id,edgeId:r.memoEdge,status:r.memoStatus});return true;}
    if(id==='memo-undo'){const undo=r.memoUndo;if(undo&&await act({type:'memo',slot:undo.slot,entry:undo.entry})){r.memoUndo=null;loadMemo(m,undo.slot);}return true;}
    if(id==='memo-delete'||id==='memo-save'){
        const owner=v.players[r.memoOwner];if(!owner||id==='memo-save'&&!r.memoEdge)return true;
        await recordMemo(m,id==='memo-delete'?null:{boardOwnerId:owner.id,edgeId:r.memoEdge!,status:r.memoStatus});return true;
    }
    if(id.startsWith('peek-target:')){
        const [,playerId,slotText]=id.split(':'),slot=Number(slotText),exists=r.peekTargets.some(t=>t.playerId===playerId&&t.slot===slot);
        if(exists)r.peekTargets=r.peekTargets.filter(t=>t.playerId!==playerId||t.slot!==slot);
        else if(r.peekTargets.length<baseMemoSlots(v.playerCount))r.peekTargets.push({playerId,slot});
        else toast(`한 번에 ${baseMemoSlots(v.playerCount)}개까지 고를 수 있어요.`);return true;
    }
    if(id==='peek-confirm'){
        const key=turnKey(v),reply=await act({type:'peek',targets:r.peekTargets});
        if(reply?.peekResult&&turnKey(m.session.view)===key&&m.session.ownTurn){r.peekResult=reply.peekResult;m.overlay='peek-result';m.focus=null;playAbility(m,'thief','타인의 기억');}return true;
    }
    if(id==='reveal-prev'||id==='reveal-next'){
        const list=v.players.filter(p=>v.revealedBoards&&Object.hasOwn(v.revealedBoards,p.id)),i=list.findIndex(p=>p.seat===r.revealSeat);
        r.revealSeat=list[(i+(id==='reveal-next'?1:-1)+list.length)%list.length]?.seat??0;return true;
    }
    return false;
}
