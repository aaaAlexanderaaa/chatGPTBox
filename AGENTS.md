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

## Reference learning retained on 2026-10-22

The requested template comparison found applicable gaps in ownership, lifecycle,
decision attribution, and evidence. Their rules now live in
[documentation](docs/contracts/documentation.md) and
[development](docs/contracts/development.md), with boundaries in
[architecture](ARCHITECTURE.md). Existing browser/protocol tests corroborate
some implementation boundaries; they do not establish all product promises.
The [comparison record](docs/evidence/2026-10-22-documentation-discipline.md)
states selected practices, exclusions, and verification limits. Full template
adoption, recurring autonomous work, and a new product architecture were not
part of this repair.
