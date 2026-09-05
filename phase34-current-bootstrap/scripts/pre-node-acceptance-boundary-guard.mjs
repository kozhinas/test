import { readFile } from 'node:fs/promises';

const shell = await readFile('scripts/phase-3-4-safe-entrypoint.sh', 'utf8');
const preNodeEnvNames = [
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'OPENSSL_CONF',
];
for (const required of ['#!/bin/sh', 'set -eu', 'exec node scripts/phase-3-4-safe-entrypoint.mjs "$@"']) {
  if (!shell.includes(required)) {
    throw new Error(`pre-node acceptance boundary guard: shell bootstrap missing ${required}`);
  }
}
const nodeExecIndex = shell.indexOf('exec node scripts/phase-3-4-safe-entrypoint.mjs "$@"');
if (nodeExecIndex < 0) {
  throw new Error('pre-node acceptance boundary guard: shell bootstrap is missing Node exec');
}
for (const name of preNodeEnvNames) {
  const check = `if [ -n "\${${name}-}" ]`;
  const message = `${name} must be unset before acceptance bootstrap`;
  const checkIndex = shell.indexOf(check);
  if (checkIndex < 0 || checkIndex > nodeExecIndex || !shell.includes(message)) {
    throw new Error(`pre-node acceptance boundary guard: ${name} must be rejected before Node starts`);
  }
}

const launcher = await readFile('scripts/phase-3-4-safe-entrypoint.mjs', 'utf8');
for (const required of [
  "import { phase34NpmInstallEnvironment } from './phase-3-4-npm-install-env.mjs'",
  "const env = phase34NpmInstallEnvironment(root, process.env)",
  "if (command === 'selftest')",
  "normalized.startsWith('git_')",
  'git-overrides=scrubbed',
  "['validate', ['scripts/phase-3-4-code-validation.mjs']]",
  "['closure', ['scripts/phase-3-4-closure.mjs']]",
  "['deploy', ['scripts/phase-3-4-deploy.mjs']]",
  "['native-android', ['scripts/phase-3-4-native-build.mjs', 'android']]",
  "['native-ios', ['scripts/phase-3-4-native-build.mjs', 'ios']]",
  "['native-smoke-android', ['scripts/phase-3-4-native-prebuild-smoke.mjs', 'android']]",
  "['record-evidence', ['scripts/phase-3-4-record-device-evidence.mjs']]",
  "['image-smoke', ['scripts/phase-3-4-image-smoke.mjs']]",
  "['compose-smoke', ['scripts/phase-3-4-compose-smoke.mjs']]",
  'env,',
  'shell: false',
  'phase-3-4.safe-entrypoint selftest ok',
]) {
  if (!launcher.includes(required)) {
    throw new Error(`pre-node acceptance boundary guard: sanitized launcher missing ${required}`);
  }
}

const selftest = await readFile('scripts/pre-node-acceptance-boundary-selftest.mjs', 'utf8');
for (const required of [
  "spawnSync('sh', ['-n', shellPath]",
  "['NODE_OPTIONS', '--require=/tmp/phase34-preload.js'",
  "['NODE_PATH', '/tmp/phase34-modules'",
  "['NODE_EXTRA_CA_CERTS', '/tmp/phase34-untrusted-ca.pem'",
  "['NODE_TLS_REJECT_UNAUTHORIZED', '0'",
  "['SSL_CERT_FILE', '/tmp/phase34-untrusted-ca.pem'",
  "['SSL_CERT_DIR', '/tmp/phase34-untrusted-certs'",
  "['OPENSSL_CONF', '/tmp/phase34-untrusted-openssl.cnf'",
  "HTTPS_PROXY: 'http://proxy.example.invalid:8080'",
  "ALL_PROXY: 'socks5://proxy.example.invalid:1080'",
  "npm_config_registry: 'http://example.invalid/'",
  "NPM_CONFIG_STRICT_SSL: 'false'",
  "EXPO_PUBLIC_PHASE34_ACCEPTANCE: '1'",
  "EXPO_PUBLIC_PHASE34_DEPLOYMENT_ID: 'ambient-deployment'",
  "GIT_DIR: '/tmp/phase34-untrusted-git-dir'",
  "Git_Work_Tree: '/tmp/phase34-untrusted-worktree'",
  "GIT_INDEX_FILE: '/tmp/phase34-untrusted-index'",
  "GIT_CONFIG_COUNT: '1'",
  "GIT_CONFIG_KEY_0: 'core.worktree'",
  "GIT_CONFIG_VALUE_0: '/tmp/phase34-untrusted-config-worktree'",
  "GITHUB_ACTIONS: 'true'",
  'git-overrides=scrubbed',
]) {
  if (!selftest.includes(required)) {
    throw new Error(`pre-node acceptance boundary guard: executable selftest missing ${required}`);
  }
}

const staticValidation = await readFile('scripts/phase-3-4-static-validation.mjs', 'utf8');
if (!staticValidation.includes("['scripts/pre-node-acceptance-boundary-selftest.mjs']")) {
  throw new Error('pre-node acceptance boundary guard: canonical static validation must execute the boundary selftest');
}

const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
for (const required of [
  'run: sh scripts/phase-3-4-safe-entrypoint.sh validate',
  'run: sh scripts/phase-3-4-safe-entrypoint.sh native-smoke-android',
  'run: sh scripts/phase-3-4-safe-entrypoint.sh image-smoke',
  'run: sh scripts/phase-3-4-safe-entrypoint.sh compose-smoke',
]) {
  if (!workflow.includes(required)) {
    throw new Error(`pre-node acceptance boundary guard: CI bypasses pre-Node boundary ${required}`);
  }
}

for (const forbidden of [
  'run: npm run validate:phase34-code',
  'run: node scripts/phase-3-4-native-prebuild-smoke.mjs',
  'run: node scripts/phase-3-4-image-smoke.mjs',
  'run: node scripts/phase-3-4-compose-smoke.mjs',
]) {
  if (workflow.includes(forbidden)) {
    throw new Error(`pre-node acceptance boundary guard: CI contains unsafe direct entry ${forbidden}`);
  }
}

console.info('pre-node-acceptance-boundary.guard ok node-loading+tls-trust-env rejected-before-node proxy+git-override-env=scrubbed sanitized-launcher evidence-recorder-safe executable-selftest ci-wired');
