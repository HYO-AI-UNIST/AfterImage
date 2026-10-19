import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const mac = '/Applications/Blender.app/Contents/MacOS/Blender';
const blender = process.env.BLENDER_BIN || (existsSync(mac) ? mac : 'blender');
const result = spawnSync(blender, ['--factory-startup', '--background', '--threads', '2', '--python', 'scripts/design/build_game_models.py'], { stdio: 'inherit' });
if (result.error)
    console.error(result.error.message);
process.exitCode = result.status ?? 1;
