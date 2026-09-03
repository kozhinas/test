import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const ambientAllowScripts = Object.entries(process.env).find(
  ([key]) => key.toLowerCase() === 'npm_config_allow_scripts',
);
if (!ambientAllowScripts || !ambientAllowScripts[1]) {
  throw new Error('proof setup failed: outer npm run did not export npm_config_allow_scripts');
}

if (existsSync(path.join(root, '.npmrc'))) {
  throw new Error('proof setup failed: project .npmrc must be absent');
}

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.toLowerCase().startsWith('npm_config_')) delete env[key];
}
const emptyConfigPath = path.join(root, 'empty.npmrc');
env.npm_config_userconfig = emptyConfigPath;
env.npm_config_globalconfig = emptyConfigPath;

const remainingAmbient = Object.keys(env).filter(
  (key) =>
    key.toLowerCase().startsWith('npm_config_') &&
    key !== 'npm_config_userconfig' &&
    key !== 'npm_config_globalconfig',
);
if (remainingAmbient.length > 0) {
  throw new Error(`sanitizer failed: inherited npm config survived (${remainingAmbient.join(', ')})`);
}

const npmCiArgs = [
  'ci',
  '--registry=https://registry.npmjs.org/',
  '--replace-registry-host=never',
  '--strict-allow-scripts=true',
  '--dangerously-allow-all-scripts=false',
  '--ignore-scripts=false',
  '--strict-ssl=true',
  '--audit=false',
  '--fund=false',
];
const result = spawnSync('npm', npmCiArgs, {
  cwd: root,
  env,
  encoding: 'utf8',
  shell: false,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`sanitized npm ci failed with exit=${result.status}`);
}

console.info(
  `phase34 npm env proof ok observed-ambient=${ambientAllowScripts[0]} scrubbed=true pinned-userconfig=true pinned-globalconfig=true`,
);
