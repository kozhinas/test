import { readFile } from 'node:fs/promises';

const deploy = await readFile('scripts/phase-3-4-deploy.mjs', 'utf8');
const compose = await readFile('scripts/phase-3-4-compose.mjs', 'utf8');

for (const required of [
  "run('npm', ['run', 'preflight:phase34'])",
  "'runtime-secrets',",
  "'.compose-attempted'",
  'let composeUpReturned = false',
  "['scripts/phase-3-4-compose.mjs', 'up', '-d', '--build']",
  'composeUpReturned = true',
  'await assertCurrentComposeAttemptMarker()',
  '} catch (error) {',
  'let composeAttempted = composeUpReturned',
  'composeAttempted = (await readComposeAttemptMarker()) === deploymentId',
  'if (composeAttempted)',
  "['scripts/phase-3-4-compose.mjs', 'down']",
  'new AggregateError(',
  'phase34 deployment failed and rollback was incomplete',
  'throw originalError',
]) {
  if (!deploy.includes(required)) {
    throw new Error(`deployment failure cleanup guard: deploy orchestrator missing ${required}`);
  }
}

const preflightIndex = deploy.indexOf("run('npm', ['run', 'preflight:phase34'])");
const tryIndex = deploy.indexOf('try {', preflightIndex);
const upIndex = deploy.indexOf("['scripts/phase-3-4-compose.mjs', 'up', '-d', '--build']", tryIndex);
const upReturnedIndex = deploy.indexOf('composeUpReturned = true', upIndex);
const markerAssertIndex = deploy.indexOf('await assertCurrentComposeAttemptMarker()', upReturnedIndex);
const evidenceResets = [...deploy.matchAll(/await rm\(evidencePath, \{ force: true \}\)/g)].map(
  (match) => match.index,
);
const successEvidenceResetIndex = evidenceResets.find((index) => index > markerAssertIndex) ?? -1;
const successIndex = deploy.indexOf('phase-3-4.deploy ok commit=', successEvidenceResetIndex);
const catchIndex = deploy.indexOf('} catch (error) {', successIndex);
const markerDecisionIndex = deploy.indexOf(
  'composeAttempted = (await readComposeAttemptMarker()) === deploymentId',
  catchIndex,
);
const rollbackConditionIndex = deploy.indexOf('if (composeAttempted)', markerDecisionIndex);
const rollbackEvidenceIndex = evidenceResets.find((index) => index > rollbackConditionIndex) ?? -1;
const downIndex = deploy.indexOf("['scripts/phase-3-4-compose.mjs', 'down']", rollbackEvidenceIndex);
const aggregateIndex = deploy.indexOf('new AggregateError(', downIndex);
const originalRethrowIndex = deploy.indexOf('throw originalError', aggregateIndex);

if (evidenceResets.length !== 2) {
  throw new Error(
    `deployment failure cleanup guard: expected exactly two deployment-evidence removals, found ${evidenceResets.length}`,
  );
}

for (const [label, index] of [
  ['preflight', preflightIndex],
  ['try', tryIndex],
  ['compose up', upIndex],
  ['up returned', upReturnedIndex],
  ['attempt marker assertion', markerAssertIndex],
  ['success evidence invalidation', successEvidenceResetIndex],
  ['success log', successIndex],
  ['catch', catchIndex],
  ['marker rollback decision', markerDecisionIndex],
  ['rollback condition', rollbackConditionIndex],
  ['rollback evidence removal', rollbackEvidenceIndex],
  ['compose down', downIndex],
  ['aggregate error', aggregateIndex],
  ['original rethrow', originalRethrowIndex],
]) {
  if (index < 0) {
    throw new Error(`deployment failure cleanup guard: unable to resolve ${label} control-flow marker`);
  }
}

if (
  !(
    preflightIndex < tryIndex &&
    tryIndex < upIndex &&
    upIndex < upReturnedIndex &&
    upReturnedIndex < markerAssertIndex &&
    markerAssertIndex < successEvidenceResetIndex &&
    successEvidenceResetIndex < successIndex &&
    successIndex < catchIndex &&
    catchIndex < markerDecisionIndex &&
    markerDecisionIndex < rollbackConditionIndex &&
    rollbackConditionIndex < rollbackEvidenceIndex &&
    rollbackEvidenceIndex < downIndex &&
    downIndex < aggregateIndex &&
    aggregateIndex < originalRethrowIndex
  )
) {
  throw new Error(
    'deployment failure cleanup guard: preflight/attempt-marker/provision/success/rollback ordering is not fail-closed',
  );
}

