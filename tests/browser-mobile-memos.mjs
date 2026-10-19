import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.AFTERIMAGE_URL ?? process.env.MINDMINER_URL ?? 'http://127.0.0.1:7777';
const output = new URL('../outputs/qa/mobile-memos/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const apiContext = await browser.newContext();
const errors = [];
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label, timeout = 16000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
}

async function api(method, path, data, token) {
  const response = await apiContext.request[method](`${base}${path}`, {
    ...(data ? { data } : {}),
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  assert.ok(response.ok(), `${method} ${path}: ${await response.text()}`);
  return response.json();
}

// Every scenario gets a new room; never change an existing player's game.
async function freshRoom(gridSize) {
  const created = await api('post', '/api/rooms', { name: '터치확인1' });
  const code = created.view.code;
  const sessions = [{ code, token: created.token, id: created.view.selfId }];
  const get = async session => (await api('get', `/api/rooms/${code}`, undefined, session.token)).view;
  const act = async (session, action) => api('post', `/api/rooms/${code}/actions`, {
    revision: (await get(session)).revision, action,
  }, session.token);
  await act(sessions[0], { type: 'settings', settings: { playerCount: 4, hintCoins: 3, totalRounds: 2, gridSize } });
  for (let index = 2; index <= 4; index++) {
    const joined = await api('post', `/api/rooms/${code}/join`, { name: `터치확인${index}` });
    sessions.push({ code, token: joined.token, id: joined.view.selfId });
  }
  await act(sessions[0], { type: 'start' });
  for (const session of sessions) {
    await act(session, { type: 'chooseRole', role: 'recorder' });
    await act(session, { type: 'place', mines: [`${gridSize - 1}-0~${gridSize}-0`] });
  }
  const choice = await get(sessions[0]);
  assert.equal(choice.boardMode, 'choice', 'new rooms use free board selection');
  assert.equal(choice.boardOwnerSeat, -1, 'a turn starts without a selected board');
  const actor = sessions[choice.activeSeat];
  const chooseOther = async session => {
    const view = await get(session);
    assert.equal(view.players.find(player => player.id === session.id).seat, view.activeSeat, 'only the active player chooses');
    const owner = view.players.find(player => player.seat !== view.activeSeat);
    await act(session, { type: 'chooseBoard', ownerSeat: owner.seat });
    return owner;
  };
  await chooseOther(actor);
  const initial = await get(actor);
  return { actor, sessions, initial, get, act, chooseOther };
}

async function tap(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  assert.ok(bounds, 'touch target has bounds');
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

async function controlsVisible(dialog, label) {
  for (const name of ['안전하다고 기억해요', '지뢰라고 기억해요', '아직 확신이 없어요', '비우기', '기록하기']) {
    const button = dialog.getByRole('button', { name, exact: true });
    const info = await button.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right,
        width: innerWidth, height: innerHeight, hittable: element === hit || element.contains(hit) };
    });
    assert.ok(info.top >= 0 && info.bottom <= info.height && info.left >= 0 && info.right <= info.width && info.hittable,
      `${label}: ${name} remains on screen and unobscured: ${JSON.stringify(info)}`);
  }
}

async function selectEdgeWithTouch(page, dialog, edge, offset = 0) {
  const line = dialog.getByRole('button', { name: `선분 ${edge}, 메모할 길 선택`, exact: true });
  await line.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
  const sample = await line.evaluate((element, offset) => {
    const matrix = element.getScreenCTM();
    const start = new DOMPoint(element.x1.baseVal.value, element.y1.baseVal.value).matrixTransform(matrix);
    const end = new DOMPoint(element.x2.baseVal.value, element.y2.baseVal.value).matrixTransform(matrix);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const point = { x: (start.x + end.x) / 2 - dy / length * offset, y: (start.y + end.y) / 2 + dx / length * offset };
    const candidates = [...element.ownerSVGElement.querySelectorAll('.edge-target')].map(target => {
      const a = new DOMPoint(target.x1.baseVal.value, target.y1.baseVal.value).matrixTransform(matrix);
      const b = new DOMPoint(target.x2.baseVal.value, target.y2.baseVal.value).matrixTransform(matrix);
      const dx = b.x - a.x; const dy = b.y - a.y;
      const progress = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
      return { label: target.getAttribute('aria-label'), distance: Math.hypot(point.x - a.x - progress * dx, point.y - a.y - progress * dy) };
    }).sort((a, b) => a.distance - b.distance);
    return { ...point, closest: candidates[0], originalWidth: parseFloat(getComputedStyle(element).strokeWidth) * matrix.a };
  }, offset);
  assert.equal(sample.closest.label, `선분 ${edge}, 메모할 길 선택`, 'offset still lies closest to the intended edge');
  await page.touchscreen.tap(sample.x, sample.y);
  await until(async () => await dialog.locator('.edge-selected .edge-target').count() === 1
    && await dialog.locator('.edge-selected .edge-target').getAttribute('aria-label') === `선분 ${edge}, 메모할 길 선택`, `touch selects ${edge} at ${offset}px offset`);
  return { offset, ...sample };
}

