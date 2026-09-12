# Issue input and writing contract

The helper takes a JSON object. All fields below are required unless marked optional.
Use plain strings; preserve Markdown code blocks and newlines inside strings.
Bug-only fields (`reproduction`, `expected`, `actual`, `environment`) are rejected
for other kinds; put relevant non-bug evidence in `context`.
Unknown keys are rejected to catch misspelled requirements rather than dropping them.

| Field | Type | Content |
|---|---|---|
| `title` | string | Specific action and affected behavior; one line, at most 256 characters. |
| `kind` | enum | `feature`, `bug`, or `maintenance`; metadata, not an automatic label. |
| `problem` | string | Current problem, trigger and practical impact. |
| `desiredBehavior` | string | Observable result after the change. |
| `scope` | nonempty string array | Bounded work required for that result. |
| `outOfScope` | string array | Useful boundaries; empty if none are needed. |
| `context` | nonempty string array | Verified paths/symbols, relevant constraints and sources. If inaccessible, explicitly describe that limitation; never manufacture evidence. |
| `acceptanceCriteria` | nonempty string array | Outcome checks, without checkbox prefixes. |
| `verification` | nonempty string array | Test/reproduction instructions and expected result; distinguish proposed commands from commands actually run. |
| `dependencies` | string array | Verified issue URLs and ordering; empty when none known. |
| `openQuestions` | string array | Blocking unknowns; must be empty before render/create. |
| `reproduction` | string | Required for bugs: smallest known reproduction, or precise limits of available evidence. |
| `expected`, `actual` | strings | Required for bugs: concrete contrast. |
| `environment` | string | Required for bugs: known version/runtime and relevant unknown details. |
| `implementationNotes` | optional string | Evidence-backed suggestions, explicitly nonbinding. |
| `templateBody` | optional string | Filled repository-specific template, prepended verbatim. |

Do not pad issues with empty sections or ceremonial prose. A small change may need
only one acceptance criterion and one verification step. Include failure and
compatibility cases when they are material. Avoid “works correctly”, “add tests”,
or a list of implementation tasks as the entire definition of success. Prefer:
“An empty selection returns the existing empty-state view without sending a request.”
Then name how to observe it.

For bugs, include reproduction inputs, expected/actual output and frequency when
known. If only a report exists, attribute it and identify what remains unverified.
For features, describe the user-facing behavior and relevant boundary cases. For
maintenance, identify the invariant preserved and how verification will detect drift.

Paths and commands are evidence only after inspection. Use commit-pinned links
when available and useful; don't claim working-tree changes exist on the remote.
A command in `verification` is a plan unless an observed result explicitly says
otherwise. Never copy credentials, private logs or unrelated personal data into issues.

Example minimal structure (replace the example facts with researched content):

```json
{
  "title": "Show an empty state when no repositories are selected",
  "kind": "feature",
  "problem": "The repository picker currently allows an empty selection, but submitting it produces a generic error.",
  "desiredBehavior": "An empty selection displays a helpful empty state without a request.",
  "scope": ["Handle the empty selection in the repository picker."],
  "outOfScope": ["Changing repository permissions."],
  "context": ["Use the repository picker implementation and its existing tests; record inspected paths before publishing."],
  "acceptanceCriteria": ["Submitting an empty selection displays the empty state and makes no network request."],
  "verification": ["Exercise an empty selection and inspect the network calls; expect zero requests."],
  "dependencies": [],
  "openQuestions": []
}
```
