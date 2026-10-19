import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'public/game/fx');
mkdirSync(out, { recursive: true });
function sprite(name, draw) {
    const canvas = createCanvas(256, 256), g = canvas.getContext('2d');
    draw(g); writeFileSync(path.join(out, `${name}.png`), canvas.toBuffer('image/png'));
}
sprite('blast-puff', g => {
    // Rounded pressure-cloud lobes, with no pointed flame silhouette.
    const fill = g.createRadialGradient(112,115,8,128,132,115);
    fill.addColorStop(0,'#fff8eaff'); fill.addColorStop(.42,'#f5e9d2fa');
    fill.addColorStop(.73,'#d0c6b4eb'); fill.addColorStop(1,'#7e87919c');
    g.fillStyle=fill; g.shadowColor='#e7d5b330'; g.shadowBlur=10;
    g.beginPath();
    for (const [x,y,r] of [[128,130,75],[80,126,39],[102,78,43],[154,80,42],[179,123,42],[157,174,42],[105,177,41]]) {
        g.moveTo(x+r,y); g.arc(x,y,r,0,Math.PI*2);
    }
    g.fill();
    g.shadowBlur=0;
    const light=g.createRadialGradient(106,102,0,106,102,74);
    light.addColorStop(0,'#ffffff85');light.addColorStop(1,'#ffffff00');
    g.fillStyle=light;g.fillRect(32,28,148,148);
});
if (existsSync(path.join(out,'flame.png'))) unlinkSync(path.join(out,'flame.png'));
sprite('smoke', g => {
    // Overlapping lobes avoid a repeated circular smoke silhouette.
    const lobes = [[128,135,76],[88,128,50],[156,103,52],[137,166,53],[97,166,42]];
    for (const [x,y,r] of lobes) {
        const fill = g.createRadialGradient(x,y,0,x,y,r);
        fill.addColorStop(0, '#d5d9def0'); fill.addColorStop(.35, '#bdc5cbd0'); fill.addColorStop(.74, '#aab3bc50'); fill.addColorStop(1, '#aab3bc00');
        g.fillStyle = fill; g.fillRect(x-r,y-r,r*2,r*2);
    }
});
sprite('ember-streak', g => {
    g.save(); g.translate(128,128); g.scale(.24,1);
    const fill = g.createRadialGradient(0,0,1,0,0,91);
    fill.addColorStop(0,'#fff6eaff'); fill.addColorStop(.12,'#ffe4baff');
    fill.addColorStop(.38,'#ffb15bb0'); fill.addColorStop(1,'#ff6e3200');
    g.fillStyle=fill; g.fillRect(-100,-100,200,200); g.restore();
});
const manifestPath = path.join(root, 'public/game/manifest.json');
if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.fx = [...new Set([...(manifest.fx ?? []).filter(p => p !== 'fx/flame.png'), 'fx/blast-puff.png', 'fx/smoke.png', 'fx/ember-streak.png'])];
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
console.log('Built rounded blast-cloud, smoke and ember particle sprites.');
