import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const sourceRoot = process.cwd();
const fixture = await mkdtemp(path.join(os.tmpdir(), 'phase34-closure-selftest-'));
const traceRoot = await mkdtemp(path.join(os.tmpdir(), 'phase34-closure-trace-'));
const tracePath = path.join(traceRoot, 'trace.log');
const deploymentPath = path.join(fixture, 'infra', 'deployment-gate-evidence.json');
const devicePath = path.join(fixture, 'infra', 'device-gate-evidence.json');

try {
  await mkdir(path.join(fixture, 'scripts'), { recursive: true });
  await mkdir(path.join(fixture, 'infra'), { recursive: true });
  await cp(
    path.join(sourceRoot, 'scripts', 'phase-3-4-closure.mjs'),
    path.join(fixture, 'scripts', 'phase-3-4-closure.mjs'),
  );
  await writeFile(
    path.join(fixture, '.gitignore'),
    'infra/deployment-gate-evidence.json\ninfra/device-gate-evidence.json\n',
  );

  await writeFile(
    path.join(fixture, 'scripts', 'phase-3-4-toolchain-check.mjs'),
    `if (process.env.PHASE34_SELFTEST_EXACT === '1') {\n  console.info('phase34 selftest exact toolchain');\n  process.exit(0);\n}\nprocess.exit(1);\n`,
  );
  for (const [fileName, label] of [
    ['phase-3-4-docker-closure.mjs', 'docker-closure'],
    ['phase-3-4-code-validation.mjs', 'code-validation'],
    ['validate-phase-3-4-deployment-evidence.mjs', 'validate-deployment'],
    ['validate-phase-3-4-evidence.mjs', 'validate-device'],
    ['phase-3-4-gate.mjs', 'final-gate'],
  ]) {
    await writeFile(
      path.join(fixture, 'scripts', fileName),
      `import { appendFileSync } from 'node:fs';\nconst trace = process.env.PHASE34_SELFTEST_TRACE;\nif (!trace) throw new Error('missing PHASE34_SELFTEST_TRACE');\nappendFileSync(trace, ${JSON.stringify(`${label}\n`)}, 'utf8');\n`,
    );
  }

  run('git', ['init', '-q'], fixture);
  run('git', ['config', 'user.email', 'phase34-closure-selftest@example.invalid'], fixture);
  run('git', ['config', 'user.name', 'Phase34 Closure Selftest'], fixture);
  run('git', ['config', 'commit.gpgsign', 'false'], fixture);
  run('git', ['add', '.'], fixture);
  run('git', ['commit', '-qm', 'fixture'], fixture);
  const head = capture('git', ['rev-parse', 'HEAD'], fixture).trim();

  await scenario('docker-fallback', async () => {
    const result = await runClosure({ exact: false });
    expectPass(result, 'docker fallback');
    expectIncludes(result.stdout, 'delegating safe code/final-gate steps to Docker', 'docker fallback');
    expectTrace(['docker-closure'], 'docker fallback');
  });

  await scenario('no-deployment-evidence', async () => {
    const result = await runClosure({ exact: true });
    expectPass(result, 'no deployment evidence');
    expectIncludes(result.stdout, 'deployment evidence is the next blocker', 'no deployment evidence');
    expectTrace(['code-validation'], 'no deployment evidence');
  });

  await scenario('stale-deployment-head', async () => {
    await writeEvidence(deploymentPath, {
      status: 'recorded',
      commitSha: '0'.repeat(40),
      deploymentId: 'deployment-a',
      mobileConfigFingerprint: 'fingerprint-a',
    });
    const result = await runClosure({ exact: true });
    expectFail(result, 'stale deployment head');
    expectIncludes(result.stderr, 'deployment evidence commitSha must equal current HEAD', 'stale deployment head');
    expectTrace(['code-validation', 'validate-deployment'], 'stale deployment head');
  });

  await scenario('deployment-without-device', async () => {
    await writeDeployment(head);
    const result = await runClosure({ exact: true });
    expectPass(result, 'deployment without device evidence');
    expectIncludes(result.stdout, 'physical-device evidence has not been generated yet', 'deployment without device evidence');
    expectTrace(['code-validation', 'validate-deployment'], 'deployment without device evidence');
  });

  await scenario('stale-device-head', async () => {
    await writeDeployment(head);
    await writeDevice({
      commitSha: 'f'.repeat(40),
      deploymentId: 'deployment-a',
      mobileConfigFingerprint: 'fingerprint-a',
      status: 'pending',
    });
    const result = await runClosure({ exact: true });
    expectFail(result, 'stale device head');
    expectIncludes(result.stderr, 'device evidence commitSha must equal current HEAD', 'stale device head');
    expectTrace(['code-validation', 'validate-deployment'], 'stale device head');
  });

  await scenario('deployment-id-mismatch', async () => {
    await writeDeployment(head);
    await writeDevice({
      commitSha: head,
      deploymentId: 'deployment-b',
      mobileConfigFingerprint: 'fingerprint-a',
      status: 'pending',
    });
    const result = await runClosure({ exact: true });
    expectFail(result, 'deployment id mismatch');
    expectIncludes(result.stderr, 'refer to different deployment instances', 'deployment id mismatch');
    expectTrace(['code-validation', 'validate-deployment'], 'deployment id mismatch');
  });

  await scenario('mobile-config-mismatch', async () => {
    await writeDeployment(head);
    await writeDevice({
      commitSha: head,
      deploymentId: 'deployment-a',
      mobileConfigFingerprint: 'fingerprint-b',
      status: 'pending',
    });
    const result = await runClosure({ exact: true });
    expectFail(result, 'mobile config mismatch');
    expectIncludes(result.stderr, 'different mobile/public endpoint configuration', 'mobile config mismatch');
    expectTrace(['code-validation', 'validate-deployment'], 'mobile config mismatch');
  });

  await scenario('pending-device-evidence', async () => {
    await writeDeployment(head);
    await writeDevice({
      commitSha: head,
      deploymentId: 'deployment-a',
      mobileConfigFingerprint: 'fingerprint-a',
      status: 'pending',
    });
    const result = await runClosure({ exact: true });
    expectPass(result, 'pending device evidence');
    expectIncludes(result.stdout, 'native acceptance evidence exists and is still pending', 'pending device evidence');
    expectTrace(['code-validation', 'validate-deployment'], 'pending device evidence');
  });

  await scenario('recorded-final-gate', async () => {
    await writeDeployment(head);
    await writeDevice({
      commitSha: head,
      deploymentId: 'deployment-a',
      mobileConfigFingerprint: 'fingerprint-a',
      status: 'recorded',
    });
    const result = await runClosure({ exact: true });
    expectPass(result, 'recorded final gate');
    expectIncludes(result.stdout, 'running final acceptance gate', 'recorded final gate');
    expectTrace(
      ['code-validation', 'validate-deployment', 'validate-device', 'final-gate'],
      'recorded final gate',
    );
  });

  await scenario('dirty-worktree', async () => {
    await writeFile(path.join(fixture, 'unexpected.txt'), 'dirty\n');
    const result = await runClosure({ exact: true });
    expectFail(result, 'dirty worktree');
    expectIncludes(result.stderr, 'worktree must be clean before Phase 3/4 closure', 'dirty worktree');
    expectTrace([], 'dirty worktree');
    await rm(path.join(fixture, 'unexpected.txt'), { force: true });
  });

  console.info(
    'phase-3-4.closure.selftest ok docker-fallback no-deployment stale-head no-device stale-device pair-mismatch pending recorded-final dirty-worktree',
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
  await rm(traceRoot, { recursive: true, force: true });
}

async function scenario(label, operation) {
  await rm(deploymentPath, { force: true });
  await rm(devicePath, { force: true });
  await rm(tracePath, { force: true });
  await operation();
  const status = capture('git', ['status', '--porcelain=v1', '--untracked-files=normal'], fixture).trim();
  if (status) {
    throw new Error(`phase34 closure selftest: ${label} left fixture dirty (${status})`);
  }
}

async function runClosure({ exact }) {
  return spawnSync(process.execPath, ['scripts/phase-3-4-closure.mjs'], {
    cwd: fixture,
    env: {
      ...process.env,
      PHASE34_SELFTEST_EXACT: exact ? '1' : '0',
      PHASE34_SELFTEST_TRACE: tracePath,
    },
    encoding: 'utf8',
    shell: false,
  });
}

async function writeDeployment(head) {
  await writeEvidence(deploymentPath, {
    status: 'recorded',
    commitSha: head,
    deploymentId: 'deployment-a',
    mobileConfigFingerprint: 'fingerprint-a',
  });
}

async function writeDevice(value) {
  await writeEvidence(devicePath, value);
}

async function writeEvidence(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function expectPass(result, label) {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `phase34 closure selftest: ${label} unexpectedly failed\nstdout:\n${result.stdout ?? ''}\nstderr:\n${result.stderr ?? ''}`,
    );
  }
}

function expectFail(result, label) {
  if (result.error) throw result.error;
  if (result.status === 0) {
    throw new Error(`phase34 closure selftest: ${label} unexpectedly passed`);
  }
}

function expectIncludes(value, expected, label) {
  if (!(value ?? '').includes(expected)) {
    throw new Error(
      `phase34 closure selftest: ${label} missing expected output ${JSON.stringify(expected)}\n${value ?? ''}`,
    );
  }
}

function expectTrace(expected, label) {
  let actual = [];
  try {
    actual = readFileSync(tracePath, 'utf8')
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    actual = [];
  }
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(
      `phase34 closure selftest: ${label} trace mismatch (${actual.join(',') || 'empty'} != ${expected.join(',') || 'empty'})`,
    );
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 closure selftest: command failed (${command} ${args.join(' ')})`);
  }
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 closure selftest: command failed (${command} ${args.join(' ')})`);
  }
  return result.stdout ?? '';
}
