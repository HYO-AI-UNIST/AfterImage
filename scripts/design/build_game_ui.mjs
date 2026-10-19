import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'public/game/ui');
mkdirSync(out, { recursive: true });
try {
    GlobalFonts.registerFromPath(path.join(root, 'public/fonts/PretendardVariable.woff2'), 'Pretendard');
}
catch { }
const atlas = createCanvas(2048, 1536), ctx = atlas.getContext('2d');
const manifest = {};
let x = 0, y = 0, row = 0;
const colors = ['#c49853', '#719b8d', '#ab7163', '#6b8fa8', '#8e7d9e', '#b5a28b'];
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
for (const [n, fill, line] of [['panel', '#111b25f2', '#66737a'], ['panel-light', '#1c2b36f5', '#9aa8aa'], ['button', '#e6ae55', '#f1d6a4'], ['button-hover', '#f2c782', '#fff0d4'], ['button-pressed', '#b78340', '#f1d6a4'], ['button-disabled', '#26323b', '#4b5b65'], ['button-quiet', '#141f29', '#76858a'], ['panel-private', '#152a31', '#84bbb8']]) {
    sprite(n, 128, 96, g => { shape(g, 2, 2, 124, 92, fill, line, 7, 2); if (n === 'panel')
        shape(g, 7, 7, 114, 82, '#00000000', '#354550', 4, 1); });
}
for (let i = 0; i < 6; i++)
    sprite(`portrait-${i}`, 128, 144, g => {
        shape(g, 2, 2, 124, 140, '#111b25', '#465764', 8);
        g.fillStyle = '#32434b';
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
        g.fillStyle = '#0a121b';
        g.fillRect(40, 68, 47, 15);
        g.fillStyle = colors[i];
        g.beginPath();
        g.moveTo(30, 65);
        g.quadraticCurveTo(28, 23, 63, 23);
        g.quadraticCurveTo(96, 25, 96, 65);
        g.fill();
        g.strokeStyle = '#0a121b';
        g.lineWidth = 5;
        g.stroke();
        g.fillStyle = colors[i];
        g.fillRect(26, 61, 74, 10);
        g.fillStyle = '#0a121b';
        g.fillRect(74, 36, 21, 23);
        g.fillStyle = '#f0dfb7';
        g.beginPath();
        g.arc(84, 47, 7, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#111b25';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(47, 111);
        g.lineTo(34, 131);
        g.moveTo(80, 111);
        g.lineTo(94, 131);
        g.stroke();
    });
sprite('logo', 1000, 236, g => {
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 116px Menlo, monospace';
    g.fillStyle = '#081019';
    g.fillText('MINDMINER', 9, 105);
    g.fillStyle = '#eee3cf';
    g.fillText('MINDMINER', 4, 98);
    g.fillStyle = '#e6ae55';
    g.fillRect(8, 176, 46, 3);
    g.font = '20px Menlo, monospace';
    g.fillStyle = '#a8b3b8';
    g.fillText('A LITTLE LIGHT. A LONG MEMORY.', 76, 178);
});
const icons = ['hint', 'help', 'sound', 'muted', 'back', 'close', 'random', 'clear', 'check', 'link', 'pause', 'mine', 'compass'];
for (let i = 1; i <= 5; i++)
    sprite(`depot-${i}`, 64, 64, g => { shape(g, 4, 4, 56, 56, '#111b25', '#7b8788', 6, 2); g.font = 'bold 34px Menlo, monospace'; g.fillStyle = '#eee3cf'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i), 32, 34); });
for (const name of icons)
    sprite(name, 64, 64, g => {
        g.strokeStyle = '#eee3cf';
        g.fillStyle = '#eee3cf';
        g.lineWidth = 3;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        const l = (x, y, a, b) => { g.beginPath(); g.moveTo(x, y); g.lineTo(a, b); g.stroke(); };
        if (name === 'hint') {
            g.beginPath();
            g.arc(32, 32, 21, 0, Math.PI * 2);
            g.fillStyle = '#aa7c3e';
            g.fill();
            g.strokeStyle = '#e6ae55';
            g.stroke();
            g.beginPath();
            g.arc(32, 32, 15, 0, Math.PI * 2);
            g.stroke();
        }
        else if (name === 'help') {
            g.font = 'bold 42px Menlo';
            g.textAlign = 'center';
            g.fillText('?', 32, 47);
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
writeFileSync(path.join(out, 'atlas.png'), atlas.toBuffer('image/png'));
writeFileSync(path.join(out, 'atlas.json'), JSON.stringify(manifest, null, 2));
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
const overview = createCanvas(1600, 1050), o = overview.getContext('2d');
o.fillStyle = '#0b1118';
o.fillRect(0, 0, 1600, 1050);
o.fillStyle = '#eee3cf';
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
writeFileSync(path.join(root, 'public/game/manifest.json'), JSON.stringify({ title: 'Quiet Mine / original game asset kit', models: ['miner-cart', 'timber-arch', 'lantern', 'supply-crate', 'cave-rock'].map(n => `models/${n}.glb`), ui: 'ui/atlas.png', frames: 'ui/atlas.json', fx: ['fx/glow.png', 'fx/dust.png', 'fx/spark.png'], source: 'assets/source/quiet-mine-kit.blend', license: 'Original assets created for MindMiner; no third-party game artwork.' }, null, 2));
console.log(`Built ${Object.keys(manifest).length} PNG UI sprites, atlas, effects, and asset sheet.`);
