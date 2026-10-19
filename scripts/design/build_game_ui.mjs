import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildGamePolish } from './build_game_polish.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'public/game/ui');
mkdirSync(out, { recursive: true });
try {
    GlobalFonts.registerFromPath(path.join(root, 'public/fonts/PretendardVariable.woff2'), 'Pretendard');
}
catch { }
const atlas = createCanvas(2048, 4096), ctx = atlas.getContext('2d');
const manifest = {};
let x = 0, y = 0, row = 0;
const colors = ['#aa9975', '#798b84', '#957c72', '#7a8c96', '#89828f', '#a09986'];
function sprite(name, w, h, draw) {
    if (x + w > 2048) {
        x = 0;
        y += row + 4;
        row = 0;
    }
    const c = createCanvas(w, h), g = c.getContext('2d');
    draw(g, w, h);
    ctx.drawImage(c, x, y);
    manifest[name] = { x, y, w, h };
    writeFileSync(path.join(out, `${name}.png`), c.toBuffer('image/png'));
    x += w + 4;
    row = Math.max(row, h);
}
function shape(g, x, y, w, h, fill, stroke = '#a79d88', cut = 8, lw = 2) {
    g.beginPath();
    g.moveTo(x + cut, y);
    g.lineTo(x + w - cut, y);
    g.lineTo(x + w - cut, y + cut);
    g.lineTo(x + w, y + cut);
    g.lineTo(x + w, y + h - cut);
    g.lineTo(x + w - cut, y + h - cut);
    g.lineTo(x + w - cut, y + h);
    g.lineTo(x + cut, y + h);
    g.lineTo(x + cut, y + h - cut);
    g.lineTo(x, y + h - cut);
    g.lineTo(x, y + cut);
    g.lineTo(x + cut, y + cut);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (stroke) {
        g.strokeStyle = stroke;
        g.lineWidth = lw;
        g.stroke();
    }
}
for (const [n, fill, line] of [['panel', '#101315f5', '#555e61'], ['panel-active', '#24323bf5', '#effaff'], ['panel-light', '#1b2022f5', '#8e989b'], ['button', '#b0c3cf', '#f1d6a4'], ['button-hover', '#f2c782', '#fff0d4'], ['button-pressed', '#b78340', '#f1d6a4'], ['button-disabled', '#232729', '#464e51'], ['button-quiet', '#131719', '#76858a'], ['panel-private', '#1a2327', '#9db5c1']]) {
    sprite(n, 128, 96, g => { shape(g, 2, 2, 124, 92, fill, line, 7, 2); if (n === 'panel')
        shape(g, 7, 7, 114, 82, '#00000000', '#30383c', 4, 1); });
}
// Each interaction state is painted into its own sprite: bevels, sockets, light and travel.
for (const quiet of [false, true]) for (const state of ['idle', 'hover', 'pressed']) {
    const name = quiet ? `button-quiet${state === 'idle' ? '' : `-${state}`}` : state === 'idle' ? 'button' : `button-${state}`;
    sprite(name, 160, 112, g => {
        const down = state === 'pressed', hot = state === 'hover', lift = down ? 5 : 0;
        shape(g, 3, 8, 154, 100, '#07090b', '#07090b', 9, 2);
        const grad = g.createLinearGradient(0, 5, 0, 100);
        grad.addColorStop(0, quiet ? hot ? '#536b79' : down ? '#20282c' : '#39474f' : hot ? '#f0f7fa' : down ? '#7893a3' : '#c3d6e2');
        grad.addColorStop(1, quiet ? hot ? '#28353d' : '#1c272e' : hot ? '#bfd4df' : '#8da7b8');
        shape(g, 3, 3 + lift, 154, 98 - lift, grad, quiet ? hot ? '#cadce4' : '#879ca9' : '#e7f2f7', 9, 2);
        g.fillStyle = down ? '#00000024' : '#ffffff24'; g.fillRect(14, 12 + lift, 132, 4);
        g.fillStyle = hot ? quiet ? '#d0e0e6' : '#e2ebee' : quiet ? '#526775' : '#485f6d';
        for (const xx of [12, 144]) { g.fillRect(xx, 23 + lift, 3, 7); g.fillRect(xx, 76 + lift, 3, 7); }
        if (hot) { g.fillStyle = quiet ? '#b5cfdc' : '#d6e3e9'; g.fillRect(22, 88, 116, 3); }
        if (down) { g.fillStyle = '#050a1166'; g.fillRect(14, 12, 132, 5); }
    });
}
for (const hot of [false, true]) sprite(hot ? 'route-arrow-hot' : 'route-arrow', 224, 224, g => {
    g.translate(48,48);
    g.shadowColor = hot ? '#e2eaed' : '#a7d2ed'; g.shadowBlur = hot ? 24 : 17;
    g.fillStyle = hot ? '#edf4f7' : '#d2e5ee'; g.strokeStyle = '#080c0f'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(64, 12); g.lineTo(111, 64); g.lineTo(84, 64); g.lineTo(84, 105); g.lineTo(44, 105); g.lineTo(44, 64); g.lineTo(17, 64); g.closePath(); g.stroke(); g.fill();
    g.shadowBlur = 0; g.fillStyle = '#ffffffa0'; g.fillRect(56, 60, 8, 33);
});
sprite('board-card', 180, 220, g => {
    shape(g, 7, 7, 166, 205, '#1b2226', '#9eafba', 12, 3);
    shape(g, 16, 17, 148, 184, '#111619', '#5a6870', 8, 2);
    g.strokeStyle = '#9aafb8'; g.lineWidth = 4;
    for (let row = 0; row < 4; row++) for (let col = 0; col <= row; col++) {
        const px = 90 + (col - row / 2) * 31, py = 53 + row * 33;
        if (row < 3) for (const d of [-1, 1]) { g.beginPath(); g.moveTo(px, py); g.lineTo(px + d * 15.5, py + 33); g.stroke(); }
        g.fillStyle = '#b0c3cf'; g.fillRect(px - 4, py - 4, 8, 8);
    }
    g.fillStyle = '#b0c3cf'; g.fillRect(48, 176, 84, 4);
});
sprite('victory-badge', 160, 160, g => {
    g.fillStyle = '#536976'; g.strokeStyle = '#d5e7f0'; g.lineWidth = 3;
    g.beginPath(); for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 45 : 66; const x = 80 + Math.cos(a) * r, y = 80 + Math.sin(a) * r; if (!i) g.moveTo(x,y); else g.lineTo(x,y); } g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#0d1419'; g.beginPath(); g.arc(80,80,32,0,Math.PI*2); g.fill();
    g.fillStyle = '#ffffff'; g.font = 'bold 38px Menlo'; g.textAlign='center'; g.textBaseline='middle'; g.fillText('1',80,82);
});
sprite('stage-ray', 128, 512, g => {
    const grad = g.createLinearGradient(0,0,0,512); grad.addColorStop(0,'#d4e9f855'); grad.addColorStop(.5,'#b9d8ed19'); grad.addColorStop(1,'#b9d8ed00');
    g.fillStyle=grad; g.beginPath(); g.moveTo(60,0); g.lineTo(68,0); g.lineTo(128,512); g.lineTo(0,512); g.closePath(); g.fill();
});
sprite('reward-spark',64,64,g => {
    g.shadowColor='#d5eaf6';g.shadowBlur=13;g.fillStyle='#e3f1f7';
    g.beginPath();g.moveTo(32,7);g.lineTo(38,26);g.lineTo(57,32);g.lineTo(38,38);g.lineTo(32,57);g.lineTo(26,38);g.lineTo(7,32);g.lineTo(26,26);g.closePath();g.fill();
});
for (let i = 0; i < 6; i++)
    sprite(`portrait-${i}`, 128, 144, g => {
        shape(g, 2, 2, 124, 140, '#14181a', '#465055', 8);
        g.fillStyle = '#30383b';
        g.beginPath();
        g.moveTo(20, 134);
        g.lineTo(32, 94);
        g.lineTo(52, 85);
        g.lineTo(78, 85);
        g.lineTo(98, 103);
        g.lineTo(110, 134);
        g.fill();
        g.fillStyle = '#988570';
        g.beginPath();
        g.moveTo(42, 65);
        g.lineTo(86, 65);
        g.lineTo(83, 95);
        g.lineTo(64, 108);
        g.lineTo(45, 96);
        g.fill();
        g.fillStyle = '#090c0f';
        g.fillRect(40, 68, 47, 15);
        g.fillStyle = colors[i];
        g.beginPath();
        g.moveTo(30, 65);
        g.quadraticCurveTo(28, 23, 63, 23);
        g.quadraticCurveTo(96, 25, 96, 65);
        g.fill();
        g.strokeStyle = '#090c0f';
        g.lineWidth = 5;
        g.stroke();
        g.fillStyle = colors[i];
        g.fillRect(26, 61, 74, 10);
        g.fillStyle = '#090c0f';
        g.fillRect(74, 36, 21, 23);
        g.fillStyle = '#f0dfb7';
        g.beginPath();
        g.arc(84, 47, 7, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#14181a';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(47, 111);
        g.lineTo(34, 131);
        g.moveTo(80, 111);
        g.lineTo(94, 131);
        g.stroke();
    });
sprite('logo', 1000, 160, g => {
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 152px Menlo, monospace';
    g.fillStyle = '#080b0e'; g.fillText('MINDMINER', 504, 89);
    g.fillStyle = '#ffffff'; g.fillText('MINDMINER', 500, 82);
});
const icons = ['hint', 'help', 'sound', 'muted', 'back', 'close', 'random', 'clear', 'check', 'link', 'pause', 'mine', 'compass'];
for (let i = 1; i <= 7; i++)
    sprite(`depot-${i}`, 64, 64, g => { shape(g, 4, 4, 56, 56, '#14181a', '#7b8788', 6, 2); g.font = 'bold 34px Menlo, monospace'; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i), 32, 34); });
