import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.AFTERIMAGE_URL || process.env.MINDMINER_URL || 'http://127.0.0.1:7777';
const shots = new URL('../outputs/qa/', import.meta.url);
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const contexts = [];
const errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}

async function pageFor(viewport = { width: 1440, height: 1100 }) {
  const context = await browser.newContext({ viewport, locale: 'ko-KR' });
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => {
    if (['script', 'stylesheet'].includes(request.resourceType())) {
      errors.push(`Asset failed: ${new URL(request.url()).pathname}`);
    }
  });
  return page;
}

async function open(page, url = base) {
  await page.goto(url);
  await page.locator('main[data-hydrated="true"]').waitFor();
}

async function click(page, name) {
  const button = page.getByRole('button', { name, exact: typeof name === 'string' });
  await until(async () => await button.isVisible() && await button.isEnabled(), `enabled button ${name}`);
  await button.click();
}

async function membership(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('mindminer.membership.v1')));
}

async function chooseBasicRole(page) {
  const picker = page.getByLabel('내 특수 능력 선택', { exact: true });
  await picker.waitFor();
  await picker.selectOption('trapper');
  await until(async () => {
    const view = await getView(page);
    return view.players.find(player => player.id === view.selfId)?.role === 'trapper';
  }, 'manual role saved');
}

