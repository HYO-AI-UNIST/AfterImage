import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.env.MINDMINER_URL || 'http://127.0.0.1:5173';
const shots = new URL('../outputs/qa/game/', import.meta.url);
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], contexts = [], touchPages = new WeakSet();
async function open(viewport = { width: 1440, height: 900 }, mobile = false) {
    const context = await browser.newContext({ viewport, locale: 'ko-KR', isMobile: mobile, hasTouch: mobile });
    contexts.push(context);
    const page = await context.newPage();
    if (mobile)
        touchPages.add(page);
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.url().includes('/game/') && r.status() >= 400)
        errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(base);
    await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 45000 });
    return page;
}
async function control(page, id) {
    await page.waitForFunction(id => JSON.parse(document.querySelector('canvas').dataset.controls || '[]').some(r => r.id === id), id, { timeout: 15000 });
    const r = await page.evaluate(id => JSON.parse(document.querySelector('canvas').dataset.controls).find(r => r.id === id), id);
    assert.ok(r, `Canvas control ${id}`);
    if (touchPages.has(page))
        await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
    else
        await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
}
async function phase(page, name) { await page.locator(`canvas[data-phase="${name}"]`).waitFor({ timeout: 15000 }); }
async function point(page, id) { await page.waitForFunction(id => JSON.parse(document.querySelector('canvas').dataset.nodes || '{}')[id], id); return page.evaluate(id => JSON.parse(document.querySelector('canvas').dataset.nodes)[id], id); }
async function node(page, id) { const p = await point(page, id); await page.mouse.click(p.x, p.y); }
async function edge(page, a, b) { const p = await point(page, a), q = await point(page, b); await page.mouse.click((p.x + q.x) / 2, (p.y + q.y) / 2); }
async function shot(page, name) { await page.screenshot({ path: new URL(name + '.png', shots).pathname }); }
async function json(page, path, body, token) { const response = await page.request[body === undefined ? 'get' : 'post'](base + path, { headers: { Origin: new URL(base).origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { data: body } : {}) }); const data = await response.json(); assert.ok(response.ok(), `${path}: ${response.status()} ${JSON.stringify(data)}`); return data; }
try {
    const page = await open();
    await page.waitForTimeout(1700);
    assert.equal(await page.locator('button,h1,[role="button"]').count(), 0, 'All visible game UI must be raster sprites, not DOM controls');
    await shot(page, 'home-desktop');
    await control(page, 'practice');
    await phase(page, 'placing');
    await page.waitForTimeout(2200);
    await control(page, 'random');
    await shot(page, 'placement-desktop');
    await control(page, 'clear');
    await control(page, 'ready');
    await phase(page, 'playing');
    await page.waitForTimeout(1100);
    await shot(page, 'playing-desktop');
    await control(page, 'hint');
    await edge(page, '4-0', '3-0');
    await page.locator('canvas[data-overlay="hint"]').waitFor();
    await shot(page, 'hint-demo');
    await control(page, 'close');
    await page.locator('canvas[data-overlay=""]').waitFor();
    await node(page, '4-4');
    await page.waitForTimeout(150);
    await page.mouse.move(650, 360);
    await page.mouse.down();
    await page.mouse.move(710, 365, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    await shot(page, 'automatic-camera');
    console.log('PASS demo: image-only UI, placement, hint and spawn.');
    await page.context().close();
    const mobile = await open({ width: 390, height: 844 }, true);
    await mobile.waitForTimeout(1500);
    await shot(mobile, 'home-mobile');
    await control(mobile, 'practice');
    await phase(mobile, 'placing');
    await mobile.waitForTimeout(2200);
    await control(mobile, 'random');
    await shot(mobile, 'placement-mobile');
    await control(mobile, 'clear');
    await control(mobile, 'ready');
    await phase(mobile, 'playing');
    await mobile.waitForTimeout(1000);
    await shot(mobile, 'playing-mobile');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await control(mobile, 'help');
    await mobile.locator('canvas[data-overlay="help"]').waitFor();
    await shot(mobile, 'help-mobile');
    await control(mobile, 'close');
    console.log('PASS mobile: touch controls, portrait layout, help, no overflow.');
    await mobile.context().close();
    const host = await open();
    await control(host, 'online');
    await control(host, 'field:name');
    await host.locator('input').fill('광부1');
    await control(host, 'enter');
    await phase(host, 'waiting');
    const membership = await host.evaluate(() => JSON.parse(localStorage.getItem('mindminer.membership.v1'))), members = [membership];
    for (let i = 1; i < 6; i++) {
        const reply = await json(host, `/api/rooms/${membership.code}/join`, { name: `광부${i + 1}` });
        members.push({ code: membership.code, token: reply.token });
    }
    await control(host, 'start');
    await phase(host, 'placing');
    await host.waitForTimeout(2200);
    await edge(host, '4-0', '3-0');
    const view = async (token = membership.token) => (await json(host, `/api/rooms/${membership.code}`, undefined, token)).view;
    const act = async (token, action) => { const v = await view(token); return json(host, `/api/rooms/${membership.code}/actions`, { action, revision: v.revision }, token); };
    for (let i = 1; i < 6; i++)
        await act(members[i].token, { type: 'place', mines: ['3-0~4-0'] });
    await control(host, 'ready');
    await phase(host, 'playing');
    let v = await view();
    // Other players take legal mine-hit turns; the actual host then plays via canvas.
    while (v.activeSeat !== 0) {
        const token = members[v.activeSeat].token;
        await act(token, { type: 'spawn', nodeId: '4-0' });
        await act(token, { type: 'move', nodeId: '3-0' });
        await host.waitForTimeout(500);
        await shot(host, 'explosion-online');
        await host.waitForTimeout(1550);
        v = await view();
    }
    await host.waitForTimeout(700);
    await control(host, 'hint');
    await edge(host, '4-0', '3-0');
    await host.locator('canvas[data-overlay="hint"]').waitFor();
    await shot(host, 'private-hint-online');
    assert.equal((await view()).players[0].coins, 2);
    await control(host, 'close');
    const other = await view(members[1].token);
    assert.equal('coins' in other.players[0], false);
    assert.equal('ownMines' in other, false);
    assert.equal('privateResult' in other, false);
    await node(host, '4-4');
    await host.waitForFunction(() => document.querySelector('canvas').dataset.position === '4-4');
    for (const target of ['3-3', '2-2', '1-1', '0-0']) {
        await host.waitForFunction(() => document.querySelector('canvas').dataset.event === '' && JSON.parse(document.querySelector('canvas').dataset.controls || '[]').some(r => r.id === 'hint'));
        await node(host, target);
        if (target !== '0-0')
            await host.waitForFunction(id => document.querySelector('canvas').dataset.position === id, target);
    }
    await phase(host, 'roundEnd');
    v = await view();
    assert.equal(v.winner.points, 3);
    await shot(host, 'round-results-online');
    await control(host, 'next');
    await phase(host, 'placing');
    await host.reload();
    await host.locator('canvas[data-ready="true"]').waitFor({ timeout: 45000 });
    await phase(host, 'placing');
    assert.equal((await view()).round, 2);
    assert.equal((await view()).players[0].score, 3);
    console.log('PASS online: six seats, server-authenticated actions, private hint, win, score, next round, reload/reconnect.');
    for (let round = 2; round <= 7; round++) {
        for (const member of members)
            await act(member.token, { type: 'place', mines: [] });
        const active = members[(await view()).activeSeat].token;
        await act(active, { type: 'spawn', nodeId: '4-4' });
        for (const target of ['3-3', '2-2', '1-1', '0-0']) {
            await host.waitForTimeout(690);
            await act(active, { type: 'move', nodeId: target });
        }
        if (round < 7) {
            await phase(host, 'roundEnd');
            await control(host, 'next');
            await phase(host, 'placing');
        }
    }
    await phase(host, 'finished');
    await shot(host, 'final-results-online');
    await control(host, 'next');
    await phase(host, 'placing');
    v = await view();
    assert.equal(v.round, 1);
    assert.ok(v.players.every(p => p.score === 0));
    console.log('PASS full seven-round match, final results, and clean restart.');
    assert.deepEqual(errors, []);
    console.log('PASS no browser errors or failed game assets. Screenshots: outputs/qa/game/');
}
catch (error) {
    for (const [i, c] of contexts.entries()) {
        for (const p of c.pages()) {
            await shot(p, `failure-${i}`).catch(() => { });
            console.error('Canvas diagnostic', await p.locator('canvas').evaluate(c => ({ ...c.dataset })).catch(() => ({})));
        }
    }
    throw error;
}
finally {
    for (const c of contexts)
        await c.close().catch(() => { });
    await browser.close();
}
