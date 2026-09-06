import { readFile } from 'node:fs/promises';

const source = await readFile('scripts/phase-3-4-deploy.mjs', 'utf8');

for (const required of [
  "run('npm', ['run', 'preflight:phase34'])",
  'let composeAttempted = false',
  'composeAttempted = true',
  "['scripts/phase-3-4-compose.mjs', 'up', '-d', '--build']",
  '} catch (error) {',
  'const rollbackErrors = []',
  'if (composeAttempted)',
  "['scripts/phase-3-4-compose.mjs', 'down']",
  'new AggregateError(',
  'phase34 deployment failed and rollback was incomplete',
  'throw originalError',
]) {
  if (!source.includes(required)) {
    throw new Error(`deployment failure cleanup guard: deploy orchestrator missing ${required}`);
  }
}

const preflightIndex = source.indexOf("run('npm', ['run', 'preflight:phase34'])");
const evidenceResets = [...source.matchAll(/await rm\(evidencePath, \{ force: true \}\)/g)].map(
  (match) => match.index,
);
const attemptDeclarationIndex = source.indexOf('let composeAttempted = false');
const tryIndex = source.indexOf('try {', attemptDeclarationIndex);
const attemptIndex = source.indexOf('composeAttempted = true', tryIndex);
const upIndex = source.indexOf(
  "['scripts/phase-3-4-compose.mjs', 'up', '-d', '--build']",
  attemptIndex,
);
const successIndex = source.indexOf('phase-3-4.deploy ok commit=', upIndex);
const catchIndex = source.indexOf('} catch (error) {', upIndex);
const rollbackEvidenceIndex = evidenceResets.find((index) => index > catchIndex) ?? -1;
const rollbackConditionIndex = source.indexOf('if (composeAttempted)', catchIndex);
const downIndex = source.indexOf("['scripts/phase-3-4-compose.mjs', 'down']", catchIndex);
const aggregateIndex = source.indexOf('new AggregateError(', catchIndex);
const originalRethrowIndex = source.indexOf('throw originalError', catchIndex);

if (evidenceResets.length !== 2) {
  throw new Error(
    `deployment failure cleanup guard: expected exactly two deployment-evidence removals, found ${evidenceResets.length}`,
  );
}

const preAttemptEvidenceIndex = evidenceResets[0] ?? -1;
if (
  preflightIndex < 0 ||
  preAttemptEvidenceIndex < 0 ||
  attemptDeclarationIndex < 0 ||
  tryIndex < 0 ||
  attemptIndex < 0 ||
  upIndex < 0 ||
  successIndex < 0 ||
  catchIndex < 0 ||
  rollbackEvidenceIndex < 0 ||
  rollbackConditionIndex < 0 ||
  downIndex < 0 ||
  aggregateIndex < 0 ||
  originalRethrowIndex < 0
) {
  throw new Error('deployment failure cleanup guard: unable to resolve rollback control-flow markers');
}

if (
  !(
    preflightIndex < preAttemptEvidenceIndex &&
    preAttemptEvidenceIndex < attemptDeclarationIndex &&
    attemptDeclarationIndex < tryIndex &&
    tryIndex < attemptIndex &&
    attemptIndex < upIndex &&
    upIndex < successIndex &&
    successIndex < catchIndex &&
    catchIndex < rollbackEvidenceIndex &&
    rollbackEvidenceIndex < rollbackConditionIndex &&
    rollbackConditionIndex < downIndex &&
    downIndex < aggregateIndex &&
    aggregateIndex < originalRethrowIndex
  )
) {
  throw new Error(
    'deployment failure cleanup guard: preflight/provision/success/rollback ordering is not fail-closed',
  );
}

const downCount = source.match(/\['scripts\/phase-3-4-compose\.mjs', 'down'\]/g)?.length ?? 0;
if (downCount !== 1) {
  throw new Error(
    `deployment failure cleanup guard: compose down must appear exactly once in rollback, found ${downCount}`,
  );
}

if (source.slice(0, catchIndex).includes("['scripts/phase-3-4-compose.mjs', 'down']")) {
  throw new Error('deployment failure cleanup guard: successful/preflight path must not tear down Compose');
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (packageJson.scripts?.['deploy:phase34'] !== 'node scripts/phase-3-4-deploy.mjs') {
  throw new Error('deployment failure cleanup guard: deploy:phase34 must use the guarded orchestrator');
}

const staticValidation = await readFile('scripts/phase-3-4-static-validation.mjs', 'utf8');
if (!staticValidation.includes("['scripts/deployment-failure-cleanup-guard.mjs']")) {
  throw new Error('deployment failure cleanup guard: canonical static validation must execute this guard');
}

console.info(
  'deployment-failure-cleanup.guard ok preflight-preserves-existing rollback-after-provision evidence-cleared compose-down aggregate-error wired-canonical',
);
