import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const strict = process.argv.includes('--strict');
const allowExternal = process.argv.includes('--allow-external');
const root = process.cwd();
const lockPath = path.join(root, 'package-lock.json');
const workspacePaths = ['', 'mobile', 'packages/protocol', 'server'];

let lockContent;
try {
  lockContent = await readFile(lockPath, 'utf8');
} catch {
  finishMissing(
    'package-lock.json is missing; run npm run lockfile:ensure to materialize the immutable verified Phase 3/4 lockfile',
  );
}

if (lockContent !== undefined) {
  if (allowExternal) {
    run(process.execPath, ['scripts/phase-3-4-import-lockfile.mjs', '--verify-existing']);
  }

  let lock;
  try {
    lock = JSON.parse(lockContent);
  } catch {
    throw new Error('phase34 lockfile: package-lock.json must be valid JSON');
  }

  if (lock.lockfileVersion !== 3) {
    throw new Error('phase34 lockfile: exact npm 11 acceptance lockfile must use lockfileVersion 3');
  }
  if (!lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) {
    throw new Error('phase34 lockfile: package-lock.json packages map is missing');
  }

  for (const workspacePath of workspacePaths) {
    await assertManifestMatchesLock(lock, workspacePath);
  }

  const tracked = isTracked('package-lock.json');
  if (!tracked) {
    if (allowExternal && isIgnored('package-lock.json')) {
      console.info(`phase-3-4.lockfile ok version=${lock.lockfileVersion} source=verified-external`);
    } else {
      finishMissing(
        'package-lock.json exists but is not a tracked lockfile or approved verified external input; run npm run lockfile:ensure',
      );
    }
  } else {
    console.info(`phase-3-4.lockfile ok version=${lock.lockfileVersion} source=tracked`);
  }
}

async function assertManifestMatchesLock(lock, workspacePath) {
  const manifestPath = workspacePath
    ? path.join(root, workspacePath, 'package.json')
    : path.join(root, 'package.json');

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error(`phase34 lockfile: ${workspacePath || 'root'}/package.json must be valid JSON`);
  }

  const entryKey = workspacePath.replaceAll('\\', '/');
  const entry = lock.packages[entryKey];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(
      `phase34 lockfile: missing packages[${JSON.stringify(entryKey)}] for ${workspacePath || 'root'} workspace`,
    );
  }

  for (const field of ['name', 'version']) {
    if ((entry[field] ?? null) !== (manifest[field] ?? null)) {
      throw new Error(
        `phase34 lockfile: ${workspacePath || 'root'} ${field} does not match package.json`,
      );
    }
  }

  if (workspacePath === '') {
    for (const field of ['name', 'version']) {
      if ((lock[field] ?? null) !== (manifest[field] ?? null)) {
        throw new Error(`phase34 lockfile: top-level ${field} does not match root package.json`);
      }
    }
    if (!sameStringArray(entry.workspaces, manifest.workspaces)) {
      throw new Error(
        'phase34 lockfile: root workspaces do not match package.json; refresh the pinned verified Phase 3/4 lockfile source',
      );
    }
  }

  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    if (!sameStringMap(entry[field], manifest[field])) {
      throw new Error(
        `phase34 lockfile: ${workspacePath || 'root'} ${field} does not match package.json; refresh the pinned verified Phase 3/4 lockfile source`,
      );
    }
  }

  if (!sameStringMap(entry.engines, manifest.engines)) {
    throw new Error(
      `phase34 lockfile: ${workspacePath || 'root'} engines does not match package.json; refresh the pinned verified Phase 3/4 lockfile source`,
    );
  }
}

function sameStringArray(left, right) {
  const a = normalizeStringArray(left);
  const b = normalizeStringArray(right);
  if (a === null || b === null || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function normalizeStringArray(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    return null;
  }
  return [...value].sort();
}

function sameStringMap(left, right) {
  const a = normalizeStringMap(left);
  const b = normalizeStringMap(right);
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key]);
}

function normalizeStringMap(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { __invalid__: '' };
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, typeof item === 'string' ? item : '__invalid__']),
  );
}

function isTracked(relativePath) {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', relativePath], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  return !result.error && result.status === 0;
}

function isIgnored(relativePath) {
  const result = spawnSync('git', ['check-ignore', '--quiet', '--', relativePath], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  return !result.error && result.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`phase34 lockfile: command failed (${command} ${args.join(' ')})`);
  }
}

function finishMissing(message) {
  if (strict) {
    throw new Error(`phase34 lockfile: ${message}`);
  }
  console.warn(`[WARN] phase34 lockfile: ${message}`);
}
