// Firestore rules test for the student sign-in model. Run from the repo root:
//   firebase emulators:exec --only firestore --project d4sg-sa-class "node scripts/test-rules.mjs"
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const env = await initializeTestEnvironment({
  projectId: 'd4sg-sa-class',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  storage: { rules: readFileSync('storage.rules', 'utf8') },
});
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'portfolios/p1b1__riley'), { benchmarkId: 'p1b1', studentName: 'Riley', nameSlug: 'riley', slots: { summary: { text: 'hi' } }, createdAt: new Date() });
  await setDoc(doc(db, 'portfolios/p1b1__carina'), { benchmarkId: 'p1b1', studentName: 'Carina', nameSlug: 'carina', slots: {}, createdAt: new Date() });
  await setDoc(doc(db, 'artifacts/a1'), { benchmarkId: 'hw-1', studentName: 'Riley', description: '', createdAt: new Date() }); // legacy: no nameSlug
  await setDoc(doc(db, 'artifacts/a2'), { benchmarkId: 'hw-1', studentName: 'Carina', description: '', createdAt: new Date() });
  await setDoc(doc(db, 'drafts/riley__p1b2'), { studentName: 'Riley', nameSlug: 'riley', benchmarkId: 'p1b2', reflection: 'draft' });
  await setDoc(doc(db, 'drafts/carina__p1b2'), { studentName: 'Carina', nameSlug: 'carina', benchmarkId: 'p1b2' });
  await setDoc(doc(db, 'students/riley'), { name: 'Riley' });
  await setDoc(doc(db, 'exhibit/e1'), { title: 't', url: 'https://x', createdAt: new Date() });
});

const student = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
const anon = env.unauthenticatedContext().firestore();
const riley = student('u-riley', 'riley.musallam@sonomaacademy.org');
const rileyCaps = student('u-riley2', 'Riley.Musallam@sonomaacademy.org');
const carina = student('u-carina', 'carina.flocco@sonomaacademy.org');
const stranger = student('u-str', 'someone.else@sonomaacademy.org');
const outsider = student('u-out', 'riley.musallam@gmail.com');
const unverified = env.authenticatedContext('u-unv', { email: 'riley.musallam@sonomaacademy.org', email_verified: false }).firestore();
const teacher = student('u-t', 'ramsey.musallam@gmail.com');
const teacher2 = student('u-t2', 'ramsey.musallam@sonomaacademy.org');

let n = 0;
const ok = async (label, p) => { await assertSucceeds(p).catch(e => { throw new Error(`${label}: expected success\n${e.message}`); }); n++; };
const no = async (label, p) => { await assertFails(p).catch(e => { throw new Error(`${label}: expected denial\n${e.message}`); }); n++; };

// Signed out: nothing but the Exhibit.
await no('anon reads a portfolio', getDoc(doc(anon, 'portfolios/p1b1__riley')));
await no('anon lists portfolios', getDocs(query(collection(anon, 'portfolios'), where('benchmarkId', '==', 'p1b1'))));
await no('anon reads a draft', getDoc(doc(anon, 'drafts/riley__p1b2')));
await no('anon reads homework', getDoc(doc(anon, 'artifacts/a1')));
await no('anon writes a portfolio', setDoc(doc(anon, 'portfolios/p1b3__riley'), { benchmarkId: 'p1b3', studentName: 'Riley', nameSlug: 'riley', slots: {}, createdAt: serverTimestamp() }));
await ok('anon reads the Exhibit', getDoc(doc(anon, 'exhibit/e1')));

// A student sees and writes only their own work.
await ok('riley reads own portfolio', getDoc(doc(riley, 'portfolios/p1b1__riley')));
await ok('riley (mixed-case email) reads own portfolio', getDoc(doc(rileyCaps, 'portfolios/p1b1__riley')));
await no('riley reads carina portfolio', getDoc(doc(riley, 'portfolios/p1b1__carina')));
await ok('riley panel query (benchmark + slug)', getDocs(query(collection(riley, 'portfolios'), where('benchmarkId', '==', 'p1b1'), where('nameSlug', '==', 'riley'))));
await ok('riley checkmark query by slug', getDocs(query(collection(riley, 'portfolios'), where('nameSlug', '==', 'riley'))));
await ok('riley checkmark query by name', getDocs(query(collection(riley, 'portfolios'), where('studentName', '==', 'Riley'))));
await no('riley class-wide query', getDocs(query(collection(riley, 'portfolios'), where('benchmarkId', '==', 'p1b1'))));
await no('riley queries carina by slug', getDocs(query(collection(riley, 'portfolios'), where('nameSlug', '==', 'carina'))));
await ok('riley homework query (legacy docs without nameSlug)', getDocs(query(collection(riley, 'artifacts'), where('benchmarkId', '==', 'hw-1'), where('studentName', '==', 'Riley'))));
await no('riley reads carina homework', getDoc(doc(riley, 'artifacts/a2')));
await ok('riley submits a new portfolio', setDoc(doc(riley, 'portfolios/p1b3__riley'), { benchmarkId: 'p1b3', studentName: 'Riley', nameSlug: 'riley', slots: {}, createdAt: serverTimestamp() }));
await no('riley submits as carina', setDoc(doc(riley, 'portfolios/p1b3__carina'), { benchmarkId: 'p1b3', studentName: 'Carina', nameSlug: 'carina', slots: {}, createdAt: serverTimestamp() }));
await ok('riley revises own portfolio', setDoc(doc(riley, 'portfolios/p1b1__riley'), { slots: { summary: { text: 'v2' }, image: null }, deleted: false }, { merge: true }));
await no('riley edits carina portfolio', setDoc(doc(riley, 'portfolios/p1b1__carina'), { slots: { summary: { text: 'x' } } }, { merge: true }));
await ok('riley reads own draft', getDoc(doc(riley, 'drafts/riley__p1b2')));
await no('riley reads carina draft', getDoc(doc(riley, 'drafts/carina__p1b2')));
await ok('riley autosaves own draft', setDoc(doc(riley, 'drafts/riley__vibe'), { studentName: 'Riley', nameSlug: 'riley', benchmarkId: 'vibe', code: 'x' }, { merge: true }));
await no('riley writes carina draft', setDoc(doc(riley, 'drafts/carina__vibe'), { studentName: 'Carina', nameSlug: 'carina', benchmarkId: 'vibe' }, { merge: true }));
await no('riley writes a draft with a mismatched id', setDoc(doc(riley, 'drafts/carina__vibe2'), { studentName: 'Riley', nameSlug: 'riley', benchmarkId: 'vibe2' }, { merge: true }));
await ok('riley turns in homework', setDoc(doc(riley, 'artifacts/a3'), { benchmarkId: 'hw-2', studentName: 'Riley', nameSlug: 'riley', description: 'd', createdAt: serverTimestamp() }));
await no('riley turns in homework as carina', setDoc(doc(riley, 'artifacts/a4'), { benchmarkId: 'hw-2', studentName: 'Carina', nameSlug: 'carina', description: 'd', createdAt: serverTimestamp() }));
await no('riley reads the legacy students list', getDoc(doc(riley, 'students/riley')));

