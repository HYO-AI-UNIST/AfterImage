import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { edgeId, getBoard, hasSafePath, maxMines } from '../lib/geometry.ts';

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
  assert.equal('boards' in view, false, 'the internal board store is never exposed');
  return view;
}

async function action(page, action) {
  const session = await membership(page);
  const view = await getView(page);
  return page.request.post(`${base}/api/rooms/${session.code}/actions`, {
    headers: { Authorization: `Bearer ${session.token}` },
    data: { action, revision: view.revision },
  });
}

async function click(page, name) {
  const button = page.getByRole('button', { name, exact: typeof name === 'string' });
  if (typeof name === 'string' && name.startsWith('선분 ')) {
    // Horizontal SVG lines have a zero-height DOM box despite their visible
    // stroke. Click their actual screen midpoint instead of bounding-box tests.
    await until(async () => await button.count() === 1 && await button.isEnabled(), `enabled edge ${name}`);
    await button.evaluate(line => line.scrollIntoView({ block: 'center', inline: 'center' }));
    const point = await button.evaluate(line => {
      const center = new DOMPoint((line.x1.baseVal.value + line.x2.baseVal.value) / 2, (line.y1.baseVal.value + line.y2.baseVal.value) / 2).matrixTransform(line.getScreenCTM());
      return { x: center.x, y: center.y };
    });
    await page.mouse.click(point.x, point.y);
    return;
  }
  await until(async () => await button.isVisible() && await button.isEnabled(), `enabled button ${name}`);
  await button.click();
}

async function join(code, name, viewport) {
  const page = await pageFor(viewport);
  await open(page, `${base}/?room=${code}`);
  await page.getByLabel('플레이어 이름').fill(name);
  await click(page, '입장하기');
  await page.locator('.lobby').waitFor();
  return page;
}

async function placeKnown(pages, minesBySeat) {
  const readyButtons = [];
  for (const [seat, page] of pages.entries()) {
    await chooseBasicRole(page);
    const view = await getView(page);
    const rebuilding = view.placementMode !== 'retained' || view.rebuildSeats.includes(seat);
    if (rebuilding) {
      await page.locator('.stage-placement').waitFor();
      if (view.ownMines.length) await click(page, '배치 모두 지우기');
      for (const id of minesBySeat[seat]) await click(page, `선분 ${id}, 지뢰 설치`);
    } else {
      assert.equal('ownMines' in view, false, 'retained board stays hidden while choosing a new ability');
      assert.equal(await page.getByTestId('confirm-placement').count(), 0, 'retained maker has no placement submit control');
    }
    readyButtons.push({ page, name: rebuilding ? /이 배치로 준비 완료/ : /기존 판으로 준비 완료/ });
  }
  await Promise.all(readyButtons.map(({ page, name }) => click(page, name)));
  await until(async () => (await getView(pages[0])).phase === 'playing', 'all placements committed');
}

async function assertPlayingPrivacy(pages, observer, minesBySeat) {
  let room = await getView(pages[0]);
  assert.equal(room.phase, 'playing');
  if (room.boardOwnerSeat < 0) {
    for (const page of [...pages, observer]) {
      assert.equal('activeBoardMineCount' in await getView(page), false, 'no current board total before selection');
      await until(async () => await page.getByTestId('board-mine-count').count() === 0, 'old count hidden while choosing');
    }
    const ownerSeat = (room.activeSeat + 1) % room.playerCount;
    await pages[room.activeSeat].getByTestId(`choose-board-${ownerSeat}`).click();
    await until(async () => (await getView(pages[0])).boardOwnerSeat === ownerSeat, 'board selected');
    room = await getView(pages[0]);
  }
  const expected = minesBySeat[room.boardOwnerSeat].length;
  for (const page of [...pages, observer]) {
    const view = await getView(page);
    assert.equal('ownMines' in view, false, 'placements are hidden during play');
    assert.equal('revealedBoards' in view, false, 'answers stay hidden until the round ends');
    assert.equal(view.activeBoardMineCount, expected, 'all players and observers receive the current board total');
    await until(async () => {
      const counter = page.getByTestId('board-mine-count');
      return await counter.count() === 1 && new RegExp(`\\b${expected}\\b`).test(await counter.innerText());
    }, 'current board mine count visible to every participant');
    await until(async () => await page.locator('.edge-mined').count() === 0, 'mine locations hidden on board');
  }
  return room;
}

