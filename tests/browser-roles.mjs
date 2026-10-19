import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.AFTERIMAGE_URL ?? process.env.MINDMINER_URL ?? 'http://127.0.0.1:7777';
const output = new URL('../outputs/qa/roles/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const contexts = [];
const errors = [];
const results = [];
const FIRST_MINE = '3-0~4-0';
const roles = ['illuminator', 'guardian', 'trapper', 'thief', 'shifter', 'recorder'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label, timeout = 16000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
}

async function pageFor(viewport = { width: 1440, height: 1050 }, membership) {
  const context = await browser.newContext({ viewport, locale: 'ko-KR', hasTouch: viewport.width < 600 });
  contexts.push(context);
  if (membership) await context.addInitScript(value => localStorage.setItem('mindminer.membership.v1', JSON.stringify(value)), membership);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('main[data-hydrated="true"]').waitFor();
  return page;
}

async function noOverflow(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label);
  for (const dialog of await page.getByRole('dialog').all()) {
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `${label}: dialog width`);
  }
}

async function svgEdge(page, scope, edge, label) {
  const target = scope.getByRole('button', { name: `선분 ${edge}, ${label}`, exact: true });
  await until(async () => await target.count() === 1 && await target.isEnabled(), `enabled edge ${edge}`);
  await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
  const point = await target.evaluate(line => {
    const point = new DOMPoint((line.x1.baseVal.value + line.x2.baseVal.value) / 2, (line.y1.baseVal.value + line.y2.baseVal.value) / 2).matrixTransform(line.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(point.x, point.y);
  const paint = await scope.locator(`[aria-label^="선분 ${edge},"]`).evaluate(element => ({ stroke: getComputedStyle(element).stroke, outline: getComputedStyle(element).outlineStyle }));
  assert.ok(paint.stroke === 'rgba(0, 0, 0, 0)' || paint.stroke === 'transparent', 'click target remains transparent');
  assert.equal(paint.outline, 'none', 'no rectangle outline on edge');
}

async function galleryChecks() {
  for (const width of [1440, 390]) {
    const page = await pageFor({ width, height: width === 390 ? 844 : 1050 });
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: theme === 'dark' ? '다크 모드' : '라이트 모드', exact: true }).click();
      await page.getByRole('button', { name: /^특수 능력$/ }).click();
      const gallery = page.getByTestId('character-gallery');
      await gallery.waitFor();
      for (const [index, role] of roles.entries()) {
        await until(async () => await gallery.getAttribute('data-character-id') === role, `gallery ${role}`);
        const active = gallery.locator('[data-active="true"]');
        assert.equal(await active.count(), 1);
        assert.equal(await active.getAttribute('aria-hidden'), 'false');
        assert.equal(await gallery.locator('[data-active="false"][inert]').count(), 5);
        await noOverflow(page, `${width} ${theme} ${role}`);
        if (theme === 'dark' || index === 0) {
          await pause(300);
          await page.screenshot({ path: new URL(`gallery-${width}-${theme}-${role}.png`, output).pathname });
        }
        await page.getByRole('button', { name: '다음 능력', exact: true }).click();
      }
      await until(async () => await gallery.getAttribute('data-character-id') === 'illuminator', 'gallery wraps');
      await page.keyboard.press('ArrowLeft');
      await until(async () => await gallery.getAttribute('data-character-id') === 'recorder', 'left arrow wraps');
      await page.keyboard.press('Home');
      await until(async () => await gallery.getAttribute('data-character-id') === 'illuminator', 'home key');
      if (width === 390) {
        const viewport = gallery.locator('[class*="viewport"]');
        await viewport.scrollIntoViewIfNeeded();
        const box = await viewport.boundingBox();
        const session = await page.context().newCDPSession(page);
        const y = Math.max(40, box.y + 70);
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 290, y }] });
        for (let x = 270; x >= 100; x -= 25) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await until(async () => await gallery.getAttribute('data-character-id') === 'guardian', 'mobile real touch swipe');
        await session.detach();
      }
      await page.keyboard.press('Escape');
      assert.equal(await gallery.count(), 0);
    }
    await page.close();
  }
  results.push('Gallery: all six slides, both themes, 1440/390 widths, arrow buttons, keyboard wrapping/Home/Escape, actual mobile touch swipe, no horizontal overflow.');
}

