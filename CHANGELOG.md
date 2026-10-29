# Changelog

## 3.3.3 — Preserve required QOTD and correct false skips

- Classify solution-generation failures using the server error kind before inspecting message text. Temporary and rate-limit failures now retry without consuming draft preparation or question skip allowances. Key, quota and provider request failures pause for provider repair.
- Keep genuine invalid model output eligible for the three-preparation-attempt replacement rule even when its message contains network words. Preserve daily skip history and submission limits.
- QOTD now stays required after failed approaches or unusable preparation. Never skip or replace it; notify for repair and preserve submission limits. Historical skipped-QOTD dispositions no longer count as completion exemptions. Other questions retain the three-failure Easy replacement rule.
- Add regression coverage for typed service failures, retry deadlines, queued questions, required QOTD and ordinary-question replacement.


## 3.3.2 — Provider output recovery and installed-version visibility

- Request JSON output from the direct Groq endpoint, recognize a bounded solution.code wrapper and strip code-field fences. Reject null/missing/oversized/truncated outputs explicitly as output failures instead of generic temporary outages.
- Preserve malformed-output evidence when a backup provider is unavailable. Three unusable preparation attempts can replace the stuck question with an Easy problem; a backup outage no longer hides those attempts in an indefinite retry loop.
- Keep malformed output eligible for provider fallback without cooling down the entire provider on one bad question. Bound each provider attempt to 45 seconds so fallback fits within the client's 180-second generation timeout.
- Relay typed provider failures and actual cooldown deadlines to the extension. Accept Retry-After HTTP dates and do not shorten explicit provider deadlines to five minutes.
- Add authenticated, bounded extension heartbeats recording installed version, run/stage status, accepted count, retry time and a canonical blocker. Do not persist statements, code, credentials or arbitrary error text in these reports.
- Show stale/mismatched installed extension versions in the dashboard. Add an idle-only Apply installed extension update action that reloads Chrome's installed code while retaining history, pauses and limits.
- Add a credential-free downloadable live check report for browser/version/provider diagnostics.

A live generation call verifies provider output separately from mocked judge tests. Provider availability can change; no synthetic acceptance is written to the daily allotment. Chrome must load the updated extension for heartbeat/version reporting and daily submissions to run.

## 3.3.1 — Recover rate limits without an hourly stall

- Honor Retry-After seconds and HTTP dates. Persist a browser-wide LeetCode cooldown across tabs/restarts, with one-minute exponential backoff up to 15 minutes when no deadline is provided. Never change questions to evade a server throttle.
- Arm an exact retry alarm instead of putting temporary Run Code failures into the unrelated hourly scheduler. Recheck login when that retry is due, even if the agent's temporary tab was closed.
- Pace judge reads at least three seconds apart and judge writes at least ten seconds apart. Remove a duplicate login request immediately after a verified submission and stop rapid GraphQL retries on HTTP 429.
- Persist code/account/question/input-bound preflight checkpoints for ten minutes. Resume pending Run Code polling after a cooldown, retain already-passed official examples during boundary-case recovery, and avoid reposting the same test. Validate checkpoint context before reuse.
- Keep cached drafts even after earlier rejected drafts, and label their reuse accurately rather than presenting zero new AI calls as zero work.
- Replace a stalled automatic question after three unusable/repeated draft preparation attempts. Record that reason separately from three different failed algorithms and retain the three-skips-per-account/day cap. A model repetition no longer produces an endless wait on the same question.
- Distinguish an explicit rejected submit HTTP 429 from a lost response: definitely-unsent requests do not consume judged slots; unknown submissions still block duplicates and recover their original ID.
- Do not replay a potentially-sent judged submission when a browser message port closes. Inject a missing content bridge only when there was no receiving endpoint.
- Migrate old temporary waiting labels to automatic retry with a resume time. Spread the daily selection note across both grid columns so question cards start together.
- Freeze the last valid saved interview code at expiry; a late Finish request cannot overwrite it.

