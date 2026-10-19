import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.AFTERIMAGE_URL ?? 'http://127.0.0.1:7777';
const output = new URL('../outputs/qa/board-choice/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const api = await browser.newContext();
const errors = [];
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await pause(100); }
  throw new Error(`Timed out: ${label}`);
}
async function request(method, path, data, token, status = 200) {
  const response = await api.request[method](`${base}${path}`, { ...(data ? {data} : {}), ...(token ? {headers: {Authorization: `Bearer ${token}`}} : {}) });
  assert.equal(response.status(), status, `${method} ${path} expected HTTP ${status}`);
  return response.json();
}
async function get(session) { return (await request('get', `/api/rooms/${session.code}`, undefined, session.token)).view; }
async function act(session, action) { return request('post', `/api/rooms/${session.code}/actions`, { revision: (await get(session)).revision, action }, session.token); }
async function pageFor(session, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? {width:390,height:844} : {width:1440,height:1000}, hasTouch:mobile, isMobile:mobile });
  if (session) await context.addInitScript(value => localStorage.setItem('mindminer.membership.v1', JSON.stringify(value)), session);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', req => { if (['script','stylesheet'].includes(req.resourceType())) errors.push(req.url()); });
  await page.goto(base);
  await page.locator('main[data-hydrated="true"]').waitFor();
  return page;
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
}
async function choose(page, session, ownerSeat) {
  const button = page.getByTestId(`choose-board-${ownerSeat}`);
  await until(() => button.isEnabled(), 'choice button enabled');
  await button.click();
  await until(async () => (await get(session)).boardOwnerSeat === ownerSeat, 'board chosen');
  await page.getByTestId('active-board').locator(`[data-owner-seat="${ownerSeat}"]`).waitFor();
}
async function explode(session) {
  await act(session, {type:'spawn',nodeId:'3-0'});
  await act(session, {type:'move',nodeId:'2-0'});
  await until(async () => !(await get(session)).event, 'explosion four-second pause ends');
}
try {
  const page = await pageFor(undefined, true);
  await page.getByRole('button',{name:/혼자 연습하기/}).click();
  await page.getByTestId('confirm-placement').waitFor();
  assert.equal(await page.getByTestId('active-board').locator('[data-owner-seat="0"]').count(),1,'own board uses seat 1 color');
  await page.getByTestId('confirm-placement').click();
  const picker=page.getByTestId('board-choice');
  await picker.waitFor();
  assert.equal(await picker.locator('button').count(),6);
  assert.equal(await page.getByTestId('choose-board-0').isDisabled(),true);
  assert.equal(await page.getByTestId('hint-button').isDisabled(),true);
  const colors = await picker.locator('button').evaluateAll(cards=>cards.map(card=>getComputedStyle(card).getPropertyValue('--seat-color').trim()));
  assert.equal(new Set(colors).size,6,'six distinct seat colors');
  await noOverflow(page);
  await page.screenshot({path:new URL('demo-choice-mobile-dark.png',output).pathname,fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:new URL('demo-choice-desktop-dark.png',output).pathname,fullPage:true});
  await page.getByRole('button', {name:'라이트 모드',exact:true}).click();
  await page.screenshot({path:new URL('demo-choice-desktop-light.png',output).pathname,fullPage:true});
  await page.getByTestId('choose-board-2').click();
  await page.getByTestId('active-board').locator('[data-owner-seat="2"]').waitFor();
  assert.equal(await picker.count(),0,'selection closes after choosing');
  assert.equal(await page.getByTestId('hint-button').isEnabled(),true);
  await page.getByRole('button',{name:'출발점 5에서 시작',exact:true}).click();
  await page.getByTestId('active-board').locator('.board-pawn').waitFor();
  await page.screenshot({path:new URL('demo-selected-desktop-light.png',output).pathname,fullPage:true});
  await page.context().close();
  results.push('Six-player demo: own-board choice disabled, five choices enabled, seat colors distinct, selected board color, actual spawn, mobile and desktop layout.');

  const created = await request('post','/api/rooms',{name:'선택확인1'},undefined,201);
  const sessions=[{code:created.view.code,token:created.token}];
  const invalid = await request('post',`/api/rooms/${created.view.code}/actions`,{revision:created.view.revision,action:{type:'settings',settings:{playerCount:7,hintCoins:3,totalRounds:2,gridSize:3}}},created.token,400);
  assert.ok(invalid.error);
  await act(sessions[0],{type:'settings',settings:{playerCount:3,hintCoins:3,totalRounds:2,gridSize:3}});
  for (let i=1;i<4;i++) { const joined=await request('post',`/api/rooms/${created.view.code}/join`,{name:`선택확인${i+1}`},undefined,201); sessions.push({code:created.view.code,token:joined.token}); }
  const start=(await act(sessions[0],{type:'start'})).view.starterSeat;
  const first=sessions[start], second=sessions[(start+1)%3], third=sessions[(start+2)%3], audience=sessions[3];
  for (let seat=0;seat<3;seat++) { await act(sessions[seat],{type:'chooseRole',role:seat===start?'guardian':seat===(start+2)%3?'shifter':'recorder'}); await act(sessions[seat],{type:'place',mines:['2-0~3-0']}); }
  const owner=(start+2)%3;
  const a=await pageFor(first,true), b=await pageFor(second), c=await pageFor(third), observer=await pageFor(audience);
  await a.getByTestId('board-choice').waitFor();
  assert.equal('activeBoardMineCount' in await get(first),false);
  assert.equal(await b.getByTestId(`choose-board-${owner}`).isDisabled(),true,'other player cannot choose');
  await choose(a,first,owner);
  await observer.getByTestId('active-board').locator(`[data-owner-seat="${owner}"]`).waitFor();
  assert.equal((await get(audience)).activeBoardMineCount,1);
  assert.equal('ownMines' in await get(audience),false);
  await a.screenshot({path:new URL('online-selected-mobile-dark.png',output).pathname,fullPage:true});
  await explode(first);
  assert.equal((await get(first)).blessingSeat,start);
  const blessingChoice=a.getByTestId('blessing-choice');
  const blessingDialog=a.getByRole('dialog').filter({has:blessingChoice});
  await blessingChoice.waitFor();
  assert.equal(await blessingDialog.evaluate(element=>element.open&&element.matches(':modal')),true,'guardian decision opens in a native modal');
  assert.match(await blessingDialog.getByTestId('blessing-remaining').innerText(),/2\s*\/\s*2/);
  for(const other of [b,c,observer]) assert.equal(await other.getByTestId('blessing-choice').count(),0,'only the active guardian sees this popup');
  await noOverflow(a);
  await a.screenshot({path:new URL('blessing-popup-mobile-dark.png',output).pathname});
  await blessingDialog.getByRole('button',{name:/가호로 다시 출발/}).tap();
  await until(async()=>!(await get(first)).event&&(await get(first)).blessingSeat===undefined,'blessing choice resolves');
  await until(async()=>await blessingChoice.count()===0,'use closes the guardian popup');
  assert.equal((await get(first)).boardOwnerSeat,owner,'guardian resumes same chosen board');
  assert.equal((await get(first)).position,null,'guardian returns to base placement');
  assert.equal((await get(first)).players[start].blessings,1);
  await explode(first);
  await blessingChoice.waitFor();
  assert.match(await blessingDialog.getByTestId('blessing-remaining').innerText(),/1\s*\/\s*2/);
  await blessingDialog.getByRole('button',{name:'가호를 아끼고 차례 넘기기',exact:true}).tap();
  await until(async()=>await blessingChoice.count()===0,'skip closes the repeated guardian popup');
  assert.equal((await get(first)).players[start].blessings,1,'skipping preserves the last blessing');
  await choose(b,second,owner);
  assert.equal((await get(second)).boardOwnerSeat,owner,'next player selects same board');
  await explode(second);
  await choose(c,third,start);
  await explode(third);
  await act(first,{type:'chooseBoard',ownerSeat:owner});
  await explode(first);
  await blessingChoice.waitFor();
  await blessingDialog.getByRole('button',{name:'가호를 아끼고 차례 넘기기',exact:true}).tap();
  await until(async()=>await blessingChoice.count()===0,'later-turn skip also closes the popup');
  await act(second,{type:'chooseBoard',ownerSeat:owner});
  await explode(second);
  await c.getByTestId('mine-shift').waitFor();
  assert.equal((await get(third)).shiftSeat,owner,'shifter acts before second personal turn board choice');
  assert.equal((await get(third)).boardOwnerSeat,-1);
  assert.equal('shiftMines' in await get(audience),false);
  await act(third,{type:'shiftMine',fromEdgeId:'2-0~3-0',toEdgeId:'1-0~2-0'});
  await c.getByTestId('board-choice').waitFor();
  assert.equal((await get(third)).players[owner].shifts,6);
  await choose(c,third,start);
  await act(third,{type:'spawn',nodeId:'3-3'});
  for (const nodeId of ['2-2','1-1','0-0']) { await act(third,{type:'move',nodeId}); await until(async()=>!(await get(third)).event,'safe move complete'); }
  await c.getByTestId('round-reveal').waitFor();
  await noOverflow(c);
  await c.screenshot({path:new URL('online-round-reveal-dark.png',output).pathname,fullPage:true});
  await act(sessions[0],{type:'nextRound'});
  const next=await get(third);
  assert.equal(next.boardMode,'choice'); assert.equal(next.boardOwnerSeat,-1); assert.equal(next.turnNumber,1);
  results.push('Online: max6 server validation, private selection, two players choose same board, guardian keeps board, spectator count/privacy, shifter second-turn decision and7→6 use, winner/reveal/new round.');
  assert.deepEqual(errors,[]);
  await writeFile(new URL('results.json',output),JSON.stringify({results,errors},null,2));
  console.log(results.join('\n'));
} finally { await browser.close(); }
