import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(modulePath), '..');
const NPM_CONFIG_PREFIX = 'npm_config_';
const GIT_ENV_PREFIX = 'git_';
const FORBIDDEN_NODE_RUNTIME_ENV = new Set([
  'node_options',
  'node_path',
  'node_extra_ca_certs',
  'node_tls_reject_unauthorized',
  'ssl_cert_file',
  'ssl_cert_dir',
  'openssl_conf',
]);
const SCRUBBED_ACCEPTANCE_ENV = new Set([
  'node_env',
  'expo_public_signaling_url',
  'expo_public_backend_url',
  'expo_public_phase34_acceptance',
  'expo_public_phase34_deployment_id',
]);
const SCRUBBED_NETWORK_ENV = new Set([
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
]);

export function phase34NpmInstallEnvironment(root = defaultRoot, baseEnv = process.env) {
  assertPhase34NodeRuntimeBoundary(baseEnv);
  const { userConfigPath, globalConfigPath } = assertPhase34NpmConfigBoundary(root);

  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.startsWith(NPM_CONFIG_PREFIX) ||
      normalizedKey.startsWith(GIT_ENV_PREFIX) ||
      SCRUBBED_ACCEPTANCE_ENV.has(normalizedKey) ||
      SCRUBBED_NETWORK_ENV.has(normalizedKey)
    ) {
      delete env[key];
    }
  }

  env.npm_config_userconfig = userConfigPath;
  env.npm_config_globalconfig = globalConfigPath;
  return env;
}

export function assertPhase34NodeRuntimeBoundary(baseEnv = process.env) {
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!FORBIDDEN_NODE_RUNTIME_ENV.has(key.toLowerCase())) continue;
    if (typeof value === 'string' && value.trim().length > 0) {
      throw new Error(
        `phase34 npm install env: ${key} must be unset for acceptance because it can alter Node loading or TLS trust semantics`,
      );
    }
  }
}

export function assertPhase34NpmConfigBoundary(root = defaultRoot) {
  const projectConfig = path.join(root, '.npmrc');
  if (existsSync(projectConfig)) {
    throw new Error(
      'phase34 npm install env: project .npmrc is forbidden for acceptance because canonical npm ci owns the install policy',
    );
  }

  const userConfigPath = path.join(root, 'infra', 'npm', 'phase34-empty.npmrc');
  const globalConfigPath = path.join(root, 'infra', 'npm', 'phase34-empty-global.npmrc');
  if (userConfigPath === globalConfigPath) {
    throw new Error('phase34 npm install env: user/global npm config paths must remain distinct');
  }
  assertEmptyConfig(userConfigPath, 'user');
  assertEmptyConfig(globalConfigPath, 'global');
  return { userConfigPath, globalConfigPath };
}

function assertEmptyConfig(configPath, label) {
  let source;
  try {
    source = readFileSync(configPath, 'utf8');
  } catch {
    throw new Error(`phase34 npm install env: pinned empty ${label} npmrc is missing or unreadable`);
  }

  const activeLines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'));
  if (activeLines.length > 0) {
    throw new Error(`phase34 npm install env: pinned ${label} npmrc must not contain active npm configuration`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  if (process.argv.length !== 3 || process.argv[2] !== '--selftest') {
    throw new Error('usage: node scripts/phase-3-4-npm-install-env.mjs --selftest');
  }

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
  const sanitized = phase34NpmInstallEnvironment(defaultRoot, fakeEnv);
  const remainingAmbient = Object.keys(sanitized).filter(
    (key) =>
      key.toLowerCase().startsWith(NPM_CONFIG_PREFIX) &&
      key !== 'npm_config_userconfig' &&
      key !== 'npm_config_globalconfig',
  );
  if (remainingAmbient.length > 0) {
    throw new Error(
      `phase34 npm install env selftest: inherited npm config survived (${remainingAmbient.join(', ')})`,
    );
  }
  const remainingAcceptanceEnv = Object.keys(sanitized).filter((key) =>
    SCRUBBED_ACCEPTANCE_ENV.has(key.toLowerCase()),
  );
  if (remainingAcceptanceEnv.length > 0) {
    throw new Error(
      `phase34 npm install env selftest: inherited acceptance environment survived (${remainingAcceptanceEnv.join(', ')})`,
    );
  }
  const remainingNetworkEnv = Object.keys(sanitized).filter((key) =>
    SCRUBBED_NETWORK_ENV.has(key.toLowerCase()),
  );
  if (remainingNetworkEnv.length > 0) {
    throw new Error(
      `phase34 npm install env selftest: inherited proxy environment survived (${remainingNetworkEnv.join(', ')})`,
    );
  }
  const remainingGitEnv = Object.keys(sanitized).filter((key) =>
    key.toLowerCase().startsWith(GIT_ENV_PREFIX),
  );
  if (remainingGitEnv.length > 0) {
    throw new Error(
      `phase34 npm install env selftest: inherited Git override environment survived (${remainingGitEnv.join(', ')})`,
    );
  }
  if (sanitized.PATH !== fakeEnv.PATH || sanitized.HOME !== fakeEnv.HOME) {
    throw new Error('phase34 npm install env selftest: unrelated environment was not preserved');
  }
  if (sanitized.GITHUB_ACTIONS !== fakeEnv.GITHUB_ACTIONS) {
    throw new Error('phase34 npm install env selftest: GITHUB_* environment must not be scrubbed with GIT_* overrides');
  }
  if (sanitized.PHASE34_SENTINEL !== fakeEnv.PHASE34_SENTINEL) {
    throw new Error('phase34 npm install env selftest: unrelated Phase 3/4 environment was not preserved');
  }

  const expectedUserConfigPath = path.join(defaultRoot, 'infra', 'npm', 'phase34-empty.npmrc');
  const expectedGlobalConfigPath = path.join(
    defaultRoot,
    'infra',
    'npm',
    'phase34-empty-global.npmrc',
  );
  if (
    sanitized.npm_config_userconfig !== expectedUserConfigPath ||
    sanitized.npm_config_globalconfig !== expectedGlobalConfigPath ||
    sanitized.npm_config_userconfig === sanitized.npm_config_globalconfig
  ) {
    throw new Error('phase34 npm install env selftest: pinned user/global npmrc paths are incorrect or not distinct');
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
      phase34NpmInstallEnvironment(defaultRoot, { ...fakeEnv, [key]: value });
    } catch (error) {
      rejected = error instanceof Error && error.message.includes(`${key} must be unset`);
    }
    if (!rejected) {
      throw new Error(`phase34 npm install env selftest: dangerous ${key} was not rejected`);
    }
  }

  console.info(
    'phase-3-4.npm-install-env selftest ok ambient-npm-config=scrubbed ambient-node-env=scrubbed ambient-phase34-expo=scrubbed ambient-proxy=scrubbed ambient-git-overrides=scrubbed case-insensitive node-runtime+tls-trust-injection=forbidden userconfig=pinned-empty globalconfig=pinned-empty distinct-config-files project-npmrc=forbidden',
  );
}