for (const name of icons)
    sprite(name, 64, 64, g => {
        g.strokeStyle = '#d9d8ce';
        g.fillStyle = '#d9d8ce';
        g.lineWidth = 3;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        const l = (x, y, a, b) => { g.beginPath(); g.moveTo(x, y); g.lineTo(a, b); g.stroke(); };
        if (name === 'hint') {
            g.beginPath();
            g.arc(32, 32, 21, 0, Math.PI * 2);
            g.fillStyle = '#556976';
            g.fill();
            g.strokeStyle = '#b0c3cf';
            g.stroke();
            g.beginPath();
            g.arc(32, 32, 15, 0, Math.PI * 2);
            g.stroke();
        }
        else if (name === 'help') {
            g.font = 'bold 42px Menlo';
            g.textAlign = 'center';
            g.fillStyle = '#ffffff'; g.fillText('?', 32, 47);
        }
        else if (name === 'back') {
            l(42, 14, 22, 32);
            l(22, 32, 42, 50);
        }
        else if (name === 'close' || name === 'mine') {
            l(19, 19, 45, 45);
            l(45, 19, 19, 45);
            if (name === 'mine') {
                g.beginPath();
                g.arc(32, 32, 25, 0, Math.PI * 2);
                g.stroke();
            }
        }
        else if (name === 'check') {
            l(14, 33, 27, 46);
            l(27, 46, 51, 18);
        }
        else if (name === 'clear') {
            g.strokeRect(21, 22, 23, 29);
            l(17, 17, 48, 17);
            l(27, 11, 38, 11);
        }
        else if (name === 'link') {
            g.strokeRect(12, 20, 25, 17);
            g.strokeRect(28, 28, 25, 17);
        }
        else if (name === 'pause') {
            g.fillRect(20, 17, 8, 32);
            g.fillRect(37, 17, 8, 32);
        }
        else if (name === 'random') {
            l(13, 18, 48, 46);
            l(13, 46, 48, 18);
            l(38, 17, 49, 17);
            l(49, 17, 49, 29);
            l(39, 47, 49, 47);
        }
        else if (name === 'compass') {
            g.beginPath();
            g.arc(32, 32, 23, 0, Math.PI * 2);
            g.stroke();
            g.beginPath();
            g.moveTo(39, 18);
            g.lineTo(37, 38);
            g.lineTo(24, 44);
            g.lineTo(27, 27);
            g.closePath();
            g.stroke();
        }
        else {
            g.beginPath();
            g.moveTo(15, 27);
            g.lineTo(24, 27);
            g.lineTo(36, 17);
            g.lineTo(36, 47);
            g.lineTo(24, 37);
            g.lineTo(15, 37);
            g.closePath();
            g.stroke();
            if (name === 'muted') {
                l(43, 24, 55, 40);
                l(55, 24, 43, 40);
            }
            else {
                g.beginPath();
                g.arc(33, 32, 20, -.75, .75);
                g.stroke();
            }
        }
    });
