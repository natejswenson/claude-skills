# Proposed field policy

Status: proposed validation contract, not an existing registry. Only these fields are
candidates for the enabled designs. Additional keys need a reviewed schema change. No
field is automatically captured and no allowed field is automatically safe to publish.

| Owner/consumer | Key | Proposed value constraint | Subject and authority |
|---|---|---|---|
| Ghostwriter | writing.hashtags | Explicit preference text, 1–512 UTF-8 bytes | Registered writing owner subject; current voice source wins; legacy key already exists |
| Ghostwriter X | writing-x.hashtags | Explicit preference text, 1–512 bytes | Separate X owner subject; new vocabulary, no implicit LinkedIn sharing |
| Devlog | devlog.audience | User-stated audience description, 1–256 bytes | Selected skill or project subject; exclude personal names/private organizations |
| Devlog | devlog.explanation-depth | brief, standard or detailed | Selected skill or project subject; does not override the skill's required post structure |
| Issuecreator | issue.acceptance-style | Explicit presentation preference, 1–256 bytes | Registered target repository subject; templates and testable criteria prevail |
| Issuecreator/Issueflow | project.design-rationale | One confirmed decision with rationale, body at most 2 KiB | Registered target repository; dependency identities/digests required; no raw source dump |
| Issueflow | project.known-constraint | One verified constraint, body at most 1 KiB | Registered target repository; source dependencies and review date required |
| Ghfactory | workflow.design-rationale | One confirmed workflow decision, at most 1 KiB | Registered target repository; never action SHAs, check status, secrets or authority |
| Bible-study | study.handout-format | Description of supported formatting, 1–128 bytes | Explicit skill subject; cannot override one-page delivery or infer beliefs |
| Bible-study | study.duration-minutes | Integer 5–240 | Explicit skill subject; user-selected duration, not participant history |
| City-report | city-report.layout | Supported presentation description, 1–128 bytes | Explicit skill subject; unsupported layouts require separate renderer work |
| City-report | city-report.metric-order | At most 22 unique identifiers from the current supported metric registry | Explicit skill subject; cannot suppress required metrics or change definitions |
| Résumé | resume.presentation-format | Supported format preference, 1–128 bytes | Explicit skill subject; no qualifications or source résumé content |
| Résumé | resume.explanation-depth | brief, standard or detailed | Explicit skill subject; does not change résumé factual validation |
| Shipreport | shipreport.audience | Non-identifying description, 1–256 bytes | Explicit skill or project subject; current report evidence still required |
| Shipreport | shipreport.emphasis | Non-identifying presentation preference, 1–256 bytes | Explicit skill or project subject; deterministic counts unchanged |
| Skillfactory | skill-design.interaction-style | Explicit ergonomics preference, 1–256 bytes | Explicit skill subject; cannot remove approval or verification gates |
| Skillfactory | skill-design.output-format | Supported format description, 1–128 bytes | Explicit skill subject; current spec/conformance contract prevails |

Devlog may additionally **read** writing.hashtags only through an explicit sharing binding
to the actual selected voice owner and current source revision. Do not give it owner write
access. Neither X nor Devlog is a currently implemented legacy adapter identity. Independent
Devlog keys and voice-owner keys use different capture paths.

The proposed limits are product decisions for implementation, not existing skill validation
limits. Validate UTF-8 bytes after normalization; reject invalid types, unknown keys and
oversized values. Enums do not authorize source/config mutation. Body, metadata and provenance
together must fit the selected-context projection; never truncate away qualifications,
supersedes links or conflict markers. Avoid secret-bearing source URLs and user paths in
metadata. Natural-language sensitivity requires review in addition to deterministic checks.

Scope is resolved before lookup; never search all subjects then filter only the displayed
results. Register exact cross-skill readers separately. No deferred skill has a field allowlist.
Local preferences may influence style without being quoted; automatically exposing the stored
record, rationale, identity or source is prohibited. Publication authorization follows the
existing skill and current user request; this design does not add a redundant approval ritual.