No code change can force LeetCode to accept requests during a server-side rate limit or guarantee accepted solutions during outages. Tests exercise mocked network/judge responses; live installed-extension verification remains separate.

## 3.3.0 — Three-approach retries and Easy replacements

- Replace an already-accepted QOTD with the full configured count of other untouched questions; retain current-day accepted progress on retries.
- Request up to three different named algorithms and distinct drafts per unsuccessful automatic question. Persist approach outcomes across retry archives and browser restarts. Syntax/example failures and known judge rejections count; outages and unknown results do not.
- Skip only after three distinct failed approaches, then select a random untouched Easy replacement. Preserve untried questions as queued. Retain pending questions in retry discovery rather than silently abandoning them.
- Stop and notify on the third skipped question per account/local day. Preserve the cap through explicit Stop, retries, archives and restored active history. Display the cap in the popup and approach/skip history in the dashboard.
- Raise the judged-submission cap to three per question/account/local day while retaining duplicate and unknown-result safeguards.
- Show temporary preflight rate limits as waiting and migrate old untried skipped labels to queued. Rate limits keep scheduled retry behavior and never trigger a blind judged submission.
- Reconcile saved pending submission IDs after Stop without starting new work, and update the corresponding approach outcome when the judge result is recovered.
- Carry explicit QOTD replacement reasons through daily priority budgets, deadline checks, weekly reports and backups. A replacement does not fabricate an accepted QOTD.

Live Chrome and LeetCode behavior still needs verification after reloading the installed extension. Named algorithms and distinct code do not prove semantic algorithm independence. Source/package tests use mocked judges and providers.

## 3.2.0 — Recovery, revision and checked updates

- Resume missed daily work on startup, network recovery and LeetCode page loads. Merge accepted progress across same-day account archives, retaining QOTD first. Recheck login promptly after a wake gap or interrupted run.
- Warn once per account at 60 and 15 minutes before the local day ends when allotted acceptances or QOTD are pending. Show the current blocker, including a cached offline diagnosis.
- Add an extension/server/login/provider health panel with explicit reconnect and the last missed-run recovery. Checks do not spend provider generation tokens.
- Block new automatic or manual submissions while an older judge result for that account/question remains unknown, including previous dates. Reconcile recovered archived results before releasing the guard.
- Add personal mistake quizzes with due dates, saved-lesson reveals and first-answer daily scoring. Correct recalls return after three days; missed recalls return the next day.
- Compare the user's code with an alternative approach, including invariants, time/space complexity and tradeoffs. Comparison is an optional, budgeted learning call and never submits code.
- Add an account-specific seven-day report with daily/QOTD completion, separate independent and assisted practice, mistake categories and notebook quiz recall. Missing records stay unknown; historical target estimates are labelled.
- Check release syntax, local dependencies and dashboard assets before installation. Keep a private code/settings/key restore point, then require authenticated version/API/syntax service checks after restart. Restore prior code on failure and report a failed restore honestly. UI waits for completed update checks.

Daily progress and revision scores are included in credential-free backups, with validated duplicate-safe restore. Chrome must be running for browser alerts and live submissions; after midnight, recovery follows the current local day's QOTD. Explicit Stop/pause, account isolation, contest pauses, protected daily budgets and submission limits remain enforced. QOTD plus the full daily allotment still need accepted judge results.

## 3.1.1 — Compact extension popup

- Fit status, daily progress, seven-day history, schedule reason and all actions into a compact popup.
- Place Solve and Learn side by side and remove unused message space while keeping Stop and feedback visible.
- Preserve daily solving, QOTD requirements and connection behavior.

## 3.1.0 — Daily reliability and personal practice

