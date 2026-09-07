import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const rawArgs = process.argv.slice(2);
const captureOutput = rawArgs[0] === '--capture';
const args = captureOutput ? rawArgs.slice(1) : rawArgs;
if (args.length === 0) {
  throw new Error(
    'usage: node scripts/phase-3-4-compose.mjs [--capture] config|up -d --build|ps --status running --services|down',
  );
}

const operation = resolveAllowedOperation(args, captureOutput);
const requiresDeploymentId = operation === 'up';
const envPath = path.join(root, '.env');
const deploymentEnv = parseEnv(readFileSync(envPath, 'utf8'));
const runtimeSecretDir = path.join(root, 'infra', 'runtime-secrets');
const composeAttemptMarkerPath = path.join(runtimeSecretDir, '.compose-attempted');
const runtimeSecretFiles = [
  ['signaling_turn_secret', 1000],
  ['coturn_turn_secret', 65534],
  ['turn_tls_private_key', 65534],
];
let ephemeralRuntimeSecrets = false;

if (operation === 'up') {
  verifyProductionInputsForBuild();
  if (process.platform !== 'linux') {
    throw new Error('phase34 compose: production secret staging requires a Linux deployment host');
  }
  provisionRuntimeSecrets(readTurnSecret(deploymentEnv), readTlsPrivateKey());
} else {
  const secretState = runtimeSecretState();
  if (secretState === 'partial') {
    if (operation !== 'down') {
      throw new Error('phase34 compose: runtime secret staging is partial; run down to clean it safely');
    }
    cleanupRuntimeSecrets();
  }
  if (runtimeSecretState() === 'missing') {
    provisionRuntimeSecrets('A'.repeat(32), 'phase34-compose-inspection-placeholder');
    ephemeralRuntimeSecrets = true;
  }
}

let deploymentId = process.env.PHASE34_DEPLOYMENT_ID?.trim() ?? '';
if (!deploymentId) {
  if (requiresDeploymentId) {
    throw new Error('phase34 compose: up requires PHASE34_DEPLOYMENT_ID from the deployment orchestrator');
  }
  deploymentId = randomBytes(24).toString('base64url');
}
if (!/^[A-Za-z0-9_-]{32,64}$/.test(deploymentId)) {
  throw new Error('phase34 compose: PHASE34_DEPLOYMENT_ID must be 32-64 base64url-safe characters');
}

// Root .env remains the authoritative non-secret deployment configuration. Strip shell overrides
// before Compose parses --env-file. Permanent TURN/TLS secret bytes are never exported to the
// Compose process environment; they are staged as owner-only files and mounted through secrets.
const childEnv = { ...process.env };
for (const key of [
  'SIGNALING_PORT',
  'LOG_LEVEL',
  'TURN_REALM',
  'TURN_HOST',
  'TURN_EXTERNAL_IP',
  'TURN_PORT',
  'TURN_TLS_PORT',
  'TURN_CREDENTIAL_TTL_SECONDS',
  'TURN_SECRET',
  'TURN_TLS_PRIVATE_KEY_PEM',
  'PHASE34_DEPLOYMENT_ID',
]) {
  delete childEnv[key];
}
childEnv.PHASE34_DEPLOYMENT_ID = deploymentId;

// The deployment orchestrator uses this marker to distinguish failures that happen while
// validating/staging production inputs from failures after Docker Compose has actually been
// invoked. It is deliberately written only after all pre-Compose work succeeds and immediately
// before spawning `docker compose`.
if (operation === 'up') {
  writeFileSync(composeAttemptMarkerPath, `${deploymentId}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

const result = spawnSync(
  'docker',
  ['compose', '--env-file', '.env', '-f', 'infra/docker-compose.yml', ...args],
  {
    cwd: root,
    env: childEnv,
    encoding: captureOutput ? 'utf8' : undefined,
    stdio: captureOutput ? 'pipe' : 'inherit',
    shell: false,
  },
);

if (result.error) {
  if (ephemeralRuntimeSecrets) cleanupRuntimeSecrets();
  throw result.error;
}
if (result.status !== 0) {
  if (captureOutput && result.stderr) process.stderr.write(result.stderr);
  if (ephemeralRuntimeSecrets) cleanupRuntimeSecrets();
  throw new Error(`phase34 compose: docker compose failed with exit=${result.status}`);
}
if (captureOutput && result.stdout) process.stdout.write(result.stdout);
if (captureOutput && result.stderr) process.stderr.write(result.stderr);

if (operation === 'down' || ephemeralRuntimeSecrets) {
  cleanupRuntimeSecrets();
}

function provisionRuntimeSecrets(turnSecret, tlsPrivateKey) {
  cleanupRuntimeSecrets();
  mkdirSync(runtimeSecretDir, { recursive: true, mode: 0o700 });
  chmodSync(runtimeSecretDir, 0o700);

  const values = new Map([
    ['signaling_turn_secret', `${turnSecret}\n`],
    ['coturn_turn_secret', `${turnSecret}\n`],
    ['turn_tls_private_key', tlsPrivateKey],
  ]);

  try {
    for (const [filename] of runtimeSecretFiles) {
      const value = values.get(filename);
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`phase34 compose: missing staged secret value for ${filename}`);
      }
      const filePath = path.join(runtimeSecretDir, filename);
      writeFileSync(filePath, value, { encoding: 'utf8', flag: 'wx', mode: 0o400 });
      chmodSync(filePath, 0o400);
    }

    for (const [filename, uid] of runtimeSecretFiles) {
      chownRuntimeSecret(filename, uid);
      assertRuntimeSecretFile(filename, uid);
    }
  } catch (error) {
    cleanupRuntimeSecrets();
    throw error;
  }
}

function chownRuntimeSecret(filename, uid) {
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--user',
      '0:0',
      '--cap-drop',
      'ALL',
      '--cap-add',
      'CHOWN',
      '--cap-add',
      'DAC_OVERRIDE',
      '--security-opt',
      'no-new-privileges:true',
      '--mount',
      `type=bind,src=${runtimeSecretDir},dst=/runtime-secrets`,
      'node:24.20.0-alpine3.24',
      'sh',
      '-ec',
      `chown ${uid}:${uid} /runtime-secrets/${filename}`,
    ],
    { cwd: root, encoding: 'utf8', shell: false },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 compose: failed to assign runtime secret ownership for ${filename}`);
  }
}

