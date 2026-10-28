# Changelog

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
