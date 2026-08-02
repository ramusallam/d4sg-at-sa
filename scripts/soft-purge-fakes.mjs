// Soft-delete all seed/test student data before the real class starts.
// Marks students / portfolios / drafts docs for the fake names deleted:true
// (the same soft-delete shape the admin UI writes, permitted by rules).
// Nothing is destroyed — docs stay in Firestore, render paths skip them.
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, doc, setDoc, serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBk_7fY9VbLla_2fePNqFTNehGJxkM3wYk',
  authDomain: 'd4sg-sa-class.firebaseapp.com',
  projectId: 'd4sg-sa-class',
  storageBucket: 'd4sg-sa-class-uploads',
  messagingSenderId: '348558190261',
  appId: '1:348558190261:web:45acfd179a20b7343cc0fc',
};

const FAKES = new Set([
  'Maya R.', 'James T.', 'Aisha K.', 'Diego M.', 'Sophia L.',
  'Noah W.', 'Priya S.', 'Ethan H.', 'Zara B.', 'Liam C.',
]);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let marked = 0;
for (const coll of ['students', 'portfolios', 'drafts']) {
  const snap = await getDocs(collection(db, coll));
  for (const d of snap.docs) {
    const v = d.data();
    if (v.deleted) continue;
    const name = (v.name || v.studentName || '').trim();
    if (!FAKES.has(name)) continue;
    await setDoc(doc(db, coll, d.id), { deleted: true, deletedAt: serverTimestamp() }, { merge: true });
    console.log(`marked deleted: ${coll}/${d.id} (${name})`);
    marked++;
  }
}
console.log(`\nDone — ${marked} docs soft-deleted.`);
process.exit(0);
