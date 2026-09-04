import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { phase34NpmInstallEnvironment } from './phase-3-4-npm-install-env.mjs';

const root = process.cwd();
const command = process.argv[2];
const targets = new Map([
  ['validate', ['scripts/phase-3-4-code-validation.mjs']],
  ['closure', ['scripts/phase-3-4-closure.mjs']],
  ['deploy', ['scripts/phase-3-4-deploy.mjs']],
  ['native-android', ['scripts/phase-3-4-native-build.mjs', 'android']],
  ['native-ios', ['scripts/phase-3-4-native-build.mjs', 'ios']],
  ['native-smoke-android', ['scripts/phase-3-4-native-prebuild-smoke.mjs', 'android']],
  ['record-evidence', ['scripts/phase-3-4-record-device-evidence.mjs']],
  ['image-smoke', ['scripts/phase-3-4-image-smoke.mjs']],
  ['compose-smoke', ['scripts/phase-3-4-compose-smoke.mjs']],
  ['gate', ['scripts/phase-3-4-gate.mjs', ...process.argv.slice(3)]],
]);

const env = phase34NpmInstallEnvironment(root, process.env);
if (command === 'selftest') {
  const forbiddenNames = new Set([
    'node_env',
    'expo_public_signaling_url',
    'expo_public_backend_url',
    'expo_public_phase34_acceptance',
    'expo_public_phase34_deployment_id',
  ]);
  for (const key of Object.keys(env)) {
    const normalized = key.toLowerCase();
    if (forbiddenNames.has(normalized)) {
      throw new Error(`phase34 safe entrypoint selftest: acceptance environment survived (${key})`);
    }
    if (
      normalized.startsWith('npm_config_') &&
      normalized !== 'npm_config_userconfig' &&
      normalized !== 'npm_config_globalconfig'
    ) {
      throw new Error(`phase34 safe entrypoint selftest: ambient npm config survived (${key})`);
    }
  }
  console.info('phase-3-4.safe-entrypoint selftest ok pre-node-bootstrap=active child-env=sanitized');
  process.exit(0);
}

const target = targets.get(command);
if (!target) {
  throw new Error(
    'usage: sh scripts/phase-3-4-safe-entrypoint.sh validate|closure|deploy|native-android|native-ios|native-smoke-android|record-evidence|image-smoke|compose-smoke|gate [gate args...]',
  );
}

const result = spawnSync(process.execPath, target, {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`phase34 safe entrypoint: ${command} failed with exit=${result.status}`);
}

console.info(`phase-3-4.safe-entrypoint ok command=${command}`);
