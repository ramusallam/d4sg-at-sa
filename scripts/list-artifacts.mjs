// Read-only: dump names in every remaining collection that could surface in UI.
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

for (const coll of ['artifacts', 'exhibit', 'students', 'portfolios', 'drafts']) {
  try {
    const snap = await getDocs(collection(db, coll));
    console.log(`\n${coll} (${snap.size} docs):`);
    snap.forEach(d => {
      const v = d.data();
      const name = v.name || v.studentName || v.maker || '(no name)';
      console.log(`  ${d.id}  name="${name}"  deleted=${!!v.deleted}`);
    });
  } catch (e) {
    console.log(`\n${coll}: ERROR ${e.message}`);
  }
}
process.exit(0);