// Old evidence must survive every error that occurs before the wrapper proves a real Compose
// attempt. There must be no evidence deletion between preflight and the successful marker check.
const beforeMarkerAssertion = deploy.slice(preflightIndex, markerAssertIndex);
if (beforeMarkerAssertion.includes('await rm(evidencePath, { force: true })')) {
  throw new Error(
    'deployment failure cleanup guard: pre-Compose failures must preserve existing deployment evidence',
  );
}

const downCount = deploy.match(/\['scripts\/phase-3-4-compose\.mjs', 'down'\]/g)?.length ?? 0;
if (downCount !== 1) {
  throw new Error(
    `deployment failure cleanup guard: compose down must appear exactly once in rollback, found ${downCount}`,
  );
}
if (deploy.slice(0, catchIndex).includes("['scripts/phase-3-4-compose.mjs', 'down']")) {
  throw new Error('deployment failure cleanup guard: successful/preflight path must not tear down Compose');
}

for (const required of [
  "const composeAttemptMarkerPath = path.join(runtimeSecretDir, '.compose-attempted')",
  "if (operation === 'up')",
  'writeFileSync(composeAttemptMarkerPath, `${deploymentId}\\n`',
  "flag: 'wx'",
  'mode: 0o600',
  "['compose', '--env-file', '.env', '-f', 'infra/docker-compose.yml', ...args]",
]) {
  if (!compose.includes(required)) {
    throw new Error(`deployment failure cleanup guard: compose wrapper missing attempt marker boundary ${required}`);
  }
}

const secretProvisionIndex = compose.indexOf(
  'provisionRuntimeSecrets(readTurnSecret(deploymentEnv), readTlsPrivateKey())',
);
const markerWriteIndex = compose.indexOf('writeFileSync(composeAttemptMarkerPath, `${deploymentId}\\n`');
const composeSpawnIndex = compose.indexOf(
  "['compose', '--env-file', '.env', '-f', 'infra/docker-compose.yml', ...args]",
);
if (
  secretProvisionIndex < 0 ||
  markerWriteIndex < 0 ||
  composeSpawnIndex < 0 ||
  !(secretProvisionIndex < markerWriteIndex && markerWriteIndex < composeSpawnIndex)
) {
  throw new Error(
    'deployment failure cleanup guard: attempt marker must be written after pre-Compose secret staging and immediately before Docker Compose invocation',
  );
}

const markerWriteCount = compose.match(/writeFileSync\(composeAttemptMarkerPath/g)?.length ?? 0;
if (markerWriteCount !== 1) {
  throw new Error(
    `deployment failure cleanup guard: Compose attempt marker must be written exactly once, found ${markerWriteCount}`,
  );
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (packageJson.scripts?.['deploy:phase34'] !== 'node scripts/phase-3-4-deploy.mjs') {
  throw new Error('deployment failure cleanup guard: deploy:phase34 must use the guarded orchestrator');
}

const staticValidation = await readFile('scripts/phase-3-4-static-validation.mjs', 'utf8');
for (const required of [
  "['scripts/deployment-failure-cleanup-guard.mjs']",
  "['scripts/deployment-failure-cleanup-selftest.mjs']",
]) {
  if (!staticValidation.includes(required)) {
    throw new Error(
      `deployment failure cleanup guard: canonical static validation missing ${required}`,
    );
  }
}

const selftest = await readFile('scripts/deployment-failure-cleanup-selftest.mjs', 'utf8');
for (const required of [
  "'preflight-failure'",
  "'pre-compose-failure'",
  "'post-marker-compose-failure'",
  "'post-up-status-failure'",
  "'rollback-failure-aggregate'",
  "expectEvidence: 'preserved'",
  "expectEvidence: 'removed'",
  'expectDown: false',
  'expectDown: true',
  'expectAggregate: true',
]) {
  if (!selftest.includes(required)) {
    throw new Error(`deployment failure cleanup guard: rollback selftest missing ${required}`);
  }
}

console.info(
  'deployment-failure-cleanup.guard ok preflight+staging-preserve-existing marker-before-compose stale-evidence-after-attempt rollback-on-real-attempt aggregate-error executable-selftest wired-canonical',
);
