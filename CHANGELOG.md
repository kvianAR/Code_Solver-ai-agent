# Changelog

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
