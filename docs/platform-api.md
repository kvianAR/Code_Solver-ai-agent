# Owned test platform API

## Connect your own question/contest API

Choose **My test platform API**, enter its base URL, and optionally save its bearer key. The adapter calls:

| Endpoint | Response or purpose |
|---|---|
| `GET /problems` | Array of problem objects in roadmap order |
| `GET /daily?date=YYYY-MM-DD` | A problem object, or `null` if unavailable |
| `GET /contests` | Array of contest objects with ISO start/end timestamps |
| `POST /submissions` | Run your platform judge and return a final result |

Problem:

```json
{
  "id":"two-sum", "title":"Two Sum", "difficulty":"Easy", "topic":"Arrays", "order":0,
  "statement":"Return the pair of indices whose values sum to target.",
  "examples":[{"input":{"nums":[2,7],"target":9},"output":[0,1]}]
}
```

The model emits `solve(data)` for Python or JavaScript, returning a JSON-serializable result. Your platform can adapt that protocol to its judge.

Contest:

```json
{"id":"benchmark-1","name":"Weekly benchmark","startAt":"2026-10-04T04:30:00Z","endAt":"2026-10-04T06:00:00Z","problemIds":["two-sum","valid-anagram"]}
```

Submission request:

```json
{"problemId":"two-sum","code":"def solve(data): ...","language":"python","idempotencyKey":"daily:2026-09-29:two-sum"}
```

Submission response:

```json
{"accepted":true,"feedback":"Passed all tests","submissionId":"s-123"}
```

Return a final `accepted: false` with useful feedback for rejected code. Pending/unknown results do not count as completed. Cache successful submissions by idempotencyKey; allow corrected code after a rejection. The adapter will resend the same key after restarts to recover from uncertain network results. Private expected values should remain inside your judge; public examples can be included in problem objects.

