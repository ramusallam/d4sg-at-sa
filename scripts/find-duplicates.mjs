// Read-only audit: list portfolio docs that share a benchmark + student name.
// Uses the same Application Default Credentials as backup-firestore.mjs. The
// browser SDK can silently return an empty cache when offline, which used to
// make a failed audit look like "dup groups 0".
//
// Run from the repo root: node scripts/find-duplicates.mjs
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'd4sg-sa-class';

async function main() {
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const snap = await getFirestore().collection('portfolios').get();
  const rows = [];
  snap.forEach(d => {
    const x = d.data();
    rows.push({
      id: d.id,
      b: x.benchmarkId,
      name: (x.studentName || x.name || '').trim(),
      slug: x.nameSlug,
      del: !!x.deleted,
      t: (x.updatedAt || x.createdAt || x.submittedAt)?.toMillis?.() || '',
      slots: Object.keys(x.slots || {}).join(',')
    });
  });
  const groups = {};
  rows.filter(r => !r.del).forEach(r => {
    const k = r.b + ' | ' + r.name.toLowerCase();
    (groups[k] ||= []).push(r);
  });
  const dups = Object.entries(groups).filter(([, v]) => v.length > 1).sort();
  console.log('total docs', rows.length, 'live', rows.filter(r => !r.del).length, 'dup groups', dups.length);
  for (const [k, v] of dups) {
    console.log('\n' + k);
    v.forEach(r => console.log('   ', r.id, '|', JSON.stringify(r.name), '| slug', r.slug, '|', r.t, '|', r.slots));
  }
}

main().catch(err => {
  console.error('Duplicate audit failed:', err && err.message || err);
  process.exit(1);
});
