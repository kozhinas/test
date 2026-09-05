import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import path from 'node:path';

const root = process.cwd();
const verifyOnly = process.argv.includes('--verify-only');
const outputPath = path.join(root, 'package-lock.json');
const embeddedDir = path.join(root, 'infra', 'lockfile');

const EXPECTED_SOURCE_BYTES = 261_242;
const EXPECTED_SOURCE_SHA256 = 'f017a37b9e62b2c24ee665b74998397b7e34d403c845b10ce8865dc293f41be4';
const EXPECTED_SOURCE_GIT_BLOB = 'dddf2eefca5cf347dbc3b48eb185ee4ccd9f24af';
const EXPECTED_BASE64_LENGTH = 85_952;
const EXPECTED_COMPRESSED_BYTES = 64_464;
const EXPECTED_COMPRESSED_SHA256 = 'eb3c412540c423657926dcc6516b1f1393e9da56b588f18916984a7445e30b24';
const PARTS = [
  ['phase34-lockfile.part-01.br.b64', 15_000, 'ba66c40458f0af1f0e5d909131f2fca6b9bbdf19'],
  ['phase34-lockfile.part-02.br.b64', 15_000, '2af54bc9a6122bd30c55e53a28b34c7a79a7d474'],
  ['phase34-lockfile.part-03.br.b64', 15_000, 'f67d9c601a454f522db4c07fb2f0bf0c98dc53df'],
  ['phase34-lockfile.part-04.br.b64', 10_000, 'aa2c57cda315888687d69f215a10d720fc58e1a7'],
  ['phase34-lockfile.part-05.br.b64', 5_000, '76c0dccdf35f22de6c171c21a8b1258ce26c7afe'],
  ['phase34-lockfile.part-06.br.b64', 15_000, '269f20723887e8ab86f8f327ad9ed7d27b2974ec'],
  ['phase34-lockfile.part-07.br.b64', 10_952, '45f238dfb87429d335cf8e42efcd55796f631be2'],
];

if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--verify-only')) {
  throw new Error('usage: node scripts/phase-3-4-embedded-lockfile.mjs [--verify-only]');
}

const headBefore = currentHead();
if (!verifyOnly) {
  if (existsSync(outputPath)) {
    throw new Error('phase34 embedded lockfile: package-lock.json already exists; refusing to overwrite it');
  }
  assertClean('before embedded lockfile materialization');
}

const sourceBytes = await reconstructVerifiedSource();
assertSourceIdentity(sourceBytes);
assertLockfileShape(sourceBytes);
assertHeadUnchanged(headBefore, 'after embedded source verification');

if (verifyOnly) {
  console.info(
    `phase-3-4.embedded-lockfile ok mode=verify-only parts=${PARTS.length} bytes=${sourceBytes.length} sha256=${EXPECTED_SOURCE_SHA256} gitBlob=${EXPECTED_SOURCE_GIT_BLOB}`,
  );
  process.exit(0);
}

let written = false;
try {
  await writeFile(outputPath, sourceBytes, { flag: 'wx', mode: 0o600 });
  written = true;
  const actual = await readFile(outputPath);
  if (!actual.equals(sourceBytes)) {
    throw new Error('phase34 embedded lockfile: materialized bytes differ from verified source');
  }
  assertHeadUnchanged(headBefore, 'after embedded lockfile materialization');
  assertClean('after embedded lockfile materialization');
  console.info(
    `phase-3-4.embedded-lockfile ok mode=materialize parts=${PARTS.length} bytes=${sourceBytes.length} sha256=${EXPECTED_SOURCE_SHA256} gitBlob=${EXPECTED_SOURCE_GIT_BLOB}`,
  );
} catch (error) {
  if (written) await rm(outputPath, { force: true });
  throw error;
}

