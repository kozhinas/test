import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const deploymentEvidencePath = path.join(root, 'infra', 'deployment-gate-evidence.json');
const deviceEvidencePath = path.join(root, 'infra', 'device-gate-evidence.json');

main();

function main() {
  const head = currentHead();
  assertNoDirtyPaths(gitStatusEntries(), 'before Phase 3/4 closure');

  if (!hasExactToolchain()) {
    console.info('phase34 closure: exact local Node/npm unavailable; delegating safe code/final-gate steps to Docker');
    run(process.execPath, ['scripts/phase-3-4-docker-closure.mjs']);
    return;
  }

  assertRepositoryUnchanged(head, 'before code validation');
  console.info('phase34 closure: running canonical code validation with immutable verified embedded lockfile');
  run(process.execPath, ['scripts/phase-3-4-code-validation.mjs']);
  assertRepositoryUnchanged(head, 'after code validation');

  if (!existsSync(deploymentEvidencePath)) {
    console.info('phase34 closure: code validation complete; deployment evidence is the next blocker');
    console.info('NEXT: sh scripts/phase-3-4-safe-entrypoint.sh deploy');
    return;
  }

  run(process.execPath, [
    'scripts/validate-phase-3-4-deployment-evidence.mjs',
    deploymentEvidencePath,
  ]);
  const deploymentEvidence = readEvidence(deploymentEvidencePath, 'deployment evidence');
  assertEvidenceHeadBinding(deploymentEvidence, head, 'deployment evidence');

  if (!existsSync(deviceEvidencePath)) {
    printPhysicalDeviceNextSteps('physical-device evidence has not been generated yet');
    return;
  }

  const deviceEvidence = readEvidence(deviceEvidencePath, 'device evidence');
  assertEvidenceHeadBinding(deviceEvidence, head, 'device evidence');
  assertEvidencePairBinding(deviceEvidence, deploymentEvidence);

  if (deviceEvidence.status === 'pending') {
    console.info('phase34 closure: native acceptance evidence exists and is still pending');
    console.info('NEXT: complete Phase 3 auto + Phase 4 privacy on the two physical phones');
    console.info('THEN: sh scripts/phase-3-4-safe-entrypoint.sh record-evidence');
    console.info('THEN: sh scripts/phase-3-4-safe-entrypoint.sh closure');
    return;
  }

  run(process.execPath, ['scripts/validate-phase-3-4-evidence.mjs', deviceEvidencePath]);
  assertRepositoryUnchanged(head, 'before final gate');

  console.info('phase34 closure: all prerequisite evidence exists; running final acceptance gate');
  run(process.execPath, [
    'scripts/phase-3-4-gate.mjs',
    deviceEvidencePath,
    deploymentEvidencePath,
  ]);
}

function printPhysicalDeviceNextSteps(reason) {
  console.info(`phase34 closure: ${reason}; physical-device acceptance is the next blocker`);
  console.info('NEXT: switch local Node/npm to the exact acceptance toolchain');
  console.info('THEN: sh scripts/phase-3-4-safe-entrypoint.sh native-android and/or native-ios');
  console.info('THEN: complete the symmetric two-device gate from docs/PHASE_3_4_DEVICE_GATE.md');
  console.info('THEN: sh scripts/phase-3-4-safe-entrypoint.sh record-evidence');
  console.info('THEN: sh scripts/phase-3-4-safe-entrypoint.sh closure');
}

function readEvidence(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(`phase34 closure: ${label} must be valid JSON`);
  }
}

function assertEvidenceHeadBinding(evidence, expectedHead, label) {
  if (evidence?.commitSha !== expectedHead) {
    throw new Error(
      `phase34 closure: ${label} commitSha must equal current HEAD (${expectedHead})`,
    );
  }
}

function assertEvidencePairBinding(deviceEvidence, deploymentEvidence) {
  if (deviceEvidence?.deploymentId !== deploymentEvidence?.deploymentId) {
    throw new Error('phase34 closure: device and deployment evidence refer to different deployment instances');
  }
  if (deviceEvidence?.mobileConfigFingerprint !== deploymentEvidence?.mobileConfigFingerprint) {
    throw new Error('phase34 closure: device and deployment evidence refer to different mobile/public endpoint configuration');
  }
}

function hasExactToolchain() {
  const result = spawnSync(process.execPath, ['scripts/phase-3-4-toolchain-check.mjs', '--exact'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status === 0) {
    const output = (result.stdout ?? '').trim();
    if (output) console.info(output);
    return true;
  }
  return false;
}

function assertNoDirtyPaths(entries, label) {
  if (entries.length === 0) return;
  throw new Error(
    `phase34 closure: worktree must be clean ${label}\n${entries
      .map((entry) => `${entry.status} ${entry.path}`)
      .join('\n')}`,
  );
}

function assertRepositoryUnchanged(expectedHead, label) {
  const current = currentHead();
  if (current !== expectedHead) {
    throw new Error(`phase34 closure: HEAD changed ${label} (${expectedHead} -> ${current})`);
  }
  assertNoDirtyPaths(gitStatusEntries(), label);
}

function currentHead() {
  const head = capture('git', ['rev-parse', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/i.test(head)) {
    throw new Error('phase34 closure: unable to resolve a full git HEAD SHA');
  }
  return head;
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
    throw new Error(`phase34 closure: command failed (${command} ${args.join(' ')})`);
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
    throw new Error(`phase34 closure: command failed (${command} ${args.join(' ')})`);
  }
  return result.stdout ?? '';
}
