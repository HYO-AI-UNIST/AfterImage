import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const mac = '/Applications/Blender.app/Contents/MacOS/Blender';
const blender = process.env.BLENDER_BIN || (existsSync(mac) ? mac : 'blender');
for (const grid of [4,3,5,6]) {
    const result = spawnSync(blender, ['--factory-startup', '--background', '--threads', '2', '--python', 'scripts/design/build_game_models.py'], { stdio: 'inherit', env: {...process.env, MINDMINER_GRID: String(grid)} });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
