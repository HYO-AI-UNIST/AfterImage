import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base=process.env.MINDMINER_URL||'http://127.0.0.1:5173';
const output=new URL('../outputs/qa/newrule/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],roles=['illuminator','guardian','trapper','thief','shifter','recorder'];
const filter=process.env.MINDMINER_ROLE;
let activePage;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function control(page,id){
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){
        const hit=await page.locator('canvas').evaluate((c,id)=>JSON.parse(c.dataset.controls||'[]').find(r=>r.id===id),id);
        if(hit){await page.mouse.click(hit.x+hit.w/2,hit.y+hit.h/2);return;}
        await page.waitForTimeout(80);
    }
    throw new Error(`Missing enabled canvas control ${id}`);
}
async function phase(page,value){await page.locator(`canvas[data-phase="${value}"]`).waitFor({timeout:45000});}
async function overlay(page,value){await page.locator(`canvas[data-overlay="${value}"]`).waitFor({timeout:45000});}
async function point(page,id){await page.waitForFunction(id=>JSON.parse(document.querySelector('canvas').dataset.nodes||'{}')[id],id);return page.locator('canvas').evaluate((c,id)=>JSON.parse(c.dataset.nodes)[id],id);}
async function edge(page,id){await page.waitForFunction(()=>document.querySelector('canvas').dataset.cinematic==='');const[a,b]=id.split('~');await point(page,a);const[p,q]=await page.locator('canvas').evaluate((c,ids)=>{const nodes=JSON.parse(c.dataset.nodes);return ids.map(id=>nodes[id]);},[a,b]);await page.mouse.click((p.x+q.x)/2,(p.y+q.y)/2);}
async function shot(page,name){await page.screenshot({path:new URL(`${name}.png`,output).pathname});}
async function stateWhen(f,predicate){const until=Date.now()+15000;while(Date.now()<until){const v=await f.view(f.actor);if(predicate(v))return v;await sleep(80);}throw new Error('State update timed out');}
async function json(context,path,body,token){
    const response=await context.request[body===undefined?'get':'post'](base+path,{headers:{Origin:base,...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{data:body})});
    const reply=await response.json();assert.ok(response.ok(),`${path}: ${response.status()} ${JSON.stringify(reply)}`);return reply;
}
async function fixture(role,grid=4,rounds=2){
    const context=await browser.newContext({viewport:{width:1280,height:900},locale:'ko-KR'});
    const host=await json(context,'/api/rooms',{name:'검증 방장'}),code=host.view.code,members=[host];
    for(let i=1;i<6;i++)members.push(await json(context,`/api/rooms/${code}/join`,{name:`검증 광부${i+1}`}));
    const view=async(seat=0)=>(await json(context,`/api/rooms/${code}`,undefined,members[seat].token)).view;
    const act=async(seat,action)=>{const v=await view(seat);return json(context,`/api/rooms/${code}/actions`,{action,revision:v.revision},members[seat].token);};
    await act(0,{type:'settings',settings:{playerCount:6,hintCoins:3,totalRounds:rounds,gridSize:grid}});
    const started=(await act(0,{type:'start'})).view,actor=started.activeSeat,owner=(actor+1)%6,mine=`${grid-1}-0~${grid}-0`;
    const concealed='0-0~1-0';
    for(let i=0;i<6;i++)if(i!==actor){
        await act(i,{type:'chooseRole',role:i===owner?'trapper':'illuminator'});
        await act(i,{type:'place',mines:[mine],concealed:i===owner?[concealed]:[]});
    }
    const page=await context.newPage();activePage=page;
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('response',r=>{if(r.url().includes('/game/')&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    await page.addInitScript(({code,token})=>{
        localStorage.setItem('mindminer.membership.v1',JSON.stringify({code,token}));
        window.frameTexts=[];const proto=CanvasRenderingContext2D.prototype,clear=proto.clearRect,text=proto.fillText;
        proto.clearRect=function(...args){window.frameTexts=[];return clear.apply(this,args);};
        proto.fillText=function(value,...args){window.frameTexts.push(String(value));return text.call(this,value,...args);};
    },{code,token:members[actor].token});
    await page.goto(base);await page.locator('canvas[data-ready="true"]').waitFor({timeout:60000});await phase(page,'placing');await overlay(page,'roles');
    assert.equal(await page.locator('button,h1,[role="button"]').count(),0,'Visual UI remains raster-only');
    for(let i=0;i<roles.indexOf(role);i++)await control(page,'role-next');
    if(role==='illuminator'){
        await control(page,'role-guide');await overlay(page,'help');
        assert.equal(await page.locator('canvas').evaluate(c=>c.dataset.guidePage),'9');
        await control(page,'close');await overlay(page,'roles');
    }
    await control(page,'role-confirm');await overlay(page,'');
    await page.waitForTimeout(1000);
    assert.equal((await view(actor)).players[actor].role,role);
    await page.waitForFunction(n=>Object.keys(JSON.parse(document.querySelector('canvas').dataset.nodes||'{}')).length===(n+1)*(n+2)/2,grid);
    await edge(page,mine);
    if(role==='trapper'){
        await control(page,'tool');await edge(page,concealed);await control(page,'tool');
    }
    await control(page,'ready');await phase(page,'playing');
    await shot(page,`${role}-board-choice`);
    if(role==='thief'){
        await act(owner,{type:'memo',slot:0,entry:{boardOwnerId:members[actor].view.selfId,edgeId:concealed,status:'mine'}});
        await control(page,'peek');await control(page,`peek-target:${members[owner].view.selfId}:0`);await control(page,'peek-confirm');await overlay(page,'peek-result');
        assert.equal((await view(actor)).players[actor].peeks,1);await shot(page,'thief-before-board');await control(page,'close');
    }
    await control(page,`board:${owner}`);
    await page.waitForFunction(()=>document.querySelector('canvas').dataset.cinematic==='');
    await control(page,'hint');await control(page,'hint');
    await page.waitForFunction(()=>document.querySelector('canvas').dataset.inputMode==='movement');
    await page.waitForTimeout(450);
    assert.equal((await view(actor)).players[actor].coins,role==='illuminator'?5:3,'Canceling a hint is free');
    return{context,page,code,members,actor,owner,mine,concealed,view,act,grid};
}
async function explode(f,seat=f.actor){
    await f.act(seat,{type:'spawn',nodeId:`${f.grid}-0`});
    const result=await f.act(seat,{type:'move',nodeId:`${f.grid-1}-0`});
    assert.equal(result.view.event.type,'explosion');
    await sleep(Math.max(0,result.view.event.until-Date.now()+80));return f.view(seat);
}
async function escape(f,seat=f.actor){
    await f.act(seat,{type:'spawn',nodeId:`${f.grid}-${f.grid}`});
    for(let row=f.grid-1;row>=0;row--){await f.act(seat,{type:'move',nodeId:`${row}-${row}`});if(row)await sleep(680);}
}
try{
    if(!filter||filter==='illuminator'){
    const light=await fixture('illuminator');
    await control(light.page,'hint');await edge(light.page,light.concealed);await overlay(light.page,'hint');
    await light.page.waitForFunction(()=>window.frameTexts.includes('판독 불가'));
    assert.equal((await light.view(light.actor)).players[light.actor].coins,4);
    await shot(light.page,'concealed-private-hint');await control(light.page,'close');
    await light.page.waitForFunction(()=>!window.frameTexts.includes('판독 불가'));
    await escape(light);await phase(light.page,'roundEnd');
    const won=await light.view(light.actor);assert.equal(won.players[light.actor].score,4);assert.equal(won.players[light.owner].score,2);assert.equal(won.players.reduce((n,p)=>n+p.score,0),18);assert.deepEqual(Object.keys(won.revealedBoards),[won.players[light.owner].id]);
    await light.page.waitForTimeout(2700);await shot(light.page,'victory-transfer');
    await light.page.setViewportSize({width:844,height:390});await light.page.waitForTimeout(700);await shot(light.page,'victory-landscape');
    await light.page.setViewportSize({width:390,height:844});await light.page.waitForTimeout(700);await shot(light.page,'victory-mobile');
    await light.page.setViewportSize({width:1280,height:900});await light.page.waitForTimeout(700);
    await control(light.page,'reveal');await overlay(light.page,'reveal');await shot(light.page,'round-reveal');await control(light.page,'close');
    await light.act(0,{type:'nextRound'});await phase(light.page,'placing');await overlay(light.page,'roles');
    const retained=await light.view(light.actor);assert.equal('ownMines'in retained,false);assert.deepEqual(retained.rebuildSeats,[light.owner]);
    await control(light.page,'role-confirm');await control(light.page,'ready');assert.equal((await stateWhen(light,v=>v.players[light.actor].ready)).players[light.actor].ready,true);
    for(let i=0;i<6;i++)if(i!==light.actor){await light.act(i,{type:'chooseRole',role:'illuminator'});await light.act(i,i===light.owner?{type:'place',mines:[]}:{type:'ready'});}
    const next=await light.view(),actor2=next.activeSeat,owner2=(actor2+1)%6;await light.act(actor2,{type:'chooseBoard',ownerSeat:owner2});await escape(light,actor2);await phase(light.page,'finished');assert.equal(Object.keys((await light.view()).revealedBoards).length,6);
    await light.act(0,{type:'restart'});await phase(light.page,'waiting');assert.ok((await light.view()).players.every(p=>p.score===3));
    await light.context.close();console.log('PASS board choice, illuminator, unreadable hint, coin transfer, retained boards, reveals and online restart.');
    }

    if(!filter||filter==='guardian'){
    const guard=await fixture('guardian');await explode(guard);await control(guard.page,'bless-use');
    const protectedView=await stateWhen(guard,v=>v.players[guard.actor].blessings===1);assert.equal(protectedView.activeSeat,guard.actor);assert.equal(protectedView.boardOwnerSeat,guard.owner);assert.equal(protectedView.position,null);
    await shot(guard.page,'guardian-return');await guard.context.close();console.log('PASS guardian same-board same-turn return.');
    }

    if(!filter||filter==='trapper'){
    const trap=await fixture('trapper');let v=await explode(trap),other=v.activeSeat;await trap.act(other,{type:'chooseBoard',ownerSeat:trap.actor});const answer=await trap.act(other,{type:'hint',edgeId:trap.concealed});assert.equal(answer.privateResult.mined,null);await trap.context.close();console.log('PASS trapper placement tool and charged unreadable hint.');
    }

    for(const role of ['thief','recorder']){
        if(filter&&filter!==role)continue;
        const f=await fixture(role);assert.equal((await f.view(f.actor)).memoCapacity,role==='recorder'?4:2);
        await control(f.page,'memos');await control(f.page,'memo-edge:0-0~1-0');await control(f.page,'memo-status:safe');await control(f.page,'memo-save');
        assert.equal((await stateWhen(f,v=>v.selfMemos[0]?.status==='safe')).selfMemos[0].status,'safe');await shot(f.page,`${role}-memo`);await control(f.page,'close');
        const memoReply=await f.act(f.owner,{type:'memo',slot:0,entry:{boardOwnerId:f.members[f.actor].view.selfId,edgeId:f.concealed,status:'mine'}});
        await f.page.waitForFunction(revision=>Number(document.querySelector('canvas').dataset.revision)>=revision,memoReply.view.revision);
        if(role==='thief'){
            await control(f.page,'peek');await control(f.page,`peek-target:${f.members[f.owner].view.selfId}:0`);await control(f.page,'peek-confirm');await overlay(f.page,'peek-result');assert.equal((await f.view(f.actor)).players[f.actor].peeks,0);await shot(f.page,'thief-peek');await control(f.page,'close');
        }
        await f.page.setViewportSize({width:390,height:844});await f.page.waitForTimeout(700);await control(f.page,'memos');await overlay(f.page,'memos');await shot(f.page,`${role}-mobile`);await control(f.page,'close');
        await f.context.close();console.log(`PASS ${role}: manual private notes, out-of-turn writes and mobile HUD.`);
    }

    if(!filter||filter==='shifter'){
    const shift=await fixture('shifter');let v2=await explode(shift);
    for(let i=0;i<5;i++){const seat=v2.activeSeat;await shift.act(seat,{type:'chooseBoard',ownerSeat:(seat+1)%6});v2=await explode(shift,seat);}
    assert.equal(v2.shiftSeat,shift.actor);await phase(shift.page,'playing');await control(shift.page,'shift-skip'); // free skip, then choice is mandatory.
    assert.equal((await shift.view(shift.actor)).players[shift.actor].shifts,7);await control(shift.page,`board:${shift.owner}`);await shift.page.waitForFunction(()=>document.querySelector('canvas').dataset.cinematic==='');
    v2=await explode(shift);for(let i=0;i<5;i++){const seat=v2.activeSeat;await shift.act(seat,{type:'chooseBoard',ownerSeat:(seat+1)%6});v2=await explode(shift,seat);}
    await shift.page.waitForFunction(()=>JSON.parse(document.querySelector('canvas').dataset.controls||'[]').some(r=>r.id==='shift-skip'));
    await edge(shift.page,shift.mine);await edge(shift.page,'3-1~4-1');await control(shift.page,'shift-confirm');
    const shifted=await stateWhen(shift,v=>v.players[shift.actor].shifts===6&&v.shiftSeat===undefined);
    assert.equal(shifted.boardOwnerSeat,-1);await shot(shift.page,'shifter-after-move');
    await shift.context.close();console.log('PASS shifter personal-turn gate, private decision and free skip.');
    }

    if(!filter||filter==='lobby'){
        const context=await browser.newContext({viewport:{width:1280,height:900},locale:'ko-KR'}),host=await json(context,'/api/rooms',{name:'설정 검증'}),code=host.view.code,members=[host];
        for(let i=1;i<6;i++)members.push(await json(context,`/api/rooms/${code}/join`,{name:`대기 광부${i}`}));
        const view=async(seat=0)=>(await json(context,`/api/rooms/${code}`,undefined,members[seat].token)).view;
        const act=async(seat,action)=>{const v=await view(seat);return json(context,`/api/rooms/${code}/actions`,{action,revision:v.revision},members[seat].token);};
        const page=await context.newPage();activePage=page;page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(({code,token})=>localStorage.setItem('mindminer.membership.v1',JSON.stringify({code,token})),{code,token:host.token});
        await page.goto(base);await page.locator('canvas[data-ready="true"]').waitFor({timeout:60000});await phase(page,'waiting');
        await control(page,'settings');for(let i=0;i<4;i++)await control(page,'setting:playerCount:-1');for(let i=0;i<3;i++)await control(page,'setting:hintCoins:-1');for(let i=0;i<6;i++)await control(page,'setting:totalRounds:-1');for(let i=0;i<2;i++)await control(page,'setting:gridSize:1');
        await shot(page,'room-settings');await control(page,'settings-apply');await overlay(page,'');
        const configured=await view();assert.equal(configured.playerCount,2);assert.equal(configured.gridSize,6);assert.equal(configured.hintCoins,0);assert.equal(configured.spectators.length,4);
        await page.setViewportSize({width:390,height:844});await page.waitForTimeout(700);await control(page,'roster');await overlay(page,'roster');await shot(page,'roster-mobile');
        await control(page,`seat:${members[1].view.selfId}:0`);await stateWhen({actor:0,view},v=>v.players.length===1);await control(page,`seat:${members[2].view.selfId}:1`);await stateWhen({actor:0,view},v=>v.players.length===2);
        assert.equal((await view()).players[1].id,members[2].view.selfId);await control(page,'close');await shot(page,'lobby-mobile');
        await control(page,'start');await phase(page,'placing');await overlay(page,'roles');
        for(let i=0;i<4;i++)await control(page,'role-next');
        await control(page,'role-confirm');await control(page,'ready');
        assert.equal((await stateWhen({actor:0,view},v=>v.players[0].ready)).players[0].role,'illuminator','Two-player gallery cycles through exactly four eligible roles');
        await act(2,{type:'chooseRole',role:'guardian'});await act(2,{type:'place',mines:[]});await phase(page,'playing');
        const playing=await view(),actor=playing.activeSeat,owner=1-actor,actorToken=actor===0?0:2;
        if(actor===0)await control(page,'board:1');else await act(actorToken,{type:'chooseBoard',ownerSeat:owner});
        assert.equal((await view()).players[0].coins,2,'Zero base hints still allow illuminator +2');
        const selected=await view();await page.waitForFunction(revision=>Number(document.querySelector('canvas').dataset.revision)>=revision,selected.revision);
        await page.waitForTimeout(350);await page.waitForFunction(()=>document.querySelector('canvas').dataset.cinematic==='');
        await page.waitForFunction(()=>Object.keys(JSON.parse(document.querySelector('canvas').dataset.nodes||'{}')).length===28);await shot(page,'two-player-grid6-mobile');
        const guest=await json(context,`/api/rooms/${code}/join`,{name:'관전자'}),audience=await browser.newContext({viewport:{width:844,height:390}}),watch=await audience.newPage();activePage=watch;watch.on('pageerror',e=>errors.push(e.message));
        await watch.addInitScript(({code,token})=>localStorage.setItem('mindminer.membership.v1',JSON.stringify({code,token})),{code,token:guest.token});
        await watch.goto(base);await watch.locator('canvas[data-ready="true"]').waitFor({timeout:60000});await phase(watch,'playing');
        assert.equal(await watch.locator('canvas').evaluate(c=>JSON.parse(c.dataset.controls||'[]').some(r=>['ready','hint','memos'].includes(r.id)||r.id.startsWith('board:'))),false);
        await shot(watch,'spectator-landscape');await audience.close();await context.close();console.log('PASS settings, capacity, seat demotion/promotion, zero hints, two-player role restrictions and spectator HUD.');
    }
    if(!filter||filter==='grid')
    for(const grid of [3,5,6]){
        const f=await fixture('illuminator',grid,1);await shot(f.page,`grid-${grid}`);
        await f.context.close();console.log(`PASS ${grid}-division Blender map and synchronized node geometry.`);
    }
    assert.deepEqual(errors,[]);console.log('PASS no JS, shader or game-asset errors.');
}catch(error){if(activePage&&!activePage.isClosed()){await shot(activePage,'failure').catch(()=>{});console.error(await activePage.locator('canvas').evaluate(c=>({phase:c.dataset.phase,overlay:c.dataset.overlay,event:c.dataset.event,cinematic:c.dataset.cinematic,controls:c.dataset.controls})).catch(()=>null));}throw error;}
finally{await browser.close();}