for (const role of ['illuminator','guardian','trapper','thief','shifter','recorder']) sprite(`role-${role}`, 96, 96, g => {
    shape(g,4,4,88,88,'#1a2329','#899ba6',12,2);g.strokeStyle='#ffffff';g.fillStyle='#ffffff';g.lineWidth=4;g.lineJoin='round';
    if(role==='illuminator'){g.strokeRect(31,34,34,38);g.beginPath();g.arc(48,31,12,Math.PI,0);g.stroke();g.fillRect(42,42,12,23);}
    if(role==='guardian'){g.beginPath();g.moveTo(48,23);g.lineTo(72,33);g.lineTo(66,58);g.lineTo(48,75);g.lineTo(30,58);g.lineTo(24,33);g.closePath();g.stroke();g.beginPath();g.moveTo(36,48);g.lineTo(45,57);g.lineTo(60,39);g.stroke();}
    if(role==='trapper'){g.beginPath();g.moveTo(22,38);g.quadraticCurveTo(48,18,74,38);g.lineTo(68,64);g.lineTo(48,76);g.lineTo(28,64);g.closePath();g.stroke();g.fillRect(31,43,12,4);g.fillRect(53,43,12,4);}
    if(role==='thief'){g.beginPath();g.moveTo(18,49);g.quadraticCurveTo(48,17,78,49);g.quadraticCurveTo(48,80,18,49);g.stroke();g.beginPath();g.arc(48,49,11,0,Math.PI*2);g.stroke();}
    if(role==='shifter'){g.beginPath();g.moveTo(22,35);g.lineTo(70,35);g.lineTo(59,24);g.moveTo(70,35);g.lineTo(59,46);g.moveTo(74,63);g.lineTo(26,63);g.lineTo(37,52);g.moveTo(26,63);g.lineTo(37,74);g.stroke();}
    if(role==='recorder'){g.strokeRect(27,23,44,54);for(let i=0;i<3;i++){g.fillRect(37,36+i*12,23,3);g.fillRect(21,32+i*16,12,3);}}
});
sprite('coin-victory',96,96,g=>{g.fillStyle='#56646d';g.beginPath();g.arc(48,51,34,0,Math.PI*2);g.fill();g.fillStyle='#d8dfe3';g.beginPath();g.arc(48,46,34,0,Math.PI*2);g.fill();g.fillStyle='#34414a';g.beginPath();g.arc(48,46,26,0,Math.PI*2);g.fill();g.fillStyle='#ffffff';g.beginPath();g.moveTo(48,25);g.lineTo(65,57);g.lineTo(31,57);g.closePath();g.fill();});
buildGamePolish(sprite,shape);
if(y+row>4096)throw new Error('UI atlas overflow');
const atlasPng=atlas.toBuffer('image/png');
writeFileSync(path.join(out, 'atlas.png'), atlasPng);
writeFileSync(path.join(out, 'atlas.json'), JSON.stringify(manifest, null, 2));
const atlasVersion=createHash('sha256').update(atlasPng).update(JSON.stringify(manifest)).digest('hex').slice(0,12);
writeFileSync(path.join(root,'lib/mine/ui-atlas-version.ts'),`// Generated by scripts/design/build_game_ui.mjs.\nexport const UI_ATLAS_VERSION = '${atlasVersion}';\n`);
const fx = path.join(root, 'public/game/fx');
mkdirSync(fx, { recursive: true });
for (const [name, color] of [['glow', '235,174,79'], ['dust', '168,182,187'], ['spark', '255,211,133']]) {
    const c = createCanvas(128, 128), g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, `rgba(${color},1)`);
    r.addColorStop(.3, `rgba(${color},.45)`);
    r.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    writeFileSync(path.join(fx, `${name}.png`), c.toBuffer('image/png'));
}
const overview = createCanvas(1600, Math.ceil(Object.keys(manifest).length/8)*200+150), o = overview.getContext('2d');
o.fillStyle = '#080b0e';
o.fillRect(0, 0, 1600, 1450);
o.fillStyle = '#d9d8ce';
o.font = 'bold 36px Menlo';
o.fillText('MINDMINER / GAME ASSETS', 48, 64);
let n = 0;
for (const [name, r] of Object.entries(manifest)) {
    if (name === 'logo')
        continue;
    const xx = 48 + (n % 8) * 194, yy = 118 + Math.floor(n / 8) * 200;
    o.drawImage(atlas, r.x, r.y, r.w, r.h, xx, yy, 145, Math.min(145, 145 * r.h / r.w));
    o.fillStyle = '#a7b2b6';
    o.font = '16px Menlo';
    o.fillText(name, xx, yy + 171);
    n++;
}
writeFileSync(path.join(out, 'asset-sheet.png'), overview.toBuffer('image/png'));
writeFileSync(path.join(root, 'public/game/manifest.json'), JSON.stringify({ title: 'Quiet Mine / original game asset kit', models: ['miner-cart', 'timber-arch', 'lantern', 'supply-crate', 'cave-rock', 'mine-level', 'mine-level-3', 'mine-level-5', 'mine-level-6', 'broken-track', 'main-menu-diorama'].map(n => `models/${n}.glb`), ui: 'ui/atlas.png', frames: 'ui/atlas.json', fx: ['fx/glow.png', 'fx/dust.png', 'fx/spark.png'], textures: ['shale', 'timber', 'iron', 'gravel', 'floor'].map(n => `textures/${n}.png`), levelLayout: 'lib/mine/level-layout.json', source: 'assets/source/quiet-mine-kit.blend', titleSource: 'assets/source/quiet-mine-title.blend', license: 'Original assets created for MindMiner; no third-party game artwork.' }, null, 2));
console.log(`Built ${Object.keys(manifest).length} PNG UI sprites, atlas, effects, and asset sheet.`);
// Quiet, illustrated material maps. Seeded strokes keep the low-poly silhouettes clean.
const textureOut = path.join(root, 'public/game/textures');
mkdirSync(textureOut, { recursive: true });
let seed = 7001;
const rand = () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646; };
for (const kind of ['shale', 'timber', 'iron', 'gravel']) {
    const c = createCanvas(512, 512), g = c.getContext('2d');
    g.fillStyle = { shale: '#20262b', timber: '#403a32', iron: '#4d565c', gravel: '#2a3034' }[kind]; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < (kind === 'gravel' ? 2400 : 700); i++) {
        const xx = rand() * 512, yy = rand() * 512;
        g.strokeStyle = rand() > .5 ? '#d3d9cf18' : '#030b1740';
        g.lineWidth = kind === 'timber' ? .6 + rand() * 2 : 1 + rand() * 3;
        if (kind === 'gravel') { g.fillStyle = rand() > .5 ? '#a2a9a638' : '#080a0d55'; g.fillRect(xx, yy, 2 + rand() * 5, 2 + rand() * 4); }
        else { g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + (kind === 'timber' ? rand() * 5 : 15 + rand() * 85), yy + (kind === 'timber' ? 50 + rand() * 230 : rand() * 12)); g.stroke(); }
    }
    if (kind === 'shale') for (let y = 0; y < 512; y += 54) {
        g.strokeStyle = '#0b0e1266'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, y); g.lineTo(150, y + 15); g.lineTo(345, y - 9); g.lineTo(512, y + 4); g.stroke();
    }
    writeFileSync(path.join(textureOut, `${kind}.png`), c.toBuffer('image/png'));
}

