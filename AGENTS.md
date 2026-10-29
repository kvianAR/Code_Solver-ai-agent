# Automatic daily practice requirements

The user's standing requirement is automatic daily practice for the signed-in account and local date, even when they forget to open the dashboard.

- Complete the configured daily allotment (currently two) using actual accepted judge results. Learning/review mode applies only to manual work and cannot turn automatic daily work into drafts.
- Attempt QOTD first when it is not already accepted. If LeetCode confirms QOTD was already accepted before this daily allotment, exclude it and choose the full configured count of other untouched questions. Do not fake a new acceptance or count that prior QOTD in the new allotment.
- For an unsuccessful automatic question, request up to three genuinely different algorithm approaches and implementations. Record the declared approach and distinct code; variable renaming or repeating an approach does not count. Syntax failures, failed valid test cases and known judge rejections count as failures; service/network/rate-limit failures and unknown judge results do not.
- Never skip or replace QOTD. After three failed approaches or unusable draft preparation attempts, retain QOTD as required, notify the user and request repair. A historical QOTD skip is not an exemption.
- For other questions, skip after three different recorded approaches fail, or after three unsuccessful draft preparation attempts cannot produce a usable different draft. Record preparation failures honestly; do not call them three distinct algorithm failures. Replace it with a random untouched Easy problem and continue until the allotted accepted count is reached.
- Allow at most three skipped questions per account/local day across retries and archived runs. On the third skip, stop automatic work and notify the user; leave the target incomplete. A retry must not reset this cap.
- Never label an untried question skipped. Show it as queued when another question or a service failure holds up the run. A 429 schedules an automatic retry at Retry-After, or starts at one minute with exponential backoff when that header is absent. Persist the cooldown across tabs/restarts, pace judge requests, and resume a saved test result rather than resending Run Code. Never evade rate limits or skip validation. Do not leave the daily run in indefinite waiting or an unrelated hourly retry.
- Keep an unknown submission result blocked until recovered, without duplicate submissions. Allow at most three judged submissions per question/account/local day.
- Retain already accepted progress and approach/skip history when retrying, restarting, moving the schedule or increasing the allotment.
- Preserve explicit Stop/pause controls, account isolation, contest pauses, budgets and result recovery. Report blockers honestly; never promise acceptance regardless of service availability.
- Keep regression tests for these requirements when changing discovery, scheduling, testing, review, submission or recovery.

- Keep daily selection notes across the full task grid width. Show cached-draft reuse accurately, including when no new AI call was needed.
