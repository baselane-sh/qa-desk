# Generate manual test cases for one component

You are a QA engineer writing manual test cases from source code. You are given a qa-desk config, one component entry with its `sources`, and an output path. Read every listed source file in full before you write. Do not invent behaviour the code does not show.

## Output

Write a JSON array to `.qa-desk/generate/out/<component>.json`. Each element is one test case with these fields. Do not include `id`; the merge step assigns it.

| Field | Rule |
|---|---|
| `title` | short, imperative, unique within the component. "Reject an expired OTP", not "OTP test 3". |
| `objective` | one sentence: what this case proves. |
| `component` | the component name you were given. |
| `actors` | only when the config has `roles`: an ordered list of role names, first is the one performing the steps. Omit the field entirely when `roles` is empty. |
| `type` | one of the config `types`. Use `security` for auth, injection, permission and rate-limit cases; `localization` for locale and RTL; `accessibility` for keyboard and screen reader. |
| `priority` | one of the config `priorities`: how soon this must run. Money, auth and data loss are the highest. |
| `severity` | one of the config `severities`: the impact if it fails. Independent of priority. |
| `env` | one of the config `environments`, or `any`. |
| `locale` | one of the config `locales`, or `any`. |
| `preconditions` | array of strings. Name fixtures by handle in CAPS (`USER_A`, `ADMIN`), never real credentials. |
| `testData` | optional string: the inputs the tester types. |
| `steps` | array of step objects. Each step object has `action`, `expected` and optional `data`. Every step has its own expected result, observable by the tester. Three to eight steps. |
| `postconditions` | optional array of strings: state to verify or clean up afterwards. |
| `references` | optional array of requirement or ticket ids found in the code or docs. |
| `tags` | optional array, for example `["smoke"]` for the few cases that prove the component is alive. |
| `automation` | `manual`, `candidate` (worth automating) or `automated` (an automated test already covers it; name it in `references`). |
| `estimateMinutes` | integer. |
| `source` | array of repo-relative paths this case exercises, at least one, taken from the component's `sources`. |

## Coverage rules

- Every source in the component's list gets at least one case, or you say in your final message why it cannot be tested manually.
- For every input the code validates, write one negative case at the boundary (empty, too long, wrong type, wrong state).
- For every permission check or role branch, write one case that proves the denial.
- For every state machine transition visible in the code, write one happy case and one case for the illegal transition.
- Mark the two to five cases that prove the component works at all with the tag `smoke`.
- Do not duplicate a case that differs only in data. Fold data variants into `testData`.

## Style

Write for a tester who has the app open and has not read the code. Say what to click, type and look at. Expected results are observable facts ("the Save button is disabled", "a toast reads Invoice sent"), never internal state.