async function getView(page) {
  const session = await membership(page);
  const response = await page.request.get(`${base}/api/rooms/${session.code}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  assert.equal(response.status(), 200);
  assert.match(response.headers()['cache-control'], /no-store/);
  const { view } = await response.json();
  assert.equal('boards' in view, false);
  return view;
}

async function action(page, value) {
  const session = await membership(page);
  const view = await getView(page);
  return page.request.post(`${base}/api/rooms/${session.code}/actions`, {
    headers: { Authorization: `Bearer ${session.token}` },
    data: { action: value, revision: view.revision },
  });
}

async function setting(page, label, key, value) {
  const select = page.getByLabel(label, { exact: true });
  await until(async () => await select.isEnabled(), `editable ${label}`);
  await select.selectOption(String(value));
  await until(async () => (await getView(page))[key] === value, `automatic ${key} update`);
  assert.equal(await page.getByRole('button', { name: '설정 저장', exact: true }).count(), 0);
}

async function join(code, name) {
  const page = await pageFor();
  await open(page, `${base}/?room=${code}`);
  await page.getByLabel('플레이어 이름').fill(name);
  await click(page, '입장하기');
  await until(async () => !!(await membership(page)), `${name} membership`);
  return page;
}

async function assertRoster(pages, seatedIds, waitingIds, seatCount) {
  for (const page of pages) {
    await page.locator('.lobby').waitFor();
    await until(async () => await page.locator('.lobby-seat').count() === seatCount &&
      await page.locator('.waiting-room .waiting-member').count() === waitingIds.length, 'roster rendered on each client');
    const view = await getView(page);
    assert.deepEqual(view.players.map(player => player.id), seatedIds, 'ordered playing members');
    assert.deepEqual(view.players.map(player => player.seat), seatedIds.map((_, seat) => seat), 'contiguous seats');
    assert.deepEqual(view.spectators.map(player => player.id), waitingIds, 'FIFO waiting members');
    assert.equal(view.playerCount, seatCount);
  }
}

function assertSpectatorPrivacy(view) {
  assert.equal(view.spectators.some(member => member.id === view.selfId), true);
  assert.equal('ownMines' in view, false);
  assert.equal('boards' in view, false);
  assert.equal('privateResult' in view, false);
  assert.equal(view.players.every(player => !('coins' in player)), true, 'observers receive no private coin balances');
}

async function assertReadOnlyBoard(page) {
  await page.locator('.game-board, [data-testid="board-choice"]').first().waitFor();
  assert.equal(await page.locator('.game-board [role="button"]').count(), 0, 'spectator board has no playable controls');
  assert.equal(await page.getByRole('button', { name: /이 배치로 준비 완료/ }).count(), 0);
  assert.equal(await page.locator('.hint-modal').count(), 0);
  assert.equal(await page.locator('.edge-mined').count(), 0);
}

async function winOnRight(page, gridSize) {
  await chooseBoard(page);
  await click(page, `출발점 ${gridSize + 1}에서 시작`);
  for (let row = gridSize - 1; row >= 0; row--) {
    await click(page, `${row + 1}행 ${row + 1}열로 이동`);
  }
}

async function chooseBoard(page) {
  const view = await getView(page);
  if (view.boardOwnerSeat >= 0) return;
  const ownerSeat = (view.activeSeat + 1) % view.playerCount;
  await page.getByTestId(`choose-board-${ownerSeat}`).click();
  await until(async () => (await getView(page)).boardOwnerSeat === ownerSeat, 'board selected');
}

async function assertDenseGridTargets(page) {
  const board = page.locator('.game-board');
  await board.scrollIntoViewIfNeeded();
  const misses = await board.evaluate(svg => {
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error('Board has no screen transformation');
    const misses = [];
    for (const group of svg.querySelectorAll('.board-edge')) {
      const target = group.querySelector('.edge-target');
      const stroke = group.querySelector('.edge-stroke');
      if (!target || !stroke) continue; // Unmineable base edges have no target.
      const x1 = Number(stroke.getAttribute('x1'));
      const y1 = Number(stroke.getAttribute('y1'));
      const x2 = Number(stroke.getAttribute('x2'));
      const y2 = Number(stroke.getAttribute('y2'));
      const expected = target.getAttribute('aria-label');
      for (const fraction of [.3, .4, .5, .6, .7]) {
        const point = svg.createSVGPoint();
        point.x = x1 + (x2 - x1) * fraction;
        point.y = y1 + (y2 - y1) * fraction;
        const screen = point.matrixTransform(matrix);
        const actual = document.elementFromPoint(screen.x, screen.y);
        if (actual !== target) misses.push({ expected, fraction, actual: actual?.getAttribute('aria-label') ?? actual?.tagName ?? null });
      }
    }
    return misses;
  });
  assert.deepEqual(misses, [], 'dense-grid segment targets must not capture clicks on neighboring segments');
}

try {
  const host = await pageFor();
  await open(host);
  await host.getByLabel('플레이어 이름').fill('자리방장');
  await click(host, '방 만들기');
  await host.locator('.lobby').waitFor();
  await setting(host, '플레이 인원', 'playerCount', 6);
  await setting(host, '라운드당 힌트 코인', 'hintCoins', 2);
  await setting(host, '총 라운드', 'totalRounds', 1);
  await setting(host, '그리드 난이도', 'gridSize', 6);
  const { code } = await membership(host);
  const pages = [host];
  for (let index = 1; index < 8; index++) {
    pages.push(await join(code, `자리참가${index + 1}`));
  }
  const initial = await getView(host);
  const ids = [];
  for (const page of pages) ids.push((await getView(page)).selfId);
  assert.deepEqual(initial.players.map(player => player.id), ids.slice(0, 6), 'new guests automatically take available seats');
  assert.deepEqual(initial.spectators.map(player => player.id), ids.slice(6), 'full room retains overflow guests');
  await assertRoster(pages, ids.slice(0, 6), ids.slice(6), 6);

  await setting(host, '플레이 인원', 'playerCount', 4);
  await assertRoster(pages, ids.slice(0, 4), [...ids.slice(6), ...ids.slice(4, 6)], 4);
  await setting(host, '플레이 인원', 'playerCount', 6);
  const sixSeats = [...ids.slice(0, 4), ids[6], ids[7]];
  await assertRoster(pages, sixSeats, [ids[4], ids[5]], 6);

  await click(host, '자리참가2 대기석으로');
  const fiveSeats = sixSeats.filter(id => id !== ids[1]);
  await assertRoster(pages, fiveSeats, [ids[4], ids[5], ids[1]], 6);
  assert.equal(await host.getByRole('button', { name: /게임 시작하기/ }).isDisabled(), true, 'manual demotion leaves a vacancy until assigned');
  const forbiddenSeat = await action(pages[1], { type: 'seat', playerId: ids[1], seated: true });
  assert.equal(forbiddenSeat.status(), 403, 'only the host can assign a waiting member');
  await click(host, '자리참가5 참가석으로');
  const finalSeats = [...fiveSeats, ids[4]];
  await assertRoster(pages, finalSeats, [ids[5], ids[1]], 6);
  assert.equal(await pages[1].getByRole('button', { name: /대기석으로|참가석으로/ }).count(), 0, 'guests have no host seat controls');

  // Small screens need both the roster controls and a dense six-division board.
  await host.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['dark', 'light']) {
    await click(host, theme === 'dark' ? '다크 모드' : '라이트 모드');
    assert.equal(await host.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${theme} waiting room mobile overflow`);
    await host.screenshot({ path: new URL(`roster-mobile-${theme}.png`, shots).pathname, fullPage: true });
  }
  await click(host, '다크 모드');
  await host.setViewportSize({ width: 1440, height: 1100 });
  await host.screenshot({ path: new URL('roster-lobby-desktop.png', shots).pathname, fullPage: true });

  await click(host, /게임 시작하기/);
  const byId = new Map(ids.map((id, index) => [id, pages[index]]));
  const playingPages = finalSeats.map(id => byId.get(id));
  const observer = pages[5];
  await observer.getByText('관전 중', { exact: true }).first().waitFor();
  await assertReadOnlyBoard(observer);
  const placementObserver = await getView(observer);
  assert.equal(placementObserver.phase, 'placing');
  assertSpectatorPrivacy(placementObserver);
  const deniedPlacement = await action(observer, { type: 'place', mines: [] });
  assert.equal(deniedPlacement.status(), 403);
  await playingPages[0].locator('.stage-placement').waitFor();
  await assertDenseGridTargets(playingPages[0]);
  for (const page of playingPages) {
    await page.locator('.stage-placement').waitFor();
    await chooseBasicRole(page);
    assert.equal(await page.locator('.game-board .board-node').count(), 28, 'six-division node count');
    assert.equal(await page.locator('.game-board .board-edge').count(), 63, 'six-division edge count');
    await click(page, '선분 5-0~6-0, 지뢰 설치');
  }
  await observer.reload();
  await observer.locator('main[data-hydrated="true"]').waitFor();
  await assertReadOnlyBoard(observer);
  assertSpectatorPrivacy(await getView(observer));
  await Promise.all(playingPages.map(page => click(page, /이 배치로 준비 완료/)));
  await until(async () => (await getView(host)).phase === 'playing', 'six players complete six-division boards');

  const lateObserver = await join(code, '도중관전자');
  await lateObserver.getByText('관전 중', { exact: true }).first().waitFor();
  await assertReadOnlyBoard(lateObserver);
  assertSpectatorPrivacy(await getView(lateObserver));
  const before = await getView(host);
  const active = byId.get(before.players[before.activeSeat].id);
  await chooseBoard(active);
  await click(active, /힌트 사용하기/);
  await click(active, '선분 5-0~6-0, 힌트 확인');
  await active.getByRole('dialog', { name: '당신만의 단서입니다.' }).waitFor();
  assert.equal(await observer.locator('.hint-modal').count(), 0);
  assert.equal(await lateObserver.locator('.hint-modal').count(), 0);
  assertSpectatorPrivacy(await getView(lateObserver));
  const deniedHint = await action(lateObserver, { type: 'hint', edgeId: '5-0~6-0' });
  assert.equal(deniedHint.status(), 403);
  await click(active, /기억했어요. 닫기/);
  await click(active, '출발점 1에서 시작');
  await until(async () => await lateObserver.locator('.board-pawn').count() === 1, 'late observer sees public pawn');
  await click(active, '6행 1열로 이동');
  await lateObserver.locator('.explosion').waitFor();
  await until(async () => (await getView(host)).activeSeat !== before.activeSeat, 'explosion advances turn');
  await until(async () => await lateObserver.locator('.explosion').count() === 0, 'observer explosion erases');
  assert.equal(await lateObserver.locator('.board-pawn').count(), 0);
  assert.equal(await lateObserver.locator('.edge-mined').count(), 0);
  assert.equal((await getView(lateObserver)).event, null);
  await lateObserver.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['dark', 'light']) {
    await click(lateObserver, theme === 'dark' ? '다크 모드' : '라이트 모드');
    assert.equal(await lateObserver.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${theme} six-division mobile board overflow`);
    await lateObserver.screenshot({ path: new URL(`grid-six-spectator-mobile-${theme}.png`, shots).pathname, fullPage: true });
  }
  const next = await getView(host);
  await winOnRight(byId.get(next.players[next.activeSeat].id), 6);
  await host.locator('.results').waitFor();
  assert.equal((await getView(host)).phase, 'finished');
  await click(host, '대기실로 돌아가기');
  await host.locator('.lobby').waitFor();
  const lobby = await getView(host);
  assert.equal(lobby.phase, 'waiting', 'new game returns to an editable roster');
  assert.equal(lobby.players.every(player => player.score === 3), true, 'new game resets every seat to three victory coins');
  assert.equal(lobby.spectators.length, 3, 'waiting identities survive game restart');

  // A second room verifies the smaller geometry rejects valid IDs from a larger grid.
  const small = await pageFor();
  await open(small);
  await small.getByLabel('플레이어 이름').fill('작은판방장');
  await click(small, '방 만들기');
  await small.locator('.lobby').waitFor();
  await setting(small, '플레이 인원', 'playerCount', 2);
  await setting(small, '라운드당 힌트 코인', 'hintCoins', 0);
  await setting(small, '총 라운드', 'totalRounds', 1);
  await setting(small, '그리드 난이도', 'gridSize', 3);
  const smallCode = (await membership(small)).code;
  const smallGuest = await join(smallCode, '작은판참가');
  await click(small, /게임 시작하기/);
  await small.locator('.stage-placement').waitFor();
  await chooseBasicRole(small);
  await chooseBasicRole(smallGuest);
  assert.equal(await small.locator('.game-board .board-node').count(), 10);
  assert.equal(await small.locator('.game-board .board-edge').count(), 18);
  const invalidPlacement = await action(small, { type: 'place', mines: ['3-0~4-0'] });
  assert.equal(invalidPlacement.status(), 400, 'larger-grid edge cannot be placed on a small board');
  const afterInvalidPlacement = await getView(small);
  assert.equal(afterInvalidPlacement.players.find(player => player.id === afterInvalidPlacement.selfId)?.ready, false);
  await Promise.all([small, smallGuest].map(page => click(page, /이 배치로 준비 완료/)));
  await until(async () => (await getView(small)).phase === 'playing', 'small board ready');
  const smallView = await getView(small);
  const smallActive = smallView.activeSeat === 0 ? small : smallGuest;
  await chooseBoard(smallActive);
  const invalidSpawn = await action(smallActive, { type: 'spawn', nodeId: '4-0' });
  assert.equal(invalidSpawn.status(), 400, 'larger-grid start cannot be used on a small board');
  await winOnRight(smallActive, 3);
  await small.locator('.results').waitFor();
  const smallResult = await getView(small);
  assert.equal(smallResult.winner.coinsTransferred, 1, 'zero hint coins do not prevent the victory coin transfer');
  assert.equal(smallResult.players[smallResult.winner.seat].score, 4);
  assert.equal(smallResult.players[smallResult.winner.ownerSeat].score, 2);
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log('PASS: immediate settings, 6-to-4 demotion, FIFO seat filling, host seat authority, waiting and live spectators, explicit board choices, private hints, ephemeral explosions, grid 3/6 movement and validation, editable game restart, and mobile themes.');
} catch (error) {
  console.error('Browser runtime errors:', errors);
  throw error;
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
