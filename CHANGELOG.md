# Changelog

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
