import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const IMAGE = 'node:24.20.0';
const mobileEnvPath = path.join(root, 'mobile', '.env');
const deploymentEvidencePath = path.join(root, 'infra', 'deployment-gate-evidence.json');
const deviceEvidencePath = path.join(root, 'infra', 'device-gate-evidence.json');

await main();

async function main() {
  assertDockerAvailable();
  const head = currentHead();
  assertClean('before Docker code validation');

  validateCodeInDocker(head);
  assertRepositoryUnchanged(head, 'after Docker code validation');

  if (!existsSync(deploymentEvidencePath)) {
    console.info('phase34 docker closure: code validation passed; deployment evidence is the next blocker');
    console.info('NEXT: sh scripts/phase-3-4-safe-entrypoint.sh deploy');
    return;
  }

  run(process.execPath, [
    'scripts/validate-phase-3-4-deployment-evidence.mjs',
    deploymentEvidencePath,
  ]);
  const deploymentEvidence = await readEvidence(deploymentEvidencePath, 'deployment evidence');
  assertEvidenceHeadBinding(deploymentEvidence, head, 'deployment evidence');

  if (!existsSync(deviceEvidencePath)) {
    printPhysicalDeviceNextSteps('physical-device evidence has not been generated yet');
    return;
  }

  const deviceEvidence = await readEvidence(deviceEvidencePath, 'device evidence');
  assertEvidenceHeadBinding(deviceEvidence, head, 'device evidence');
  assertEvidencePairBinding(deviceEvidence, deploymentEvidence);

  if (deviceEvidence.status === 'pending') {
    console.info('phase34 docker closure: native acceptance evidence exists and is still pending');
    console.info('NEXT: complete Phase 3 auto + Phase 4 privacy on the two physical phones');
    console.info('THEN: sh scripts/phase-3-4-safe-entrypoint.sh record-evidence');
    console.info('THEN: sh scripts/phase-3-4-safe-entrypoint.sh closure');
    return;
  }

  run(process.execPath, ['scripts/validate-phase-3-4-evidence.mjs', deviceEvidencePath]);
  if (!existsSync(mobileEnvPath)) {
    throw new Error(
      'phase34 docker closure: mobile/.env is required for the final public gate; configure only the public signaling/backend endpoints',
    );
  }

  assertRepositoryUnchanged(head, 'before Docker final gate');
  console.info('phase34 docker closure: prerequisite evidence exists; running final acceptance gate in pinned Docker');
  runFinalGateInDocker(head);
  assertRepositoryUnchanged(head, 'after Docker final gate');
  console.info(`phase34 docker closure: final gate passed commit=${head}`);
}

function printPhysicalDeviceNextSteps(reason) {
  console.info(`phase34 docker closure: ${reason}; physical-device acceptance is next`);
  console.info('NEXT: switch local Node/npm to the exact acceptance toolchain');
  console.info('THEN: sh scripts/phase-3-4-safe-entrypoint.sh native-android and/or native-ios');
  console.info('THEN: complete docs/PHASE_3_4_DEVICE_GATE.md');
  console.info('THEN: sh scripts/phase-3-4-safe-entrypoint.sh record-evidence');
  console.info('THEN: sh scripts/phase-3-4-safe-entrypoint.sh closure');
}

async function readEvidence(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    throw new Error(`phase34 docker closure: ${label} must be valid JSON`);
  }
}

function assertEvidenceHeadBinding(evidence, expectedHead, label) {
  if (evidence?.commitSha !== expectedHead) {
    throw new Error(
      `phase34 docker closure: ${label} commitSha must equal current HEAD (${expectedHead})`,
    );
  }
}

function assertEvidencePairBinding(deviceEvidence, deploymentEvidence) {
  if (deviceEvidence?.deploymentId !== deploymentEvidence?.deploymentId) {
    throw new Error('phase34 docker closure: device and deployment evidence refer to different deployment instances');
  }
  if (deviceEvidence?.mobileConfigFingerprint !== deploymentEvidence?.mobileConfigFingerprint) {
    throw new Error('phase34 docker closure: device and deployment evidence refer to different mobile/public endpoint configuration');
  }
}

