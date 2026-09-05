import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { phase34NpmInstallEnvironment } from './phase-3-4-npm-install-env.mjs';

const root = process.cwd();
const scrubbedAcceptanceKeys = new Set([
  'node_env',
  'expo_public_signaling_url',
  'expo_public_backend_url',
  'expo_public_phase34_acceptance',
  'expo_public_phase34_deployment_id',
]);
const scrubbedNetworkKeys = new Set(['http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']);
const fakeEnv = {
  PATH: '/phase34/bin',
  HOME: '/phase34/home',
  NODE_ENV: 'production',
  NoDe_EnV: 'production-shadow',
  EXPO_PUBLIC_SIGNALING_URL: 'wss://ambient.example.invalid/v1',
  expo_public_backend_url: 'https://ambient.example.invalid',
  EXPO_PUBLIC_PHASE34_ACCEPTANCE: '1',
  Expo_Public_Phase34_Deployment_Id: 'ambient-deployment-id',
  npm_config_allow_scripts: 'unexpected-package',
  NPM_CONFIG_REGISTRY: 'http://example.invalid/',
  NpM_Config_Strict_Ssl: 'false',
  npm_config_ignore_scripts: 'true',
  npm_config_cache: '/phase34/untrusted-cache',
  HTTPS_PROXY: 'http://proxy.example.invalid:8080',
  http_proxy: 'http://proxy-shadow.example.invalid:8080',
  ALL_PROXY: 'socks5://proxy.example.invalid:1080',
  No_Proxy: '*',
  GIT_DIR: '/tmp/phase34-untrusted-git-dir',
  Git_Work_Tree: '/tmp/phase34-untrusted-worktree',
  GIT_INDEX_FILE: '/tmp/phase34-untrusted-index',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.worktree',
  GIT_CONFIG_VALUE_0: '/tmp/phase34-untrusted-config-worktree',
  GITHUB_ACTIONS: 'true',
  PHASE34_SENTINEL: 'preserved',
};
const sanitized = phase34NpmInstallEnvironment(root, fakeEnv);
const npmConfigKeys = Object.keys(sanitized).filter((key) => key.toLowerCase().startsWith('npm_config_'));
const acceptanceEnvKeys = Object.keys(sanitized).filter((key) =>
  scrubbedAcceptanceKeys.has(key.toLowerCase()),
);
const networkEnvKeys = Object.keys(sanitized).filter((key) => scrubbedNetworkKeys.has(key.toLowerCase()));
const gitEnvKeys = Object.keys(sanitized).filter((key) => key.toLowerCase().startsWith('git_'));
const expectedUserConfigPath = path.join(root, 'infra', 'npm', 'phase34-empty.npmrc');
const expectedGlobalConfigPath = path.join(root, 'infra', 'npm', 'phase34-empty-global.npmrc');

if (
  npmConfigKeys.length !== 2 ||
  !npmConfigKeys.includes('npm_config_userconfig') ||
  !npmConfigKeys.includes('npm_config_globalconfig')
) {
  throw new Error(
    `npm install env guard: sanitized environment contains unexpected npm config keys (${npmConfigKeys.join(', ')})`,
  );
}
if (acceptanceEnvKeys.length > 0) {
  throw new Error(
    `npm install env guard: inherited acceptance environment must be scrubbed case-insensitively (${acceptanceEnvKeys.join(', ')})`,
  );
}
if (networkEnvKeys.length > 0) {
  throw new Error(
    `npm install env guard: inherited proxy environment must be scrubbed case-insensitively (${networkEnvKeys.join(', ')})`,
  );
}
if (gitEnvKeys.length > 0) {
  throw new Error(
    `npm install env guard: inherited Git repository override environment must be scrubbed case-insensitively (${gitEnvKeys.join(', ')})`,
  );
}
if (sanitized.GITHUB_ACTIONS !== fakeEnv.GITHUB_ACTIONS) {
  throw new Error('npm install env guard: GITHUB_* environment must not be scrubbed with GIT_* overrides');
}
if (
  sanitized.npm_config_userconfig !== expectedUserConfigPath ||
  sanitized.npm_config_globalconfig !== expectedGlobalConfigPath ||
  sanitized.npm_config_userconfig === sanitized.npm_config_globalconfig
) {
  throw new Error('npm install env guard: user/global npm config must point to distinct pinned empty npmrc files');
}
if (sanitized.PHASE34_SENTINEL !== 'preserved' || sanitized.PATH !== fakeEnv.PATH) {
  throw new Error('npm install env guard: unrelated environment must remain intact');
}

