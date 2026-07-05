# D4SG @ SA — Semester Audit

## Verdict

The app is pedagogically and structurally excellent — the infra-vs-compiler error split, per-slot upload retry, claim-ownership identity, and the benchmark format are genuinely well-engineered for a classroom — and the Spark aesthetic holds at the core (real token system, one icon family, shake fixes intact). But it is **not safe to coast on**: two confirmed criticals (any anonymous visitor can permanently wipe all student work with no backup to restore from; the AI endpoint lets a stranger burn hundreds of dollars a day of your personal OpenAI money), four highs that will bite on a normal class day, and the AI & ML twin's core submission flow is verifiably broken right now (live-tested: `portfolios` writes are PERMISSION_DENIED). Premium at the center, soft at the edges.

## Fix before next class

Ordered by risk × effort. Line numbers cite `index.html` unless noted.

1. **[CRITICAL] Cap AI endpoint input + gate the origin** — `api/vibe-code.js:137` accepts unbounded `prompt`; history is sliced by count only, so one request can carry ~120k input tokens (~$0.36 each). The 1000/day per-IP limit is a per-instance in-memory Map (resets on cold start, fans out across instances) and CORS is `*` — the file's "gates by class code" comment (line 2) is fiction; no gate exists. Fix (small): reject prompt > 4,000 chars, truncate history messages to 8,000 chars, add an Origin/Referer allowlist + a non-secret `X-D4SG-Class` header, set a hard monthly spend cap on the OpenAI account.
2. **[CRITICAL] Kill anonymous deletes and get a real backup** — every collection allows `delete: if true` (firestore.rules:14,30,56,71,82,95) and Storage's null-write rule permits `deleteObject` (storage.rules:10,25,45); your own `scripts/purge-by-name.mjs` proves the public web SDK can enumerate and wipe everything. There is **no recovery path**: Archive itself deletes Storage blobs (13568) and restore returns "(file unavailable)" (13815). Fix (medium): flip deletes (and the `portfolios` update rule at firestore.rules:34, which lets anyone silently blank a classmate's graded slots) to `if false`, route admin deletes through a small Admin-SDK serverless endpoint, enable a scheduled daily Firestore export, switch Storage deletes to a `trash/` prefix, and add Firebase App Check.
3. **[HIGH] Failed compile bricks the Upload button** — `vibeUploadToArduino` disables the button at 15266; the compile-failure early returns (15278, 15286) never re-enable it (`btn.disabled = false` lives only in the unreachable flash `finally` at 15312). Compile errors are the normal case; on a Fly cold-start day the whole room stalls until someone reloads. Fix: re-enable + strip `is-active` on the early-return paths. One line per path.
4. **[HIGH] Portfolio Drop retry/resubmit splits the 60-pt portfolio across docs** — `addDoc` at 12080 mints a new doc per submit; the retry path nulls succeeded slots and addDocs again. Student view last-wins arbitrarily (12227), admin gallery double-counts (13044). The fix already exists in-file: the Instructable's deterministic-id `setDoc(..., {merge:true})` at 12790. Apply the same to the checkpoint path (12579) while you're there.
5. **[HIGH] Multi-photo evidence is invisible** — submits write `slots.images`/`slots.cads` (12584-12591) but nothing ever reads them; SLOT_DEFS (11386) renders only `image`/`cad` (first item). Since nearly every checkpoint demands schematic PNG + circuit photo, essentially every complete submission renders as missing evidence. Fix: render a thumbnail strip when `images[]`/`cads[]` exist, falling back to the single field.
6. **[HIGH] Progress page publicly ranks named minors** — descending "leaderboard order" (10466), #1-#3 medals and podium shading (10489-10497), numbered empty pips for every gap, on a public URL. Directly violates your standing dignity rule. Fix (~15 lines in `renderProgressTable`): own card first, everyone else alphabetical, drop rank/medals.
7. **[HIGH] Neuter the archived CAD endpoint** — the tool has no route since May 28, but `api/cad-code.js` still deploys, spends OpenAI money, CORS `*`, hardcoded 30/day per-IP. Return 410 before touching OpenAI and drop the dead `/tools/cad` rewrites (vercel.json:19-20). If the tool ever returns, fix the cap (30/day for a whole shared NAT IP is a mid-period hard stop) with per-student keys + env override, mirroring compile.js.

## Money & abuse reality

