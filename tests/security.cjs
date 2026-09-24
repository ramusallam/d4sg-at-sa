const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

assert.doesNotMatch(html, /const ADMIN_TOKEN\s*=/, 'no teacher secret is shipped to the browser');
assert.match(html, /signInWithPopup\(auth, new GoogleAuthProvider\(\)\)/, 'teacher mode uses Google sign-in');
assert.match(html, /const wantsAdmin = urlParams\.has\('admin'\)/, 'admin URL is only a mode trigger');
assert.match(rules, /function isTeacher\(\)/, 'rules define a teacher identity check');
assert.match(rules, /match \/archives\/\{archiveId\}[\s\S]*?allow read: if isTeacher\(\)/, 'archives are teacher-only');
assert.match(rules, /match \/exhibit\/\{exhibitId\}[\s\S]*?allow create: if isTeacher\(\)/, 'Exhibit curation is teacher-only');
assert.match(rules, /allow create: if request\.resource\.data\.keys\(\)\.hasAll\(\['benchmarkId','studentName','createdAt','slots'\]\)/, 'student portfolio creation remains open');
assert.match(rules, /request\.resource\.data\.deleted == false/, 'students can revise and resubmit soft-removed portfolios');
assert.doesNotMatch(rules, /allow delete: if true/, 'hard deletes remain denied');

console.log('T4SG security audit passed: open student submissions, teacher-only maintenance, and no client admin secret.');
