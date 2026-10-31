# Working on ChatGPTBox

ChatGPTBox is a browser extension with page functions, multiple AI connections,
and optional local API/MCP processes. It is an existing product, not the
engineering-discipline template. The local harness executes its own tools;
the extension's page actions and external client interfaces are separate.

## Establish the task context

Start from the user's requested outcome and the [documentation map](docs/README.md).
Read the applicable product/interface owner, the relevant
[architecture boundary](ARCHITECTURE.md), current code, and completion evidence.
Read history only for a specific provenance, conflict, or recovery question.
Old branch instructions and unchecked plan tasks do not select today's work.

[Development discipline](docs/contracts/development.md) owns investigation,
decision authority, implementation, verification, and closure. Continue the
authorized outcome through necessary corrections. Ordinary reversible choices
inside that scope do not require repeated user approval. Do not expand the
assignment into unrelated product or release work.

## Use the repository's current paths

- [Contributing](CONTRIBUTING.md) owns the supported Node version, setup, commands,
  build outputs, browser testing, and pre-commit behavior. Read it before running
  project checks; `package.json` and CI are the executable sources.
- [Product definition](docs/product/definition.md) routes to the accepted browser
  assistant direction and [product contracts](docs/product/contracts.md).
- [SettingsCenter](src/options/SettingsCenter.jsx) owns the current settings
  navigation. Use actual UI labels, including `Functions`; do not reuse the
  retired five-tab settings map.
- [API server](docs/api-server.md), [MCP server](docs/mcp-server.md), and
  [Drafts](docs/drafts/README.md) own their interfaces and operator procedures.
- For ChatGPT Web compatibility changes, use the repository
  [adaptation skill](.agents/skills/chatgpt-web-adapt/SKILL.md).

## Maintain documents at their owners

[Documentation discipline](docs/contracts/documentation.md) owns lifecycle,
metadata, source attribution, relationships, and evidence limits. Update the
existing owner instead of adding another summary or permanent rule to a plan.
Use a standalone plan only when the change needs one. At closure reconcile
guides, finish applicable plan states, and run `npm run docs:check` for docs.
Checker changes also run `npm run docs:test`.

Explain the project in plain language. When request flow matters, name the
originating page, forwarding code, and destination HTTP API. Report what was
actually verified and what remains unknown; do not call an old test count or
same-context review fresh independent evidence.

## Discipline comparison retained on 2026-10-29

The complete current template learning set was read before applicability was
judged. The [comparison record](docs/evidence/2026-10-29-discipline-refresh.md)
contains the source identity, local facts, rule results, and verification limits.
The earlier [October 22 repair](docs/evidence/2026-10-22-documentation-discipline.md)
remains dated evidence.

| Rule and result | Current owner |
| --- | --- |
| Outcome, authority, lifecycle, and source attribution: existing coverage retained; named endings and reader needs clarified | [Development](docs/contracts/development.md#start-from-the-requested-outcome), [documentation](docs/contracts/documentation.md#sources-language-and-conflicts) |
| Read and understand before selecting rules: the missing broad-comparison route is added; ordinary tasks keep conditional reading | [Rule comparison](docs/contracts/documentation.md#read-rules-before-judging-their-fit) |
| Inquiry, access fallback, and reusable experience: existing partial coverage strengthened with conditions and retrieval | [Investigation](docs/contracts/development.md#investigate-the-decisive-uncertainty), [experience](docs/contracts/development.md#retain-experience-where-matching-work-begins) |
| Domain boundaries, risk, operation frequency/freshness, and resource use: missing detail added for matching work | [Concerns](docs/contracts/development.md#apply-the-concerns-the-change-actually-touches), [execution depth](docs/contracts/development.md#choose-execution-depth-by-consequences), [account use](docs/contracts/development.md#bound-repeated-work-and-account-use), [verification](docs/contracts/development.md#verify-promises-and-effects) |
| Template carriers and standing autonomy: not adopted by this bounded discipline update; the project retains its Node checker and per-task authorization | [Comparison dispositions](docs/evidence/2026-10-29-discipline-refresh.md#carriers-drafts-and-standing-operation) |

These are incorporated rules, not evidence of later agent reuse, product
acceptance, or a completed release.
