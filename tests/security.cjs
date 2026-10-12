const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');
const roster = [...rules.matchAll(/^\s*"([^"]+@sonomaacademy\.org)": \{ "name": "([^"]+)", "slug": "([^"]+)" \},$/gm)]
  .map(([, email, name, slug]) => ({ email, name, slug }));

assert.doesNotMatch(html, /const ADMIN_TOKEN\s*=/, 'no teacher secret is shipped to the browser');
assert.match(html, /signInWithPopup\(auth, new GoogleAuthProvider\(\)\)/, 'teacher mode uses Google sign-in');
assert.match(html, /const wantsAdmin = urlParams\.has\('admin'\)/, 'admin URL is only a mode trigger');
assert.match(html, /const TEACHER_EMAILS = \['ramsey\.musallam@gmail\.com', 'ramsey\.musallam@sonomaacademy\.org'\]/, 'both teacher accounts open teacher mode');
assert.match(html, /return !!user && user\.emailVerified && TEACHER_EMAILS\.includes/, 'teacher mode requires a verified Google account');
assert.match(rules, /function isTeacher\(\)[\s\S]*?'ramsey\.musallam@gmail\.com', 'ramsey\.musallam@sonomaacademy\.org'/, 'rules know both teacher accounts');

// Student sign-in: every student is on the roster with a school email, the
// roster is stamped identically into the page and the rules, and nobody
// self-registers anymore.
assert.ok(roster.length >= 18, 'roster holds the class');
for (const s of roster) {
  assert.match(s.email, /@sonomaacademy\.org$/, `${s.name} uses a school email`);
  const h = createHash('sha256').update(s.email.toLowerCase()).digest('hex');
  assert.ok(html.includes(`{ name: ${JSON.stringify(s.name)}, h: ${JSON.stringify(h)} }`), `${s.name} is in the page roster as a hash`);
  assert.ok(!html.includes(s.email), `${s.name}'s email never ships to the browser`);
  assert.ok(rules.includes(`${JSON.stringify(s.email)}: { "name": ${JSON.stringify(s.name)}`), `${s.name} is in the rules roster`);
  assert.ok(storage.includes(`${JSON.stringify(s.email)}: { "name": ${JSON.stringify(s.name)}`), `${s.name} is in the storage roster`);
}
if (fs.existsSync(path.join(root, 'roster.json'))) {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'gen-roster.mjs'), '--check'], { stdio: 'pipe' });
}
assert.doesNotMatch(html, /I'm new/, 'the add-me flow is gone');
assert.match(html, /provider\.setCustomParameters\(\{ hd: SCHOOL_DOMAIN/, 'student sign-in asks for the school domain');
assert.match(html, /is not on the T4SG roster/, 'an unknown account is signed out with a clear message');

// Ownership is enforced server-side, not just in the UI.
assert.match(rules, /function isStudent\(\)[\s\S]*?email_verified == true[\s\S]*?in roster\(\)/, 'a student is a verified school account on the roster');
assert.match(rules, /match \/portfolios\/\{portfolioId\}[\s\S]*?allow read: if isTeacher\(\) \|\| owns\(resource\.data\)/, 'portfolios are readable only by their owner or the teacher');
assert.match(rules, /match \/artifacts\/\{artifactId\}[\s\S]*?allow read: if isTeacher\(\) \|\| owns\(resource\.data\)/, 'homework artifacts are readable only by their owner or the teacher');
assert.match(rules, /match \/drafts\/\{draftId\}[\s\S]*?allow read: if isTeacher\(\) \|\| \(isStudent\(\) && draftId\.matches/, 'drafts are readable only by their owner or the teacher');
assert.match(rules, /writesAsSelf\(request\.resource\.data\)/, 'students can only write work under their own name');
assert.match(rules, /match \/students\/\{studentSlug\}[\s\S]*?allow read: if isTeacher\(\)/, 'the legacy self-added roster is teacher-only');
assert.match(rules, /match \/archives\/\{archiveId\}[\s\S]*?allow read: if isTeacher\(\)/, 'archives are teacher-only');
assert.match(rules, /match \/exhibit\/\{exhibitId\}[\s\S]*?allow read: if true/, 'the Exhibit stays public');
assert.match(rules, /match \/exhibit\/\{exhibitId\}[\s\S]*?allow create: if isTeacher\(\)/, 'Exhibit curation is teacher-only');
assert.match(rules, /request\.resource\.data\.deleted == false/, 'students can revise and resubmit soft-removed portfolios');
assert.match(rules, /request\.resource\.data\.nameSlug == mySlug\(\)/, 'a student cannot transfer an existing portfolio to another owner');
assert.doesNotMatch(rules, /allow delete: if true/, 'hard deletes remain denied');
assert.match(storage, /function ownsScope\(ownerScope\)[\s\S]*?ownerScope\.matches\('\^' \+ mySlug\(\) \+ '__\.\*'\)/, 'student file access is limited to an owner-prefixed folder');
assert.match(storage, /match \/artifacts\/\{ownerScope\}\/\{file=\*\*\}[\s\S]*?allow read: if canAccess\(ownerScope\)/, 'artifact files are owner- or teacher-only');
assert.match(storage, /match \/portfolios\/\{ownerScope\}\/\{file=\*\*\}[\s\S]*?allow read: if canAccess\(ownerScope\)/, 'portfolio files are owner- or teacher-only');
assert.match(storage, /match \/drafts\/\{draftId\}\/\{file=\*\*\}[\s\S]*?allow read: if canAccess\(draftId\)/, 'draft files are owner- or teacher-only');
assert.match(html, /artifacts\/\$\{nameSlug\(name\)\}__\$\{benchmarkId\}\//, 'new artifact uploads use an owner-prefixed folder');
assert.match(html, /portfolios\/\$\{nameSlug\(name\)\}__\$\{benchmarkId\}\//, 'new portfolio uploads use an owner-prefixed folder');
const artifactWrites = [...html.matchAll(/addDoc\(collection\(db, 'artifacts'\), \{([\s\S]*?)\n\s*\}\);/g)];
assert.equal(artifactWrites.length, 4, 'all four legacy artifact write paths are covered');
artifactWrites.forEach(([, body], i) => assert.match(body, /studentName: name,\s*nameSlug: nameSlug\(name\)/, `artifact write ${i + 1} stores its owner slug`));
assert.match(html, /isTeacherUser\(user\)[\s\S]*?setTeacherMode\(true\)/, 'a verified teacher account always opens the class-wide view');
assert.match(html, /const teacherHref = appRouteHref\(location\.pathname \+ location\.search \+ location\.hash\)/, 'teacher sign-in stamps the teacher URL state');
assert.doesNotMatch(html, /setTeacherMode\(wantsAdmin\)/, 'teacher visibility never depends on entering through a special URL');
assert.match(html, /if \(prevTeacher !== isAdmin\)[\s\S]*?applyRoute\(location\.pathname\)/, 'initial teacher sign-in repaints the current page with class-wide data');
assert.match(html, /function appRouteHref\(path\)[\s\S]*?url\.searchParams\.set\('admin', '1'\)/, 'teacher routes preserve the admin flag');
assert.match(html, /const routeHref = appRouteHref\(href\)/, 'top navigation preserves teacher mode');
assert.match(html, /navigateApp\('\/cad'\)/, 'CAD navigation preserves teacher mode');
assert.doesNotMatch(html, /history\.pushState\(\{\}, '', '\/cad'\)/, 'CAD navigation never drops teacher mode');

// The page only ever asks for class-wide work as the teacher.
assert.match(html, /if \(isAdmin && !isVideoSummary && !isInstructable\) \{/, 'Class submissions is a teacher-only section');
assert.match(html, /if \(!benchmarkId \|\| !isAdmin\) return; \/\/ class-wide counts/, 'class-wide count badges are teacher-only');
assert.equal((html.match(/watchScopedWork\('portfolios'/g) || []).length, 3, 'every student panel reads portfolios through the scoped watcher');
assert.equal((html.match(/watchScopedWork\('artifacts'/g) || []).length, 1, 'the homework gallery reads artifacts through the scoped watcher');
assert.doesNotMatch(html, /const _pfq = query\(collection\(db, 'portfolios'\), where\('benchmarkId'/, 'no panel queries the whole class directly');

console.log('T4SG security audit passed: school Google sign-in, roster stamped into page and rules, owner-only reads and writes, teacher-only class views, and no client admin secret.');
