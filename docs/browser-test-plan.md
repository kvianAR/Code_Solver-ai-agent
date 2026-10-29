# Browser verification

Automated regression tests cover the runner, pairing protocol, account isolation, budgets, restart recovery, and offline behavior with mocked browser/provider responses. They do not certify a real Chrome installation.

After loading or reloading `extension/` from this checkout, use **Check this browser** in the extension dashboard. Its report separately records pass, fail, and manual checks. It never generates a solution or submits to LeetCode.

| Scenario | Procedure | Required observation |
|---|---|---|
| Fresh install | Start the local app, load its `extension/` folder in a fresh browser profile | Auto pairing succeeds without a pasted token; authenticated server and version checks pass |
| Server starts later | Load the extension while the server is off, then start the app | The next minute poll or Connect automatically recovers |
| Browser restart | Record the connection, restart Chrome, run the browser check again | Connection is preserved and authenticated; account session is rechecked |
| Account change | Switch the signed-in LeetCode account between manual sessions | New history belongs to the new account; an in-progress run cannot submit on the wrong account |
| Offline recovery | While idle, briefly disconnect the network and reconnect | A network failure is not presented as a logout; practice waits for verified login |
| Interrupted submission | In an owned test environment, restart the worker after a submission ID is saved | The saved result is polled; generation and submission are not duplicated |
| Learning | Open a question and use Learn with hints in the popup | Hint, approach, code review and solution are separate explicit provider requests; none submits code |
| Review mode | Enable draft review and run one manual practice question | Examples and supplied boundary inputs are checked; no judged submission is sent |
| Backup | Export then inspect a backup | No provider keys, connection token, pairing key or cookies are present |
| Update | Check a trusted local release ZIP before installing | Invalid or incompatible archives are rejected; a restore point exists before replacement |

The automation available in this chat cannot open `chrome-extension://` pages. Real-profile checks remain pending until the user runs them in Chrome. Do not mark them passed based on unit tests, the localhost web dashboard, or a simulated browser context.

## 3.2 recovery and insights checks

- Close Chrome after a partial accepted daily run; reopen after the scheduled time. Check a fresh login verification, retained accepted tasks, QOTD first and no duplicate submissions.
- Wake the Mac after a missed due time with no LeetCode tabs. Confirm login is checked immediately and a temporary tab closes after the run.
- Stop a run explicitly, then reconnect or reload a LeetCode page. Confirm it stays stopped until explicit Retry today.
- With an unknown prior judge result, try the same question manually and automatically. Confirm generation/submission is blocked until result recovery succeeds. A missing submission ID must remain a visible blocker.
- Near local midnight, verify one alert per account at each 60/15-minute threshold, including offline reasons. Completed allotments must not alert. Browser-closed notification delivery remains unverified until tested.
- Check health with stale heartbeat, signed-out login and provider cooldown. Reconnect must keep the selected project/account boundaries.
- Import a recorded mistake; answer a revision quiz, reveal the saved lesson and reload. Confirm daily first-answer scoring and next review date, with no change to daily acceptances.
- Compare pasted code. Confirm optional budget and contest rules apply, and no judge submission occurs.
- Load reports for two accounts. Confirm separate data, unknown-day labels and independent/assisted scoring.
- Prepare an invalid ZIP in a disposable checkout. Confirm syntax/assets failure precedes code replacement. Simulate a failed installed copy/startup check and verify automatic rollback status.

## 3.3 attempt policy checks

- A 429 before submission must show waiting, preserve the draft, leave following questions queued, and consume neither a failed approach nor a skip.
- Reject three different recorded approaches. Confirm exactly one skip and an untouched random Easy replacement. Repeat until the third skipped question: confirm notification, popup attention state and no fourth question/replacement attempt.
- Restart, archive, explicitly Stop, restore or Retry today. Confirm same-account/day skip and approach history persists and current accepted count is retained. Other accounts/dates remain separate.
- Mark the daily question already accepted on LeetCode before discovery. With target two, confirm two other questions are newly accepted and no extra QOTD submission occurs.
- With fewer than three failed approaches and a service interruption, confirm the unfinished question is rediscovered before unrelated random work.
- Repeat an algorithm label or identical code. Confirm it is not counted as a new failed approach and never duplicates an earlier submission.
- Stop while a saved submission ID is pending. Confirm judge-result recovery updates history while Stop still prevents new generation/submission.

## 3.3.1 transport recovery

- With a mocked 429 and Retry-After, confirm a persisted browser-wide cooldown, the exact retry alarm, no requests from other tabs before expiry, and fresh login verification when the retry becomes due.
- Pause a Run Code result response with 429. Restart the worker/tab, then recover the same test run ID without repeating the interpret POST. Repeat during optional boundary checks; official examples must not be rerun.
- Change account/code/problem/inputs or expire the checkpoint. Confirm it is rejected and fresh checks run.
- Verify explicit submit HTTP 429 does not create an unknown judged result or consume a judged slot. A dropped response after a POST remains unknown and must never replay automatically.
- Close a message port mid-submission. Confirm only one send; a genuinely missing receiving bridge may be injected before a fresh operation.
- Repeatedly return the same AI algorithm for a non-QOTD question. Confirm three preparation failures permit Easy replacement, record the actual reason, and do not reset the daily three-skip limit.
- Confirm the QOTD selection note spans the task grid, cached-draft reuse is labelled, and the popup gives the retry time.

## 3.3.2 live provider and installed-version checks

- Return malformed solution JSON from the first provider and a temporary outage from the backup. Confirm each unusable preparation is counted. After three, a non-QOTD question can be replaced with untouched Easy; QOTD remains required and notifies for repair.
- Confirm JSON wrappers/fences are normalized, truncated outputs are rejected, and malformed output does not disable a provider for unrelated questions.
- Confirm provider cooldown deadlines survive the server error response and reach the runner as typed retry metadata.
- Observe a heartbeat after loading this extension. Compare its installed version and freshness with the server. A different local extension folder must show a mismatch instead of implying an update succeeded.
- Use Apply installed extension update while idle. Confirm Chrome reloads, history/counters remain, and the next heartbeat reports the new version. During an active run the action must refuse to reload.
- Download the live check report and confirm it contains no keys, tokens, account names, problem statements or code.

## 3.3.3 required QOTD and typed errors

- Return a typed temporary provider error with message "Provider returned invalid JSON". Confirm automatic retry at the supplied deadline, zero preparation failures, zero skips and queued remaining work.
- Fail QOTD three times. Confirm no Easy replacement, no skipped QOTD and no completion exemption. Preserve the last concrete failure and notify for repair. Submission limits still apply.
- Reload an old run with a historical QOTD skip. Confirm that disposition does not satisfy QOTD or reset historical daily counters.

## 3.3.4 output-budget repair

- Exhaust QOTD preparation on truncated outputs at 4096 tokens. Increase the configured output limit to 16384 and explicitly retry today. Confirm a fresh preparation window while cumulative failures remain three, with unchanged submission and daily skip history.
- Retry again at the same output limit. Confirm it cannot create another preparation allowance. Never reopen the window for three genuine failed approaches or unknown submission results.
