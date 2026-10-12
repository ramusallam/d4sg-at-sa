// Stamp roster.json into index.html (const ROSTER), firestore.rules, and
// storage.rules (function roster()). Idempotent: rewrites only marked blocks.
//   node scripts/gen-roster.mjs          # write
//   node scripts/gen-roster.mjs --check  # exit 1 if either file is stale
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const roster = JSON.parse(readFileSync(join(root, 'roster.json'), 'utf8')).students;

const slug = (name) => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const seen = new Set();
for (const s of roster) {
  if (!s.name || !s.email) throw new Error(`roster entry missing name/email: ${JSON.stringify(s)}`);
  const e = s.email.toLowerCase();
  if (seen.has(e) || seen.has(slug(s.name))) throw new Error(`duplicate roster entry: ${s.name} / ${s.email}`);
  seen.add(e); seen.add(slug(s.name));
}
const sorted = [...roster].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

// The page never ships student emails: it carries a SHA-256 of each one and
// hashes the signed-in account to find the matching name.
const hashEmail = (email) => createHash('sha256').update(email.toLowerCase()).digest('hex');
const htmlBlock = [
  '  const ROSTER = [ // GENERATED from roster.json by scripts/gen-roster.mjs. Do not edit here.',
  ...sorted.map(s => `    { name: ${JSON.stringify(s.name)}, h: ${JSON.stringify(hashEmail(s.email))} },`),
  '  ]; // END GENERATED ROSTER',
].join('\n');

const rulesBlock = [
  '    // GENERATED from roster.json by scripts/gen-roster.mjs. Do not edit here.',
  '    function roster() {',
  '      return {',
  ...sorted.map(s => `        ${JSON.stringify(s.email.toLowerCase())}: { "name": ${JSON.stringify(s.name)}, "slug": ${JSON.stringify(slug(s.name))} },`),
  '      };',
  '    }',
  '    // END GENERATED ROSTER',
].join('\n');

function stamp(file, re, block) {
  const src = readFileSync(join(root, file), 'utf8');
  if (!re.test(src)) throw new Error(`${file}: roster markers not found`);
  const next = src.replace(re, block);
  const stale = next !== src;
  if (check) { if (stale) { console.error(`${file} is stale; run node scripts/gen-roster.mjs`); process.exitCode = 1; } else console.log(`${file} up to date`); return; }
  if (stale) { writeFileSync(join(root, file), next); console.log(`stamped ${file}`); } else console.log(`${file} unchanged`);
}

stamp('index.html', /  const ROSTER = \[ \/\/ GENERATED[\s\S]*?\]; \/\/ END GENERATED ROSTER/, htmlBlock);
stamp('firestore.rules', /    \/\/ GENERATED from roster\.json[\s\S]*?\/\/ END GENERATED ROSTER/, rulesBlock);
stamp('storage.rules', /    \/\/ GENERATED from roster\.json[\s\S]*?\/\/ END GENERATED ROSTER/, rulesBlock);