async function swipeContent(page, dialog) {
  const content = page.getByTestId('memo-editor-scroll');
  const overflow = await content.evaluate(element => element.scrollHeight - element.clientHeight);
  if (overflow < 5) return { needed: false };
  await content.evaluate(element => { element.scrollTop = 0; });
  const beforeSelection = await dialog.locator('.edge-selected .edge-target').getAttribute('aria-label');
  const beforeClicks = await page.evaluate(() => window.memoTouchClicks.length);
  const bounds = await content.boundingBox();
  const x = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height - 20;
  const endY = bounds.y + 25;
  assert.ok(startY - endY > 50, 'the editor leaves useful space for touch scrolling');
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
    for (let step = 1; step <= 12; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY + (endY - startY) * step / 12 }] });
      await pause(20);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
  await until(async () => await content.evaluate(element => element.scrollTop) > 10, 'real finger gesture scrolls the editor');
  await pause(350);
  assert.equal(await dialog.locator('.edge-selected .edge-target').getAttribute('aria-label'), beforeSelection, 'scroll gesture does not change the selected edge');
  assert.equal(await page.evaluate(() => window.memoTouchClicks.length), beforeClicks, 'touch scrolling does not dispatch an accidental board click');
  await controlsVisible(dialog, 'after real touch scrolling');
  return { needed: true, overflow, scrollTop: await content.evaluate(element => element.scrollTop) };
}

async function draftMatches(dialog, boardOwnerId, edge, statusLabel) {
  assert.equal(await dialog.count(), 1, 'draft stays open');
  assert.equal(await dialog.getByLabel('메모할 판', { exact: true }).inputValue(), boardOwnerId, 'selected board survives the turn change');
  assert.equal(await dialog.locator('.edge-selected .edge-target').getAttribute('aria-label'), `선분 ${edge}, 메모할 길 선택`, 'selected edge survives the turn change');
  assert.equal(await dialog.getByRole('button', { name: statusLabel, exact: true }).getAttribute('aria-pressed'), 'true', 'selected status survives the turn change');
}

