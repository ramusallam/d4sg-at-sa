// One-shot cleanup: delete all portfolios, drafts, students entries, and
// Storage files for the given student name(s). Rules allow `delete: if true`
// on portfolios/drafts/students and `write: if request.resource == null` on
// Storage, so the public web client SDK is enough — no Admin SDK required.
//
// Usage:
//   node scripts/purge-by-name.mjs "James T." "Ramsey Musallam"

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, query, where, getDocs, doc, deleteDoc,
} from 'firebase/firestore';
import { getStorage, ref, listAll, deleteObject } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyBk_7fY9VbLla_2fePNqFTNehGJxkM3wYk',
  authDomain: 'd4sg-sa-class.firebaseapp.com',
  projectId: 'd4sg-sa-class',
  storageBucket: 'd4sg-sa-class-uploads',
  messagingSenderId: '348558190261',
  appId: '1:348558190261:web:45acfd179a20b7343cc0fc',
};

function nameSlug(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('Usage: node purge-by-name.mjs "Name One" "Name Two"');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

async function purgeStorageFolder(path) {
  try {
    const folder = ref(storage, path);
    const list = await listAll(folder);
    for (const item of list.items) {
      try { await deleteObject(item); console.log('  · storage delete', item.fullPath); }
      catch (e) { console.warn('  · storage delete failed', item.fullPath, e.message); }
    }
    for (const prefix of list.prefixes) {
      await purgeStorageFolder(prefix.fullPath);
    }
  } catch (e) {
    console.warn('  · listAll skipped for', path, e.message);
  }
}

for (const name of targets) {
  const slug = nameSlug(name);
  console.log(`\n=== Purging "${name}" (slug: ${slug}) ===`);

  // 1) Portfolios by studentName
  try {
    const q = query(collection(db, 'portfolios'), where('studentName', '==', name));
    const snap = await getDocs(q);
    console.log(`  portfolios matching studentName: ${snap.size}`);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
      console.log('  · deleted portfolios/' + d.id);
    }
  } catch (e) {
    console.warn('  portfolios query failed', e.message);
  }

  // 2) Drafts by nameSlug (server-side field) OR doc-id prefix
  try {
    const q = query(collection(db, 'drafts'), where('nameSlug', '==', slug));
    const snap = await getDocs(q);
    console.log(`  drafts matching nameSlug: ${snap.size}`);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
      console.log('  · deleted drafts/' + d.id);
    }
  } catch (e) {
    console.warn('  drafts query failed', e.message);
  }

  // 3) Drafts whose doc id starts with the slug (in case nameSlug field is missing)
  try {
    const all = await getDocs(collection(db, 'drafts'));
    const prefix = `${slug}__`;
    let count = 0;
    for (const d of all.docs) {
      if (d.id.startsWith(prefix)) {
        await deleteDoc(d.ref);
        console.log('  · deleted drafts/' + d.id + ' (by doc-id prefix)');
        count++;
      }
    }
    if (count) console.log(`  drafts matching doc-id prefix: ${count}`);
  } catch (e) {
    console.warn('  drafts prefix scan failed', e.message);
  }

  // 4) Roster entry
  if (slug) {
    try {
      await deleteDoc(doc(db, 'students', slug));
      console.log('  · deleted students/' + slug);
    } catch (e) {
      console.warn('  students delete failed', e.message);
    }
  }

  // 5) Storage files at drafts/${slug}__*  (one folder per benchmark)
  //    We can't wildcard-list drafts/${slug}__*, so scan drafts/ and filter.
  try {
    const root = ref(storage, 'drafts');
    const list = await listAll(root);
    const prefix = `${slug}__`;
    for (const sub of list.prefixes) {
      const folderName = sub.fullPath.split('/').pop();
      if (folderName.startsWith(prefix)) {
        await purgeStorageFolder(sub.fullPath);
      }
    }
  } catch (e) {
    console.warn('  storage drafts scan failed', e.message);
  }
}

console.log('\nDone.');
process.exit(0);
