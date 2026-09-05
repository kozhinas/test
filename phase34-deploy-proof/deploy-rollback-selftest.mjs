import { existsSync, readFileSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const sourceRoot = process.cwd();
const fixture = await mkdtemp(path.join(os.tmpdir(), 'phase34-deploy-proof-'));
const traceRoot = await mkdtemp(path.join(os.tmpdir(), 'phase34-deploy-trace-'));
const tracePath = path.join(traceRoot, 'trace.log');
const evidencePath = path.join(fixture, 'infra', 'deployment-gate-evidence.json');

try {
  await mkdir(path.join(fixture, 'scripts'), { recursive: true });
  await mkdir(path.join(fixture, 'infra'), { recursive: true });
  await mkdir(path.join(fixture, 'fakebin'), { recursive: true });
  await cp(
    path.join(sourceRoot, 'phase-3-4-deploy.mjs'),
    path.join(fixture, 'scripts', 'phase-3-4-deploy.mjs'),
  );

  await writeFile(
    path.join(fixture, 'scripts', 'phase-3-4-health.mjs'),
    "export async function readPhase34Health() { return { deploymentId: process.env.PHASE34_DEPLOYMENT_ID }; }\n",
  );
  await writeFile(
    path.join(fixture, 'scripts', 'phase-3-4-mobile-config.mjs'),
    "export async function phase34MobileConfigFingerprint() { return 'fingerprint-a'; }\nexport async function readPhase34MobileConfig() { return { backendUrl: 'https://example.invalid', signalingUrl: 'wss://example.invalid/v1' }; }\n",
  );
  await writeFile(
    path.join(fixture, 'scripts', 'phase-3-4-turn-transport-probe.mjs'),
    "throw new Error('turn transport probe should not be reached by rollback selftest');\n",
  );
  await writeFile(
    path.join(fixture, 'scripts', 'validate-phase-3-4-deployment-evidence.mjs'),
    "throw new Error('deployment evidence validator should not be reached by rollback selftest');\n",
  );
  await writeFile(
    path.join(fixture, 'infra', 'deployment-gate-evidence.example.json'),
    `${JSON.stringify({ schemaVersion: 1, status: 'pending' }, null, 2)}\n`,
  );
  await writeFile(
    path.join(fixture, '.gitignore'),
    'infra/deployment-gate-evidence.json\n',
  );

  const composeStub = `import { appendFileSync } from 'node:fs';
const trace = process.env.PHASE34_PROOF_TRACE;
const scenario = process.env.PHASE34_PROOF_SCENARIO;
const args = process.argv.slice(2);
const line = args.join(' ');
if (line === 'up -d --build') {
  appendFileSync(trace, 'up\\n');
  if (scenario === 'compose-up-fail') process.exit(43);
  process.exit(0);
}
if (line === '--capture ps --status running --services') {
  appendFileSync(trace, 'ps\\n');
  process.stdout.write('signaling\\nreverse-proxy\\n');
  process.exit(0);
}
if (line === 'down') {
  appendFileSync(trace, 'down\\n');
  if (scenario === 'rollback-down-fail') process.exit(44);
  process.exit(0);
}
throw new Error('unexpected compose args: ' + line);
`;
  await writeFile(path.join(fixture, 'scripts', 'phase-3-4-compose.mjs'), composeStub);

  const npmStub = `#!/bin/sh
printf '%s\\n' preflight >> "$PHASE34_PROOF_TRACE"
if [ "$PHASE34_PROOF_SCENARIO" = "preflight-fail" ]; then
  exit 42
fi
exit 0
`;
  const npmPath = path.join(fixture, 'fakebin', 'npm');
  await writeFile(npmPath, npmStub);
  await chmod(npmPath, 0o755);

  run('git', ['init', '-q'], fixture);
  run('git', ['config', 'user.email', 'phase34-deploy-proof@example.invalid'], fixture);
  run('git', ['config', 'user.name', 'Phase34 Deploy Proof'], fixture);
  run('git', ['config', 'commit.gpgsign', 'false'], fixture);
  run('git', ['add', '.'], fixture);
  run('git', ['commit', '-qm', 'fixture'], fixture);

  await scenario('preflight-fail', async () => {
    await writeOldEvidence();
    const result = runDeploy('preflight-fail');
    expectFail(result, 'preflight failure');
    if (!existsSync(evidencePath)) {
      throw new Error('preflight failure erased existing deployment evidence');
    }
    const existing = JSON.parse(readFileSync(evidencePath, 'utf8'));
    if (existing.sentinel !== 'existing-good-deployment') {
      throw new Error('preflight failure replaced existing deployment evidence');
    }
    expectTrace(['preflight'], 'preflight failure');
  });

  await scenario('compose-up-fail', async () => {
    await writeOldEvidence();
    const result = runDeploy('compose-up-fail');
    expectFail(result, 'compose up failure');
    assertEvidenceAbsent('compose up failure');
    expectTrace(['preflight', 'up', 'down'], 'compose up failure');
  });

  await scenario('post-up-fail', async () => {
    await writeOldEvidence();
    const result = runDeploy('post-up-fail');
    expectFail(result, 'post-up service failure');
    expectIncludes(result.stderr, 'required services are not running: coturn', 'post-up service failure');
    assertEvidenceAbsent('post-up service failure');
    expectTrace(['preflight', 'up', 'ps', 'down'], 'post-up service failure');
  });

  await scenario('rollback-down-fail', async () => {
    await writeOldEvidence();
    const result = runDeploy('rollback-down-fail');
    expectFail(result, 'rollback down failure');
    expectIncludes(result.stderr, 'phase34 deployment failed and rollback was incomplete', 'rollback down failure');
    assertEvidenceAbsent('rollback down failure');
    expectTrace(['preflight', 'up', 'ps', 'down'], 'rollback down failure');
  });

  console.info(
    'phase34 deploy rollback proof ok preflight-preserves-existing compose-up-cleans post-up-cleans rollback-error-aggregates',
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
  await rm(traceRoot, { recursive: true, force: true });
}

async function scenario(label, operation) {
  await rm(evidencePath, { force: true });
  await rm(tracePath, { force: true });
  await operation();
  const status = capture('git', ['status', '--porcelain=v1', '--untracked-files=normal'], fixture).trim();
  if (status) throw new Error(`${label} left fixture dirty (${status})`);
}

async function writeOldEvidence() {
  await writeFile(
    evidencePath,
    `${JSON.stringify({ sentinel: 'existing-good-deployment' }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function runDeploy(scenarioName) {
  return spawnSync(process.execPath, ['scripts/phase-3-4-deploy.mjs'], {
    cwd: fixture,
    env: {
      ...process.env,
      PATH: `${path.join(fixture, 'fakebin')}:${process.env.PATH ?? ''}`,
      PHASE34_PROOF_TRACE: tracePath,
      PHASE34_PROOF_SCENARIO: scenarioName,
    },
    encoding: 'utf8',
    shell: false,
  });
}

function expectFail(result, label) {
  if (result.error) throw result.error;
  if (result.status === 0) throw new Error(`${label} unexpectedly passed`);
}

function expectIncludes(value, expected, label) {
  if (!(value ?? '').includes(expected)) {
    throw new Error(`${label} missing expected output ${JSON.stringify(expected)}\n${value ?? ''}`);
  }
}

function assertEvidenceAbsent(label) {
  if (existsSync(evidencePath)) throw new Error(`${label} left deployment evidence behind`);
}

function expectTrace(expected, label) {
  const actual = existsSync(tracePath)
    ? readFileSync(tracePath, 'utf8').split(/\r?\n/).map((v) => v.trim()).filter(Boolean)
    : [];
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
    throw new Error(`${label} trace mismatch (${actual.join(',') || 'empty'} != ${expected.join(',')})`);
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`command failed (${command} ${args.join(' ')})`);
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`command failed (${command} ${args.join(' ')})`);
  return result.stdout ?? '';
}