for (const [key, value] of [
  ['NODE_OPTIONS', '--require=/tmp/phase34-untrusted-preload.js'],
  ['node_options', '--require=/tmp/phase34-untrusted-preload.js'],
  ['NODE_PATH', '/tmp/phase34-untrusted-modules'],
  ['NoDe_PaTh', '/tmp/phase34-untrusted-modules'],
  ['NODE_EXTRA_CA_CERTS', '/tmp/phase34-untrusted-ca.pem'],
  ['node_extra_ca_certs', '/tmp/phase34-untrusted-ca.pem'],
  ['NODE_TLS_REJECT_UNAUTHORIZED', '0'],
  ['Ssl_Cert_File', '/tmp/phase34-untrusted-ca.pem'],
  ['SSL_CERT_DIR', '/tmp/phase34-untrusted-certs'],
  ['OPENSSL_CONF', '/tmp/phase34-untrusted-openssl.cnf'],
]) {
  let rejected = false;
  try {
    phase34NpmInstallEnvironment(root, { ...fakeEnv, [key]: value });
  } catch (error) {
    rejected = error instanceof Error && error.message.includes(`${key} must be unset`);
  }
  if (!rejected) {
    throw new Error(`npm install env guard: dangerous ${key} must be rejected before acceptance npm execution`);
  }
}

for (const npmrcPath of ['infra/npm/phase34-empty.npmrc', 'infra/npm/phase34-empty-global.npmrc']) {
  const source = await readFile(npmrcPath, 'utf8');
  const activeLines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'));
  if (activeLines.length > 0) {
    throw new Error(`npm install env guard: ${npmrcPath} must contain no active configuration`);
  }
}

const helper = await readFile('scripts/phase-3-4-npm-install-env.mjs', 'utf8');
for (const required of [
  'export function phase34NpmInstallEnvironment',
  'export function assertPhase34NodeRuntimeBoundary',
  "const GIT_ENV_PREFIX = 'git_'",
  "'node_options'",
  "'node_path'",
  "'node_extra_ca_certs'",
  "'node_tls_reject_unauthorized'",
  "'ssl_cert_file'",
  "'ssl_cert_dir'",
  "'openssl_conf'",
  "'http_proxy'",
  "'https_proxy'",
  "'all_proxy'",
  "'no_proxy'",
  "'node_env'",
  "'expo_public_signaling_url'",
  "'expo_public_backend_url'",
  "'expo_public_phase34_acceptance'",
  "'expo_public_phase34_deployment_id'",
  'FORBIDDEN_NODE_RUNTIME_ENV.has(key.toLowerCase())',
  'SCRUBBED_NETWORK_ENV.has(normalizedKey)',
  'normalizedKey.startsWith(NPM_CONFIG_PREFIX)',
  'normalizedKey.startsWith(GIT_ENV_PREFIX)',
  'SCRUBBED_ACCEPTANCE_ENV.has(normalizedKey)',
  'env.npm_config_userconfig = userConfigPath',
  'env.npm_config_globalconfig = globalConfigPath',
  "path.join(root, '.npmrc')",
  'project .npmrc is forbidden for acceptance',
  "path.join(root, 'infra', 'npm', 'phase34-empty.npmrc')",
  "path.join(root, 'infra', 'npm', 'phase34-empty-global.npmrc')",
  'can alter Node loading or TLS trust semantics',
  'ambient-proxy=scrubbed',
  'ambient-git-overrides=scrubbed',
  'node-runtime+tls-trust-injection=forbidden',
]) {
  if (!helper.includes(required)) {
    throw new Error(`npm install env guard: helper missing boundary ${required}`);
  }
}

