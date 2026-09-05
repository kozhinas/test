import { spawnSync } from 'node:child_process';

const steps = [
  ['scripts/script-syntax-guard.mjs'],
  ['scripts/ci-action-pin-guard.mjs'],
  ['scripts/pre-node-acceptance-boundary-guard.mjs'],
  ['scripts/pre-node-acceptance-boundary-selftest.mjs'],
  ['scripts/toolchain-boundary-guard.mjs'],
  ['scripts/npm-install-env-boundary-guard.mjs'],
  ['scripts/phase-3-4-embedded-lockfile.mjs', '--verify-only'],
  ['scripts/embedded-lockfile-checkout-guard.mjs'],
  ['scripts/lockfile-contract-guard.mjs'],
  ['scripts/lockfile-import-guard.mjs'],
  ['scripts/lockfile-import-selftest.mjs'],
  ['scripts/lockfile-supply-chain-guard.mjs'],
  ['scripts/lockfile-supply-chain-selftest.mjs'],
  ['scripts/phase-3-4-closure-guard.mjs'],
  ['scripts/closure-evidence-binding-guard.mjs'],
  ['scripts/device-evidence-recorder-guard.mjs'],
  ['scripts/mobile-native-dependency-guard.mjs'],
  ['scripts/protocol-native-entry-guard.mjs'],
  ['scripts/workspace-direct-dependency-guard.mjs'],
  ['scripts/tooling-direct-dependency-guard.mjs'],
  ['scripts/container-image-boundary-guard.mjs'],
  ['scripts/docker-context-guard.mjs'],
  ['scripts/compose-secret-exposure-guard.mjs'],
  ['scripts/turn-secret-boundary-guard.mjs'],
  ['scripts/turn-port-boundary-guard.mjs'],
  ['scripts/turn-env-policy-selftest.mjs'],
  ['scripts/turn-response-boundary-guard.mjs'],
  ['scripts/turn-rate-state-guard.mjs'],
  ['scripts/turn-refresh-transaction-guard.mjs'],
  ['scripts/coturn-persistence-guard.mjs'],
  ['scripts/public-ip-policy-selftest.mjs'],
  ['scripts/phase-3-4-turn-transport-probe.mjs', '--selftest'],
  ['scripts/phase-3-4-turn-auth-probe.mjs', '--selftest'],
  ['scripts/signaling-client-liveness-guard.mjs'],
  ['scripts/signaling-registry-boundary-guard.mjs'],
  ['scripts/signaling-server-resource-guard.mjs'],
  ['scripts/architecture-guard.mjs'],
  ['scripts/runtime-log-guard.mjs'],
  ['scripts/health-boundary-guard.mjs'],
  ['scripts/health-boundary-selftest.mjs'],
  ['scripts/selected-candidate-route-guard.mjs'],
  ['scripts/privacy-ice-server-guard.mjs'],
  ['scripts/datachannel-fail-closed-guard.mjs'],
  ['scripts/peer-observer-isolation-guard.mjs'],
  ['scripts/webrtc-gate-guard.mjs'],
  ['scripts/early-ice-boundary-guard.mjs'],
  ['scripts/privacy-run-latch-guard.mjs'],
  ['scripts/acceptance-rendezvous-guard.mjs'],
  ['scripts/acceptance-start-lifecycle-guard.mjs'],
  ['scripts/acceptance-session-evidence-guard.mjs'],
  ['scripts/deployment-binding-guard.mjs'],
  ['scripts/deployment-failure-cleanup-guard.mjs'],
  ['scripts/evidence-flow-guard.mjs'],
  ['scripts/live-turn-auth-guard.mjs'],
  ['scripts/evidence-validator-selftest.mjs'],
  [
    'scripts/validate-phase-3-4-evidence.mjs',
    '--schema-only',
    'infra/device-gate-evidence.example.json',
  ],
  [
    'scripts/validate-phase-3-4-deployment-evidence.mjs',
    '--schema-only',
    'infra/deployment-gate-evidence.example.json',
  ],
];

for (const args of steps) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 static validation failed (${process.execPath} ${args.join(' ')})`);
  }
}

console.info(`phase-3-4.static-validation ok steps=${steps.length}`);
