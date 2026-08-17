// Add one card to the T4SG Exhibit (the wall of past student work).
// The `exhibit` collection allows `create` with light field validation and
// `createdAt == request.time`, so the public web client SDK is enough — no
// Admin SDK / service account required (same trick as purge-by-name.mjs).
//
// Usage:
//   node scripts/add-to-exhibit.mjs \
//     --title "One-Handed Keyboard Mount" \
//     --url   "https://www.instructables.com/..." \
//     --type  "Instructable" \
//     --maker "Maya R. · 2024" \
//     --blurb "A 3D-printed mount that holds a keyboard at an angle for one-handed typing." \
//     --image "https://.../photo.jpg"
//
// Required: --title, --url.  Optional: --type, --maker, --blurb, --image.
// Add --dry to print the card without writing it.

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBk_7fY9VbLla_2fePNqFTNehGJxkM3wYk',
  authDomain: 'd4sg-sa-class.firebaseapp.com',
  projectId: 'd4sg-sa-class',
  storageBucket: 'd4sg-sa-class-uploads',
  messagingSenderId: '348558190261',
  appId: '1:348558190261:web:45acfd179a20b7343cc0fc',
};

// --flag "value" parsing
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'dry') { out.dry = true; continue; }
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) { out[key] = ''; }
      else { out[key] = val; i++; }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const title = (args.title || '').trim();
const url = (args.url || '').trim();

if (!title || !url) {
  console.error('Required: --title and --url.\nSee header of this file for full usage.');
  process.exit(1);
}
if (title.length > 120) { console.error('Title too long (max 120).'); process.exit(1); }
if (url.length > 500) { console.error('URL too long (max 500).'); process.exit(1); }

const card = {
  title,
  url,
  type: (args.type || '').trim(),
  maker: (args.maker || '').trim(),
  blurb: (args.blurb || '').trim(),
  image: (args.image || '').trim(),
};

console.log('\nCard to add:');
for (const [k, v] of Object.entries(card)) console.log(`  ${k.padEnd(6)} ${v || '—'}`);

if (args.dry) { console.log('\n(dry run — nothing written)'); process.exit(0); }

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

try {
  const refDoc = await addDoc(collection(db, 'exhibit'), { ...card, createdAt: serverTimestamp() });
  console.log(`\nAdded to Exhibit → exhibit/${refDoc.id}`);
  console.log('Live at https://t4sg-at-sa.vercel.app/exhibit');
  process.exit(0);
} catch (e) {
  console.error('\nCould not add card:', e && e.message || e);
  process.exit(1);
}