const safeShell = await readFile('scripts/phase-3-4-safe-entrypoint.sh', 'utf8');
for (const required of [
  '${NODE_OPTIONS-}',
  '${NODE_PATH-}',
  '${NODE_EXTRA_CA_CERTS-}',
  '${NODE_TLS_REJECT_UNAUTHORIZED-}',
  '${SSL_CERT_FILE-}',
  '${SSL_CERT_DIR-}',
  '${OPENSSL_CONF-}',
]) {
  if (!safeShell.includes(required)) {
    throw new Error(`npm install env guard: pre-Node bootstrap missing trust boundary ${required}`);
  }
}

const codeValidation = await readFile('scripts/phase-3-4-code-validation.mjs', 'utf8');
for (const required of [
  "import { phase34NpmInstallEnvironment } from './phase-3-4-npm-install-env.mjs'",
  'const npmEnv = phase34NpmInstallEnvironment(root)',
  "const env = command === 'npm' ? npmEnv : process.env",
  "'--include=dev'",
  "run('npm', npmCiArgs)",
  "run('npm', ['run', 'typecheck'])",
  "run('npm', ['run', 'lint'])",
  "run('npm', ['test'])",
]) {
  if (!codeValidation.includes(required)) {
    throw new Error(`npm install env guard: canonical validation missing ${required}`);
  }
}

const nativeBuild = await readFile('scripts/phase-3-4-native-build.mjs', 'utf8');
for (const required of [
  "import { phase34NpmInstallEnvironment } from './phase-3-4-npm-install-env.mjs'",
  'const npmEnv = phase34NpmInstallEnvironment(root)',
  "const baseEnv = command === 'npm' ? npmEnv : process.env",
  "'--include=dev'",
  "run('npm', npmCiArgs)",
  "run('npm', ['run', 'doctor:phase34'",
  'const publicEndpointEnv = {',
  'EXPO_PUBLIC_SIGNALING_URL: signalingUrl',
  'EXPO_PUBLIC_BACKEND_URL: backendUrl',
  'const acceptanceEnv = {',
  "EXPO_PUBLIC_PHASE34_ACCEPTANCE: '1'",
  'EXPO_PUBLIC_PHASE34_DEPLOYMENT_ID: deploymentId',
]) {
  if (!nativeBuild.includes(required)) {
    throw new Error(`npm install env guard: native acceptance missing ${required}`);
  }
}

const nativeSmoke = await readFile('scripts/phase-3-4-native-prebuild-smoke.mjs', 'utf8');
for (const required of [
  "import { phase34NpmInstallEnvironment } from './phase-3-4-npm-install-env.mjs'",
  'const baseEnv = phase34NpmInstallEnvironment(root)',
  'const syntheticEnv = {',
  '...baseEnv,',
  "NODE_ENV: 'production'",
  "EXPO_PUBLIC_SIGNALING_URL: 'wss://phase34-ci.invalid/v1'",
  "EXPO_PUBLIC_BACKEND_URL: 'https://phase34-ci.invalid'",
  'npm-env=sanitized',
]) {
  if (!nativeSmoke.includes(required)) {
    throw new Error(`npm install env guard: Android native smoke missing sanitized environment boundary ${required}`);
  }
}
if (nativeSmoke.includes('...process.env,\n  NODE_ENV')) {
  throw new Error('npm install env guard: Android native smoke must not rebuild its synthetic env from ambient process.env');
}

console.info(
  'npm-install-env-boundary.guard ok inherited-npm-config=scrubbed inherited-node-env=scrubbed inherited-phase34-expo=scrubbed inherited-proxy=scrubbed inherited-git-overrides=scrubbed case-insensitive node-runtime+tls-trust-injection=forbidden pinned-distinct-empty-user+global-config project-npmrc=forbidden canonical+native=include-dev validated-native-env=explicit android-smoke=synthetic-explicit',
);
