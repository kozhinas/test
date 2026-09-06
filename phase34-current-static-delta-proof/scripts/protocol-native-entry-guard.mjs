import { readFile } from 'node:fs/promises';

const protocolPackage = JSON.parse(await readFile('packages/protocol/package.json', 'utf8'));
const mobilePackage = JSON.parse(await readFile('mobile/package.json', 'utf8'));

if (protocolPackage.main !== 'dist/index.js') {
  throw new Error('protocol native entry guard: default runtime entry must remain dist/index.js');
}
if (protocolPackage['react-native'] !== 'dist/index.js') {
  throw new Error(
    'protocol native entry guard: React Native must consume built dist/index.js so Metro never resolves NodeNext .js specifiers against TypeScript source',
  );
}
if (protocolPackage.types !== 'src/index.ts') {
  throw new Error('protocol native entry guard: TypeScript declarations must continue to resolve from src/index.ts');
}

const rootExport = protocolPackage.exports?.['.'];
for (const [condition, expected] of [
  ['types', './src/index.ts'],
  ['react-native', './dist/index.js'],
  ['default', './dist/index.js'],
]) {
  if (rootExport?.[condition] !== expected) {
    throw new Error(
      `protocol native entry guard: exports["."].${condition} must remain ${expected}`,
    );
  }
}

if (protocolPackage.scripts?.build !== 'tsc -p tsconfig.build.json') {
  throw new Error('protocol native entry guard: protocol build script must remain the NodeNext dist build');
}

const sourceIndex = (await readFile('packages/protocol/src/index.ts', 'utf8')).trim();
if (sourceIndex !== "export * from './signaling.js';") {
  throw new Error(
    'protocol native entry guard: source entry must retain the explicit .js NodeNext export; React Native must be fixed through the built entry, not by weakening ESM semantics',
  );
}

for (const lifecycle of ['prestart', 'preprebuild', 'preios', 'preandroid', 'pretest']) {
  if (mobilePackage.scripts?.[lifecycle] !== 'npm run build -w @private/protocol') {
    throw new Error(
      `protocol native entry guard: mobile ${lifecycle} must build @private/protocol before Metro/Expo consumes dist/index.js`,
    );
  }
}

console.info(
  'protocol-native-entry.guard ok node=src-types+dist-runtime react-native=dist metro-nodeNext-compatible lifecycle-build=locked',
);