try {
  for (const scenario of [
    { width: 320, height: 568, gridSize: 6 },
    { width: 390, height: 844, gridSize: 4 },
    { width: 390, height: 844, gridSize: 6 },
  ]) {
    const { width, height, gridSize } = scenario;
    const { actor, sessions, initial, get, act, chooseOther } = await freshRoom(gridSize);
    const context = await browser.newContext({ viewport: { width, height }, locale: 'ko-KR', hasTouch: true, isMobile: true });
    try {
      await context.addInitScript(value => localStorage.setItem('mindminer.membership.v1', JSON.stringify(value)), actor);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      const panel = page.getByTestId('memo-panel');
      const slot = panel.getByRole('button', { name: /^메모 1,/ });
      const dialog = page.getByRole('dialog', { name: '메모 1 기록하기', exact: true });
      await panel.waitFor();
      const jump = page.getByRole('button', { name: /내 메모로 이동/ });
      assert.ok((await jump.boundingBox()).height >= 44, 'mobile memo shortcut has a comfortable touch target');
      await tap(page, jump);
      await until(async () => await panel.evaluate(element => document.activeElement === element), 'memo shortcut moves focus to the notes panel');
      const panelTop = await panel.evaluate(element => element.getBoundingClientRect().top);
      assert.ok(panelTop >= 0 && panelTop < height, 'memo shortcut scrolls the panel into view');
      await tap(page, slot);
      await dialog.waitFor();
      await controlsVisible(dialog, 'on opening the editor');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal page overflow');
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false, 'no horizontal dialog overflow');
      assert.ok(await dialog.getByLabel('메모할 판', { exact: true }).evaluate(element => parseFloat(getComputedStyle(element).fontSize)) >= 16, 'mobile native select does not request text autozoom');
      await page.screenshot({ path: new URL(`editor-${width}x${height}-g${gridSize}-initial.png`, output).pathname });

      const padding = await dialog.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.left + 4, y: bounds.top + 120 };
      });
      assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, padding), 'DIALOG');
      await page.touchscreen.tap(padding.x, padding.y);
      assert.equal(await dialog.count(), 1, 'touching inside dialog padding keeps the draft open');
      await page.touchscreen.tap(2, height / 2);
      await until(async () => await dialog.count() === 0, 'actual backdrop touch closes the editor');
      await tap(page, slot);
      await dialog.waitFor();
      await page.evaluate(() => {
        window.memoTouchClicks = [];
        document.addEventListener('click', event => {
          if (event.target instanceof Element && event.target.closest('[data-testid="memo-editor-board"]')) {
            window.memoTouchClicks.push({ detail: event.detail, pointerType: event.pointerType });
          }
        }, true);
      });

      const currentOwner = initial.players.find(player => player.seat === initial.boardOwnerSeat);
      const select = dialog.getByLabel('메모할 판', { exact: true });
      const edge = `${gridSize - 1}-0~${gridSize}-0`;
      const offsets = [];
      for (const offset of [0, 8, 12]) {
        await select.selectOption(currentOwner.id);
        await select.selectOption(actor.id);
        assert.equal(await dialog.locator('.game-board').getAttribute('data-owner-seat'), String(initial.activeSeat), 'memo board uses its creator seat color');
        offsets.push(await selectEdgeWithTouch(page, dialog, edge, offset));
        await controlsVisible(dialog, `after ${offset}px edge touch`);
      }
      const touchClicks = await page.evaluate(() => window.memoTouchClicks);
      assert.equal(touchClicks.length, 3);
      assert.ok(touchClicks.every(click => click.detail > 0 && click.pointerType === 'touch'), `native touch clicks carry detail > 0: ${JSON.stringify(touchClicks)}`);
      const scroll = await swipeContent(page, dialog);
      if (height === 568) assert.equal(scroll.needed, true, 'short screen exercises actual scrolling');
      await tap(page, dialog.getByRole('button', { name: '안전하다고 기억해요', exact: true }));
      await page.screenshot({ path: new URL(`editor-${width}x${height}-g${gridSize}-selected.png`, output).pathname });
      await tap(page, dialog.getByRole('button', { name: '기록하기', exact: true }));
      await until(async () => await dialog.count() === 0, 'save closes the editor');
      assert.deepEqual((await get(actor)).selfMemos[0], { boardOwnerId: actor.id, edgeId: edge, status: 'safe' }, 'arbitrary-board note is saved exactly, including a false safe guess');

      await page.reload();
      await panel.waitFor();
      await until(async () => (await slot.getAttribute('aria-label')).includes('안전'), 'saved memo survives refresh');
      await tap(page, slot);
      await select.selectOption(currentOwner.id);
      assert.equal(await dialog.locator('.game-board').getAttribute('data-owner-seat'), String(currentOwner.seat), 'changing memo board changes its creator color');
      await selectEdgeWithTouch(page, dialog, edge, 8);
      await tap(page, dialog.getByRole('button', { name: '지뢰라고 기억해요', exact: true }));
      await tap(page, dialog.getByRole('button', { name: '기록하기', exact: true }));
      await until(async () => await dialog.count() === 0, 'edited note saves');
      await until(async () => await page.locator('.board-stage .memo-marker').count() === 1, 'current-board memo appears on the board');
      assert.equal(await page.locator('.board-stage .memo-marker').getAttribute('data-memo-status'), 'mine');
      await page.reload();
      await until(async () => await page.locator('.board-stage .memo-marker').count() === 1, 'current-board overlay persists after refresh');
      await tap(page, slot);
      await tap(page, dialog.getByRole('button', { name: '비우기', exact: true }));
      await until(async () => await dialog.count() === 0, 'deleting a note closes the editor');
      assert.equal((await get(actor)).selfMemos[0], null, 'note is deleted on the server');
      await until(async () => await page.locator('.board-stage .memo-marker').count() === 0, 'deleting removes the overlay');

      await tap(page, slot);
      await select.selectOption(actor.id);
      await selectEdgeWithTouch(page, dialog, edge, 8);
      await tap(page, dialog.getByRole('button', { name: '안전하다고 기억해요', exact: true }));
      await act(actor, { type: 'spawn', nodeId: `${gridSize}-0` });
      await act(actor, { type: 'move', nodeId: `${gridSize - 1}-0` });
      await page.locator('.board-stage .explosion').waitFor();
      await draftMatches(dialog, actor.id, edge, '안전하다고 기억해요');
      assert.equal(await dialog.getByRole('button', { name: '기록하기', exact: true }).isDisabled(), false, 'an explosion does not disable the note editor');
      await until(async () => (await get(actor)).activeSeat !== initial.activeSeat, 'mine ends the actor turn after the explosion pause');
      assert.equal((await get(actor)).boardOwnerSeat, -1, 'next player must select a board');
      await until(async () => await page.locator('.player-active.player-self').count() === 0, 'browser receives the next player turn');
      await draftMatches(dialog, actor.id, edge, '안전하다고 기억해요');
      await tap(page, dialog.getByRole('button', { name: '기록하기', exact: true }));
      await until(async () => await dialog.count() === 0, 'draft saves during another player turn');
      assert.deepEqual((await get(actor)).selfMemos[0], { boardOwnerId: actor.id, edgeId: edge, status: 'safe' });
      assert.equal(await page.locator('.board-stage .memo-marker').count(), 0, 'off-turn notes never overlay another player turn');
      assert.equal(await slot.isDisabled(), false, 'notes remain editable outside the actor turn');
      await tap(page, slot);
      await tap(page, dialog.getByRole('button', { name: '지뢰라고 기억해요', exact: true }));
      await tap(page, dialog.getByRole('button', { name: '기록하기', exact: true }));
      await until(async () => await dialog.count() === 0, 'off-turn edit saves');
      assert.equal((await get(actor)).selfMemos[0].status, 'mine');
      await tap(page, slot);
      await tap(page, dialog.getByRole('button', { name: '비우기', exact: true }));
      await until(async () => await dialog.count() === 0, 'off-turn delete saves');
      assert.equal((await get(actor)).selfMemos[0], null);

      // Exercise event transitions and the round boundary once, independently of viewport coverage.
      const transitionChecks = [];
      if (width === 390 && gridSize === 4) {
        const openDraft = async () => {
          await tap(page, slot);
          await select.selectOption(actor.id);
          await selectEdgeWithTouch(page, dialog, edge);
          await tap(page, dialog.getByRole('button', { name: '안전하다고 기억해요', exact: true }));
        };
        const saveDuringEvent = async type => {
          const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/rooms/${actor.code}/actions`)
            && response.request().method() === 'POST' && response.request().postDataJSON().action.type === 'memo');
          await tap(page, dialog.getByRole('button', { name: '기록하기', exact: true }));
          const response = await responsePromise;
          assert.ok(response.ok(), `memo saves during ${type}: ${await response.text()}`);
          assert.equal((await response.json()).view.event?.type, type, `memo is accepted while the ${type} event is still active`);
          await until(async () => await dialog.count() === 0, `${type} note editor closes after saving`);
          transitionChecks.push(type);
        };
        let next = sessions[(await get(actor)).activeSeat];
        await chooseOther(next);
        await act(next, { type: 'spawn', nodeId: '4-0' });
        await openDraft();
        await act(next, { type: 'move', nodeId: '4-1' });
        await saveDuringEvent('move');
        await until(async () => !(await get(actor)).event, 'safe movement finishes');
        await act(next, { type: 'move', nodeId: '4-0' });
        await until(async () => !(await get(actor)).event, 'safe return finishes');
        await openDraft();
        await act(next, { type: 'move', nodeId: '3-0' });
        await saveDuringEvent('explosion');
        await until(async () => (await get(actor)).activeSeat !== (initial.activeSeat + 1) % 4, 'second player explosion finishes');

        for (let attempt = 0; attempt < 2; attempt++) {
          const before = await get(actor);
          next = sessions[before.activeSeat];
          await chooseOther(next);
          await act(next, { type: 'spawn', nodeId: '4-0' });
          if (attempt === 1) await openDraft();
          await act(next, { type: 'move', nodeId: '3-0' });
          await until(async () => (await get(actor)).activeSeat !== before.activeSeat, 'remaining player explosion finishes');
        }
        const nextChoice = await get(actor);
        assert.equal(nextChoice.boardOwnerSeat, -1, 'returning to the first player opens another board choice');
        assert.equal(nextChoice.event, null, 'board choices do not insert a rotation animation');
        assert.equal(nextChoice.turnNumber, initial.turnNumber + 4, 'each failed attempt advances the turn counter');
        await draftMatches(dialog, actor.id, edge, '안전하다고 기억해요');
        const selectionSave = page.waitForResponse(response => response.url().endsWith(`/api/rooms/${actor.code}/actions`)
          && response.request().method() === 'POST' && response.request().postDataJSON().action.type === 'memo');
        await tap(page, dialog.getByRole('button', { name: '기록하기', exact: true }));
        const savedWhileChoosing = await selectionSave;
        assert.ok(savedWhileChoosing.ok(), 'memo saves while a board choice is pending');
        assert.equal((await savedWhileChoosing.json()).view.boardOwnerSeat, -1, 'saving a memo leaves the board choice pending');
        await until(async () => await dialog.count() === 0, 'board-selection note editor closes after saving');
        transitionChecks.push('board-selection');

        await openDraft();
        await tap(page, dialog.getByRole('button', { name: '아직 확신이 없어요', exact: true }));
        const winner = sessions[(await get(actor)).activeSeat];
        const chosenOwner = await chooseOther(winner);
        await until(async () => await page.locator('.board-stage .game-board').getAttribute('data-owner-seat') === String(chosenOwner.seat), 'browser receives the selected board');
        await draftMatches(dialog, actor.id, edge, '아직 확신이 없어요');
        transitionChecks.push('draft-survives-board-choice');
        await act(winner, { type: 'spawn', nodeId: '4-4' });
        for (let row = 3; row >= 0; row--) {
          await act(winner, { type: 'move', nodeId: `${row}-${row}` });
          await until(async () => !(await get(actor)).event, 'safe winning movement finishes');
        }
        await until(async () => await dialog.count() === 0 && await panel.count() === 0, 'round end closes the unsaved draft and memo panel');
        assert.equal((await get(actor)).phase, 'roundEnd');
        await act(sessions[0], { type: 'nextRound' });
        for (const session of sessions) {
          await act(session, { type: 'chooseRole', role: 'recorder' });
          const preparation = await get(session);
          const seat = preparation.players.find(player => player.id === session.id).seat;
          await act(session, preparation.rebuildSeats.includes(seat) ? { type: 'place', mines: [edge] } : { type: 'ready' });
        }
        await panel.waitFor();
        assert.ok((await get(actor)).selfMemos.every(entry => entry === null), 'next round clears all notes');
        await tap(page, slot);
        assert.equal(await dialog.locator('.edge-selected').count(), 0, 'next round does not restore the abandoned draft');
        await tap(page, dialog.getByRole('button', { name: '닫기', exact: true }));
        transitionChecks.push('round-end', 'new-round');
      }
      results.push({ ...scenario, code: actor.code, offsets, scroll, touchClicks,
        transitionChecks,
        checks: 'mobile memo shortcut; inside-padding/backdrop; visible controls; offset touch selection; touch scrolling; arbitrary board; creator colors; create/edit/save/refresh/delete; private board overlay; draft survives turn change and board choice; off-turn create/edit/delete' });
      console.log(`PASS mobile memos ${width}x${height}, grid ${gridSize}, room ${actor.code}`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser runtime errors');
  await writeFile(new URL('results.json', output), JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
