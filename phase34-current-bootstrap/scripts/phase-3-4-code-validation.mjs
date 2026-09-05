import { spawnSync } from 'node:child_process';

import { phase34NpmInstallEnvironment } from './phase-3-4-npm-install-env.mjs';

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
assertClean('before code validation');
const npmEnv = phase34NpmInstallEnvironment(root);

run(process.execPath, ['scripts/phase-3-4-toolchain-check.mjs', '--exact']);
run(process.execPath, ['scripts/phase-3-4-ensure-lockfile.mjs']);
run(process.execPath, [
  'scripts/phase-3-4-lockfile-check.mjs',
  '--strict',
  '--allow-external',
]);
run(process.execPath, ['scripts/lockfile-supply-chain-guard.mjs']);
assertRepositoryUnchanged(headBefore, 'after toolchain/lockfile checks');

run('npm', npmCiArgs);
run(process.execPath, [
  'scripts/phase-3-4-lockfile-check.mjs',
  '--strict',
  '--allow-external',
]);
assertRepositoryUnchanged(headBefore, 'after npm ci');

// The final acceptance path owns the static architecture gate directly. Do not rely on the
// internal composition of the generic root `npm test` script to keep Phase 3/4 guards enabled.
run(process.execPath, ['scripts/phase-3-4-static-validation.mjs']);
assertRepositoryUnchanged(headBefore, 'after canonical static validation');

run('npm', ['run', 'typecheck']);
run('npm', ['run', 'lint']);
run('npm', ['test']);
assertRepositoryUnchanged(headBefore, 'after typecheck/lint/tests');

console.info(`phase-3-4.code-validation ok commit=${headBefore}`);

function assertRepositoryUnchanged(expectedHead, label) {
  const currentHead = gitHead();
  if (currentHead !== expectedHead) {
    throw new Error(
      `phase34 code validation: HEAD changed ${label}; expected ${expectedHead}, got ${currentHead}`,
    );
  }
  assertClean(label);
}

function assertClean(label) {
  const status = capture('git', ['status', '--porcelain=v1', '--untracked-files=normal']).trim();
  if (status) {
    throw new Error(`phase34 code validation: worktree must be clean ${label}\n${status}`);
  }
}

function gitHead() {
  const sha = capture('git', ['rev-parse', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error('phase34 code validation: unable to resolve full git HEAD');
  }
  return sha;
}

function run(command, args) {
  const env = command === 'npm' ? npmEnv : process.env;
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 code validation: command failed (${command} ${args.join(' ')})`);
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
    throw new Error(`phase34 code validation: command failed (${command} ${args.join(' ')})`);
  }
  return result.stdout ?? '';
}
