import { spawnSync } from 'node:child_process';

const shellPath = 'scripts/phase-3-4-safe-entrypoint.sh';

const syntax = spawnSync('sh', ['-n', shellPath], { encoding: 'utf8', shell: false });
if (syntax.error) throw syntax.error;
if (syntax.status !== 0) {
  throw new Error(`pre-node acceptance boundary selftest: shell syntax failed\n${syntax.stderr ?? ''}`);
}

const baseEnv = { ...process.env };
for (const name of [
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'OPENSSL_CONF',
]) {
  delete baseEnv[name];
}
for (const name of Object.keys(baseEnv)) {
  if (name.toLowerCase().startsWith('git_')) delete baseEnv[name];
}

const clean = spawnSync('sh', [shellPath, 'selftest'], {
  encoding: 'utf8',
  shell: false,
  env: {
    ...baseEnv,
    NODE_ENV: 'production',
    npm_config_registry: 'http://example.invalid/',
    NPM_CONFIG_STRICT_SSL: 'false',
    HTTPS_PROXY: 'http://proxy.example.invalid:8080',
    http_proxy: 'http://proxy-shadow.example.invalid:8080',
    ALL_PROXY: 'socks5://proxy.example.invalid:1080',
    NO_PROXY: '*',
    EXPO_PUBLIC_SIGNALING_URL: 'wss://ambient.example.invalid/v1',
    EXPO_PUBLIC_BACKEND_URL: 'https://ambient.example.invalid',
    EXPO_PUBLIC_PHASE34_ACCEPTANCE: '1',
    EXPO_PUBLIC_PHASE34_DEPLOYMENT_ID: 'ambient-deployment',
    GIT_DIR: '/tmp/phase34-untrusted-git-dir',
    Git_Work_Tree: '/tmp/phase34-untrusted-worktree',
    GIT_INDEX_FILE: '/tmp/phase34-untrusted-index',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: '/tmp/phase34-untrusted-config-worktree',
    GITHUB_ACTIONS: 'true',
  },
});
if (clean.error) throw clean.error;
if (
  clean.status !== 0 ||
  !(clean.stdout ?? '').includes('phase-3-4.safe-entrypoint selftest ok') ||
  !(clean.stdout ?? '').includes('git-overrides=scrubbed')
) {
  throw new Error(
    `pre-node acceptance boundary selftest: sanitized bootstrap failed\nstdout=${clean.stdout ?? ''}\nstderr=${clean.stderr ?? ''}`,
  );
}

for (const [name, value, expectedMessage] of [
  ['NODE_OPTIONS', '--require=/tmp/phase34-preload.js', 'NODE_OPTIONS must be unset'],
  ['NODE_PATH', '/tmp/phase34-modules', 'NODE_PATH must be unset'],
  ['NODE_EXTRA_CA_CERTS', '/tmp/phase34-untrusted-ca.pem', 'NODE_EXTRA_CA_CERTS must be unset'],
  ['NODE_TLS_REJECT_UNAUTHORIZED', '0', 'NODE_TLS_REJECT_UNAUTHORIZED must be unset'],
  ['SSL_CERT_FILE', '/tmp/phase34-untrusted-ca.pem', 'SSL_CERT_FILE must be unset'],
  ['SSL_CERT_DIR', '/tmp/phase34-untrusted-certs', 'SSL_CERT_DIR must be unset'],
  ['OPENSSL_CONF', '/tmp/phase34-untrusted-openssl.cnf', 'OPENSSL_CONF must be unset'],
]) {
  const result = spawnSync('sh', [shellPath, 'selftest'], {
    encoding: 'utf8',
    shell: false,
    env: { ...baseEnv, [name]: value },
  });
  if (result.error) throw result.error;
  if (result.status === 0 || !(result.stderr ?? '').includes(expectedMessage)) {
    throw new Error(
      `pre-node acceptance boundary selftest: dangerous ${name} was not rejected before Node startup`,
    );
  }
}

console.info(
  'pre-node-acceptance-boundary.selftest ok shell-syntax clean-bootstrap ambient-install+proxy+git-override-env=scrubbed node-options+node-path=pre-node-reject tls-trust-env=pre-node-reject',
);
