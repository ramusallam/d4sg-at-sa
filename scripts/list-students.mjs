// Read-only: list every doc in the `students` collection plus a count of
// portfolios/drafts per name, so we can see what test data exists.
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBk_7fY9VbLla_2fePNqFTNehGJxkM3wYk',
  authDomain: 'd4sg-sa-class.firebaseapp.com',
  projectId: 'd4sg-sa-class',
  storageBucket: 'd4sg-sa-class-uploads',
  messagingSenderId: '348558190261',
  appId: '1:348558190261:web:45acfd179a20b7343cc0fc',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const students = await getDocs(collection(db, 'students'));
console.log(`students collection (${students.size} docs):`);
students.forEach(d => console.log(`  ${d.id}  →  ${JSON.stringify(d.data())}`));

for (const coll of ['portfolios', 'drafts']) {
  const snap = await getDocs(collection(db, coll));
  const byName = {};
  snap.forEach(d => {
    const n = d.data().name || d.data().studentName || '(no name)';
    byName[n] = (byName[n] || 0) + 1;
  });
  console.log(`\n${coll} (${snap.size} docs):`);
  Object.entries(byName).sort().forEach(([n, c]) => console.log(`  ${n}: ${c}`));
}
process.exit(0);
