import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'public/game/guide');
mkdirSync(out, { recursive: true });
const layout = JSON.parse(readFileSync(path.join(root, 'lib/mine/level-layout.json'), 'utf8')).nodes;
const edges = [];
for (let row = 0; row < 5; row++) for (let col = 0; col <= row; col++) {
    const a = `${row}-${col}`;
    if (col < row) edges.push([a, `${row}-${col + 1}`]);
    if (row < 4) edges.push([a, `${row + 1}-${col}`], [a, `${row + 1}-${col + 1}`]);
}
const key = (a, b) => [a, b].sort().join('~');
const art = {};
function line(g, a, b, color, width) { g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.strokeStyle = color; g.lineWidth = width; g.stroke(); }
function ellipse(g, x, y, rx, ry, color) { g.fillStyle = color; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
function glow(g, x, y, radius, color = '207,223,230') {
    const grad = g.createRadialGradient(x, y, 0, x, y, radius); grad.addColorStop(0, `rgba(${color},.28)`); grad.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = grad; g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}
function arrow(g, x, y, angle = 0, size = 1, bright = true) {
    g.save(); g.translate(x, y); g.rotate(angle); g.scale(size, size);
    g.shadowBlur = bright ? 15 : 0; g.shadowColor = '#d5e3e9';
    g.fillStyle = bright ? '#ffffff' : '#667079'; g.strokeStyle = '#090c10'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -22); g.lineTo(18, 0); g.lineTo(7, 0); g.lineTo(7, 18); g.lineTo(-7, 18); g.lineTo(-7, 0); g.lineTo(-18, 0); g.closePath(); g.stroke(); g.fill(); g.restore();
}
function cart(g, x, y, scale = 1) {
    g.save(); g.translate(x, y); g.scale(scale, scale);
    glow(g, 0, 0, 45); ellipse(g, 0, 10, 24, 10, '#03050888');
    for (const xx of [-15, 15]) { ellipse(g, xx, 9, 5, 7, '#07090b'); ellipse(g, xx, 9, 2, 3, '#84929a'); }
    g.fillStyle = '#8d999f'; g.beginPath(); g.moveTo(-25, -17); g.lineTo(23, -17); g.lineTo(18, 8); g.lineTo(-18, 8); g.closePath(); g.fill();
    g.strokeStyle = '#e1e4e4'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#313b41'; g.fillRect(-19, -20, 36, 10);
    for (let i = 0; i < 5; i++) ellipse(g, -12 + i * 6, -18 - i % 2 * 4, 7, 5, '#161d21');
    ellipse(g, 1, -1, 6, 5, '#f6f5ea'); g.restore();
}
function mine(g, x, y, size = 1) {
    g.save(); g.translate(x, y); g.scale(size, size); glow(g, 0, 0, 45, '210,84,65');
    line(g, [-20, 8], [-8, -19], '#d3a097', 5); line(g, [20, 8], [8, -19], '#b57569', 5);
    line(g, [-17, 7], [-5, -19], '#efefea', 1); line(g, [17, 7], [5, -19], '#efefea', 1);
    ellipse(g, 0, 0, 5, 5, '#ea715c'); g.restore();
}
function cloud(g, x, y, scale = 1) {
    g.save(); g.translate(x, y); g.scale(scale, scale); glow(g, 0, -8, 85, '224,206,179');
    for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 14 + i * 3; ellipse(g, Math.cos(a) * r, Math.sin(a) * r - 15, 20 + i % 3 * 3, 19 + i % 3 * 3, i < 4 ? '#686969' : '#d6d0bf'); }
    ellipse(g, 0, -8, 22, 20, '#f5f1df'); g.restore();
}
function coin(g, x, y, scale = 1, dim = false) {
    g.save(); g.translate(x, y); g.scale(scale, scale); g.globalAlpha = dim ? .18 : 1;
    ellipse(g, 0, 3, 20, 21, '#566774'); ellipse(g, 0, 0, 20, 21, '#bfccd2'); ellipse(g, 0, 0, 15, 16, '#29353e');
    g.fillStyle = '#ffffff'; g.font = 'bold 21px Menlo'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 0, 1); g.restore();
}
function board(g, cx = 400, top = 55, scale = 1, config = {}) {
    const p = id => [cx + layout[id][0] * 24 * scale, top + (layout[id][1] + 7.2) * 22 * scale];
    const safe = new Set((config.path || []).slice(1).map((id, i) => key(config.path[i], id)));
    const mines = new Set(config.mines || []);
    glow(g, cx, top + 180 * scale, 250 * scale);
    for (const [a, b] of edges) {
        const A = p(a), B = p(b), dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
        line(g, [A[0], A[1] + 12 * scale], [B[0], B[1] + 12 * scale], '#050709', 16 * scale);
        line(g, A, B, '#293239', 17 * scale);
        for (let t = .12; t < 1; t += .18) { const x = A[0] + dx * t, y = A[1] + dy * t; line(g, [x + nx * 7 * scale, y + ny * 7 * scale], [x - nx * 7 * scale, y - ny * 7 * scale], '#4c4941', 3 * scale); }
        for (const side of [-1, 1]) line(g, [A[0] + nx * 4 * side * scale, A[1] + ny * 4 * side * scale], [B[0] + nx * 4 * side * scale, B[1] + ny * 4 * side * scale], '#8d9ba2', 1.6 * scale);
        if (safe.has(key(a, b))) { g.save(); g.shadowColor = '#c8dfe8'; g.shadowBlur = 14; line(g, A, B, '#ffffff', 3 * scale); g.restore(); }
        if (mines.has(key(a, b))) mine(g, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, scale * .65);
    }
    for (const [id] of Object.entries(layout)) {
        const [x, y] = p(id); ellipse(g, x, y + 4 * scale, 12 * scale, 8 * scale, '#070a0c'); ellipse(g, x, y, 12 * scale, 7 * scale, '#61717a'); ellipse(g, x, y, 9 * scale, 5 * scale, '#1b252c');
    }
    const goal = p('0-0');
    glow(g, goal[0], goal[1], 42 * scale); g.fillStyle = '#c9d5d9'; g.fillRect(goal[0] - 11 * scale, goal[1] - 23 * scale, 22 * scale, 17 * scale);
    g.fillStyle = '#172229'; g.fillRect(goal[0] - 8 * scale, goal[1] - 20 * scale, 16 * scale, 14 * scale);
    if (config.cart) cart(g, ...p(config.cart), .65 * scale);
    if (config.starts) for (let i = 0; i < 5; i++) { const [x, y] = p(`4-${i}`); arrow(g, x, y - 22 * scale, 0, .48 * scale); g.fillStyle = '#ffffff'; g.font = `bold ${16 * scale}px Menlo`; g.textAlign = 'center'; g.fillText(String(i + 1), x, y + 32 * scale); }
    return p;
}
function sprite(name, draw) {
    const c = createCanvas(800, 440), g = c.getContext('2d');
    g.fillStyle = '#090d10'; g.fillRect(0, 0, 800, 440);
    // Cut rock silhouettes and restrained grain keep the plates part of the mine.
    g.fillStyle = '#141a1e';
    for (let i = 0; i < 15; i++) { const x = i * 62 - 20, y = i % 2 ? 410 : 15; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 28, y + (i % 2 ? -34 : 22)); g.lineTo(x + 70, y + 4); g.lineTo(x + 57, y + 30); g.closePath(); g.fill(); }
    for (let i = 0; i < 1800; i++) { g.fillStyle = i % 3 ? '#b3c5cf05' : '#00000020'; g.fillRect((i * 127.3) % 800, (i * 71.7) % 440, 2, 1); }
    draw(g);
    const v = g.createRadialGradient(400, 200, 170, 400, 200, 430); v.addColorStop(0, '#03050700'); v.addColorStop(1, '#030507b0'); g.fillStyle = v; g.fillRect(0, 0, 800, 440);
    writeFileSync(path.join(out, `${name}.png`), c.toBuffer('image/png')); art[name] = `guide/${name}.png`;
}
sprite('overview', g => {
    board(g, 200, 126, .53, {mines: ['2-0~3-0', '2-1~3-2']});
    board(g, 520, 60, 1.05, {path: ['4-4', '3-3', '2-2', '1-1', '0-0'], cart: '2-2'});
    arrow(g, 314, 237, Math.PI / 2, .9);
});
sprite('placement', g => {
    board(g, 400, 56, 1.12, {path: ['4-0', '3-0', '2-0', '1-0', '0-0'], mines: ['2-1~3-1', '2-2~3-3', '1-1~2-1', '3-1~4-2', '1-1~2-2', '2-0~2-1']});
    line(g, [204, 372], [596, 372], '#bcc8cc', 2); for (const x of [204, 596]) line(g, [x, 365], [x, 378], '#bcc8cc', 2);
});
sprite('movement', g => {
    const p = board(g, 400, 50, 1.05, {cart: '3-1', starts: true});
    const from = p('3-1');
    for (const id of ['2-0', '2-1', '3-0', '3-2', '4-1', '4-2']) { const to = p(id); arrow(g, from[0] + (to[0] - from[0]) * .66, from[1] + (to[1] - from[1]) * .66, Math.atan2(to[1] - from[1], to[0] - from[0]) + Math.PI / 2, .50); }
});
sprite('memory', g => {
    board(g, 260, 80, .8, {cart: '3-0'}); board(g, 592, 122, .60);
    const p = [260 - 5.42 * 24 * .8, 80 + (2.19 + 7.2) * 22 * .8]; cloud(g, p[0] + 20, p[1] - 24, .85);
    arrow(g, 430, 227, Math.PI / 2, .7);
    for (let i = 0; i < 3; i++) { g.save(); g.globalAlpha = .35 - i * .1; cart(g, 110 + i * 43, 380, .4); g.restore(); }
});
sprite('hint', g => {
    const p = board(g, 278, 80, .78);
    const a = p('2-1'), b = p('3-1'), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    g.save(); g.shadowBlur = 14; g.shadowColor = '#ffffff'; line(g, a, b, '#ffffff', 5); g.restore();
    line(g, mid, [540, 212], '#74858d', 2);
    g.fillStyle = '#172027'; g.fillRect(518, 138, 200, 158); g.strokeStyle = '#acbdc5'; g.lineWidth = 2; g.strokeRect(518, 138, 200, 158);
    mine(g, 618, 199, 1.1); g.fillStyle = '#ffffff'; g.font = 'bold 17px Menlo'; g.textAlign = 'center'; g.fillText('PRIVATE', 618, 269);
    coin(g, 562, 348, .85, true); coin(g, 616, 348, .85); coin(g, 670, 348, .85);
    g.fillStyle = '#ffffff'; g.font = 'bold 23px Menlo'; g.fillText('-1', 562, 403);
});
sprite('turns', g => {
    for (let i = 0; i < 3; i++) {
        g.fillStyle=i===1?'#273640':'#131b21';g.fillRect(78+i*232,76,196,270);g.strokeStyle=i===1?'#ffffff':'#63717a';g.lineWidth=i===1?3:1;g.strokeRect(78+i*232,76,196,270);
        board(g,176+i*232,127,.43);cart(g,176+i*232,310,.55);
    }
    arrow(g,408,378,0,.9);
});
sprite('scoring', g => {
    glow(g,570,235,160);cart(g,230,239,2);cart(g,570,239,2);
    arrow(g,400,217,Math.PI/2,1.1);coin(g,400,157,1.25);
    g.fillStyle='#ffffff';g.font='bold 40px Menlo';g.textAlign='center';g.fillText('3 → 2',230,347);g.fillText('3 → 4',570,347);
});
sprite('controls', g => {
    board(g, 550, 88, .83, {cart: '2-1'});
    g.strokeStyle = '#b7c4ca'; g.lineWidth = 4; g.fillStyle = '#172128'; g.beginPath(); g.roundRect(92, 90, 108, 147, 44); g.fill(); g.stroke(); line(g, [146, 90], [146, 147], '#b7c4ca', 3); ellipse(g, 146, 120, 5, 12, '#ffffff');
    g.beginPath(); g.roundRect(223, 143, 98, 170, 13); g.fill(); g.stroke(); line(g, [246, 158], [298, 158], '#b7c4ca', 3); ellipse(g, 271, 226, 15, 15, '#d7e1e5');
    for (let i = 0; i < 3; i++) { g.fillStyle = '#29363f'; g.fillRect(92 + i * 57, 329, 48, 44); g.strokeRect(92 + i * 57, 329, 48, 44); g.fillStyle = '#ffffff'; g.font = 'bold 22px Menlo'; g.textAlign = 'center'; g.fillText(['H', 'R', 'M'][i], 116 + i * 57, 360); }
});
sprite('retained',g=>{
    board(g,200,95,.73,{mines:['2-1~3-2','3-0~4-0']});board(g,590,95,.73,{mines:['1-1~2-2','3-2~4-3']});
    g.strokeStyle='#a8b9c1';g.lineWidth=3;g.strokeRect(53,60,294,305);g.strokeStyle='#ffffff';g.strokeRect(443,60,294,305);
    arrow(g,590,385,0,.65);g.fillStyle='#ffffff';g.font='bold 27px Menlo';g.textAlign='center';g.fillText('−1',590,44);
});
sprite('illuminator',g=>{board(g,280,70,.85);for(let i=0;i<5;i++)coin(g,550+(i%2)*66,115+Math.floor(i/2)*85,1.15);});
sprite('guardian',g=>{board(g,290,70,.86,{cart:'4-1'});cloud(g,266,219,.8);arrow(g,540,224,Math.PI,.9);cart(g,650,306,1.2);coin(g,583,122,1);coin(g,650,122,1);});
sprite('trapper',g=>{const p=board(g,380,60,1.08);for(const id of ['1-0','2-1','3-1','3-3']){const [x,y]=p(id);glow(g,x,y,42);g.fillStyle='#ffffff';g.font='bold 32px Menlo';g.textAlign='center';g.fillText('?',x,y-12);}});
sprite('thief',g=>{board(g,247,80,.78);g.fillStyle='#19232a';g.fillRect(493,104,203,225);g.strokeStyle='#b4c4cc';g.lineWidth=3;g.strokeRect(493,104,203,225);for(let i=0;i<3;i++)line(g,[518,147+i*53],[670,147+i*53],i===1?'#ffffff':'#60707a',3);g.setLineDash([7,5]);line(g,[475,204],[337,204],'#c5d5dd',3);g.setLineDash([]);arrow(g,405,262,-Math.PI/2,.9);});
sprite('shifter',g=>{const p=board(g,400,64,1.06);const a=p('2-1'),b=p('3-1'),c=p('2-2'),d=p('3-3');mine(g,(a[0]+b[0])/2,(a[1]+b[1])/2,.8);glow(g,(c[0]+d[0])/2,(c[1]+d[1])/2,45);arrow(g,445,238,Math.PI/2,.9);g.fillStyle='#ffffff';g.font='bold 25px Menlo';g.textAlign='center';g.fillText('7',660,101);});
sprite('recorder',g=>{for(let i=0;i<4;i++){const x=90+(i%2)*337,y=60+Math.floor(i/2)*176;g.fillStyle='#1c272e';g.fillRect(x,y,280,140);g.strokeStyle='#b1c2ca';g.lineWidth=2;g.strokeRect(x,y,280,140);board(g,x+91,y+19,.32);g.fillStyle='#ffffff';g.font='bold 25px Menlo';g.fillText(String(i+1),x+228,y+80);}});
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(art, null, 2));
const manifestPath = path.join(root, 'public/game/manifest.json');
if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.guide = 'guide/manifest.json';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
console.log(`Built ${Object.keys(art).length} illustrated game guide plates.`);
