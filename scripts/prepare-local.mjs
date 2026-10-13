import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

// The generated production config contains the same local D1 identity used by
// the dev preview. Wrangler's migration ledger makes this safe to run again.
run(['scripts/run-framework.mjs', 'build']);
const configPath = resolve('dist/server/wrangler.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
for (const binding of config.d1_databases ?? []) {
  if (binding.binding === 'DB') binding.migrations_dir = resolve('drizzle');
}
writeFileSync(configPath, JSON.stringify(config, null, 2));
run(['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js',
  'd1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', '.wrangler/state']);
