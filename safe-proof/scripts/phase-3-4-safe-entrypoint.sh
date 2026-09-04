#!/bin/sh
set -eu

if [ -n "${NODE_OPTIONS-}" ]; then
  echo "phase34 safe entrypoint: NODE_OPTIONS must be unset before acceptance bootstrap" >&2
  exit 1
fi
if [ -n "${NODE_PATH-}" ]; then
  echo "phase34 safe entrypoint: NODE_PATH must be unset before acceptance bootstrap" >&2
  exit 1
fi
if [ -n "${NODE_EXTRA_CA_CERTS-}" ]; then
  echo "phase34 safe entrypoint: NODE_EXTRA_CA_CERTS must be unset before acceptance bootstrap" >&2
  exit 1
fi
if [ -n "${NODE_TLS_REJECT_UNAUTHORIZED-}" ]; then
  echo "phase34 safe entrypoint: NODE_TLS_REJECT_UNAUTHORIZED must be unset before acceptance bootstrap" >&2
  exit 1
fi
if [ -n "${SSL_CERT_FILE-}" ]; then
  echo "phase34 safe entrypoint: SSL_CERT_FILE must be unset before acceptance bootstrap" >&2
  exit 1
fi
if [ -n "${SSL_CERT_DIR-}" ]; then
  echo "phase34 safe entrypoint: SSL_CERT_DIR must be unset before acceptance bootstrap" >&2
  exit 1
fi
if [ -n "${OPENSSL_CONF-}" ]; then
  echo "phase34 safe entrypoint: OPENSSL_CONF must be unset before acceptance bootstrap" >&2
  exit 1
fi

exec node scripts/phase-3-4-safe-entrypoint.mjs "$@"
