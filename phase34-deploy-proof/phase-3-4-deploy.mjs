import { randomBytes } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';

import { readPhase34Health } from './phase-3-4-health.mjs';
import {
  phase34MobileConfigFingerprint,
  readPhase34MobileConfig,
} from './phase-3-4-mobile-config.mjs';

const root = process.cwd();
const evidencePath = path.join(root, 'infra', 'deployment-gate-evidence.json');
const templatePath = path.join(root, 'infra', 'deployment-gate-evidence.example.json');
const headBefore = gitHead();
const deploymentId = randomBytes(24).toString('base64url');
process.env.PHASE34_DEPLOYMENT_ID = deploymentId;

assertClean('before deployment');

run('npm', ['run', 'preflight:phase34']);
assertRepositoryUnchanged(headBefore, 'after production preflight');

// A preflight-only failure must not tear down an existing healthy deployment or erase its
// evidence. Once provisioning begins, however, any failure leaves the public runtime in an
// unknown/partially-updated state and must fail closed by tearing the attempted stack down.
await rm(evidencePath, { force: true });
let composeAttempted = false;
try {
  composeAttempted = true;
  run(process.execPath, ['scripts/phase-3-4-compose.mjs', 'up', '-d', '--build']);
  assertRepositoryUnchanged(headBefore, 'after docker compose up');

  assertRequiredServicesRunning();
  assertRepositoryUnchanged(headBefore, 'after container status check');

  const deploymentEnv = parseEnv(await readFile(path.join(root, '.env'), 'utf8'));
  await assertTurnDns(deploymentEnv);
  assertRepositoryUnchanged(headBefore, 'after TURN DNS check');

  await assertTurnListeners(deploymentEnv);
  assertRepositoryUnchanged(headBefore, 'after TURN listener checks');

  run(process.execPath, ['scripts/phase-3-4-turn-transport-probe.mjs']);
  assertRepositoryUnchanged(headBefore, 'after TURN STUN transport probes');

  const mobileConfigFingerprint = await phase34MobileConfigFingerprint(root);
  const { backendUrl, signalingUrl } = await readPhase34MobileConfig(root);
  await waitForPublicHealth(backendUrl, deploymentId);
  assertRepositoryUnchanged(headBefore, 'after public health check');

  await assertPublicSignalingUpgrade(signalingUrl);
  assertRepositoryUnchanged(headBefore, 'after public signaling round-trip check');

  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  if (template.schemaVersion !== 1 || template.status !== 'pending') {
    throw new Error(
      'phase34 deployment: committed deployment evidence template must remain pending schemaVersion=1',
    );
  }

  const evidence = {
    schemaVersion: 1,
    status: 'recorded',
    commitSha: headBefore,
    mobileConfigFingerprint,
    deploymentId,
    preflight: 'passed',
    composeUp: 'passed',
    servicesRunning: 'passed',
    turnDns: 'passed',
    turnListeners: 'passed',
    publicHealth: 'ok',
    signalingUpgrade: 'passed',
  };

  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  run(process.execPath, ['scripts/validate-phase-3-4-deployment-evidence.mjs', evidencePath]);
  assertRepositoryUnchanged(headBefore, 'after deployment evidence');

  console.info(`phase-3-4.deploy ok commit=${headBefore}`);
  console.info(`phase-3-4.deploy evidence=${path.relative(root, evidencePath)}`);
} catch (error) {
  const originalError = error instanceof Error ? error : new Error(String(error));
  const rollbackErrors = [];

  try {
    await rm(evidencePath, { force: true });
  } catch (cleanupError) {
    rollbackErrors.push(
      new Error('phase34 deployment rollback: failed to remove partial deployment evidence', {
        cause: cleanupError,
      }),
    );
  }

  if (composeAttempted) {
    try {
      run(process.execPath, ['scripts/phase-3-4-compose.mjs', 'down']);
    } catch (cleanupError) {
      rollbackErrors.push(
        new Error('phase34 deployment rollback: docker compose down failed', {
          cause: cleanupError,
        }),
      );
    }
  }

  if (rollbackErrors.length > 0) {
    throw new AggregateError(
      [originalError, ...rollbackErrors],
      'phase34 deployment failed and rollback was incomplete',
    );
  }
  throw originalError;
}

function assertRequiredServicesRunning() {
  const output = capture(process.execPath, [
    'scripts/phase-3-4-compose.mjs',
    '--capture',
    'ps',
    '--status',
    'running',
    '--services',
  ]);
  const running = new Set(
    output
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const missing = ['signaling', 'reverse-proxy', 'coturn'].filter((service) => !running.has(service));
  if (missing.length > 0) {
    throw new Error(`phase34 deployment: required services are not running: ${missing.join(', ')}`);
  }
}

async function assertTurnDns(env) {
  const turnHost = env.TURN_HOST?.trim();
  const externalIp = env.TURN_EXTERNAL_IP?.trim();
  if (!turnHost) throw new Error('phase34 deployment: TURN_HOST is missing');
  if (!externalIp) throw new Error('phase34 deployment: TURN_EXTERNAL_IP is missing');

  let addresses;
  try {
    addresses = await resolve4(turnHost);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`phase34 deployment: TURN_HOST DNS lookup failed: ${message}`);
  }

  if (!addresses.includes(externalIp)) {
    throw new Error(
      'phase34 deployment: TURN_HOST DNS does not resolve to configured TURN_EXTERNAL_IP',
    );
  }
}