async function winOnRight(page) {
  await click(page, '출발점 5에서 시작');
  for (let row = 3; row >= 0; row--) await click(page, `${row + 1}행 ${row + 1}열로 이동`);
}

async function assertRevealed(pages, observer, minesBySeat, phase) {
  for (const page of [...pages, observer]) {
    await page.getByTestId('round-reveal').waitFor();
    const view = await getView(page);
    assert.equal(view.phase, phase);
    assert.equal('activeBoardMineCount' in view, false);
    const visibleOwners = phase === 'finished' ? view.players : view.players.filter(player => player.seat === view.winner.ownerSeat);
    assert.deepEqual(Object.keys(view.revealedBoards).sort(), visibleOwners.map(player => player.id).sort(), 'only permitted board answers are sent');
    assert.equal(await page.getByRole('group', { name: '정답을 확인할 판 선택' }).getByRole('button').count(), visibleOwners.length, 'selector lists only disclosed boards');
    for (const player of visibleOwners) {
      assert.deepEqual([...view.revealedBoards[player.id]].sort(), [...minesBySeat[player.seat]].sort());
      await page.getByRole('button', { name: `${player.name}의 판 보기`, exact: false }).click();
      const revealed = page.getByTestId('revealed-board');
      assert.equal(await revealed.locator('.edge-mined').count(), minesBySeat[player.seat].length);
      assert.equal(await revealed.locator('[role="button"]').count(), 0, 'revealed board is read-only');
    }
    assert.equal(await page.getByTestId('board-mine-count').count(), 0);
  }
}