// Not on the roster, wrong domain, or unverified: nothing.
await no('stranger reads riley portfolio', getDoc(doc(stranger, 'portfolios/p1b1__riley')));
await no('stranger creates a portfolio', setDoc(doc(stranger, 'portfolios/p1b3__someone'), { benchmarkId: 'p1b3', studentName: 'Someone', nameSlug: 'someone', slots: {}, createdAt: serverTimestamp() }));
await no('gmail outsider reads riley portfolio', getDoc(doc(outsider, 'portfolios/p1b1__riley')));
await no('unverified school email reads a portfolio', getDoc(doc(unverified, 'portfolios/p1b1__riley')));

// Teacher: everything, from either account.
for (const [label, t] of [['teacher gmail', teacher], ['teacher school', teacher2]]) {
  await ok(`${label} lists the class`, getDocs(query(collection(t, 'portfolios'), where('benchmarkId', '==', 'p1b1'))));
  await ok(`${label} reads a draft`, getDoc(doc(t, 'drafts/carina__p1b2')));
  await ok(`${label} reads homework`, getDocs(query(collection(t, 'artifacts'), where('benchmarkId', '==', 'hw-1'))));
  await ok(`${label} soft-deletes a portfolio`, setDoc(doc(t, 'portfolios/p1b1__carina'), { deleted: true }, { merge: true }));
  await ok(`${label} reads the legacy students list`, getDoc(doc(t, 'students/riley')));
}

// Storage uses owner-prefixed folders for every new T4SG upload. Existing
// download-token URLs remain valid, but direct SDK reads, lists, and writes are
// limited to the signed-in owner or Ramsey.
const bucket = 'gs://d4sg-sa-class-uploads';
const storageFor = (uid, email, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified }).storage(bucket);
const rileyFiles = storageFor('s-riley', 'riley.musallam@sonomaacademy.org');
const carinaFiles = storageFor('s-carina', 'carina.flocco@sonomaacademy.org');
const strangerFiles = storageFor('s-stranger', 'someone.else@sonomaacademy.org');
const teacherFiles = storageFor('s-teacher', 'ramsey.musallam@gmail.com');
const anonFiles = env.unauthenticatedContext().storage(bucket);
const png = new Uint8Array([137, 80, 78, 71]);
const ownerPath = 'drafts/riley__rules-test/owner.png';
const otherPath = 'drafts/carina__rules-test/other.png';
await ok('riley uploads to her draft folder', uploadBytes(ref(rileyFiles, ownerPath), png, { contentType: 'image/png' }));
await ok('riley reads her draft file', getBytes(ref(rileyFiles, ownerPath)));
await no('carina cannot read riley draft file', getBytes(ref(carinaFiles, ownerPath)));
await no('riley cannot upload to carina draft folder', uploadBytes(ref(rileyFiles, otherPath), png, { contentType: 'image/png' }));
await no('unrostered school account cannot upload', uploadBytes(ref(strangerFiles, 'drafts/someone__rules-test/file.png'), png, { contentType: 'image/png' }));
await no('signed-out visitor cannot read owner files', getBytes(ref(anonFiles, ownerPath)));
await ok('teacher uploads to a student folder', uploadBytes(ref(teacherFiles, otherPath), png, { contentType: 'image/png' }));
await ok('teacher reads a student file', getBytes(ref(teacherFiles, ownerPath)));
// The shared Firebase project also serves the separate chemistry image wall;
// preserve its established public QR-upload behavior.
await ok('chem wall public image upload remains available', uploadBytes(ref(anonFiles, 'chemWall/rules-test.png'), png, { contentType: 'image/png' }));
await env.cleanup();
console.log(`Firestore + Storage rules: ${n} checks passed.`);