{
    const c = createCanvas(1024, 1024), g = c.getContext('2d');
    g.fillStyle = '#252b2f'; g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 12000; i++) {
        g.fillStyle = rand() > .52 ? '#b7c0c024' : '#05080b42';
        g.fillRect(rand() * 1024, rand() * 1024, 1 + rand() * 6, 1 + rand() * 4);
    }
    for (let i = 0; i < 34; i++) {
        let x = rand() * 1024, y = rand() * 1024;
        g.beginPath(); g.moveTo(x,y);
        for (let j = 0; j < 8; j++) { x += (rand() - .35) * 46; y += rand() * 35; g.lineTo(x,y); }
        g.strokeStyle = '#080d1185'; g.lineWidth = 2 + rand() * 3; g.stroke();
        g.strokeStyle = '#aab4b320'; g.lineWidth = 1; g.stroke();
    }
    for (let i = 0; i < 14; i++) {
        const x = rand() * 1024, y = rand() * 1024, r = 60 + rand() * 110;
        const soot = g.createRadialGradient(x,y,0,x,y,r); soot.addColorStop(0,'#070b1038'); soot.addColorStop(1,'#070b1000');
        g.fillStyle = soot; g.fillRect(x-r,y-r,r*2,r*2);
    }
    writeFileSync(path.join(textureOut,'floor.png'),c.toBuffer('image/png'));
}

await import('./build_explosion_fx.mjs');
await import('./build_game_guide.mjs');
