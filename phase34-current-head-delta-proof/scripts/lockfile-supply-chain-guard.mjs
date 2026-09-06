import { readFile } from 'node:fs/promises';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (lock?.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') {
  throw new Error('lockfile supply-chain guard: expected lockfileVersion 3 packages map');
}

const allowedInstallScripts = new Map([
  ['node_modules/esbuild', { version: '0.28.2', optional: false }],
  ['node_modules/fsevents', { version: '2.3.3', optional: true }],
]);
const expectedAllowScripts = {
  'esbuild@0.28.2': true,
  'fsevents@2.3.3': true,
};
const workspaceManifestPaths = [
  'package.json',
  'mobile/package.json',
  'packages/protocol/package.json',
  'server/package.json',
];
const forbiddenInstallLifecycleScripts = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
];

let rootManifest;
for (const manifestPath of workspaceManifestPaths) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error(`lockfile supply-chain guard: ${manifestPath} must be valid JSON`);
  }
  if (manifestPath === 'package.json') rootManifest = manifest;

  const scripts = manifest?.scripts;
  if (scripts !== undefined && (!scripts || typeof scripts !== 'object' || Array.isArray(scripts))) {
    throw new Error(`lockfile supply-chain guard: ${manifestPath} scripts must be an object`);
  }
  for (const scriptName of forbiddenInstallLifecycleScripts) {
    if (Object.hasOwn(scripts ?? {}, scriptName)) {
      throw new Error(
        `lockfile supply-chain guard: ${manifestPath} must not define npm install lifecycle script ${scriptName}`,
      );
    }
  }
}

assertExactAllowScripts(rootManifest?.allowScripts);

let externalPackages = 0;
let installScriptPackages = 0;

for (const [packagePath, entry] of Object.entries(lock.packages)) {
  if (!packagePath.startsWith('node_modules/') || entry?.link === true) continue;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`lockfile supply-chain guard: invalid package entry ${packagePath}`);
  }

  externalPackages += 1;

  if (typeof entry.version !== 'string' || entry.version.length === 0) {
    throw new Error(`lockfile supply-chain guard: external package ${packagePath} is missing version`);
  }
  if (typeof entry.resolved !== 'string' || entry.resolved.length === 0) {
    throw new Error(`lockfile supply-chain guard: external package ${packagePath} is missing resolved URL`);
  }

  let resolved;
  try {
    resolved = new URL(entry.resolved);
  } catch {
    throw new Error(`lockfile supply-chain guard: external package ${packagePath} has invalid resolved URL`);
  }

  if (
    resolved.protocol !== 'https:' ||
    resolved.hostname !== 'registry.npmjs.org' ||
    resolved.port ||
    resolved.username ||
    resolved.password ||
    resolved.search ||
    resolved.hash
  ) {
    throw new Error(
      `lockfile supply-chain guard: external package ${packagePath} must resolve only from the default HTTPS origin https://registry.npmjs.org without credentials/query/fragment`,
    );
  }

  assertCanonicalSha512Integrity(entry.integrity, packagePath);

  if (entry.hasInstallScript === true) {
    installScriptPackages += 1;
    const allowed = allowedInstallScripts.get(packagePath);
    if (!allowed) {
      throw new Error(`lockfile supply-chain guard: unexpected install-script package ${packagePath}`);
    }
    if (entry.version !== allowed.version || Boolean(entry.optional) !== allowed.optional) {
      throw new Error(
        `lockfile supply-chain guard: install-script metadata changed for ${packagePath}`,
      );
    }
  }
}

for (const [packagePath, expected] of allowedInstallScripts) {
  const entry = lock.packages[packagePath];
  if (
    !entry ||
    entry.hasInstallScript !== true ||
    entry.version !== expected.version ||
    Boolean(entry.optional) !== expected.optional
  ) {
    throw new Error(
      `lockfile supply-chain guard: expected install-script package changed or disappeared: ${packagePath}`,
    );
  }
}

if (externalPackages === 0) {
  throw new Error('lockfile supply-chain guard: no external npm packages were found');
}
if (installScriptPackages !== allowedInstallScripts.size) {
  throw new Error(
    `lockfile supply-chain guard: expected ${allowedInstallScripts.size} install-script packages, found ${installScriptPackages}`,
  );
}

console.info(
  `lockfile-supply-chain.guard ok external=${externalPackages} registry=registry.npmjs.org:443 integrity=sha512/64-byte install-scripts=${installScriptPackages} allowScripts=exact workspace-install-lifecycle=none`,
);

function assertCanonicalSha512Integrity(value, packagePath) {
  if (typeof value !== 'string' || !value.startsWith('sha512-')) {
    throw new Error(
      `lockfile supply-chain guard: external package ${packagePath} must have exactly one canonical sha512 integrity value`,
    );
  }

  const encoded = value.slice('sha512-'.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(
      `lockfile supply-chain guard: external package ${packagePath} must have exactly one canonical sha512 integrity value`,
    );
  }

  const digest = Buffer.from(encoded, 'base64');
  if (digest.length !== 64 || digest.toString('base64') !== encoded) {
    throw new Error(
      `lockfile supply-chain guard: external package ${packagePath} sha512 integrity must decode canonically to exactly 64 bytes`,
    );
  }
}

function assertExactAllowScripts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('lockfile supply-chain guard: root package.json allowScripts must be an object');
  }
  const actualEntries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expectedAllowScripts).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (
    actualEntries.length !== expectedEntries.length ||
    actualEntries.some(
      ([key, approved], index) =>
        key !== expectedEntries[index][0] || approved !== expectedEntries[index][1],
    )
  ) {
    throw new Error(
      'lockfile supply-chain guard: root package.json allowScripts must approve exactly esbuild@0.28.2 and fsevents@2.3.3',
    );
  }
}