function assertRuntimeSecretFile(filename, expectedUid) {
  const filePath = path.join(runtimeSecretDir, filename);
  const linkStat = lstatSync(filePath);
  if (!linkStat.isFile() || linkStat.isSymbolicLink()) {
    throw new Error(`phase34 compose: runtime secret must be a regular non-symlink file (${filename})`);
  }
  const fileStat = statSync(filePath);
  const mode = fileStat.mode & 0o777;
  if (mode !== 0o400) {
    throw new Error(
      `phase34 compose: runtime secret ${filename} mode=${mode.toString(8)}; expected 400`,
    );
  }
  if (process.platform === 'linux' && fileStat.uid !== expectedUid) {
    throw new Error(
      `phase34 compose: runtime secret ${filename} uid=${fileStat.uid}; expected ${expectedUid}`,
    );
  }
}

function runtimeSecretState() {
  if (!existsSync(runtimeSecretDir)) return 'missing';
  const entries = runtimeSecretFiles.map(([filename]) => existsSync(path.join(runtimeSecretDir, filename)));
  if (entries.every(Boolean)) return 'complete';
  if (entries.every((value) => !value)) return 'missing';
  return 'partial';
}

function cleanupRuntimeSecrets() {
  rmSync(runtimeSecretDir, { recursive: true, force: true });
}

function verifyProductionInputsForBuild() {
  runVerification(
    ['scripts/phase-3-4-toolchain-check.mjs'],
    'compatible Phase 3/4 deployment host toolchain',
  );
  runVerification(
    ['scripts/phase-3-4-lockfile-check.mjs', '--strict', '--allow-external'],
    'exact verified Phase 3/4 lockfile',
  );
  runVerification(
    ['scripts/lockfile-supply-chain-guard.mjs'],
    'approved Phase 3/4 lockfile supply chain',
  );
  runVerification(
    ['scripts/turn-env-policy.mjs'],
    'strict TURN port/TTL environment policy',
  );
}

function runVerification(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `phase34 compose: refusing production build without ${label}; run npm run preflight:phase34`,
    );
  }
}

function resolveAllowedOperation(value, capture) {
  if (exactArgs(value, ['config'])) {
    if (capture) throw new Error('phase34 compose: --capture is only allowed for the bounded ps query');
    return 'config';
  }
  if (exactArgs(value, ['up', '-d', '--build'])) {
    if (capture) throw new Error('phase34 compose: deployment output must not be captured');
    return 'up';
  }
  if (exactArgs(value, ['ps', '--status', 'running', '--services'])) {
    if (!capture) {
      throw new Error('phase34 compose: bounded ps query must use --capture for machine validation');
    }
    return 'ps';
  }
  if (exactArgs(value, ['down'])) {
    if (capture) throw new Error('phase34 compose: down output must not be captured');
    return 'down';
  }

  throw new Error(
    `phase34 compose: unsupported command surface (${value.join(' ')}); allowed: config | up -d --build | --capture ps --status running --services | down`,
  );
}

function exactArgs(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function readTurnSecret(envValues) {
  const value = envValues.TURN_SECRET ?? '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) {
    throw new Error('phase34 compose: invalid TURN_SECRET in root .env');
  }
  return value;
}

function readTlsPrivateKey() {
  const tlsKeyPath = path.join(root, 'infra/certs/privkey.pem');
  const value = readFileSync(tlsKeyPath, 'utf8');
  if (
    !/^-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+-----END (?:RSA |EC )?PRIVATE KEY-----\s*$/.test(
      value,
    )
  ) {
    throw new Error('phase34 compose: infra/certs/privkey.pem is not a PEM private key');
  }
  return value;
}

function parseEnv(source) {
  const result = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
