// Firestore backup: export every collection to a timestamped local JSON file.
//
// This is the recovery net behind WS1's delete lockdown. Hard deletes are now
// denied by security rules and the admin "delete" is a soft delete, so student
// work is never destroyed by the web SDK — but a periodic off-Firestore export
// is still the durable backstop. Run this on a schedule (see below).
//
// It uses firebase-admin with Application Default Credentials (ADC) — no service
// account key file is committed. ADC resolves in this order:
//   1. GOOGLE_APPLICATION_CREDENTIALS env var pointing at a service-account JSON
//   2. `gcloud auth application-default login` credentials on this machine
//
// One-time setup:
//   cd scripts
//   npm install                 # installs firebase-admin (now in package.json)
//   gcloud auth application-default login   # (or export GOOGLE_APPLICATION_CREDENTIALS)
//
// Usage:
//   node scripts/backup-firestore.mjs
//   node scripts/backup-firestore.mjs --out /path/to/backups
//
// Output:
//   ./backups/d4sg-firestore-backup-YYYY-MM-DDTHH-MM-SS-sssZ.json
//
// Idempotent: each run writes a NEW timestamped file; it never mutates Firestore
// (read-only) and never overwrites a prior backup.

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const PROJECT_ID = 'd4sg-sa-class';

// Top-level collections in this project. `archives` is a parent-doc collection
// whose portfolios/artifacts live in subcollections; we walk those per-doc.
const TOP_LEVEL = ['artifacts', 'portfolios', 'exhibit', 'students', 'drafts', 'archives'];
const ARCHIVE_SUBCOLLECTIONS = ['portfolios', 'artifacts'];

function parseOutDir() {
  const i = process.argv.indexOf('--out');
  if (i !== -1 && process.argv[i + 1]) return resolve(process.argv[i + 1]);
  return resolve(process.cwd(), 'backups');
}

// Firestore Timestamps and other rich types are converted to plain JSON via a
// replacer so the export is self-describing and restorable.
function jsonReplacer(_key, value) {
  if (value && typeof value === 'object' && typeof value.toDate === 'function') {
    return { __type: 'timestamp', iso: value.toDate().toISOString() };
  }
  return value;
}

async function dumpCollection(db, collRef) {
  const snap = await collRef.get();
  const docs = {};
  snap.forEach((d) => { docs[d.id] = d.data(); });
  return docs;
}

async function main() {
  if (!getApps().length) {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  }
  const db = getFirestore();

  const out = { project: PROJECT_ID, exportedAt: new Date().toISOString(), collections: {} };

  for (const name of TOP_LEVEL) {
    process.stdout.write(`Exporting ${name} ... `);
    out.collections[name] = await dumpCollection(db, db.collection(name));
    console.log(`${Object.keys(out.collections[name]).length} docs`);
  }

  // Walk each archive's subcollections so historical snapshots are backed up too.
  out.archiveSubcollections = {};
  const archiveIds = Object.keys(out.collections.archives || {});
  for (const archiveId of archiveIds) {
    out.archiveSubcollections[archiveId] = {};
    for (const sub of ARCHIVE_SUBCOLLECTIONS) {
      const ref = db.collection('archives').doc(archiveId).collection(sub);
      out.archiveSubcollections[archiveId][sub] = await dumpCollection(db, ref);
    }
  }

  const outDir = parseOutDir();
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(outDir, `d4sg-firestore-backup-${stamp}.json`);
  writeFileSync(file, JSON.stringify(out, jsonReplacer, 2));
  console.log(`\nBackup written: ${file}`);
}

main().catch((err) => {
  console.error('Backup failed:', err && err.message || err);
  process.exit(1);
});