async function assertTurnListeners(env) {
  const turnHost = env.TURN_HOST?.trim();
  if (!turnHost) throw new Error('phase34 deployment: TURN_HOST is missing');

  const turnPort = parsePort(env.TURN_PORT, 3478, 'TURN_PORT');
  const turnsPort = parsePort(env.TURN_TLS_PORT, 5349, 'TURN_TLS_PORT');

  await retry('TURN TCP listener', () => connectTcp('127.0.0.1', turnPort));
  await retry('TURNS TLS listener', () => connectTls('127.0.0.1', turnsPort, turnHost));
}

function connectTcp(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timeout connecting to ${host}:${port}`));
    }, 3_000);

    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function connectTls(host, port, servername) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername, rejectUnauthorized: true });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timeout completing TLS handshake to ${servername}:${port}`));
    }, 5_000);

    socket.once('secureConnect', () => {
      clearTimeout(timer);
      if (!socket.authorized) {
        const reason = socket.authorizationError ?? 'certificate not authorized';
        socket.destroy();
        reject(new Error(String(reason)));
        return;
      }
      socket.destroy();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function assertPublicSignalingUpgrade(signalingUrl) {
  if (typeof WebSocket !== 'function') {
    throw new Error('phase34 deployment: Node WebSocket client is unavailable');
  }
  await retry('public signaling hello/ping/pong round-trip', () =>
    openWebSocketAndRoundTrip(signalingUrl),
  );
}

function openWebSocketAndRoundTrip(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const nonce = randomBytes(12).toString('base64url');
    let settled = false;
    const timer = setTimeout(() => {
      settleReject(new Error('timeout waiting for signaling pong'));
    }, 5_000);

    const settleResolve = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close(1000, 'phase34_probe');
      } catch {
      }
      resolve();
    };

    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
      }
      reject(error);
    };

    socket.addEventListener(
      'open',
      () => {
        try {
          socket.send(
            JSON.stringify({
              type: 'hello',
              protocolVersion: 1,
              clientVersion: 'phase34-deploy-probe',
              platform: 'android',
            }),
          );
          socket.send(
            JSON.stringify({
              type: 'ping',
              protocolVersion: 1,
              nonce,
            }),
          );
        } catch (error) {
          settleReject(error instanceof Error ? error : new Error(String(error)));
        }
      },
      { once: true },
    );

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const message = JSON.parse(event.data);
        if (
          message?.type === 'pong' &&
          message?.protocolVersion === 1 &&
          message?.nonce === nonce
        ) {
          settleResolve();
        }
      } catch {
      }
    });

    socket.addEventListener(
      'error',
      () => settleReject(new Error('signaling WebSocket emitted an error before matching pong')),
      { once: true },
    );
    socket.addEventListener(
      'close',
      () => {
        if (!settled) settleReject(new Error('signaling WebSocket closed before matching pong'));
      },
      { once: true },
    );
  });
}

async function retry(label, operation) {
  let lastError = new Error('unknown');
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 10) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`phase34 deployment: ${label} failed: ${lastError.message}`);
}

async function waitForPublicHealth(backendUrl, expectedDeploymentId) {
  await readPhase34Health(backendUrl, {
    expectedDeploymentId,
    attempts: 20,
    label: 'public health check',
  });
}

function parsePort(raw, fallback, label) {
  if (!raw?.trim()) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`phase34 deployment: ${label} is invalid`);
  }
  return parsed;
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

function assertRepositoryUnchanged(expectedHead, label) {
  const currentHead = gitHead();
  if (currentHead !== expectedHead) {
    throw new Error(
      `phase34 deployment: HEAD changed ${label}; expected ${expectedHead}, got ${currentHead}`,
    );
  }
  assertClean(label);
}

function assertClean(label) {
  const status = capture('git', ['status', '--porcelain=v1', '--untracked-files=normal']).trim();
  if (status) throw new Error(`phase34 deployment: worktree must be clean ${label}\n${status}`);
}

function gitHead() {
  const sha = capture('git', ['rev-parse', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error('phase34 deployment: unable to resolve git HEAD');
  }
  return sha;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 deployment: command failed (${command} ${args.join(' ')})`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 deployment: command failed (${command} ${args.join(' ')})`);
  }
  return result.stdout ?? '';
}
