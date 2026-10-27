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
| Review mode | Enable draft review and run one practice question | Examples and supplied boundary inputs are checked; no judged submission is sent |
| Backup | Export then inspect a backup | No provider keys, connection token, pairing key or cookies are present |
| Update | Check a trusted local release ZIP before installing | Invalid or incompatible archives are rejected; a restore point exists before replacement |

The automation available in this chat cannot open `chrome-extension://` pages. Real-profile checks remain pending until the user runs them in Chrome. Do not mark them passed based on unit tests, the localhost web dashboard, or a simulated browser context.