async function apiReply(request, method, url, data, token, status = 200) {
  const response = await request[method](`${base}${url}`, { ...(data ? { data } : {}), ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });
  assert.equal(response.status(), status, `${method} ${url}: ${await response.text()}`);
  return response.json();
}

async function realMemoChecks() {
  const request = (await pageFor()).request;
  const created = await apiReply(request, 'post', '/api/rooms', { name: '직업확인1' }, undefined, 201);
  const code = created.view.code;
  const sessions = [{ code, token: created.token, id: created.view.selfId }];
  for (let index = 2; index <= 7; index++) {
    const joined = await apiReply(request, 'post', `/api/rooms/${code}/join`, { name: index === 7 ? '직업관전자' : `직업확인${index}` }, undefined, 201);
    sessions.push({ code, token: joined.token, id: joined.view.selfId });
  }
  const get = async session => (await apiReply(request, 'get', `/api/rooms/${code}`, undefined, session.token)).view;
  const act = async (session, action) => {
    const view = await get(session);
    return apiReply(request, 'post', `/api/rooms/${code}/actions`, { revision: view.revision, action }, session.token);
  };
  const started = await act(sessions[0], { type: 'start' });
  const roleChoicePage = await pageFor(undefined, sessions[started.view.starterSeat]);
  await roleChoicePage.getByLabel('내 특수 능력 선택', { exact: true }).waitFor();
  assert.equal(await roleChoicePage.getByTestId('confirm-placement').isDisabled(), true, 'a role must be chosen before submitting placement');
  await roleChoicePage.getByLabel('내 특수 능력 선택', { exact: true }).selectOption('guardian');
  await until(async () => (await get(sessions[started.view.starterSeat])).players[started.view.starterSeat].role === 'guardian', 'manual online role choice saved');
  await roleChoicePage.close();
  results.push('Real online role picker: no role selected initially, placement confirmation blocked until choice, selected guardian saved.');
  const turnRoles = ['guardian', 'thief', 'recorder', 'trapper', 'illuminator', 'shifter'];
  for (const [seat, session] of sessions.slice(0, 6).entries()) {
    await act(session, { type: 'chooseRole', role: turnRoles[(seat - started.view.starterSeat + 6) % 6] });
    await act(session, { type: 'place', mines: [FIRST_MINE] });
  }
  let initial = await get(sessions[0]);
  const actor = sessions[initial.activeSeat];
  const spectator = sessions[6];
  const page = await pageFor(undefined, actor);
  const observer = await pageFor({ width: 390, height: 844 }, spectator);
  const ownerSeat = (initial.activeSeat + 1) % initial.playerCount;
  await page.getByTestId(`choose-board-${ownerSeat}`).click();
  await until(async () => (await get(actor)).boardOwnerSeat === ownerSeat, 'memo actor chooses board');
  initial = await get(actor);
  await page.getByTestId('memo-panel').waitFor();
  const currentOwner = initial.players.find(player => player.seat === initial.boardOwnerSeat);
  async function writeMemo(slot, boardOwnerId, edge, statusLabel) {
    await page.getByTestId('memo-panel').getByRole('button', { name: new RegExp(`^메모 ${slot + 1},`) }).click();
    const dialog = page.getByRole('dialog', { name: `메모 ${slot + 1} 기록하기`, exact: true });
    await dialog.getByLabel('메모할 판', { exact: true }).selectOption(boardOwnerId);
    await svgEdge(page, dialog, edge, '메모할 길 선택');
    await dialog.getByRole('button', { name: statusLabel, exact: true }).click();
    await dialog.getByRole('button', { name: '기록하기', exact: true }).click();
    await until(async () => await dialog.count() === 0, 'memo editor closes');
  }
  await writeMemo(0, actor.id, '2-0~3-0', '지뢰라고 기억해요');
  await writeMemo(1, currentOwner.id, FIRST_MINE, '안전하다고 기억해요');
  let ownView = await get(actor);
  assert.deepEqual(ownView.selfMemos[1], { boardOwnerId: currentOwner.id, edgeId: FIRST_MINE, status: 'safe' }, 'incorrect guess is accepted verbatim');
  assert.equal(ownView.selfMemos[0].boardOwnerId, actor.id, 'any board can be recorded');
  await until(async () => await page.locator('.board-stage .memo-marker').count() === 1, 'current board private overlay');
  assert.equal(await page.locator('.board-stage .memo-marker').getAttribute('data-memo-status'), 'safe');
  await observer.getByRole('heading', { name: '현재 판을 관전 중입니다.' }).waitFor();
  assert.equal(await observer.locator('.memo-marker').count(), 0);
  assert.equal(await observer.getByTestId('memo-panel').count(), 0);
  const audience = await get(spectator);
  assert.equal('selfMemos' in audience, false);
  assert.equal('peekableMemos' in audience, false);
  assert.equal('shiftMines' in audience, false);
  for (const theme of ['dark', 'light']) {
    await page.getByRole('button', { name: theme === 'dark' ? '다크 모드' : '라이트 모드', exact: true }).click();
    await noOverflow(page, `memo desktop ${theme}`);
    await page.screenshot({ path: new URL(`memo-desktop-${theme}.png`, output).pathname, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, 'memo mobile');
  await page.getByTestId('memo-panel').getByRole('button', { name: /^메모 2,/ }).click();
  await noOverflow(page, 'memo editor mobile');
  await page.screenshot({ path: new URL('memo-editor-mobile-light.png', output).pathname });
  await page.keyboard.press('Escape');
  await page.reload();
  await until(async () => await page.locator('.board-stage .memo-marker').count() === 1, 'memo persists after reload');
  await page.getByRole('button', { name: '출발점 1에서 시작', exact: true }).click();
  await page.getByRole('button', { name: '4행 1열로 이동', exact: true }).click();
  await observer.locator('.explosion').waitFor();
  assert.equal(await page.getByTestId('blessing-choice').count(), 0, 'blessing popup waits for the explosion pause to finish');
  if (initial.players[initial.activeSeat].role === 'guardian') {
    const choice = page.getByTestId('blessing-choice');
    const dialog = page.getByRole('dialog').filter({ has: choice });
    await choice.waitFor();
    assert.equal(await dialog.evaluate(element => element.open && element.matches(':modal')), true, 'guardian choice is a native modal dialog');
    assert.equal(await dialog.getByRole('button', { name: '닫기', exact: true }).count(), 0, 'decision has no implicit close button');
    assert.match(await dialog.getByTestId('blessing-remaining').innerText(), /2\s*\/\s*2/);
    assert.equal(await observer.getByTestId('blessing-choice').count(), 0, 'spectator does not receive the guardian decision popup');
    assert.equal((await get(actor)).event, null, 'popup opens after the explosion animation');
    await page.keyboard.press('Escape');
    await page.mouse.click(2, 2);
    assert.equal(await dialog.isVisible(), true, 'Escape and backdrop do not dismiss the decision');
    ownView = await get(actor);
    assert.equal(ownView.blessingSeat, initial.activeSeat, 'dismissal attempts do not advance the turn');
    assert.equal(ownView.players[initial.activeSeat].blessings, 2, 'dismissal attempts do not consume a blessing');
    await page.reload();
    await choice.waitFor();
    assert.equal(await dialog.evaluate(element => element.open && element.matches(':modal')), true, 'pending decision reopens as a modal after reload');
    assert.match(await dialog.getByTestId('blessing-remaining').innerText(), /2\s*\/\s*2/);
    await noOverflow(page, 'guardian popup mobile');
    await page.screenshot({ path: new URL('blessing-popup-mobile-light.png', output).pathname });
    await dialog.getByRole('button', { name: /가호로 다시 출발/ }).click();
    await until(async () => (await get(actor)).players[initial.activeSeat].blessings === 1, 'blessing request completes');
    await until(async () => await choice.count() === 0, 'using blessing closes the popup');
    ownView = await get(actor);
    assert.equal(ownView.activeSeat, initial.activeSeat);
    assert.equal(ownView.boardOwnerSeat, initial.boardOwnerSeat, 'using blessing resumes the same selected board');
    assert.equal(ownView.turnNumber, initial.turnNumber, 'using blessing keeps the same turn');
    assert.equal(ownView.position, null);
    assert.equal(ownView.players[initial.activeSeat].blessings, 1);
    await page.getByRole('button', { name: '출발점 1에서 시작', exact: true }).click();
    await page.getByRole('button', { name: '4행 1열로 이동', exact: true }).click();
    await page.getByTestId('memo-panel').getByRole('button', { name: /^메모 2,/ }).click();
    const pendingMemo = page.locator('dialog[aria-label="메모 2 기록하기"]');
    await pendingMemo.getByRole('button', { name: '아직 확신이 없어요', exact: true }).click();
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden', 'memo locks background scrolling during the explosion pause');
    await choice.waitFor();
    assert.match(await dialog.getByTestId('blessing-remaining').innerText(), /1\s*\/\s*2/);
    assert.equal(await pendingMemo.evaluate(element => element.open), true, 'pending memo draft stays mounted beneath the guardian popup');
    await dialog.getByRole('button', { name: '가호를 아끼고 차례 넘기기', exact: true }).click();
    await until(async () => await choice.count() === 0, 'explicit skip closes the popup');
    assert.equal((await get(actor)).players[initial.activeSeat].blessings, 1, 'explicit skip preserves the remaining blessing');
    assert.equal(await pendingMemo.getByLabel('메모할 판', { exact: true }).inputValue(), currentOwner.id, 'underlying memo keeps its board');
    assert.equal(await pendingMemo.locator('.edge-selected .edge-target').getAttribute('aria-label'), `선분 ${FIRST_MINE}, 메모할 길 선택`, 'underlying memo keeps its edge');
    assert.equal(await pendingMemo.getByRole('button', { name: '아직 확신이 없어요', exact: true }).getAttribute('aria-pressed'), 'true', 'underlying memo keeps its unsaved status');
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden', 'closing guardian keeps the remaining memo scroll lock');
    await page.keyboard.press('Escape');
    await until(async () => await pendingMemo.count() === 0, 'underlying memo can be closed normally after the guardian decision');
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden', 'last dialog releases background scrolling');
    results.push('Guardian online mobile popup: actor only, appears after explosion pause, remaining count, Escape/backdrop cannot dismiss or spend, pending reload restores modal, use resumes same board/base/turn, repeat popup and explicit skip, overlapping memo draft survives with correct scroll locks.');
  }
  await until(async () => (await get(actor)).activeSeat !== initial.activeSeat, 'next player receives turn');
  await until(async () => await page.locator('.board-stage .memo-marker').count() === 0, 'memo overlays disappear outside own turn');
  for (const button of await page.getByTestId('memo-panel').getByRole('button', { name: /^메모 \d,/ }).all()) assert.equal(await button.isDisabled(), false);
  assert.equal((await get(actor)).selfMemos[1].status, 'safe', 'explosion does not correct a wrong memo');
  await writeMemo(0, actor.id, '2-0~3-0', '아직 확신이 없어요');
  assert.equal((await get(actor)).selfMemos[0].status, 'unsure', 'note can be edited during another player turn');
  assert.equal(await page.locator('.board-stage .memo-marker').count(), 0, 'editing off-turn does not expose note overlays');
  assert.equal(await observer.locator('.memo-marker').count(), 0, 'off-turn memo updates remain private from spectators');
  results.push(`Real six-player room ${code} plus spectator: notes on arbitrary/current boards, wrong guess accepted, private overlay, spectator secrecy, refresh persistence, mobile editor, no click boxes, off-turn editing permitted, explosion leaves notes unchanged.`);
  const thief = sessions[(initial.activeSeat + 1) % 6];
  const thiefPage = await pageFor(undefined, thief);
  await thiefPage.getByTestId('memo-panel').waitFor();
  let thiefView = await get(thief);
  await thiefPage.getByTestId(`choose-board-${(thiefView.activeSeat + 1) % thiefView.playerCount}`).click();
  await until(async () => (await get(thief)).boardOwnerSeat >= 0, 'thief chooses board');
  thiefView = await get(thief);
  assert.equal(thiefView.players.find(player => player.id === thief.id).role, 'thief');
  assert.equal(thiefView.peekableMemos.length, 2);
  assert.ok(thiefView.peekableMemos.every(target => Object.keys(target).sort().join(',') === 'playerId,slot'), 'selectable memo metadata never contains contents');
  await thiefPage.getByRole('button', { name: /메모 훔쳐보기/ }).click();
  const peekChoice = thiefPage.getByRole('dialog', { name: '어떤 메모를 볼까요?' });
  await peekChoice.getByRole('button', { name: /^메모 1/ }).click();
  await peekChoice.getByRole('button', { name: /^메모 2/ }).click();
  await peekChoice.getByRole('button', { name: '2개 확인 · 1회 사용', exact: true }).click();
  await thiefPage.getByTestId('peek-result').waitFor();
  await thiefPage.getByRole('button', { name: '다음 메모', exact: true }).click();
  assert.equal(await thiefPage.getByTestId('peek-result').locator('.memo-marker').getAttribute('data-memo-status'), 'safe');
  await thiefPage.screenshot({ path: new URL('peek-result-desktop-dark.png', output).pathname });
  await thiefPage.getByRole('button', { name: '기억했어요. 닫기', exact: true }).click();
  assert.equal(await thiefPage.getByTestId('peek-result').count(), 0);
  assert.equal((await get(thief)).players.find(player => player.id === thief.id).peeks, 1);
  await thiefPage.reload();
  await thiefPage.getByTestId('memo-panel').waitFor();
  assert.equal(await thiefPage.getByTestId('peek-result').count(), 0, 'peek result never persists across reload');
  assert.equal('peekResult' in await get(thief), false);
  await act(thief, { type: 'spawn', nodeId: '4-0' });
  await act(thief, { type: 'move', nodeId: '3-0' });
  await until(async () => (await get(thief)).activeSeat !== thiefView.activeSeat, 'thief turn ends');
  await until(async () => await thiefPage.getByRole('button', { name: /메모 훔쳐보기/ }).isDisabled(), 'peek ability still requires the thief own turn');
  assert.equal(await thiefPage.getByTestId('memo-panel').getByRole('button', { name: /^메모 1,/ }).isDisabled(), false, 'ordinary notes remain available while peek is unavailable');
  assert.equal((await get(thief)).players.find(player => player.id === thief.id).peeks, 1, 'ending a turn does not consume another peek');
  results.push('Real thief UI: only hidden occupied-slot metadata before selection; two notes cost one use; page through results; close/reload removes results; peek remains restricted to own turn while ordinary note editing stays available.');
  await thiefPage.close();
  await page.close(); await observer.close();
}

async function demoChecks() {
  for (const role of ['recorder', 'trapper', 'illuminator']) {
    const page = await pageFor({ width: role === 'trapper' ? 390 : 1440, height: 1000 });
    await page.getByRole('button', { name: /혼자 연습하기/ }).click();
    await page.getByLabel('내 특수 능력 선택', { exact: true }).selectOption(role);
    await until(async () => await page.getByTestId('role-panel').getAttribute('data-role') === role, `${role} demo`);
    if (role === 'trapper') {
      await svgEdge(page, page.locator('.board-stage'), FIRST_MINE, '지뢰 설치');
      await page.getByRole('button', { name: /길 위장/ }).click();
      for (const edge of [FIRST_MINE, '2-0~3-0', '1-0~2-0', '0-0~1-0', '0-0~1-1']) await svgEdge(page, page.locator('.board-stage'), edge, '위장 선택');
      assert.equal(await page.locator('.concealment-marker').count(), 4, 'concealment cap is four');
      assert.equal(await page.locator('.edge-mined').count(), 1, 'safe and mined edges are both conceal-able');
      await noOverflow(page, 'trapper mobile placement');
      await page.screenshot({ path: new URL('trapper-mobile-dark.png', output).pathname, fullPage: true });
    }
    await page.getByTestId('confirm-placement').click();
    await page.getByTestId('memo-panel').waitFor();
    if (role === 'recorder') assert.equal(await page.getByTestId('memo-panel').getByRole('button', { name: /^메모 \d,/ }).count(), 4);
    if (role === 'illuminator') assert.match(await page.locator('.hint-heading').innerText(), /5\s*\/\s*5/);
    results.push(`Actual local demo: ${role} selectable and its ${role === 'recorder' ? 'four memo slots' : role === 'trapper' ? 'four concealed safe/mined edge cap' : 'five starting hint coins'} verified.`);
    await page.close();
  }
}

async function realShiftChecks() {
  const holder = await pageFor();
  const request = holder.request;
  const created = await apiReply(request, 'post', '/api/rooms', { name: '이동확인1' }, undefined, 201);
  const code = created.view.code;
  const sessions = [{ code, token: created.token, id: created.view.selfId }];
  const get = async session => (await apiReply(request, 'get', `/api/rooms/${code}`, undefined, session.token)).view;
  const act = async (session, action) => {
    const view = await get(session);
    return apiReply(request, 'post', `/api/rooms/${code}/actions`, { revision: view.revision, action }, session.token);
  };
  await act(sessions[0], { type: 'settings', settings: { playerCount: 3, hintCoins: 3, totalRounds: 1, gridSize: 4 } });
  for (const name of ['이동확인2', '이동확인3', '이동관전자']) {
    const reply = await apiReply(request, 'post', `/api/rooms/${code}/join`, { name }, undefined, 201);
    sessions.push({ code, token: reply.token, id: reply.view.selfId });
  }
  await act(sessions[0], { type: 'start' });
  for (const [index, session] of sessions.slice(0, 3).entries()) {
    await act(session, { type: 'chooseRole', role: index === 0 ? 'shifter' : 'illuminator' });
    await act(session, { type: 'place', mines: [FIRST_MINE] });
  }
  // The shifter receives a decision at their second personal turn. Random
  // starting seats need three to five failed turns to reach that point.
  for (let attempt = 0; attempt < 6; attempt++) {
    const state = await get(sessions[0]);
    if (state.shiftSeat === 0) break;
    const actor = sessions[state.activeSeat];
    await act(actor, { type: 'chooseBoard', ownerSeat: (state.activeSeat + 1) % state.playerCount });
    await act(actor, { type: 'spawn', nodeId: '4-0' });
    await act(actor, { type: 'move', nodeId: '3-0' });
    await until(async () => !(await get(sessions[0])).event, 'shift test explosion finishes');
  }
  const shiftView = await get(sessions[0]);
  assert.equal(shiftView.shiftSeat, 0);
  assert.deepEqual(shiftView.shiftMines, [FIRST_MINE]);
  assert.equal('shiftMines' in await get(sessions[1]), false);
  assert.equal('shiftMines' in await get(sessions[2]), false);
  assert.equal('shiftMines' in await get(sessions[3]), false);
  const page = await pageFor({ width: 390, height: 844 }, sessions[0]);
  await page.getByTestId('mine-shift').waitFor();
  assert.equal(await page.getByTestId('shift-remaining').locator('b').innerText(), '7 / 7');
  assert.equal(await page.getByTestId('shift-resource').locator('b').innerText(), '7 / 7');
  assert.equal(await page.getByRole('button', { name: /옮기고 판 선택/ }).isDisabled(), true);
  await page.getByTestId('memo-panel').getByRole('button', { name: /^메모 1,/ }).click();
  const memoEditor = page.getByRole('dialog', { name: '메모 1 기록하기', exact: true });
  await memoEditor.getByLabel('메모할 판', { exact: true }).selectOption(sessions[0].id);
  await svgEdge(page, memoEditor, FIRST_MINE, '메모할 길 선택');
  await memoEditor.getByRole('button', { name: '안전하다고 기억해요', exact: true }).click();
  await memoEditor.getByRole('button', { name: '기록하기', exact: true }).click();
  await until(async () => await memoEditor.count() === 0, 'memo saves during mine-shift decision');
  const recordedWhileShifting = await get(sessions[0]);
  assert.equal(recordedWhileShifting.shiftSeat, 0, 'memo does not resolve the pending shift decision');
  assert.deepEqual(recordedWhileShifting.selfMemos[0], { boardOwnerId: sessions[0].id, edgeId: FIRST_MINE, status: 'safe' });
  await svgEdge(page, page.getByTestId('mine-shift'), FIRST_MINE, '지뢰 이동 위치 선택');
  await svgEdge(page, page.getByTestId('mine-shift'), '2-0~3-0', '지뢰 이동 위치 선택');
  await noOverflow(page, 'real mine shift mobile');
  await page.screenshot({ path: new URL('mine-shift-mobile-dark.png', output).pathname, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '라이트 모드', exact: true }).click();
  await noOverflow(page, 'real mine shift desktop');
  await page.screenshot({ path: new URL('mine-shift-desktop-light.png', output).pathname, fullPage: true });
  await page.getByRole('button', { name: /옮기고 판 선택/ }).click();
  await until(async () => {
    const state = await get(sessions[0]);
    return state.shiftSeat === undefined && !state.event;
  }, 'mine shift proceeds to board selection');
  await until(async () => await page.getByTestId('shift-resource').locator('b').innerText() === '6 / 7', 'remaining shifts updated');
  await page.reload();
  await page.getByTestId('shift-resource').waitFor();
  assert.equal(await page.getByTestId('shift-resource').locator('b').innerText(), '6 / 7');
  const resumed = await get(sessions[0]);
  assert.equal(resumed.players[0].shifts, 6);
  assert.equal('shifts' in (await get(sessions[1])).players[0], false);
  assert.equal('shifts' in (await get(sessions[2])).players[0], false);
  assert.equal('shifts' in (await get(sessions[3])).players[0], false);
  assert.deepEqual(resumed.selfMemos[0], { boardOwnerId: sessions[0].id, edgeId: FIRST_MINE, status: 'safe' }, 'mine relocation does not silently rewrite personal notes');
  const winner = sessions[resumed.activeSeat];
  assert.equal(resumed.boardOwnerSeat, -1, 'shifter still chooses an opponent board');
  await page.getByTestId(`choose-board-${(resumed.activeSeat + 1) % resumed.playerCount}`).click();
  await until(async () => (await get(winner)).boardOwnerSeat >= 0, 'shifter chooses board');
  await act(winner, { type: 'spawn', nodeId: '4-4' });
  for (let row = 3; row >= 0; row--) {
    await act(winner, { type: 'move', nodeId: `${row}-${row}` });
    await until(async () => !(await get(winner)).event, 'safe movement finishes');
  }
  const revealed = await get(winner);
  assert.equal(revealed.phase, 'finished');
  assert.equal(Object.keys(revealed.revealedBoards).length, revealed.playerCount, 'game completion reveals every board');
  assert.deepEqual(revealed.revealedBoards[sessions[0].id], ['2-0~3-0']);
  results.push(`Real three-player room ${code}: second-personal-turn mine shift UI, note editing during the shift decision, private mine visibility, valid one-mine relocation, unchanged personal notes, spectator secrecy, explicit opponent-board choice and final answer confirms moved mine.`);
  await page.close(); await holder.close();
}

try {
  const selected = (process.env.AFTERIMAGE_QA_PHASES ?? process.env.MINDMINER_QA_PHASES ?? 'gallery,memo,demo,shift').split(',');
  if (selected.includes('gallery')) await galleryChecks();
  if (selected.includes('memo')) await realMemoChecks();
  if (selected.includes('demo')) await demoChecks();
  if (selected.includes('shift')) await realShiftChecks();
  assert.deepEqual(errors, [], 'no browser runtime errors');
  await writeFile(new URL('result.json', output), JSON.stringify({ results, errors }, null, 2));
  console.log(results.join('\n'));
} catch (error) {
  console.error('Runtime errors:', errors);
  throw error;
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
