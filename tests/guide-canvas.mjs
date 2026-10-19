import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { GUIDE_PAGES } from '../lib/mine/guide.ts';
import { getBoard, randomBoard } from '../lib/game.ts';

const base = process.env.MINDMINER_URL || 'http://127.0.0.1:5173';
const output = new URL('../outputs/qa/guide/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const errors = [];
async function control(page, id) {
    await page.waitForFunction(id => JSON.parse(document.querySelector('canvas').dataset.controls || '[]').some(r => r.id === id), id);
    let r = await page.evaluate(id => JSON.parse(document.querySelector('canvas').dataset.controls).find(r => r.id === id), id);
    if (!r) {
        await page.waitForFunction(id => JSON.parse(document.querySelector('canvas').dataset.controls || '[]').some(r => r.id === id), id);
        r = await page.evaluate(id => JSON.parse(document.querySelector('canvas').dataset.controls).find(r => r.id === id), id);
    }
    assert.ok(r, `Visible canvas control: ${id}`);
    await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
}
async function chapter(page, index) {
    await page.waitForFunction(i => document.querySelector('canvas').dataset.guidePage === String(i), index);
}
async function shot(page, name) { await page.screenshot({path: new URL(`${name}.png`, output).pathname}); }
try {
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['small', 320, 568], ['landscape', 844, 390]]) {
        const context = await browser.newContext({viewport: {width, height}, hasTouch: true, locale: 'ko-KR'});
        const page = await context.newPage();
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('response', r => { if (r.url().includes('/game/') && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
        // A fixed demo fixture: the left side is safe and the right side is mined.
        await page.addInitScript(() => {
            Math.random = () => .42;
            const allocation = new WeakMap();
            const proto = WebGL2RenderingContext.prototype, storage = proto.texStorage2D, upload = proto.texSubImage2D;
            window.hudUploadMismatches = [];
            proto.texStorage2D = function(target, levels, format, w, h) {
                if (target === this.TEXTURE_2D) allocation.set(this.getParameter(this.TEXTURE_BINDING_2D), [w, h]);
                return storage.call(this, target, levels, format, w, h);
            };
            proto.texSubImage2D = function(...args) {
                const canvas = args.at(-1);
                if (canvas instanceof HTMLCanvasElement) {
                    const size = allocation.get(this.getParameter(this.TEXTURE_BINDING_2D));
                    if (!size || size[0] !== canvas.width || size[1] !== canvas.height)
                        window.hudUploadMismatches.push({allocated: size, canvas: [canvas.width, canvas.height]});
                    window.hudUploadedSize = [canvas.width, canvas.height];
                }
                return upload.apply(this, args);
            };
        });
        await page.goto(base);
        await page.locator('canvas[data-ready="true"]').waitFor({timeout: 45000});
        await control(page, 'help'); await chapter(page, 0);
        assert.equal(await page.locator('button,h1,[role="button"]').count(), 0);
        for (let i = 0; i < GUIDE_PAGES.length; i++) {
            await control(page, `guide:${i}`); await chapter(page, i);
            const controls = await page.locator('canvas').evaluate(c => JSON.parse(c.dataset.controls));
            assert.ok(controls.every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height), 'Guide controls fit the viewport');
            if (i === 0 || i === 4 || i === GUIDE_PAGES.length-1) await shot(page, `${name}-${i}`);
        }
        await page.keyboard.press('Home'); await chapter(page, 0);
        if (name === 'mobile') {
            const touch = await context.newCDPSession(page);
            await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 285, y: 250}]});
            await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: 100, y: 250}]});
            await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
            await chapter(page, 1);
            await page.keyboard.press('Home'); await chapter(page, 0);
            await touch.detach();
        }
        await page.keyboard.press('ArrowRight'); await chapter(page, 1);
        await page.keyboard.press('End'); await chapter(page, GUIDE_PAGES.length-1);
        await page.setViewportSize({width: height, height: width}); await chapter(page, GUIDE_PAGES.length-1);
        await page.waitForFunction(() => window.hudUploadedSize?.[0] === Math.round(innerWidth * Math.min(devicePixelRatio, 1.5)) && window.hudUploadedSize?.[1] === Math.round(innerHeight * Math.min(devicePixelRatio, 1.5)));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (name === 'small') {
            await page.keyboard.press('ArrowDown');
            await page.waitForFunction(() => Number(document.querySelector('canvas').dataset.guideScroll) > 0);
            await shot(page, 'small-rotated-scroll');
        }
        await page.setViewportSize({width, height});
        await page.waitForFunction(() => window.hudUploadedSize?.[0] === Math.round(innerWidth * Math.min(devicePixelRatio, 1.5)) && window.hudUploadedSize?.[1] === Math.round(innerHeight * Math.min(devicePixelRatio, 1.5)));
        await page.keyboard.press('Escape');
        await page.locator('canvas[data-overlay=""]').waitFor();
        if (name === 'desktop' || name === 'landscape') {
            await control(page, 'practice');
            await page.locator('canvas[data-phase="placing"]').waitFor();
            await control(page, 'role-confirm');
            // Placement and hint selection both work with keyboard edge targets.
            await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
            await control(page, 'clear'); await control(page, 'ready');
            await control(page, 'board:1');
            await page.waitForFunction(() => document.querySelector('canvas').dataset.cinematic === '');
            await control(page, 'hint');
            await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
            await page.locator('canvas[data-overlay="hint"]').waitFor();
            await shot(page, `${name}-hint-map`);
            await control(page, 'close');
            await control(page, 'hint'); // Cancel without spending the second coin.
            await page.keyboard.press('Escape');
            const geometry=getBoard(),mine=randomBoard(()=>.42).map(id=>geometry.edgeLookup.get(id)).find(e=>geometry.nodes.find(n=>n.id===e.b)?.start);
            assert.ok(mine,'Fixed demo has a mine beside a departure station');
            const start=geometry.nodes.find(n=>n.id===mine.b).start?mine.b:mine.a, destination=start===mine.a?mine.b:mine.a;
            await page.keyboard.press(String(Number(start.split('-')[1])+1));
            await page.waitForFunction(id => document.querySelector('canvas').dataset.position === id,start);
            const next = await page.locator('canvas').evaluate((c,id) => JSON.parse(c.dataset.nodes)[id],destination);
            await page.mouse.click(next.x, next.y);
            await page.waitForFunction(() => document.querySelector('canvas').dataset.event === 'explosion');
            await page.keyboard.press('F1'); await chapter(page, 2);
            const pausedRevision = await page.locator('canvas').getAttribute('data-revision');
            await page.waitForTimeout(4300);
            assert.equal(await page.locator('canvas').getAttribute('data-revision'), pausedRevision, 'Solo bots wait while the guide is open');
        }
        assert.deepEqual(await page.evaluate(() => window.hudUploadMismatches), [], 'Canvas uploads always match allocated GPU storage');
        await context.close();
        console.log(`PASS ${name}: ${GUIDE_PAGES.length} illustrated chapters, navigation, resize and raster UI.`);
    }
    assert.deepEqual(errors, [], 'No browser, shader or asset errors');
    console.log('PASS keyboard placement and hints, private hint maps in landscape, and guide assets.');
} finally { await browser.close(); }
