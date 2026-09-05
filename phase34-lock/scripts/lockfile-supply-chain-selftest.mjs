import { mkdtemp, mkdir, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const fixture = await mkdtemp(path.join(os.tmpdir(), 'phase34-lock-supply-chain-'));
const manifestPaths = [
  'package.json',
  'mobile/package.json',
  'packages/protocol/package.json',
  'server/package.json',
];

try {
  await mkdir(path.join(fixture, 'scripts'), { recursive: true });
  await mkdir(path.join(fixture, 'mobile'), { recursive: true });
  await mkdir(path.join(fixture, 'packages', 'protocol'), { recursive: true });
  await mkdir(path.join(fixture, 'server'), { recursive: true });
  await cp(
    path.join(root, 'scripts', 'lockfile-supply-chain-guard.mjs'),
    path.join(fixture, 'scripts', 'lockfile-supply-chain-guard.mjs'),
  );
  for (const relativePath of manifestPaths) {
    await cp(path.join(root, relativePath), path.join(fixture, relativePath));
  }

  const canonical = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  await writeLock(canonical);
  expectPass('canonical');

  const victimPath = Object.keys(canonical.packages).find(
    (packagePath) =>
      packagePath.startsWith('node_modules/') &&
      canonical.packages[packagePath]?.link !== true &&
      canonical.packages[packagePath]?.hasInstallScript !== true,
  );
  if (!victimPath) {
    throw new Error('lockfile supply-chain selftest: unable to find an external non-script package fixture');
  }

  const badHost = structuredClone(canonical);
  badHost.packages[victimPath].resolved = 'https://evil.example.invalid/package.tgz';
  await writeLock(badHost);
  expectFail('foreign-registry-host');

  const badPort = structuredClone(canonical);
  badPort.packages[victimPath].resolved = 'https://registry.npmjs.org:8443/package.tgz';
  await writeLock(badPort);
  expectFail('non-default-registry-port');

  const missingIntegrity = structuredClone(canonical);
  delete missingIntegrity.packages[victimPath].integrity;
  await writeLock(missingIntegrity);
  expectFail('missing-integrity');

  const shortIntegrity = structuredClone(canonical);
  shortIntegrity.packages[victimPath].integrity = 'sha512-AA==';
  await writeLock(shortIntegrity);
  expectFail('short-sha512-integrity');

  const nonCanonicalIntegrity = structuredClone(canonical);
  nonCanonicalIntegrity.packages[victimPath].integrity = canonical.packages[
    victimPath
  ].integrity.replace(/==$/, '');
  await writeLock(nonCanonicalIntegrity);
  expectFail('noncanonical-sha512-integrity');

  const unexpectedInstallScript = structuredClone(canonical);
  unexpectedInstallScript.packages[victimPath].hasInstallScript = true;
  await writeLock(unexpectedInstallScript);
  expectFail('unexpected-install-script');

  const changedAllowedScript = structuredClone(canonical);
  changedAllowedScript.packages['node_modules/esbuild'].version = '0.0.0-invalid';
  await writeLock(changedAllowedScript);
  expectFail('changed-allowed-install-script');

  await writeLock(canonical);
  const canonicalRootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

  const missingApproval = structuredClone(canonicalRootManifest);
  delete missingApproval.allowScripts['esbuild@0.28.2'];
  await writeRootManifest(missingApproval);
  expectFail('missing-esbuild-approval');

  const extraApproval = structuredClone(canonicalRootManifest);
  extraApproval.allowScripts['unexpected-package@1.0.0'] = true;
  await writeRootManifest(extraApproval);
  expectFail('extra-install-script-approval');

  const deniedApproval = structuredClone(canonicalRootManifest);
  deniedApproval.allowScripts['esbuild@0.28.2'] = false;
  await writeRootManifest(deniedApproval);
  expectFail('changed-install-script-approval');

  const rootLifecycle = structuredClone(canonicalRootManifest);
  rootLifecycle.scripts = { ...(rootLifecycle.scripts ?? {}), preinstall: 'node malicious.js' };
  await writeRootManifest(rootLifecycle);
  expectFail('root-preinstall-lifecycle');
  await cp(path.join(root, 'package.json'), path.join(fixture, 'package.json'));

  const serverManifest = JSON.parse(await readFile(path.join(root, 'server', 'package.json'), 'utf8'));
  serverManifest.scripts = { ...(serverManifest.scripts ?? {}), prepare: 'node malicious.js' };
  await writeFile(
    path.join(fixture, 'server', 'package.json'),
    `${JSON.stringify(serverManifest, null, 2)}\n`,
  );
  expectFail('workspace-prepare-lifecycle');

  console.info(
    'lockfile-supply-chain.selftest ok canonical-pass foreign-host-reject non-default-port-reject missing-integrity-reject short-sha512-reject noncanonical-sha512-reject unexpected-script-reject changed-script-reject exact-approvals-reject-drift root-preinstall-reject workspace-prepare-reject',
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}

async function writeLock(value) {
  await writeFile(path.join(fixture, 'package-lock.json'), `${JSON.stringify(value)}\n`);
}

async function writeRootManifest(value) {
  await writeFile(path.join(fixture, 'package.json'), `${JSON.stringify(value, null, 2)}\n`);
}

function runGuard() {
  return spawnSync(process.execPath, ['scripts/lockfile-supply-chain-guard.mjs'], {
    cwd: fixture,
    encoding: 'utf8',
    shell: false,
  });
}

function expectPass(label) {
  const result = runGuard();
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`lockfile supply-chain selftest: ${label} unexpectedly failed\n${result.stderr ?? ''}`);
  }
}

function expectFail(label) {
  const result = runGuard();
  if (result.error) throw result.error;
  if (result.status === 0) {
    throw new Error(`lockfile supply-chain selftest: ${label} unexpectedly passed`);
  }
}
