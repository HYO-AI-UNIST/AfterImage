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
    if (['script', 'stylesheet'].includes(request.resourceType())) errors.push(`Asset failed: ${new URL(request.url()).pathname}`);
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
  const response = await page.request.get(`${base}/api/rooms/${session.code}`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(response.status(), 200);
  assert.match(response.headers()['cache-control'], /no-store/);
  const data = await response.json();
  assert.equal('boards' in data.view, false);
  return data.view;
}

async function chooseBoard(page, ownerSeat) {
  const view = await getView(page);
  if (view.boardOwnerSeat >= 0) return;
  const owner = ownerSeat ?? (view.activeSeat + 1) % view.playerCount;
  await page.getByTestId(`choose-board-${owner}`).click();
  await until(async () => (await getView(page)).boardOwnerSeat === owner, 'board selected');
}

try {
  const host = await pageFor();
  await open(host, base);
  await host.getByRole('heading', { name: '잔상', exact: true }).waitFor();
  await host.evaluate(() => document.fonts.ready);
  await host.screenshot({ path: new URL('home-desktop.png', shots).pathname, fullPage: true });
  await host.getByLabel('플레이어 이름').fill('테스터1');
  await host.getByRole('button', { name: '방 만들기', exact: true }).click();
  await host.locator('.lobby').waitFor();
  const { code } = await membership(host);
  const pages = [host];
  for (let i = 1; i < 6; i++) {
    const page = await pageFor();
    await open(page, `${base}/?room=${code}`);
    await page.getByLabel('플레이어 이름').fill(`테스터${i + 1}`);
    await page.getByRole('button', { name: '입장하기', exact: true }).click();
    await page.locator('.lobby').waitFor();
    pages.push(page);
  }
  await until(async () => (await getView(host)).players.length === 6, 'six players join');
  await host.screenshot({ path: new URL('lobby-desktop.png', shots).pathname, fullPage: true });
  const full = await host.request.post(`${base}/api/rooms/${code}/join`, { data: { name: '일곱번째' } });
  assert.equal(full.status(), 201);
  const waiting = await full.json();
  assert.equal(waiting.view.players.length, 6);
  assert.equal(waiting.view.spectators.some(member => member.id === waiting.view.selfId), true);
  await host.getByRole('button', { name: /게임 시작하기/ }).click();
  for (const page of pages) await page.locator('.stage-placement').waitFor();
  await host.screenshot({ path: new URL('placement-desktop.png', shots).pathname, fullPage: true });

  for (const page of pages) {
    await chooseBasicRole(page);
    await page.getByRole('button', { name: '선분 3-0~4-0, 지뢰 설치', exact: true }).click();
  }
  await Promise.all(pages.map(page => page.getByRole('button', { name: /이 배치로 준비 완료/ }).click()));
  await until(async () => (await getView(host)).phase === 'playing', 'all placement ready');
  const initial = await getView(host);
  const activePage = pages[initial.activeSeat];
  const otherPage = pages[(initial.activeSeat + 1) % 6];
  assert.equal(initial.boardOwnerSeat, -1);
  assert.equal('ownMines' in initial, false);
  await chooseBoard(activePage);
  await activePage.getByRole('button', { name: /힌트 사용하기/ }).click();
  await activePage.getByRole('button', { name: '선분 3-0~4-0, 힌트 확인', exact: true }).click();
  await activePage.getByRole('dialog', { name: '당신만의 단서입니다.' }).waitFor();
  assert.equal(await otherPage.locator('.hint-modal').count(), 0);
  await activePage.screenshot({ path: new URL('private-hint-desktop.png', shots).pathname, fullPage: true });
  await activePage.getByRole('button', { name: /기억했어요. 닫기/ }).click();
  assert.equal(await activePage.locator('.hint-modal').count(), 0);
  assert.equal(await activePage.locator('.edge-selected').count(), 0);
  const hintView = await getView(activePage);
  assert.equal(hintView.players.find(p => p.id === hintView.selfId).coins, 2);
  assert.equal('privateResult' in hintView, false);
  await activePage.reload();
  await activePage.getByRole('button', { name: '출발점 1에서 시작' }).waitFor();
  assert.equal(await activePage.locator('.hint-modal').count(), 0);
  await activePage.getByRole('button', { name: '출발점 1에서 시작' }).click();
  await activePage.getByRole('button', { name: '4행 1열로 이동' }).click();
  await otherPage.locator('.explosion').waitFor();
  await otherPage.screenshot({ path: new URL('explosion-spectator.png', shots).pathname, fullPage: true });
  await until(async () => (await getView(host)).activeSeat !== initial.activeSeat, 'explosion moves turn');
  await until(async () => await otherPage.locator('.explosion').count() === 0, 'explosion erased');
  assert.equal(await otherPage.locator('.edge-mined').count(), 0);
  assert.equal(await otherPage.locator('.board-pawn').count(), 0);

  const next = await getView(host);
  const winner = pages[next.activeSeat];
  await chooseBoard(winner);
  await winner.getByRole('button', { name: '출발점 5에서 시작' }).click();
  for (let row = 3; row >= 0; row--) {
    await winner.getByRole('button', { name: `${row + 1}행 ${row + 1}열로 이동` }).click();
  }
  await host.locator('.results').waitFor();
  const result = await getView(host);
  assert.equal(result.scoringMode, 'transfer');
  assert.equal(result.winner.coinsTransferred, 1);
  assert.equal(result.winner.ownerSeat, (next.activeSeat + 1) % result.playerCount);
  assert.equal(result.players[result.winner.seat].score, 4, 'winner receives one victory coin');
  assert.equal(result.players[result.winner.ownerSeat].score, 2, 'completed board creator pays one victory coin');
  assert.equal('remainingCoins' in result.winner, false, 'round result does not expose private hint balances');
  assert.equal(result.winner.seat, next.activeSeat);
  assert.deepEqual(Object.keys(result.revealedBoards), [result.players[result.winner.ownerSeat].id], 'only the completed board is revealed');
  await host.screenshot({ path: new URL('result-desktop.png', shots).pathname, fullPage: true });
  await host.getByRole('button', { name: /다음 라운드 준비하기/ }).click();
  await host.getByLabel('내 특수 능력 선택', { exact: true }).waitFor();
  const round2 = await getView(host);
  assert.equal(round2.round, 2);
  assert.equal(round2.starterSeat, (result.winner.seat + 1) % 6);
  assert.deepEqual(round2.players.map(player => player.score), result.players.map(player => player.score), 'victory coins persist across rounds');
  assert.deepEqual(round2.rebuildSeats, [result.winner.ownerSeat], 'only the coin-losing maker may rebuild');
  const hostSeat = round2.players.find(player => player.id === round2.selfId).seat;
  await host.getByTestId(round2.rebuildSeats.includes(hostSeat) ? 'confirm-placement' : 'confirm-ready').waitFor();
  if (!round2.rebuildSeats.includes(hostSeat)) assert.equal('ownMines' in round2, false, 'retained maker does not see their saved board');

  const mobile = await pageFor({ width: 390, height: 844 });
  await open(mobile, base);
  await mobile.evaluate(() => document.fonts.ready);
  await mobile.screenshot({ path: new URL('home-mobile.png', shots).pathname, fullPage: true });
  await mobile.getByRole('button', { name: /혼자 연습하기/ }).click();
  await mobile.locator('.stage-placement').waitFor();
  await mobile.getByRole('button', { name: /랜덤 배치/ }).click();
  await mobile.screenshot({ path: new URL('demo-placement-mobile.png', shots).pathname, fullPage: true });
  await mobile.getByRole('button', { name: /이 배치로 준비 완료/ }).click();
  await mobile.getByTestId('choose-board-1').click();
  await mobile.getByRole('button', { name: '출발점 3에서 시작' }).click();
  await mobile.screenshot({ path: new URL('demo-playing-mobile.png', shots).pathname, fullPage: true });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'mobile horizontal overflow');
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log('PASS: six browser contexts, private hints, reload, public explosion and erasure, scoring, winner-left round, demo and mobile.');
} catch (error) {
  console.error('Browser runtime errors:', errors);
  throw error;
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
