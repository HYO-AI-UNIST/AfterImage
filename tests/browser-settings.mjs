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

async function pageFor(viewport = { width: 1440, height: 1000 }) {
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

async function open(page, url) {
  await page.goto(url);
  await page.locator('main[data-hydrated="true"]').waitFor();
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

async function click(page, name) {
  const button = page.getByRole('button', { name, exact: typeof name === 'string' });
  await until(async () => await button.isVisible() && await button.isEnabled(), `enabled button ${name}`);
  await button.click();
}

async function assertTheme(page, theme) {
  await until(async () => await page.locator('html').getAttribute('data-theme') === theme, `${theme} theme`);
  assert.equal(await page.getByRole('button', { name: theme === 'dark' ? '다크 모드' : '라이트 모드', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: theme === 'dark' ? '라이트 모드' : '다크 모드', exact: true }).getAttribute('aria-pressed'), 'false');
}

async function setSettings(page, playerCount, hintCoins, totalRounds, gridSize = 4) {
  for (const [label, key, value] of [
    ['플레이 인원', 'playerCount', playerCount],
    ['라운드당 힌트 코인', 'hintCoins', hintCoins],
    ['총 라운드', 'totalRounds', totalRounds],
    ['그리드 난이도', 'gridSize', gridSize],
  ]) {
    const select = page.getByLabel(label, { exact: true });
    await until(async () => await select.isEnabled(), `editable setting ${label}`);
    await select.selectOption(String(value));
    await until(async () => (await getView(page))[key] === value, `automatically saved ${key}`);
  }
  assert.equal(await page.getByRole('button', { name: '설정 저장', exact: true }).count(), 0);
}

async function placeMines(pages) {
  const readyButtons = [];
  for (const page of pages) {
    await chooseBasicRole(page);
    const view = await getView(page);
    const seat = view.players.find(player => player.id === view.selfId).seat;
    const rebuilding = view.placementMode !== 'retained' || view.rebuildSeats.includes(seat);
    if (rebuilding) {
      await page.locator('.stage-placement').waitFor();
      if (!view.ownMines.includes('3-0~4-0')) await click(page, '선분 3-0~4-0, 지뢰 설치');
    } else {
      assert.equal('ownMines' in view, false, 'retained board is not disclosed during preparation');
      assert.equal(await page.getByTestId('confirm-placement').count(), 0);
    }
    readyButtons.push({ page, name: rebuilding ? /이 배치로 준비 완료/ : /기존 판으로 준비 완료/ });
  }
  await Promise.all(readyButtons.map(({ page, name }) => click(page, name)));
  await until(async () => (await getView(pages[0])).phase === 'playing', 'everyone ready');
}

async function winOnRight(page) {
  await chooseBoard(page);
  await click(page, '출발점 5에서 시작');
  for (let row = 3; row >= 0; row--) {
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

try {
  const host = await pageFor();
  await open(host, base);
  await assertTheme(host, 'dark');
  await host.getByLabel('플레이어 이름').fill('설정방장');
  await click(host, '방 만들기');
  await host.locator('.lobby').waitFor();
  assert.equal(await host.getByLabel('플레이 인원', { exact: true }).inputValue(), '6');
  assert.equal(await host.getByLabel('라운드당 힌트 코인', { exact: true }).inputValue(), '3');
  assert.equal(await host.getByLabel('총 라운드', { exact: true }).inputValue(), '7');
  assert.equal(await host.getByLabel('그리드 난이도', { exact: true }).inputValue(), '4');
  await setSettings(host, 3, 2, 2);
  await host.screenshot({ path: new URL('settings-lobby-dark.png', shots).pathname, fullPage: true });
  await click(host, '라이트 모드');
  await assertTheme(host, 'light');
  assert.equal(await host.evaluate(() => localStorage.getItem('mindminer.theme.v1')), 'light');
  await host.reload();
  await host.locator('main[data-hydrated="true"]').waitFor();
  await host.locator('.lobby').waitFor();
  await assertTheme(host, 'light');
  assert.equal(await host.getByLabel('플레이 인원', { exact: true }).inputValue(), '3');
  await host.screenshot({ path: new URL('settings-lobby-light.png', shots).pathname, fullPage: true });

  const { code } = await membership(host);
  const pages = [host];
  for (let index = 1; index < 3; index++) {
    const guest = await pageFor();
    await open(guest, `${base}/?room=${code}`);
    await assertTheme(guest, 'dark');
    await guest.getByLabel('플레이어 이름').fill(`설정참가${index}`);
    await click(guest, '입장하기');
    await guest.locator('.lobby').waitFor();
    for (const label of ['플레이 인원', '라운드당 힌트 코인', '총 라운드', '그리드 난이도']) {
      assert.equal(await guest.getByLabel(label, { exact: true }).isDisabled(), true, `guest cannot edit ${label}`);
    }
    assert.equal(await guest.getByRole('button', { name: '설정 저장', exact: true }).count(), 0);
    pages.push(guest);
  }
  await until(async () => (await getView(host)).players.length === 3, 'three players join');
  const guestSession = await membership(pages[1]);
  const current = await getView(pages[1]);
  const denied = await pages[1].request.post(`${base}/api/rooms/${code}/actions`, {
    headers: { Authorization: `Bearer ${guestSession.token}` },
    data: { action: { type: 'settings', settings: { playerCount: 3, hintCoins: 2, totalRounds: 2, gridSize: 4 } }, revision: current.revision },
  });
  assert.equal(denied.status(), 403, 'host authority is enforced by the API');
  const full = await host.request.post(`${base}/api/rooms/${code}/join`, { data: { name: '정원초과' } });
  assert.equal(full.status(), 201, 'a full room admits new members to the waiting area');
  const overflow = await full.json();
  assert.equal(overflow.view.players.length, 3);
  assert.equal(overflow.view.spectators.some(member => member.id === overflow.view.selfId), true);

  await click(host, '다크 모드');
  await assertTheme(host, 'dark');
  await click(host, /게임 시작하기/);
  await placeMines(pages);
  const initial = await getView(host);
  assert.equal(initial.playerCount, 3);
  assert.equal(initial.hintCoins, 2);
  assert.equal(initial.totalRounds, 2);
  assert.equal(initial.boardMode, 'choice');
  assert.equal(initial.turnNumber, 1);
  assert.equal(initial.boardOwnerSeat, -1);
  for (const page of pages) {
    const view = await getView(page);
    assert.equal(view.players.find(player => player.id === view.selfId).coins, 2);
    assert.notEqual(view.activeSeat, view.boardOwnerSeat);
  }
  await host.screenshot({ path: new URL('settings-playing-dark.png', shots).pathname, fullPage: true });

  // Three failures complete the first circuit; each new turn chooses a board.
  for (let attempt = 0; attempt < 3; attempt++) {
    await until(async () => !(await getView(host)).event, 'settled turn before explosion');
    const before = await getView(host);
    assert.equal(before.boardOwnerSeat, -1);
    await chooseBoard(pages[before.activeSeat]);
    await click(pages[before.activeSeat], '출발점 1에서 시작');
    await click(pages[before.activeSeat], '4행 1열로 이동');
    await until(async () => (await getView(host)).event?.type === 'explosion', 'mine explodes');
    await until(async () => {
      const next = await getView(host);
      return next.activeSeat === (before.activeSeat + 1) % 3 && next.turnNumber === before.turnNumber + 1;
    }, 'configured turn order advances');
  }
  await until(async () => !(await getView(host)).event, 'third explosion completes');
  const rotated = await getView(host);
  assert.equal(rotated.rotation, 0);
  assert.equal(rotated.turnNumber, 4);
  assert.equal(rotated.activeSeat, initial.starterSeat);
  assert.equal(rotated.boardOwnerSeat, -1);
  const winnerPage = pages[rotated.activeSeat];
  await chooseBoard(winnerPage);
  await click(winnerPage, /힌트 사용하기/);
  await click(winnerPage, '선분 3-0~4-0, 힌트 확인');
  await winnerPage.getByRole('dialog', { name: '당신만의 단서입니다.' }).waitFor();
  await click(winnerPage, /기억했어요. 닫기/);
  const hinted = await getView(winnerPage);
  assert.equal(hinted.players.find(player => player.id === hinted.selfId).coins, 1);
  await winOnRight(winnerPage);
  await host.locator('.results').waitFor();
  const roundOne = await getView(host);
  assert.equal(roundOne.phase, 'roundEnd');
  assert.equal(roundOne.scoringMode, 'transfer');
  assert.equal(roundOne.winner.coinsTransferred, 1, 'remaining hints do not increase the victory coin transfer');
  assert.equal(roundOne.winner.ownerSeat, hinted.boardOwnerSeat);
  assert.equal(roundOne.players[roundOne.winner.seat].score, 4);
  assert.equal(roundOne.players[roundOne.winner.ownerSeat].score, 2);
  assert.equal(roundOne.winner.seat, rotated.activeSeat);

  await click(host, /다음 라운드 준비하기/);
  await host.getByLabel('내 특수 능력 선택', { exact: true }).waitFor();
  const secondRound = await getView(host);
  assert.equal(secondRound.round, 2);
  assert.equal(secondRound.starterSeat, (roundOne.winner.seat + 1) % 3);
  assert.deepEqual(secondRound.players.map(player => player.score), roundOne.players.map(player => player.score), 'victory coin balances persist instead of refilling');
  assert.deepEqual(secondRound.rebuildSeats, [roundOne.winner.ownerSeat]);
  for (const page of pages) {
    const view = await getView(page);
    assert.equal(view.players.find(player => player.id === view.selfId).coins, 2, 'configured hint coins reset each round');
    const self = view.players.find(player => player.id === view.selfId);
    if (view.rebuildSeats.includes(self.seat)) assert.deepEqual(view.ownMines, ['3-0~4-0'], 'rebuilding maker can start from the previous placement');
    else assert.equal('ownMines' in view, false, 'retained boards stay private in the next preparation');
  }
  await placeMines(pages);
  const lastRound = await getView(host);
  await winOnRight(pages[lastRound.activeSeat]);
  await host.locator('.results').waitFor();
  const finished = await getView(host);
  assert.equal(finished.phase, 'finished', 'game ends after the configured round count');
  assert.equal(finished.round, 2);
  assert.equal(finished.winner.coinsTransferred, 1, 'unused hints do not add victory coins');
  assert.equal(finished.players[lastRound.activeSeat].score, 3, 'last-round winner recovers one coin lost in round one');
  assert.deepEqual(finished.champions, [roundOne.winner.seat], 'highest balance wins even when another player won the last round');
  assert.equal(finished.players.reduce((sum, player) => sum + player.score, 0), 9, 'three players preserve the initial nine victory coins');

  const mobile = await pageFor({ width: 390, height: 844 });
  await open(mobile, base);
  await assertTheme(mobile, 'dark');
  await mobile.getByLabel('플레이어 이름').fill('모바일방장');
  await click(mobile, '방 만들기');
  await mobile.locator('.lobby').waitFor();
  await setSettings(mobile, 6, 0, 1);
  await until(async () => await mobile.locator('.lobby-seat').count() === 6, 'six visible seats');
  assert.equal(await mobile.getByLabel('플레이 인원', { exact: true }).locator('option[value="7"], option[value="8"]').count(), 0);
  for (const theme of ['dark', 'light']) {
    await click(mobile, theme === 'dark' ? '다크 모드' : '라이트 모드');
    await assertTheme(mobile, theme);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `mobile ${theme} horizontal overflow`);
    await mobile.screenshot({ path: new URL(`settings-mobile-${theme}.png`, shots).pathname, fullPage: true });
  }
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log('PASS: automatic host-only settings, configured seats and waiting area, three-player board choices, independent hint/victory coins, persistent coin balances and highest-balance final winner, two-round finish, persistent per-browser themes, and six-seat mobile layout.');
} catch (error) {
  console.error('Browser runtime errors:', errors);
  throw error;
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
