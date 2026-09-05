import { spawnSync } from 'node:child_process';

import { readPhase34Health } from './phase-3-4-health.mjs';
import { readPhase34MobileConfig } from './phase-3-4-mobile-config.mjs';
import { phase34NpmInstallEnvironment } from './phase-3-4-npm-install-env.mjs';

const platform = process.argv[2];
if (platform !== 'android' && platform !== 'ios') {
  throw new Error('usage: node scripts/phase-3-4-native-build.mjs android|ios');
}

const root = process.cwd();
const headBefore = gitHead();
const npmCiArgs = [
  'ci',
  '--include=dev',
  '--registry=https://registry.npmjs.org/',
  '--replace-registry-host=never',
  '--strict-allow-scripts=true',
  '--dangerously-allow-all-scripts=false',
  '--ignore-scripts=false',
  '--strict-ssl=true',
  '--audit=false',
  '--fund=false',
];
assertClean('before native build');
const npmEnv = phase34NpmInstallEnvironment(root);

run(process.execPath, ['scripts/phase-3-4-toolchain-check.mjs', '--exact']);
run(process.execPath, ['scripts/phase-3-4-ensure-lockfile.mjs']);
run(process.execPath, ['scripts/lockfile-supply-chain-guard.mjs']);
run('npm', npmCiArgs);
run(process.execPath, [
  'scripts/phase-3-4-lockfile-check.mjs',
  '--strict',
  '--allow-external',
]);
assertRepositoryUnchanged(headBefore, 'after npm ci');

run('npm', ['run', 'doctor:phase34', '--', `--platform=${platform}`]);

const { backendUrl, signalingUrl } = await readPhase34MobileConfig(root);
const deploymentId = await readCurrentDeploymentId(backendUrl);
const publicEndpointEnv = {
  EXPO_PUBLIC_SIGNALING_URL: signalingUrl,
  EXPO_PUBLIC_BACKEND_URL: backendUrl,
};

run(
  'npm',
  [
    'run',
    'prebuild',
    '-w',
    '@private/mobile',
    '--',
    '--clean',
    '--no-install',
  ],
  publicEndpointEnv,
);
assertRepositoryUnchanged(headBefore, 'after Expo Prebuild');

if (platform === 'ios') {
  run('pod', ['install', '--project-directory=mobile/ios']);
  assertRepositoryUnchanged(headBefore, 'after CocoaPods install');
}

const acceptanceEnv = {
  ...publicEndpointEnv,
  EXPO_PUBLIC_PHASE34_ACCEPTANCE: '1',
  EXPO_PUBLIC_PHASE34_DEPLOYMENT_ID: deploymentId,
};

const platformArgs =
  platform === 'android'
    ? ['--device', '--no-install', '--no-bundler', '--variant', 'release']
    : ['--device', '--no-install', '--no-bundler', '--configuration', 'Release'];

run(
  'npm',
  ['run', platform, '-w', '@private/mobile', '--', ...platformArgs],
  acceptanceEnv,
);
assertRepositoryUnchanged(headBefore, 'after acceptance release build/install');

run(
  process.execPath,
  ['scripts/phase-3-4-reset-evidence.mjs'],
  { PHASE34_EXPECTED_DEPLOYMENT_ID: deploymentId },
);
assertRepositoryUnchanged(headBefore, 'after resetting local device evidence');

console.info(`phase-3-4.native-${platform} ok commit=${headBefore}`);
console.info('phase-3-4.native acceptance Release build embeds JS and requires no Metro server');
console.info('phase-3-4.native public endpoints are explicitly bound to validated mobile/.env values');
console.info('phase-3-4.native evidence status=pending; record the physical test before final gate');

async function readCurrentDeploymentId(backendUrl) {
  const health = await readPhase34Health(backendUrl, {
    attempts: 10,
    label: 'native deployment binding',
  });
  return health.deploymentId;
}

function assertRepositoryUnchanged(expectedHead, label) {
  const currentHead = gitHead();
  if (currentHead !== expectedHead) {
    throw new Error(
      `phase34 native build: HEAD changed ${label}; expected ${expectedHead}, got ${currentHead}`,
    );
  }
  assertClean(label);
}

function assertClean(label) {
  const status = capture('git', ['status', '--porcelain=v1', '--untracked-files=normal']).trim();
  if (status) {
    throw new Error(`phase34 native build: worktree must be clean ${label}\n${status}`);
  }
}

function gitHead() {
  const sha = capture('git', ['rev-parse', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error('phase34 native build: unable to resolve full git HEAD');
  }
  return sha;
}

function run(command, args, extraEnv = {}) {
  const baseEnv = command === 'npm' ? npmEnv : process.env;
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...baseEnv, ...extraEnv },
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 native build: command failed (${command} ${args.join(' ')})`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 native build: command failed (${command} ${args.join(' ')})`);
  }
  return result.stdout ?? '';
}