- Check readiness shortly before scheduled daily work, including syntax, remaining budget and provider model catalogs. Check again at the due time; handle schedules around midnight.
- Protect an estimated token/cost allowance for remaining daily questions before optional learning, interview or manual calls. Allow configuring the reserve and provider cooldown.
- Recover verified unsubmitted drafts, retry pending judge-result lookups, and use provider cooldowns/fallback without consuming repeated failed calls.
- Generate problem-specific boundary test plans. Keep official examples separate; invalid generated inputs warn instead of falsely failing the solution. Valid-case failures still block submission.
- Add an account-specific mistake notebook, deduplicated history import, categories, revision notes and resolved status.
- Track self-reported independent practice separately from AI-assisted acceptances. Recorded assistance prevents an attempt being counted as independent.
- Add timed mock interviews with saved drafts, limited hints, follow-up questions and a structured feedback rubric. Enforce deadlines and hint limits on the server.
- Add optional Ollama and LM Studio support with installed-model discovery, JSON/syntax capability checks, local-first/cloud-first ordering and explicit cloud fallback.

The full configured daily allotment remains mandatory, with QOTD first and accepted judge results required for completion. Explicit Stop, account isolation, contest pauses and submission limits remain in force. Increasing the allotment retains accepted progress.

Catalog checks do not guarantee generation quota. Budget reserves are estimates; retries can need more. Practice scores are self-reported, and interview feedback does not execute or prove code correctness. Local AI is off by default, downloads no models, and can send prompts to cloud providers only when cloud fallback is enabled. Study data is included in backups; restored active interviews are cancelled.

## 3.0.1

- Preserve the standing daily allotment requirement: the full configured count, currently two, must have accepted results, including QOTD first.
- Limit draft-only review to manual work so it cannot stop automatic daily completion.
- Resume unfinished automatic review drafts and same-day increases in allotment while carrying accepted progress forward.
- Keep project requirements through code updates and rollback.

## 3.0.0

- Browser self-check with real read-only permission, pairing, version and login probes; manual restart/offline/account-switch checks remain visibly separate.
- Starter-signature checks and up to four model-suggested boundary inputs evaluated by LeetCode's checker. Generated expected outputs are not trusted.
- Learning mode with separate hint, approach, code-review and full-solution requests. Learning never submits code.
- Account-specific weak-topic recommendations and spaced revision, deduplicating archived copies and accepted carry-over tasks.
- Per-provider/session token accounting, configurable session call limits and estimated USD budgets using user-entered model prices. Unknown and legacy costs cannot silently bypass an enabled cost limit.
- Actionable failure classifications and a redacted diagnostic export.
- Portable settings/history backups, validation before restore, duplicate-safe merge and automatic pause after restore. Existing credentials and their endpoints remain unchanged.
- Checked local release ZIP installation, compatibility checks, private restore points, automatic recovery after an install failure and code rollback that preserves current runtime history and keys.

Real Chrome profile tests require the built-in browser check and the manual matrix in docs/browser-test-plan.md. Provider prices are estimates, not billing data. Changes do not prove hidden-test correctness.

## 2.9.0

- Automatic local pairing for an unpacked extension loaded from the running checkout. Manual cloud connection remains available.
- A macOS one-click server setup with checkout-specific login service, port selection, persistent startup, and a non-destructive uninstall command.
- Setup checks for the server, language syntax checker, provider status, browser session, and server/extension version agreement.
- Direct Groq by default, an explicit custom endpoint setting, and provider model discovery.
- Submission ID persistence and result recovery after a browser restart. Unknown results pause rather than duplicate a submission.
- Draft review mode with code copying and manual submission on LeetCode. Prepared drafts are never counted as accepted.
- Progress display, remaining attempt counts, and account/date/status history filters.
- Configurable retry intervals shared with the optional macOS wake helper. Temporary provider failures wait for a later retry.
- Diagnostics command, release packaging that excludes credentials and runtime data, and regression tests for pairing, recovery, review, and provider routing.

Live provider access, Chrome extension behavior, and macOS sleep/wake behavior still require verification on the intended account and browser profile. Automated tests use mocked provider and LeetCode responses.