Your OpenAI perimeter is the only place real money leaks. Worst case today: a scripted stranger hitting `vibe-code.js` can burn **$360+/day from a single IP** (128k-token requests at max cap), effectively unbounded with concurrency or IP rotation, because the rate limit is per-warm-instance memory and there is no origin gating of any kind. `cad-code.js` is a second, forgotten door to the same key. `preview.js` is a rate-limit-free open fetch proxy that could exhaust your Vercel quota and take **compile** down with it — give it the same daily bucket and a private-IP/size cap. Compile and Firebase are flat-or-pennies cost; the $5 Firebase alert is fine as-is once App Check and a drafts lifecycle rule (auto-delete `drafts/` objects > 60 days) are on. Cheapest full guard set: input caps + origin allowlist + class header + shared-store counters + **hard OpenAI spend limit**. Also swap the stale `gpt-4o` fallback (vibe-code.js:158) for a mini-tier model and tighten the over-broad "contains 'model'" fallback trigger.

One refutation worth knowing: do **not** add a runtime Wokwi fallback for Fly outages — live testing showed Wokwi silently builds Uno (atmega328p) hexes regardless of board, which would flash "successfully" onto Leonardos and run garbage. The current honest outage message is the right behavior.

## Premium polish

- **Icons/glyphs:** emoji fallbacks (🔗 10991, 📄 13430, 📦 13451, ⚠) appear exactly in degraded states — swap for the existing `LINK_ICON` constants + stroked Lucide siblings; redraw the filled `ICON_WIRING` bolt (7556) as a stroked zap; replace ✎/▶/✦ glyph buttons; fix three ASCII `...` → `…`.
- **Color discipline:** add `--danger`/`--danger-deep`/`--warning` tokens — error red has drifted to three hexes, done-green to two; replace the blue-500 `rgba(59,130,246,…)` glows under indigo elements (2189, 2712, 4347).
- **UX guardrails:** render the 3 reflection questions as a visible list, not a vanishing placeholder (12271); add a "N of 7 slots filled" confirm before partial portfolio submits (11970); message HEIC/oversized rejects in the checkpoint drop instead of silent `continue` (12399); route three student-facing `alert()`s through the existing `schemToast`.
- **Stability nets:** static "Loading… check wifi" fallback inside `<main>` for gstatic import failure (silent blank page today); delete the dead synchronous Konva `<head>` script (6785); a 10-line `window.onerror`/`unhandledrejection` handler; Promise.race timeout on text-only `addDoc` submits; fix the schematic keydown handler leak (stale Backspace can silently delete saved schematic work, 8807); branch AI-chat 429/5xx errors to "Verify and Upload still work."
- **Repo hygiene:** gitignore + `git rm --cached` the 10,123 committed `scripts/node_modules` files and `.DS_Store`.
- **Nice-to-have:** GET health handler on compile.js + mount-time ping on /tools (doubles as a Fly pre-warm — a cold start currently costs the first student ~1 minute each period).

## Twin port checklist (AI & ML)

- [ ] **Rules first — the twin is broken today.** Live-verified: `portfolios` and `archives` are PERMISSION_DENIED on ai-ml-class-2026; its own Portfolio Drop code (twin index.html:3968, 4184, 4735) writes to collections its deployed rules never matched. Port D4SG's *hardened* rules, commit them, test one submit end-to-end before next term.
- [ ] SPA router + nav interception, stale-tab ETag banner, `?b=` deep links
- [ ] Students roster + drafts autosave + Jump-to-student
- [ ] Card-movement/modal-shake fixes, slot-icon refresh, safe delete, lightbox sizing
- [ ] Every fix from "Fix before next class" above (Upload-button re-enable, deterministic-id submits, images[] render, leaderboard removal)
- [ ] Decide: does AI & ML get Tools/Vibe/Exhibit? If yes, copy `vibe-code.js`/`compile.js` + env vars and extend vercel.json rewrites
- [ ] Skip D4SG-specific curriculum; recommit with a dated sync message (239 commits behind since May 1)

## Grades

| Dimension | Grade | Why |
|---|---|---|
| Data integrity | **D** | Anyone can irreversibly delete a semester of minors' work; no backup exists. |
| API spend & abuse | **C-** | Thoughtful classroom limits wrapped around an unmetered public door to your personal OpenAI key. |
| Client stability | **B+** | Genuinely robust upload/flash flows, but the most common event in class bricks the Upload button. |
| Pedagogy & flow | **B** | Benchmark content is excellent; the leaderboard and condition-first persona labels undercut its own dignity standard. |
| Aesthetics & CSS | **A-** | Strong token core and one icon family; drift only at the degraded-state edges. |
| Class-day resilience | **B** | Best-in-class compile error handling; unguarded boot path and no compile health surface. |
| Twin drift | **D** | Twin's core submit flow is dead against its own rules and it's 239 commits behind. |