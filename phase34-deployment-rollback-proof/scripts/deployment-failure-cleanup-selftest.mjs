import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const sourceRoot = process.cwd();
const fixture = await mkdtemp(path.join(os.tmpdir(), 'phase34-deploy-rollback-selftest-'));
const fixedHead = 'a'.repeat(40);
const sentinelEvidence = '{"existing":"healthy"}\n';

try {
  await mkdir(path.join(fixture, 'scripts'), { recursive: true });
  await mkdir(path.join(fixture, 'infra'), { recursive: true });
  await mkdir(path.join(fixture, 'bin'), { recursive: true });

  await cp(
    path.join(sourceRoot, 'scripts', 'phase-3-4-deploy.mjs'),
    path.join(fixture, 'scripts', 'phase-3-4-deploy.mjs'),
  );

  await writeFile(
    path.join(fixture, 'scripts', 'phase-3-4-health.mjs'),
    `export async function readPhase34Health(_url, options = {}) { return { deploymentId: options.expectedDeploymentId ?? 'selftest' }; }\n`,
  );
  await writeFile(
    path.join(fixture, 'scripts', 'phase-3-4-mobile-config.mjs'),
    [
      `export async function phase34MobileConfigFingerprint() { return 'b'.repeat(64); }`,
      `export async function readPhase34MobileConfig() { return { backendUrl: 'https://example.invalid', signalingUrl: 'wss://example.invalid/v1' }; }`,
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(fixture, 'scripts', 'phase-3-4-turn-transport-probe.mjs'),
    `process.exit(0);\n`,
  );
  await writeFile(
    path.join(fixture, 'scripts', 'validate-phase-3-4-deployment-evidence.mjs'),
    `process.exit(0);\n`,
  );
  await writeFile(
    path.join(fixture, 'infra', 'deployment-gate-evidence.example.json'),
    `${JSON.stringify({ schemaVersion: 1, status: 'pending' })}\n`,
  );

  await writeExecutable(
    path.join(fixture, 'bin', 'git'),
    `#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args[0] === 'rev-parse' && args[1] === 'HEAD') { console.log('${fixedHead}'); process.exit(0); }\nif (args[0] === 'status') process.exit(0);\nprocess.stderr.write('unexpected selftest git command: ' + args.join(' ') + '\\n');\nprocess.exit(2);\n`,
  );
  await writeExecutable(
    path.join(fixture, 'bin', 'npm'),
    `#!/usr/bin/env node\nif (process.env.PHASE34_SELFTEST_PREFLIGHT === 'fail') process.exit(23);\nprocess.exit(0);\n`,
  );

  await writeFile(
    path.join(fixture, 'scripts', 'phase-3-4-compose.mjs'),
    `import { mkdirSync, rmSync, writeFileSync } from 'node:fs';\nimport path from 'node:path';\nconst args = process.argv.slice(2);\nconst root = process.cwd();\nconst events = path.join(root, 'selftest-events.log');\nconst mode = process.env.PHASE34_SELFTEST_COMPOSE_MODE ?? '';\nfunction event(value) { writeFileSync(events, value + '\\n', { flag: 'a' }); }\nif (args[0] === 'up') {\n  event('up');\n  if (mode !== 'pre-fail') {\n    const dir = path.join(root, 'infra', 'runtime-secrets');\n    mkdirSync(dir, { recursive: true });\n    writeFileSync(path.join(dir, '.compose-attempted'), (process.env.PHASE34_DEPLOYMENT_ID ?? '') + '\\n');\n  }\n  if (mode === 'pre-fail' || mode === 'post-marker-fail') process.exit(31);\n  process.exit(0);\n}\nif (args[0] === '--capture' && args[1] === 'ps') {\n  event('ps');\n  if (mode !== 'status-fail') process.stdout.write('signaling\\nreverse-proxy\\ncoturn\\n');\n  process.exit(0);\n}\nif (args[0] === 'down') {\n  event('down');\n  rmSync(path.join(root, 'infra', 'runtime-secrets'), { recursive: true, force: true });\n  if (process.env.PHASE34_SELFTEST_DOWN_FAIL === '1') process.exit(37);\n  process.exit(0);\n}\nprocess.stderr.write('unexpected selftest compose command: ' + args.join(' ') + '\\n');\nprocess.exit(2);\n`,
  );

  await runScenario('preflight-failure', {
    preflight: 'fail',
    composeMode: 'pre-fail',
    expectEvidence: 'preserved',
    expectDown: false,
  });
  await runScenario('pre-compose-failure', {
    composeMode: 'pre-fail',
    expectEvidence: 'preserved',
    expectDown: false,
  });
  await runScenario('post-marker-compose-failure', {
    composeMode: 'post-marker-fail',
    expectEvidence: 'removed',
    expectDown: true,
  });
  await runScenario('post-up-status-failure', {
    composeMode: 'status-fail',
    expectEvidence: 'removed',
    expectDown: true,
  });
  await runScenario('rollback-failure-aggregate', {
    composeMode: 'post-marker-fail',
    downFail: true,
    expectEvidence: 'removed',
    expectDown: true,
    expectAggregate: true,
  });

  console.info(
    'deployment-failure-cleanup.selftest ok preflight-preserve pre-compose-preserve post-marker-down post-up-down aggregate-rollback-error',
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}

async function runScenario(
  label,
  {
    preflight = 'pass',
    composeMode,
    downFail = false,
    expectEvidence,
    expectDown,
    expectAggregate = false,
  },
) {
  const evidencePath = path.join(fixture, 'infra', 'deployment-gate-evidence.json');
  const eventsPath = path.join(fixture, 'selftest-events.log');
  await rm(path.join(fixture, 'infra', 'runtime-secrets'), { recursive: true, force: true });
  await rm(eventsPath, { force: true });
  await writeFile(evidencePath, sentinelEvidence, { mode: 0o600 });

  const env = {
    ...process.env,
    PATH: `${path.join(fixture, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
    PHASE34_SELFTEST_PREFLIGHT: preflight,
    PHASE34_SELFTEST_COMPOSE_MODE: composeMode,
    PHASE34_SELFTEST_DOWN_FAIL: downFail ? '1' : '0',
  };
  const result = spawnSync(process.execPath, ['scripts/phase-3-4-deploy.mjs'], {
    cwd: fixture,
    env,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status === 0) {
    throw new Error(`deployment failure cleanup selftest: ${label} unexpectedly succeeded`);
  }

  if (expectEvidence === 'preserved') {
    if (!existsSync(evidencePath)) {
      throw new Error(`deployment failure cleanup selftest: ${label} removed existing evidence`);
    }
    const actual = await readFile(evidencePath, 'utf8');
    if (actual !== sentinelEvidence) {
      throw new Error(`deployment failure cleanup selftest: ${label} changed existing evidence`);
    }
  } else if (existsSync(evidencePath)) {
    throw new Error(`deployment failure cleanup selftest: ${label} left stale deployment evidence`);
  }

  const events = existsSync(eventsPath) ? await readFile(eventsPath, 'utf8') : '';
  const sawDown = events.split(/\r?\n/).includes('down');
  if (sawDown !== expectDown) {
    throw new Error(
      `deployment failure cleanup selftest: ${label} compose-down=${sawDown} expected=${expectDown}\nevents=${events}`,
    );
  }

  const aggregateSeen = (result.stderr ?? '').includes(
    'phase34 deployment failed and rollback was incomplete',
  );
  if (aggregateSeen !== expectAggregate) {
    throw new Error(
      `deployment failure cleanup selftest: ${label} aggregate=${aggregateSeen} expected=${expectAggregate}\nstderr=${result.stderr}`,
    );
  }
}

async function writeExecutable(filePath, source) {
  await writeFile(filePath, source, { mode: 0o755 });
  await chmod(filePath, 0o755);
}