try {
  const host = await pageFor();
  await open(host, base);
  await host.getByLabel('플레이어 이름').fill('배치방장');
  await click(host, '방 만들기');
  await host.locator('.lobby').waitFor();
  for (const [label, key, value] of [
    ['플레이 인원', 'playerCount', 2],
    ['라운드당 힌트 코인', 'hintCoins', 2],
    ['총 라운드', 'totalRounds', 2],
  ]) {
    const select = host.getByLabel(label, { exact: true });
    await until(async () => await select.isEnabled(), `editable ${label}`);
    await select.selectOption(String(value));
    await until(async () => (await getView(host))[key] === value, `saved ${key}`);
  }
  const { code } = await membership(host);
  const guest = await join(code, '배치참가');
  const observer = await join(code, '배치관전자', { width: 390, height: 844 });
  const players = [host, guest];
  const audience = await getView(observer);
  assert.equal(audience.spectators.some(player => player.id === audience.selfId), true);
  await click(host, /게임 시작하기/);
  await host.locator('.stage-placement').waitFor();
  await chooseBasicRole(host);

  const limit = maxMines(4);
  const { edges } = getBoard(4);
  const rightPath = new Set(Array.from({ length: 4 }, (_, row) => edgeId(`${row}-${row}`, `${row + 1}-${row + 1}`)));
  const candidates = edges.filter(edge => !edge.base && !rightPath.has(edge.id)).map(edge => edge.id);
  assert.equal(hasSafePath(candidates.slice(0, limit + 1), 4), true, 'over-cap API sample still has a valid escape route');
  for (const id of candidates.slice(0, limit)) await click(host, `선분 ${id}, 지뢰 설치`);
  assert.equal(await host.locator('.edge-mined').count(), limit);
  assert.match(await host.locator('.placement-counter').innerText(), new RegExp(`${limit}\\s*/\\s*${limit}`));
  const blockedAddition = host.getByRole('button', { name: `선분 ${candidates[limit]}, 지뢰 설치`, exact: true });
  assert.equal(await blockedAddition.isDisabled(), true, 'further mine additions are disabled at the limit');
  await blockedAddition.dispatchEvent('click');
  assert.equal(await host.locator('.edge-mined').count(), limit, 'disabled additions also guard their click handlers');
  assert.equal(await host.getByTestId('confirm-placement').isEnabled(), true, 'a safe board at the cap can be submitted');
  await click(host, `선분 ${candidates[0]}, 지뢰 제거`);
  assert.equal(await host.locator('.edge-mined').count(), limit - 1, 'mines remain removable at the cap');
  await click(host, `선분 ${candidates[limit]}, 지뢰 설치`);
  assert.equal(await host.locator('.edge-mined').count(), limit);
  const rejected = await action(host, { type: 'place', mines: candidates.slice(0, limit + 1) });
  assert.equal(rejected.status(), 400, 'the server rejects over-cap placements independently of the client');
  assert.equal((await getView(host)).players[0].ready, false);

  for (let trial = 0; trial < 12; trial++) {
    await click(host, /랜덤 배치/);
    assert.ok(await host.locator('.edge-mined').count() <= limit, 'random placements respect the mine cap');
    assert.equal(await host.getByTestId('confirm-placement').isEnabled(), true, 'random placements retain a safe route');
  }
  await click(host, '배치 모두 지우기');
  const firstMines = [['3-0~4-0'], ['3-0~4-0', '2-0~3-0']];
  await placeKnown(players, firstMines);
  const first = await assertPlayingPrivacy(players, observer, firstMines);
  const active = players[first.activeSeat];
  await active.setViewportSize({ width: 390, height: 844 });
  assert.equal(await active.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'active mine count mobile horizontal overflow');
  await active.screenshot({ path: new URL('mines-active-count-mobile-dark.png', shots).pathname, fullPage: true });
  await active.setViewportSize({ width: 1440, height: 1000 });
  await click(active, /힌트 사용하기/);
  await click(active, '선분 3-0~4-0, 힌트 확인');
  await active.getByRole('dialog', { name: '당신만의 단서입니다.' }).waitFor();
  await click(active, /기억했어요. 닫기/);
  await assertPlayingPrivacy(players, observer, firstMines);
  const hinted = await getView(active);
  assert.equal(hinted.players[hinted.activeSeat].coins, 1);
  await click(active, '출발점 1에서 시작');
  await click(active, '4행 1열로 이동');
  await until(async () => {
    const next = await getView(host);
    return next.activeSeat !== first.activeSeat && !next.event;
  }, 'explosion advances the turn and its animation expires');
  const second = await assertPlayingPrivacy(players, observer, firstMines);
  assert.notEqual(firstMines[first.boardOwnerSeat].length, firstMines[second.boardOwnerSeat].length, 'next turn shows the new board count');
  await winOnRight(players[second.activeSeat]);
  await assertRevealed(players, observer, firstMines, 'roundEnd');
  await host.screenshot({ path: new URL('mines-round-reveal-desktop-dark.png', shots).pathname, fullPage: true });
  for (const theme of ['dark', 'light']) {
    await click(observer, theme === 'dark' ? '다크 모드' : '라이트 모드');
    assert.equal(await observer.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `round reveal mobile ${theme} horizontal overflow`);
    await observer.screenshot({ path: new URL(`mines-round-reveal-mobile-${theme}.png`, shots).pathname, fullPage: true });
  }

  await click(host, /다음 라운드 준비하기/);
  for (const page of [...players, observer]) {
    await until(async () => (await getView(page)).phase === 'placing', 'next round begins');
    const view = await getView(page);
    assert.equal('revealedBoards' in view, false, 'previous round answers are removed from the API');
    assert.equal('activeBoardMineCount' in view, false);
    await until(async () => await page.getByTestId('round-reveal').count() === 0, 'previous answer panel removed');
    const self = view.players.find(player => player.id === view.selfId);
    if (self && view.rebuildSeats.includes(self.seat)) {
      assert.deepEqual(view.ownMines, firstMines[self.seat], 'only rebuilding maker can inspect the prior placement');
      await page.getByTestId('confirm-placement').waitFor();
    } else {
      assert.equal('ownMines' in view, false, 'retained makers and spectators cannot inspect saved placements');
      assert.equal(await page.locator('.edge-mined').count(), 0);
      if (self) await page.getByTestId('confirm-ready').waitFor();
    }
  }
  const nextPreparation = await getView(host);
  const replacements = [['2-0~3-0'], []];
  const finalMines = firstMines.map((mines, seat) => nextPreparation.rebuildSeats.includes(seat) ? replacements[seat] : mines);
  await placeKnown(players, finalMines);
  const last = await assertPlayingPrivacy(players, observer, finalMines);
  await winOnRight(players[last.activeSeat]);
  await assertRevealed(players, observer, finalMines, 'finished');
  await host.screenshot({ path: new URL('mines-final-reveal-desktop-dark.png', shots).pathname, fullPage: true });
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log('PASS: placement cap, removal and random placement, API enforcement, public current-board mine totals, hints and turn changes, successful-board round reveal/all-board final reveal, selective rebuilding with retained-board secrecy, and mobile themes.');
} catch (error) {
  console.error('Browser runtime errors:', errors);
  throw error;
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
