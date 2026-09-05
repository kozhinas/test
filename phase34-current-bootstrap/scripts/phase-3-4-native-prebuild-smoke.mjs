import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { phase34NpmInstallEnvironment } from './phase-3-4-npm-install-env.mjs';

const root = process.cwd();
const platform = process.argv[2] ?? 'android';

if (platform !== 'android') {
  throw new Error('phase34 native smoke: only android is supported on the Linux CI smoke path');
}

const headBefore = gitHead();
assertClean('before native smoke');
const baseEnv = phase34NpmInstallEnvironment(root);

run(process.execPath, ['scripts/phase-3-4-toolchain-check.mjs', '--exact']);

const expoBinary = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'expo.cmd' : 'expo',
);
if (!existsSync(expoBinary)) {
  throw new Error('phase34 native smoke: local Expo CLI is missing; canonical npm ci must run first');
}

const outputDir = path.join(root, 'mobile', 'android');
const bundleOutputDir = path.join(root, 'mobile', '.phase34-native-smoke-bundle');
const syntheticEnv = {
  ...baseEnv,
  NODE_ENV: 'production',
  EXPO_PUBLIC_SIGNALING_URL: 'wss://phase34-ci.invalid/v1',
  EXPO_PUBLIC_BACKEND_URL: 'https://phase34-ci.invalid',
  EXPO_NO_TELEMETRY: '1',
};
delete syntheticEnv.EXPO_PUBLIC_PHASE34_ACCEPTANCE;
delete syntheticEnv.EXPO_PUBLIC_PHASE34_DEPLOYMENT_ID;

await rm(outputDir, { recursive: true, force: true });
await rm(bundleOutputDir, { recursive: true, force: true });

try {
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
      '--platform',
      platform,
    ],
    { cwd: root, env: syntheticEnv },
  );

  for (const relativePath of [
    'mobile/android/gradlew',
    'mobile/android/settings.gradle',
    'mobile/android/app/build.gradle',
    'mobile/android/app/src/main/AndroidManifest.xml',
  ]) {
    assertNonEmptyFile(relativePath, 'generated native file');
  }

  assertRepositoryUnchanged(headBefore, 'after Android Expo Prebuild');

  // Catch Metro/package-entry regressions before paying the full native compile cost.
  run(
    expoBinary,
    ['export', '--platform', platform, '--output-dir', bundleOutputDir, '--clear'],
    {
      cwd: path.join(root, 'mobile'),
      env: syntheticEnv,
    },
  );
  await rm(bundleOutputDir, { recursive: true, force: true });
  assertRepositoryUnchanged(headBefore, 'after Android Metro export smoke');

  // This is a CI smoke, not the final physical-device acceptance artifact. Limit the native
  // compile to the physical-device ABI so regressions surface faster; the real Release wrapper
  // remains unchanged and builds the normal project configuration for acceptance.
  run(
    'bash',
    [
      './gradlew',
      ':app:assembleRelease',
      '-PreactNativeArchitectures=arm64-v8a',
      '--no-daemon',
      '--stacktrace',
    ],
    {
      cwd: outputDir,
      env: syntheticEnv,
    },
  );

  const apkPath = 'mobile/android/app/build/outputs/apk/release/app-release.apk';
  assertNonEmptyFile(apkPath, 'release APK');
  assertRepositoryUnchanged(headBefore, 'after Android Release compile');

  console.info(
    `phase-3-4.native-smoke ok platform=${platform} release=assembled abi=arm64-v8a acceptance=false npm-env=sanitized commit=${headBefore}`,
  );
} finally {
  await rm(bundleOutputDir, { recursive: true, force: true });
  await rm(outputDir, { recursive: true, force: true });
}

assertRepositoryUnchanged(headBefore, 'after native smoke cleanup');

function assertNonEmptyFile(relativePath, label) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`phase34 native smoke: ${label} is missing (${relativePath})`);
  }
  const stats = statSync(absolutePath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error(`phase34 native smoke: ${label} must be a non-empty file (${relativePath})`);
  }
}

function assertRepositoryUnchanged(expectedHead, label) {
  const currentHead = gitHead();
  if (currentHead !== expectedHead) {
    throw new Error(
      `phase34 native smoke: HEAD changed ${label}; expected ${expectedHead}, got ${currentHead}`,
    );
  }
  assertClean(label);
}

function assertClean(label) {
  const status = capture('git', ['status', '--porcelain=v1', '--untracked-files=normal']).trim();
  if (status) {
    throw new Error(`phase34 native smoke: worktree must be clean ${label}\n${status}`);
  }
}

function gitHead() {
  const sha = capture('git', ['rev-parse', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error('phase34 native smoke: unable to resolve full git HEAD');
  }
  return sha;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? baseEnv,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 native smoke: command failed (${command} ${args.join(' ')})`);
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
    throw new Error(`phase34 native smoke: command failed (${command} ${args.join(' ')})`);
  }
  return result.stdout ?? '';
}
