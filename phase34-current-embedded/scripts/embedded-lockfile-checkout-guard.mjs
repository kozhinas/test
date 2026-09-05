import { readFile } from 'node:fs/promises';

const attributes = (await readFile('.gitattributes', 'utf8')).replace(/\r\n/g, '\n');
const rule = 'infra/lockfile/*.br.b64 -text';
const matchingRules = attributes
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line === rule);

if (matchingRules.length !== 1) {
  throw new Error(
    `embedded lockfile checkout guard: .gitattributes must contain exactly one ${JSON.stringify(rule)} rule`,
  );
}

for (const forbidden of [
  'infra/lockfile/*.br.b64 text',
  'infra/lockfile/*.br.b64 text=',
  'infra/lockfile/*.br.b64 eol=',
]) {
  if (attributes.includes(forbidden)) {
    throw new Error(
      `embedded lockfile checkout guard: conflicting EOL conversion rule ${JSON.stringify(forbidden)}`,
    );
  }
}

const embedded = await readFile('scripts/phase-3-4-embedded-lockfile.mjs', 'utf8');
for (const required of [
  "const expectedNames = ['README.md', ...PARTS.map(([name]) => name)].sort()",
  'actualNames.length !== expectedNames.length',
  "raw.endsWith('\\n')",
  "raw.slice(0, -1).includes('\\n')",
  "raw.includes('\\r')",
  'gitBlobSha(Buffer.from(raw, \'utf8\'))',
]) {
  if (!embedded.includes(required)) {
    throw new Error(
      `embedded lockfile checkout guard: materializer lost checkout/directory invariant ${required}`,
    );
  }
}

console.info(
  'embedded-lockfile-checkout.guard ok exact-bytes checkout-eol-conversion=disabled directory=README+7-parts-only',
);
