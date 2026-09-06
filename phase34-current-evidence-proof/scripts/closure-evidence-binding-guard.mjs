import { readFile } from 'node:fs/promises';

for (const [path, label] of [
  ['scripts/phase-3-4-closure.mjs', 'local closure'],
  ['scripts/phase-3-4-docker-closure.mjs', 'Docker closure'],
]) {
  const source = await readFile(path, 'utf8');

  for (const required of [
    "const deploymentEvidence = ",
    "assertEvidenceHeadBinding(deploymentEvidence, head, 'deployment evidence')",
    "const deviceEvidence = ",
    "assertEvidenceHeadBinding(deviceEvidence, head, 'device evidence')",
    'assertEvidencePairBinding(deviceEvidence, deploymentEvidence)',
    "deviceEvidence.status === 'pending'",
    'deviceEvidence?.deploymentId !== deploymentEvidence?.deploymentId',
    'deviceEvidence?.mobileConfigFingerprint !== deploymentEvidence?.mobileConfigFingerprint',
  ]) {
    if (!source.includes(required)) {
      throw new Error(`closure evidence binding guard: ${label} missing ${required}`);
    }
  }

  const deploymentValidator = source.indexOf('validate-phase-3-4-deployment-evidence.mjs');
  const deploymentRead = source.indexOf('const deploymentEvidence = ', deploymentValidator);
  const deploymentHead = source.indexOf(
    "assertEvidenceHeadBinding(deploymentEvidence, head, 'deployment evidence')",
    deploymentRead,
  );
  const deviceMissingBranch = source.indexOf('if (!existsSync(deviceEvidencePath))', deploymentHead);
  const deviceRead = source.indexOf('const deviceEvidence = ', deviceMissingBranch);
  const deviceHead = source.indexOf(
    "assertEvidenceHeadBinding(deviceEvidence, head, 'device evidence')",
    deviceRead,
  );
  const pairBinding = source.indexOf(
    'assertEvidencePairBinding(deviceEvidence, deploymentEvidence)',
    deviceHead,
  );
  const pendingBranch = source.indexOf("deviceEvidence.status === 'pending'", pairBinding);

  if (
    deploymentValidator < 0 ||
    deploymentRead < 0 ||
    deploymentHead < 0 ||
    deviceMissingBranch < 0 ||
    deviceRead < 0 ||
    deviceHead < 0 ||
    pairBinding < 0 ||
    pendingBranch < 0 ||
    !(
      deploymentValidator < deploymentRead &&
      deploymentRead < deploymentHead &&
      deploymentHead < deviceMissingBranch &&
      deviceMissingBranch < deviceRead &&
      deviceRead < deviceHead &&
      deviceHead < pairBinding &&
      pairBinding < pendingBranch
    )
  ) {
    throw new Error(
      `closure evidence binding guard: ${label} must reject stale/mismatched evidence before physical-device progression`,
    );
  }
}

console.info(
  'closure-evidence-binding.guard ok deployment-head-before-device-step device-head+deployment+config-before-pending local+docker',
);