function validateCodeInDocker(expectedHead) {
  runDocker(expectedHead, ['sh scripts/phase-3-4-safe-entrypoint.sh validate']);
}

function runFinalGateInDocker(expectedHead) {
  runDocker(
    expectedHead,
    [
      'mkdir -p mobile infra',
      'cp /inputs/mobile.env mobile/.env',
      'cp /inputs/deployment-evidence.json infra/deployment-gate-evidence.json',
      'cp /inputs/device-evidence.json infra/device-gate-evidence.json',
      'sh scripts/phase-3-4-safe-entrypoint.sh gate infra/device-gate-evidence.json infra/deployment-gate-evidence.json',
    ],
    {
      inputFiles: [
        [mobileEnvPath, '/inputs/mobile.env'],
        [deploymentEvidencePath, '/inputs/deployment-evidence.json'],
        [deviceEvidencePath, '/inputs/device-evidence.json'],
      ],
    },
  );
}

function runDocker(expectedHead, commands, options = {}) {
  const { inputFiles = [] } = options;
  const args = [
    'run',
    '--rm',
    '--init',
    '-e',
    `PHASE34_EXPECTED_HEAD=${expectedHead}`,
    '-e',
    'HOME=/tmp',
    '-e',
    'npm_config_cache=/tmp/npm-cache',
    '-e',
    'npm_config_update_notifier=false',
    '-v',
    `${root}:/source:ro`,
  ];
  for (const [hostPath, containerPath] of inputFiles) {
    args.push('-v', `${hostPath}:${containerPath}:ro`);
  }

  const script = [
    'set -euo pipefail',
    'test "$(node -v)" = "v24.20.0"',
    'test "$(npm -v)" = "11.19.0"',
    'command -v git >/dev/null',
    'git config --global --add safe.directory /source',
    'git clone --no-local /source /workspace >/dev/null',
    'cd /workspace',
    'git checkout --detach "$PHASE34_EXPECTED_HEAD" >/dev/null',
    'test "$(git rev-parse HEAD)" = "$PHASE34_EXPECTED_HEAD"',
    ...commands,
  ].join('; ');

  args.push(IMAGE, 'bash', '-lc', script);
  run('docker', args);
}

function assertDockerAvailable() {
  const client = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 15_000,
  });
  if (client.error || client.status !== 0 || !(client.stdout ?? '').trim()) {
    throw new Error(
      'phase34 docker closure: Docker daemon is unavailable; start Docker Desktop/Engine or use sh scripts/phase-3-4-safe-entrypoint.sh closure with exact local Node/npm',
    );
  }
}

function assertRepositoryUnchanged(expectedHead, label) {
  assertHeadUnchanged(expectedHead, label);
  assertClean(label);
}

function assertHeadUnchanged(expectedHead, label) {
  const current = currentHead();
  if (current !== expectedHead) {
    throw new Error(`phase34 docker closure: HEAD changed ${label} (${expectedHead} -> ${current})`);
  }
}

function assertClean(label) {
  const entries = gitStatusEntries();
  if (entries.length === 0) return;
  throw new Error(
    `phase34 docker closure: worktree must be clean ${label}\n${entries
      .map((entry) => `${entry.status} ${entry.path}`)
      .join('\n')}`,
  );
}

function currentHead() {
  const sha = capture('git', ['rev-parse', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error('phase34 docker closure: unable to resolve a full git HEAD SHA');
  }
  return sha;
}

function gitStatusEntries() {
  const output = capture('git', ['status', '--porcelain=v1', '--untracked-files=normal']).trim();
  if (!output) return [];
  return output.split(/\r?\n/).map((line) => {
    const status = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const entryPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) : rawPath;
    return { status, path: entryPath };
  });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 docker closure: command failed (${command} ${args.join(' ')})`);
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
    throw new Error(`phase34 docker closure: command failed (${command} ${args.join(' ')})`);
  }
  return result.stdout ?? '';
}