async function reconstructVerifiedSource() {
  const actualNames = (await readdir(embeddedDir)).sort();
  const expectedNames = ['README.md', ...PARTS.map(([name]) => name)].sort();
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error(
      `phase34 embedded lockfile: directory must contain exactly ${expectedNames.join(', ')}`,
    );
  }

  let encoded = '';
  for (const [name, expectedChars, expectedBlobSha] of PARTS) {
    const raw = await readFile(path.join(embeddedDir, name), 'utf8');
    if (!raw.endsWith('\n') || raw.slice(0, -1).includes('\n') || raw.includes('\r')) {
      throw new Error(`phase34 embedded lockfile: ${name} must be exactly one LF-terminated line`);
    }
    const body = raw.slice(0, -1);
    if (body.length !== expectedChars || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
      throw new Error(`phase34 embedded lockfile: ${name} has invalid base64 shape/length`);
    }
    const blobSha = gitBlobSha(Buffer.from(raw, 'utf8'));
    if (blobSha !== expectedBlobSha) {
      throw new Error(
        `phase34 embedded lockfile: ${name} blob mismatch (${blobSha} != ${expectedBlobSha})`,
      );
    }
    encoded += body;
  }

  if (encoded.length !== EXPECTED_BASE64_LENGTH) {
    throw new Error(
      `phase34 embedded lockfile: base64 length mismatch (${encoded.length} != ${EXPECTED_BASE64_LENGTH})`,
    );
  }

  const compressed = Buffer.from(encoded, 'base64');
  if (
    compressed.length !== EXPECTED_COMPRESSED_BYTES ||
    compressed.toString('base64') !== encoded
  ) {
    throw new Error('phase34 embedded lockfile: compressed stream is not canonical base64');
  }
  const compressedSha = createHash('sha256').update(compressed).digest('hex');
  if (compressedSha !== EXPECTED_COMPRESSED_SHA256) {
    throw new Error(
      `phase34 embedded lockfile: compressed SHA-256 mismatch (${compressedSha} != ${EXPECTED_COMPRESSED_SHA256})`,
    );
  }

  try {
    return brotliDecompressSync(compressed);
  } catch (error) {
    throw new Error(`phase34 embedded lockfile: Brotli decompression failed (${error.message})`);
  }
}

function assertSourceIdentity(bytes) {
  if (bytes.length !== EXPECTED_SOURCE_BYTES) {
    throw new Error(
      `phase34 embedded lockfile: source byte length mismatch (${bytes.length} != ${EXPECTED_SOURCE_BYTES})`,
    );
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== EXPECTED_SOURCE_SHA256) {
    throw new Error(
      `phase34 embedded lockfile: source SHA-256 mismatch (${sha256} != ${EXPECTED_SOURCE_SHA256})`,
    );
  }
  const blobSha = gitBlobSha(bytes);
  if (blobSha !== EXPECTED_SOURCE_GIT_BLOB) {
    throw new Error(
      `phase34 embedded lockfile: source Git blob mismatch (${blobSha} != ${EXPECTED_SOURCE_GIT_BLOB})`,
    );
  }
}

function assertLockfileShape(bytes) {
  let lock;
  try {
    lock = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('phase34 embedded lockfile: reconstructed source must be valid JSON');
  }
  if (lock?.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') {
    throw new Error('phase34 embedded lockfile: reconstructed source must be lockfileVersion 3 with packages');
  }
  for (const [key, resolved] of [
    ['node_modules/@private/mobile', 'mobile'],
    ['node_modules/@private/protocol', 'packages/protocol'],
    ['node_modules/@private/server', 'server'],
  ]) {
    const entry = lock.packages[key];
    if (entry?.link !== true || entry?.resolved !== resolved) {
      throw new Error(`phase34 embedded lockfile: invalid workspace link ${key}`);
    }
  }
}

function gitBlobSha(bytes) {
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function currentHead() {
  const value = capture('git', ['rev-parse', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error('phase34 embedded lockfile: unable to resolve full git HEAD');
  }
  return value;
}

function assertHeadUnchanged(expected, label) {
  const actual = currentHead();
  if (actual !== expected) {
    throw new Error(`phase34 embedded lockfile: HEAD changed ${label} (${expected} -> ${actual})`);
  }
}

function assertClean(label) {
  const status = capture('git', ['status', '--porcelain=v1', '--untracked-files=normal']).trim();
  if (status) {
    throw new Error(`phase34 embedded lockfile: worktree must be clean ${label}\n${status}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 embedded lockfile: command failed (${command} ${args.join(' ')})`);
  }
  return result.stdout ?? '';
}
