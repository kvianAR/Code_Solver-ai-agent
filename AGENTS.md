# Automatic daily practice requirements

The user's standing requirement is automatic daily practice for the signed-in account and local date, even when they forget to open the dashboard.

- Complete the configured daily allotment (currently two) using actual accepted judge results. Learning/review mode applies only to manual work and cannot turn automatic daily work into drafts.
- Attempt QOTD first when it is not already accepted. If LeetCode confirms QOTD was already accepted before this daily allotment, exclude it and choose the full configured count of other untouched questions. Do not fake a new acceptance or count that prior QOTD in the new allotment.
- For an unsuccessful automatic question, request up to three genuinely different algorithm approaches and implementations. Record the declared approach and distinct code; variable renaming or repeating an approach does not count. Syntax failures, failed valid test cases and known judge rejections count as failures; service/network/rate-limit failures and unknown judge results do not.
- Skip a question only after three different recorded approaches fail. Replace it with a random untouched Easy problem and continue until the allotted accepted count is reached.
- Allow at most three skipped questions per account/local day across retries and archived runs. On the third skip, stop automatic work and notify the user; leave the target incomplete. A retry must not reset this cap.
- Never label an untried question skipped. Show it as queued when another question or a service failure holds up the run. A 429 waits for a scheduled retry; do not evade service rate limits.
- Keep an unknown submission result blocked until recovered, without duplicate submissions. Allow at most three judged submissions per question/account/local day.
- Retain already accepted progress and approach/skip history when retrying, restarting, moving the schedule or increasing the allotment.
- Preserve explicit Stop/pause controls, account isolation, contest pauses, budgets and result recovery. Report blockers honestly; never promise acceptance regardless of service availability.
- Keep regression tests for these requirements when changing discovery, scheduling, testing, review, submission or recovery.
