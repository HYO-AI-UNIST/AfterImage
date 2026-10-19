import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.AFTERIMAGE_URL ?? 'http://127.0.0.1:7777';
const output = new URL('../outputs/qa/victory-coins/', import.meta.url);
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true});
const api = await browser.newContext();
const errors=[];
const results=[];
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=16000) { const start=Date.now(); while(Date.now()-start<timeout) {if(await check()) return; await pause(100);} throw new Error(`Timed out: ${label}`); }
async function request(method,path,data,token,status=200) {
  const response=await api.request[method](`${base}${path}`,{...(data?{data}:{}),...(token?{headers:{Authorization:`Bearer ${token}`}}:{})});
  assert.equal(response.status(),status,`${method} ${path} expected HTTP ${status}`);
  return response.json();
}
async function get(s) {return (await request('get',`/api/rooms/${s.code}`,undefined,s.token)).view;}
async function act(s,action) {return request('post',`/api/rooms/${s.code}/actions`,{revision:(await get(s)).revision,action},s.token);}
async function pageFor(session,width=390,height=844) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<600,isMobile:width<600});
  if(session) await context.addInitScript(value=>localStorage.setItem('mindminer.membership.v1',JSON.stringify(value)),session);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('main[data-hydrated="true"]').waitFor();return page;
}
async function noOverflow(page) {assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');}
try {
  const demo=await pageFor(undefined,320,568);
  await demo.getByRole('button',{name:/혼자 연습하기/}).click();
  await demo.getByTestId('victory-wallet').waitFor();
  assert.match(await demo.getByTestId('victory-wallet').getAttribute('aria-label'),/3개/);
  for(let seat=0;seat<6;seat++) assert.match(await demo.getByTestId(`victory-coins-${seat}`).getAttribute('aria-label'),/승점 코인 3개/);
  await demo.getByTestId('confirm-placement').click();
  await demo.getByTestId('board-choice').waitFor();
  assert.equal(await demo.getByTestId('board-choice').getByText('승점 코인',{exact:false}).count(),6);
  await noOverflow(demo);
  await demo.screenshot({path:new URL('demo-start-320-dark.png',output).pathname,fullPage:true});
  await demo.context().close();
  results.push('Demo starts six players at three victory coins; hints and victory wallet shown separately, 320px layout.');

  const created=await request('post','/api/rooms',{name:'코인확인1'},undefined,201);
  const sessions=[{code:created.view.code,token:created.token}];
  assert.equal(created.view.scoringMode,'transfer');assert.equal(created.view.players[0].score,3);
  await act(sessions[0],{type:'settings',settings:{playerCount:3,hintCoins:3,totalRounds:5,gridSize:3}});
  for(let i=1;i<4;i++){const joined=await request('post',`/api/rooms/${created.view.code}/join`,{name:`코인확인${i+1}`},undefined,201);sessions.push({code:created.view.code,token:joined.token});}
  const start=(await act(sessions[0],{type:'start'})).view.activeSeat;
  const seatA=start,seatB=(start+1)%3,seatC=(start+2)%3;
  const page=await pageFor(sessions[seatA]);
  const watcher=await pageFor(sessions[3],1440,1000);
  const makerPage=await pageFor(sessions[seatC],320,700);
  const balances=[3,3,3];
  for(let round=1;round<=5;round++){
    const preparation=await get(sessions[0]);
    assert.equal(preparation.placementMode,'retained');
    assert.deepEqual(preparation.rebuildSeats,round===1?[0,1,2]:round===5?[]:[seatC]);
    for(let seat=0;seat<3;seat++){
      const privateView=await get(sessions[seat]);
      const rebuild=preparation.rebuildSeats.includes(seat);
      assert.equal('ownMines' in privateView,rebuild,'only rebuild maker can reopen their board');
      if(rebuild&&round>1)assert.deepEqual(privateView.ownMines,['2-0~3-0'],'rebuild begins with previous layout');
      await act(sessions[seat],{type:'chooseRole',role:seat===seatA||seat===seatB&&round>1?'illuminator':'trapper'});
    }
    if(round===2||round===5){
      await page.getByTestId('retained-board').waitFor();
      assert.equal(await page.getByTestId('confirm-placement').count(),0);
      assert.equal(await page.locator('.edge-mined').count(),0);
      await noOverflow(page);
      await page.screenshot({path:new URL(`retained-round-${round}-mobile-dark.png`,output).pathname,fullPage:true});
      await page.reload();await page.getByTestId('retained-board').waitFor();
      if(round===2){
        await makerPage.getByTestId('confirm-placement').waitFor();
        assert.equal(await makerPage.locator('.edge-mined').count(),1,'eligible maker sees previous layout');
        await noOverflow(makerPage);
        await makerPage.screenshot({path:new URL('rebuild-maker-320-dark.png',output).pathname,fullPage:true});
        // Hidden-board editing is denied by the server, even outside the UI.
        const denied=await request('post',`/api/rooms/${preparation.code}/actions`,{revision:(await get(sessions[seatA])).revision,action:{type:'place',mines:[]}},sessions[seatA].token,409);
        assert.ok(denied.error);
      } else {
        await makerPage.getByTestId('retained-board').waitFor();
        assert.equal(await makerPage.getByTestId('confirm-placement').count(),0,'zero coin transfer grants no rebuild');
      }
    }
    for(let seat=0;seat<3;seat++){
      if(preparation.rebuildSeats.includes(seat)){
        if(round===2&&seat===seatC){await makerPage.getByTestId('confirm-placement').click();await until(async()=>(await get(sessions[seat])).players[seat].ready,'maker confirms retained draft');}
        else await act(sessions[seat],{type:'place',mines:['2-0~3-0'],...(round===1&&seat===seatB?{concealed:['1-0~2-0']}:{})});
      }else if(seat===seatA){
        await page.getByTestId('confirm-ready').click();
        await until(async()=>(await get(sessions[seat])).players[seat].ready,'retained player ready via mobile UI');
      }else await act(sessions[seat],{type:'ready'});
    }
    let state=await get(sessions[0]);assert.deepEqual(state.players.map(p=>p.score),balances,'balances persist to next round');
    if(state.activeSeat===seatC){
      await act(sessions[seatC],{type:'chooseBoard',ownerSeat:seatB});
      if(round===3){const hint=await act(sessions[seatC],{type:'hint',edgeId:'1-0~2-0'});assert.equal(hint.privateResult.mined,null,'retained concealment survives changing away from trapper');}
      await act(sessions[seatC],{type:'spawn',nodeId:'3-0'});
      await act(sessions[seatC],{type:'move',nodeId:'2-0'});
      await until(async()=>!(await get(sessions[0])).event,'maker failed turn finishes');
      state=await get(sessions[0]);
    }
    const actor=state.activeSeat;assert.notEqual(actor,seatC);
    if(round===4){
      await page.getByTestId('board-choice').waitFor();
      assert.match(await page.getByTestId(`choose-board-${seatC}`).innerText(),/승점 코인 0개/);
    }
    await act(sessions[actor],{type:'chooseBoard',ownerSeat:seatC});
    if(round===1){
      assert.equal((await get(sessions[actor])).players[actor].coins,5);
      await act(sessions[actor],{type:'hint',edgeId:'2-0~3-0'});
      const afterHint=await get(sessions[actor]);assert.equal(afterHint.players[actor].score,3);assert.equal(afterHint.players[actor].coins,4);
    }
    await act(sessions[actor],{type:'spawn',nodeId:'3-3'});
    for(const nodeId of ['2-2','1-1','0-0']){await act(sessions[actor],{type:'move',nodeId});await until(async()=>!(await get(sessions[0])).event,'safe move ends');}
    const result=await get(sessions[actor]);
    const amount=round>=4?0:1;
    balances[actor]+=amount;balances[seatC]-=amount;
    assert.deepEqual(Object.keys(result.revealedBoards).sort(),(round===5?result.players.map(p=>p.id):[result.players[seatC].id]).sort(),'only completed board is revealed until game ends');
    assert.deepEqual(Object.keys((await get(sessions[3])).revealedBoards).sort(),Object.keys(result.revealedBoards).sort(),'spectator receives same limited answers');
    assert.equal(result.winner.ownerSeat,seatC);assert.equal(result.winner.coinsTransferred,amount);assert.equal('remainingCoins' in result.winner,false);
    assert.deepEqual(result.players.map(p=>p.score),balances);
    assert.equal(result.players.reduce((sum,p)=>sum+p.score,0),9);
    assert.ok(result.players.every(p=>p.score>=0));
    await until(async()=>await page.getByTestId('coin-transfer').getAttribute('data-amount')===String(amount),'coin transfer result rendered');
    await until(async()=>await watcher.getByTestId('coin-transfer').getAttribute('data-amount')===String(amount),'spectator sees public transfer');
    assert.equal(await page.locator('.score-equation').count(),0,'legacy hint bonus equation absent');
    for(let seat=0;seat<3;seat++)assert.match(await page.getByTestId(`balance-${seat}`).getAttribute('aria-label'),new RegExp(`승점 코인 ${balances[seat]}개`));
    await noOverflow(page);
    if(round===1){
      await page.screenshot({path:new URL('transfer-mobile-dark.png',output).pathname,fullPage:true});
      await watcher.getByRole('button',{name:'라이트 모드',exact:true}).click();
      await watcher.screenshot({path:new URL('transfer-desktop-light.png',output).pathname,fullPage:true});
      await page.reload();await page.getByTestId('coin-transfer').waitFor();assert.equal((await get(sessions[actor])).players[actor].score,4);
    }
    if(round<5){await act(sessions[0],{type:'nextRound'});await until(async()=>await page.locator('main').getAttribute('data-phase')==='placing','next round visible');}
    else{
      assert.deepEqual(result.champions,[seatA]);assert.equal(result.winner.seat,seatA);assert.equal(result.players[seatA].score,5);assert.equal(result.players[seatC].score,0);
      assert.match(await page.getByTestId('coin-transfer').innerText(),/코인 이동 없이/);
      await page.screenshot({path:new URL('zero-maker-final-mobile-dark.png',output).pathname,fullPage:true});
    }
  }
  await act(sessions[0],{type:'restart'});
  const restarted=await get(sessions[0]);assert.equal(restarted.phase,'waiting');assert.deepEqual(restarted.players.map(p=>p.score),[3,3,3]);
  results.push('Five live rounds: actual selected maker pays one, balances persist, hint use and illuminator bonus never score, maker reaches zero, fourth/fifth rounds transfer zero with no rebuild, retained layouts and concealed safe edges persist across ability changes, maker-only editable UI and API, limited round reveal/full final reveal, richest wins, public results/reload, restart returns everyone to three.');
  assert.deepEqual(errors,[]);
  await writeFile(new URL('results.json',output),JSON.stringify({results,errors},null,2));
  console.log(results.join('\n'));
}finally{await browser.close();}
