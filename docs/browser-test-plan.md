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
