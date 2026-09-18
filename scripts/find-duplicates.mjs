// Read-only audit: list portfolio docs that share a benchmark + student name.
// Run from scripts/: node find-duplicates.mjs   (expect "dup groups 0" for anything submitted after 2026-09-18)
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
const app = initializeApp({ apiKey: 'AIzaSyBk_7fY9VbLla_2fePNqFTNehGJxkM3wYk', authDomain: 'd4sg-sa-class.firebaseapp.com', projectId: 'd4sg-sa-class' });
const db = getFirestore(app);
const snap = await getDocs(collection(db, 'portfolios'));
const rows = [];
snap.forEach(d => { const x = d.data(); rows.push({ id: d.id, b: x.benchmarkId, name: (x.studentName||x.name||'').trim(), slug: x.nameSlug, del: !!x.deleted, t: (x.updatedAt||x.createdAt||x.submittedAt)?.toMillis?.() || x.updatedAt || x.createdAt || '', slots: Object.keys(x.slots||{}).join(',') }); });
const groups = {};
rows.filter(r => !r.del).forEach(r => { const k = r.b + ' | ' + r.name.toLowerCase(); (groups[k] ||= []).push(r); });
const dups = Object.entries(groups).filter(([,v]) => v.length > 1).sort();
console.log('total docs', rows.length, 'live', rows.filter(r=>!r.del).length, 'dup groups', dups.length);
for (const [k, v] of dups) { console.log('\n' + k); v.forEach(r => console.log('   ', r.id, '|', JSON.stringify(r.name), '| slug', r.slug, '|', r.t, '|', r.slots)); }
process.exit(0);
