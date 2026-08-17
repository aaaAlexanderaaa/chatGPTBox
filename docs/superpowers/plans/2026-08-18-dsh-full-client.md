# DeepSeek Harness Full Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native Preact client in `dsh.html` that page-parity-replaces DSH Web so the user never opens `:3080`.

**Architecture:** Expand the existing gateway RPC table and host-frame handling. Put all new UI behind shell / pages / chrome / adapter. Pure view-models are tested first; JSX only consumes those models. No iframe, no official React tree, no new npm dependencies.

**Tech Stack:** Existing extension (MV3, vitest, Preact, webextension-polyfill). Harness protocol from `tmp/deepseek-harness/packages/host/apiproxy`.

**Spec:** `docs/superpowers/specs/2026-08-18-dsh-full-client-design.md`

## Global Constraints

- Local `dsh` remains the engine. The extension never executes tools, never iframes `:3080`, never adds npm deps to vendor the official client.
- Endpoint stays loopback-only. Privileged RPCs ride the existing DNR fence. Default `dshModuleEnabled: false`.
- User-visible copy never contains `cockpit`, `Cockpit`, `console` (as a product name), `驾驶舱`. Internal identifiers may keep `cockpitUrlForSession` until a later rename; do not add new user-facing cockpit strings.
- Agent presets come from `agentPreset.list` (`id` + `name` + `description`). Do not hard-code 标准/PTC/极简/创造.
- `session.create` must send `workspaceId` and, when the roster is non-empty, `agentPreset`. No bare create.
- Float/popup stay conversation + approval cards. They must not import `src/modules/dsh/ui/pages/`.
- Automated tests never launch real `dsh web` and never open a real OS directory picker. Fake RPC only.
- Work in an isolated worktree on `feat/dsh-full-client` (create it at execution time via using-git-worktrees). Commit after each task. Do not `--no-verify`.
- Tasks are reviewable units of one complete client, not a product-facing “ship half”.

## File map

| File | Responsibility |
| --- | --- |
| `src/modules/dsh/ui/models/sidebar-model.mjs` | Workspace grouping, archive hide, subagent hide, `canCompose` |
| `src/modules/dsh/ui/models/preset-model.mjs` | Picker options, lock, label |
| `src/modules/dsh/ui/models/settings-write.mjs` | Mutate payload + conflict detect |
| `src/modules/dsh/ui/models/schema-fields.mjs` | `settings.describe` → field list |
| `src/modules/dsh/ui/pages/registry.mjs` | `registerPage` / `listPages` |
| `src/modules/dsh/background/gateway.mjs` | Passthrough RPC + `session.create` args + workspace broadcast |
| `src/modules/dsh/ui/adapter/useGatewayPort.js` | Port + workspaces + rpc (moved from `ui/useGatewayPort.js`) |
| `src/modules/dsh/ui/chrome/*` | Presentational controls |
| `src/modules/dsh/ui/shell/*` | Header / slots / narrow layout |
| `src/modules/dsh/ui/pages/*` | Conversation, settings, jobs, skills, subagents, plan, workflow, trajectory |
| `src/modules/dsh/ui/app.jsx` | Mount; replaces `Cockpit.jsx` |
| `src/modules/dsh/ui/tokens.css` | Replaces `dsh.css` branding |
| `src/_locales/{en,zh-hans}/main.json` | Harness copy |
| `docs/product/*` | D-23 and IA rewrite |

---

### Task 1: User-facing copy — drop 驾驶舱 / cockpit

**Files:**
- Modify: `src/_locales/en/main.json`
- Modify: `src/_locales/zh-hans/main.json`
- Modify: `src/modules/dsh/ui/SettingsCard.jsx`
- Modify: `src/components/ConversationCard/index.jsx` (the `t('Open cockpit')` label only)
- Modify: `src/popup/ChatPanel.jsx` (the two `t('…cockpit…')` labels only)
- Modify: `tests/dsh-review-fixes.test.mjs`

**Interfaces:**
- Consumes: existing `t(key)` where key === English source string
- Produces: these exact keys (English source = English value):
  - `A locally running \`dsh web\` instance becomes an agent engine: DeepSeek Harness in this extension, approval notifications, and per-session auto-approve. Everything stays on your machine.`
  - `Open DeepSeek Harness`
  - `The agent is waiting for you` (unchanged)
  - `Answer in DeepSeek Harness`

- [ ] **Step 1: Write the failing test**

In `tests/dsh-review-fixes.test.mjs` replace the `en locale covers dsh surface copy` block and add a scan:

```js
describe('en locale covers dsh surface copy', () => {
  it('has the decision-card keys without cockpit product names', () => {
    const en = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'src/_locales/en/main.json'), 'utf8'),
    )
    for (const key of [
      'ChatGPT Web keeps the conversation server-side',
      'The agent is waiting for you',
      'Selection attached',
      'Open DeepSeek Harness',
      'Answer in DeepSeek Harness',
    ]) {
      expect(en[key]).toBe(key)
    }
  })
})

describe('no cockpit product copy', () => {
  it('en and zh-hans user strings do not say cockpit or 驾驶舱', () => {
    for (const rel of ['src/_locales/en/main.json', 'src/_locales/zh-hans/main.json']) {
      const table = JSON.parse(readFileSync(path.resolve(process.cwd(), rel), 'utf8'))
      for (const [key, value] of Object.entries(table)) {
        const blob = `${key}\n${value}`
        expect(blob).not.toMatch(/cockpit/i)
        expect(blob).not.toMatch(/驾驶舱/)
      }
    }
  })
})
```

Delete the keys `Open the cockpit`, `Open cockpit`, `Cockpit`, `Open the cockpit to answer`, `Answer in the cockpit` from both locale files in the same edit as Step 3 (the test must fail first while they still exist).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dsh-review-fixes.test.mjs`
Expected: FAIL — missing `Open DeepSeek Harness` and/or cockpit strings still present.

- [ ] **Step 3: Update locales and call sites**

`src/_locales/en/main.json` — remove the five cockpit keys. Add:

```json
  "A locally running `dsh web` instance becomes an agent engine: DeepSeek Harness in this extension, approval notifications, and per-session auto-approve. Everything stays on your machine.": "A locally running `dsh web` instance becomes an agent engine: DeepSeek Harness in this extension, approval notifications, and per-session auto-approve. Everything stays on your machine.",
  "Open DeepSeek Harness": "Open DeepSeek Harness",
  "Answer in DeepSeek Harness": "Answer in DeepSeek Harness"
```

`src/_locales/zh-hans/main.json` — same keys, Chinese values:

```json
  "A locally running `dsh web` instance becomes an agent engine: DeepSeek Harness in this extension, approval notifications, and per-session auto-approve. Everything stays on your machine.": "本机运行的 `dsh web` 实例成为一个 agent 引擎：扩展内的 DeepSeek Harness、审批通知、每会话自动审批。一切都在你的机器上。",
  "Open DeepSeek Harness": "打开 DeepSeek Harness",
  "Answer in DeepSeek Harness": "去 DeepSeek Harness 回答"
```

`SettingsCard.jsx`: `t('Open the cockpit')` → `t('Open DeepSeek Harness')`; description string → the new long key above.

`ConversationCard/index.jsx`: `t('Open cockpit')` → `t('Open DeepSeek Harness')`.

`ChatPanel.jsx`: `t('Open the cockpit to answer')` → `t('Open DeepSeek Harness')`; `t('Answer in the cockpit')` → `t('Answer in DeepSeek Harness')`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/dsh-review-fixes.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/_locales/en/main.json src/_locales/zh-hans/main.json \
  src/modules/dsh/ui/SettingsCard.jsx \
  src/components/ConversationCard/index.jsx \
  src/popup/ChatPanel.jsx \
  tests/dsh-review-fixes.test.mjs
git commit -m "$(cat <<'EOF'
fix(dsh): drop cockpit wording from user-visible copy

The full client is DeepSeek Harness, not a second product named cockpit.
EOF
)"
```

---

### Task 2: Sidebar and compose view-models

**Files:**
- Create: `src/modules/dsh/ui/models/sidebar-model.mjs`
- Create: `tests/dsh-sidebar-model.test.mjs`

**Interfaces:**
- Consumes: workspace rows `{ workspaceId, title, path, sessionIds }`, session rows `{ sessionId, title, origin, blank, waiting, running }`, `archivedSessionIds: string[]`
- Produces:
  - `isSubagentSession(session)` → `session?.origin === 'subagent'`
  - `canCompose({ workspaceCount, selectedWorkspaceId })` → boolean
  - `groupSessionsForSidebar({ workspaces, sessions, archivedSessionIds })` → `{ groups: { workspace, sessions }[], ungrouped: session[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/dsh-sidebar-model.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import {
  canCompose,
  groupSessionsForSidebar,
  isSubagentSession,
} from '../src/modules/dsh/ui/models/sidebar-model.mjs'

const wsA = { workspaceId: 'w1', title: 'repo-a', path: '/a', sessionIds: ['s1', 's2'] }
const s1 = { sessionId: 's1', title: 'one', origin: 'local-new' }
const s2 = { sessionId: 's2', title: 'two', origin: 'local-new' }
const child = { sessionId: 's3', title: 'child', origin: 'subagent' }
const stray = { sessionId: 's9', title: 'loose', origin: 'local-new' }

describe('sidebar-model', () => {
  it('hides subagent-origin rows from the sidebar', () => {
    expect(isSubagentSession(child)).toBe(true)
    const { groups, ungrouped } = groupSessionsForSidebar({
      workspaces: [wsA],
      sessions: [s1, s2, child, stray],
      archivedSessionIds: [],
    })
    expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(['s1', 's2'])
    expect(ungrouped.map((s) => s.sessionId)).toEqual(['s9'])
  })

  it('hides archived sessions in every group', () => {
    const { groups, ungrouped } = groupSessionsForSidebar({
      workspaces: [wsA],
      sessions: [s1, s2, stray],
      archivedSessionIds: ['s2', 's9'],
    })
    expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(['s1'])
    expect(ungrouped).toEqual([])
  })

  it('keeps workspace order and sessionIds order', () => {
    const { groups } = groupSessionsForSidebar({
      workspaces: [wsA],
      sessions: [s2, s1],
      archivedSessionIds: [],
    })
    expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(['s1', 's2'])
  })

  it('forbids compose without a selected workspace', () => {
    expect(canCompose({ workspaceCount: 0, selectedWorkspaceId: null })).toBe(false)
    expect(canCompose({ workspaceCount: 2, selectedWorkspaceId: null })).toBe(false)
    expect(canCompose({ workspaceCount: 1, selectedWorkspaceId: 'w1' })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dsh-sidebar-model.test.mjs`
Expected: FAIL — cannot find module `sidebar-model.mjs`

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/dsh/ui/models/sidebar-model.mjs`:

```js
export function isSubagentSession(session) {
  return session?.origin === 'subagent'
}

export function canCompose({ workspaceCount, selectedWorkspaceId }) {
  return Boolean(selectedWorkspaceId) && Number(workspaceCount) > 0
}

export function groupSessionsForSidebar({
  workspaces = [],
  sessions = [],
  archivedSessionIds = [],
} = {}) {
  const archived = new Set(archivedSessionIds)
  const byId = new Map(
    sessions
      .filter((session) => session && !isSubagentSession(session) && !archived.has(session.sessionId))
      .map((session) => [session.sessionId, session]),
  )
  const groupedIds = new Set()
  const groups = workspaces.map((workspace) => {
    const rows = (workspace.sessionIds || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
    for (const row of rows) groupedIds.add(row.sessionId)
    return { workspace, sessions: rows }
  })
  const ungrouped = [...byId.values()].filter((session) => !groupedIds.has(session.sessionId))
  return { groups, ungrouped }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dsh-sidebar-model.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/dsh/ui/models/sidebar-model.mjs tests/dsh-sidebar-model.test.mjs
git commit -m "$(cat <<'EOF'
feat(dsh): group sidebar sessions by workspace

Hide archived and subagent-origin rows so the tree matches DSH Web.
EOF
)"
```

---

### Task 3: Preset picker view-model

**Files:**
- Create: `src/modules/dsh/ui/models/preset-model.mjs`
- Create: `tests/dsh-preset-model.test.mjs`

**Interfaces:**
- Consumes: `agentPreset.list` value `{ presets: { id, name?, description?, trust, isDefault, broken? }[], authorable, hasDocument }` and a session `{ blank, agentPreset? }`
- Produces:
  - `pickerPresets(list)` → presets with `broken` absent
  - `isPresetLocked(session)` → `session?.blank !== true`
  - `presetLabel(preset)` → `preset.name || preset.id`
  - `defaultPresetId(list)` → id of `isDefault` or first picker row or `null`

- [ ] **Step 1: Write the failing test**

Create `tests/dsh-preset-model.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import {
  defaultPresetId,
  isPresetLocked,
  pickerPresets,
  presetLabel,
} from '../src/modules/dsh/ui/models/preset-model.mjs'

const list = {
  presets: [
    { id: 'standard', name: '标准模式', description: 'full', trust: 'system', isDefault: true },
    { id: 'ghost', name: 'Broken', trust: 'user', isDefault: false, broken: 'missing composition' },
    { id: 'minimal', description: 'two tools', trust: 'system', isDefault: false },
  ],
}

describe('preset-model', () => {
  it('drops broken presets from the picker and keeps them out of the default', () => {
    expect(pickerPresets(list).map((p) => p.id)).toEqual(['standard', 'minimal'])
    expect(defaultPresetId(list)).toBe('standard')
  })

  it('falls back to id when name is missing', () => {
    expect(presetLabel({ id: 'minimal' })).toBe('minimal')
    expect(presetLabel({ id: 'standard', name: '标准模式' })).toBe('标准模式')
  })

  it('locks the picker after the first turn', () => {
    expect(isPresetLocked({ blank: true })).toBe(false)
    expect(isPresetLocked({ blank: false, agentPreset: 'standard' })).toBe(true)
    expect(isPresetLocked({})).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dsh-preset-model.test.mjs`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/dsh/ui/models/preset-model.mjs`:

```js
export function pickerPresets(list) {
  return (list?.presets || []).filter((preset) => !preset.broken)
}

export function presetLabel(preset) {
  return preset?.name || preset?.id || ''
}

export function defaultPresetId(list) {
  const rows = pickerPresets(list)
  return rows.find((preset) => preset.isDefault)?.id || rows[0]?.id || null
}

export function isPresetLocked(session) {
  return session?.blank !== true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dsh-preset-model.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/dsh/ui/models/preset-model.mjs tests/dsh-preset-model.test.mjs
git commit -m "$(cat <<'EOF'
feat(dsh): derive agent-preset picker options from the host roster

Broken presets stay off the switcher; a started session locks the choice.
EOF
)"
```

---

### Task 4: Settings write helpers and schema fields

**Files:**
- Create: `src/modules/dsh/ui/models/settings-write.mjs`
- Create: `src/modules/dsh/ui/models/schema-fields.mjs`
- Create: `tests/dsh-settings-model.test.mjs`

**Interfaces:**
- Consumes: schemastery-like `settings.describe` section `{ namespace, schema, values, revision, secrets }` and mutate ops
- Produces:
  - `settingsMutatePayload({ namespace, ops, expectedRevision })` → `{ namespace, ops, expectedRevision }`
  - `isSettingsConflict(error)` → `error?.code === 'settings-conflict'`
  - `fieldsFromDescribe(section)` → `{ path, type, title, secret }[]` walking `schema.properties` (object) or `schema.dict` entries; skip missing schema; mark `secret` if path is in `section.secrets`

- [ ] **Step 1: Write the failing test**

Create `tests/dsh-settings-model.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { fieldsFromDescribe } from '../src/modules/dsh/ui/models/schema-fields.mjs'
import {
  isSettingsConflict,
  settingsMutatePayload,
} from '../src/modules/dsh/ui/models/settings-write.mjs'

describe('settings-write', () => {
  it('sends expectedRevision with each mutate', () => {
    expect(
      settingsMutatePayload({
        namespace: 'locale',
        ops: [{ kind: 'set', path: 'language', value: 'zh' }],
        expectedRevision: 3,
      }),
    ).toEqual({
      namespace: 'locale',
      ops: [{ kind: 'set', path: 'language', value: 'zh' }],
      expectedRevision: 3,
    })
  })

  it('detects settings-conflict and nothing else', () => {
    expect(isSettingsConflict({ code: 'settings-conflict' })).toBe(true)
    expect(isSettingsConflict({ code: 'settings-rejected' })).toBe(false)
    expect(isSettingsConflict(null)).toBe(false)
  })
})

describe('schema-fields', () => {
  it('flattens object properties and flags secrets', () => {
    const fields = fieldsFromDescribe({
      namespace: 'llm.deepseek',
      secrets: ['apiKey'],
      schema: {
        type: 'object',
        properties: {
          apiKey: { type: 'string', title: 'API Key' },
          baseUrl: { type: 'string', title: 'Base URL' },
        },
      },
    })
    expect(fields).toEqual([
      { path: 'apiKey', type: 'string', title: 'API Key', secret: true },
      { path: 'baseUrl', type: 'string', title: 'Base URL', secret: false },
    ])
  })

  it('returns no fields when the namespace has no schema', () => {
    expect(fieldsFromDescribe({ namespace: 'x' })).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dsh-settings-model.test.mjs`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write minimal implementation**

`src/modules/dsh/ui/models/settings-write.mjs`:

```js
export function settingsMutatePayload({ namespace, ops, expectedRevision }) {
  return { namespace, ops, expectedRevision }
}

export function isSettingsConflict(error) {
  return error?.code === 'settings-conflict'
}
```

`src/modules/dsh/ui/models/schema-fields.mjs`:

```js
export function fieldsFromDescribe(section) {
  const properties = section?.schema?.properties
  if (!properties || typeof properties !== 'object') return []
  const secrets = new Set(section.secrets || [])
  return Object.entries(properties).map(([path, spec]) => ({
    path,
    type: spec?.type || 'string',
    title: spec?.title || path,
    secret: secrets.has(path),
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dsh-settings-model.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/dsh/ui/models/settings-write.mjs \
  src/modules/dsh/ui/models/schema-fields.mjs \
  tests/dsh-settings-model.test.mjs
git commit -m "$(cat <<'EOF'
feat(dsh): add settings mutate and schema-field helpers

Conflict detection stays on the wire code; the form only renders exposed fields.
EOF
)"
```

---

### Task 5: Page registry

**Files:**
- Create: `src/modules/dsh/ui/pages/registry.mjs`
- Create: `tests/dsh-page-registry.test.mjs`

**Interfaces:**
- Consumes: `{ id: string, title: string, render: Function }`
- Produces: `registerPage(page)`, `listPages()` → copy of registered pages in insertion order, `getPage(id)` → page or `null`. Duplicate `id` throws `Error('dsh pages: duplicate id "…")`.

- [ ] **Step 1: Write the failing test**

Create `tests/dsh-page-registry.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { getPage, listPages, registerPage } from '../src/modules/dsh/ui/pages/registry.mjs'

describe('page registry', () => {
  it('lists pages in registration order and rejects duplicates', () => {
    const conversation = { id: 'conversation', title: 'Chat', render: () => null }
    const settings = { id: 'settings', title: 'Settings', render: () => null }
    registerPage(conversation)
    registerPage(settings)
    expect(listPages().map((p) => p.id)).toEqual(['conversation', 'settings'])
    expect(getPage('settings')).toBe(settings)
    expect(getPage('missing')).toBe(null)
    expect(() => registerPage(conversation)).toThrow(/duplicate id "conversation"/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dsh-page-registry.test.mjs`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/dsh/ui/pages/registry.mjs`:

```js
const pages = []

export function registerPage(page) {
  if (!page || typeof page.id !== 'string' || !page.id) {
    throw new Error('dsh pages: registerPage requires an id')
  }
  if (pages.some((entry) => entry.id === page.id)) {
    throw new Error(`dsh pages: duplicate id "${page.id}"`)
  }
  pages.push(page)
}

export function listPages() {
  return [...pages]
}

export function getPage(id) {
  return pages.find((page) => page.id === id) || null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dsh-page-registry.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/dsh/ui/pages/registry.mjs tests/dsh-page-registry.test.mjs
git commit -m "$(cat <<'EOF'
feat(dsh): register Harness pages behind a swap-friendly table

The shell only mounts what the registry lists.
EOF
)"
```

---

### Task 6: Gateway — create with workspace/preset + privileged passthrough

**Files:**
- Modify: `src/modules/dsh/background/gateway.mjs` (`rpcHandlers`, `session.create`, host-frame `default`)
- Modify: `tests/dsh-gateway.test.mjs` (fake harness rpc + new cases)

**Interfaces:**
- Consumes: `callRpc(method, args)` from UI ports
- Produces:
  - `session.create` forwards `{ sessionId, workspaceId?, agentPreset? }` (omit nullish)
  - passthrough methods listed below call `api.rpc(method, args)` unchanged
  - unknown method still throws `unknown method "…"`
  - host frames `workspace-added` / `workspace-removed` / `workspace-changed` / `host/archived-sessions-changed` trigger `workspace.list` and `broadcast({ type: 'workspaces', items, archivedSessionIds })`
  - after successful start, also pull `workspace.list` once and broadcast

Passthrough method names (exact):

```
workspace.list workspace.create workspace.rename workspace.delete
workspace.insertBefore workspace.insertSessionBefore workspace.archiveSession
host.pickDirectory host.openPath host.listDirectory host.createDirectory
agentPreset.list agentPreset.select agentPreset.read agentPreset.copy
agentPreset.remove agentPreset.openDocument
settings.describe settings.mutate settings.update settings.replace settings.openDocument
credentials.describe credentials.set credentials.unset
llm.providers llm.models llm.discoverModels
command.list command.execute
skill.list
subagent.list subagent.prompt subagent.interrupt
```

- [ ] **Step 1: Write the failing test**

In `tests/dsh-gateway.test.mjs` add to `harness.rpc`:

```js
'workspace.list': async () => ({ items: harness.workspaces || [], archivedSessionIds: [] }),
'workspace.create': async (payload) => {
  harness.lastWorkspaceCreate = payload
  return { workspace: { workspaceId: 'w1', path: payload.path, title: 't', sessionIds: [] }, created: true }
},
'agentPreset.list': async () => ({
  presets: [{ id: 'standard', trust: 'system', isDefault: true }],
  authorable: true,
  hasDocument: false,
}),
'settings.describe': async (payload) => ({ sections: [{ namespace: payload?.namespace || 'locale', revision: 1 }] }),
```

And change `'session.create'` to record payload:

```js
'session.create': async (payload) => {
  harness.lastCreate = payload
  const sessionId = payload.sessionId || `session-${Math.random().toString(36).slice(2)}`
  harness.sessions[sessionId] = { blank: true, running: false }
  return { sessionId, agentPreset: payload.agentPreset }
},
```

Add cases (reuse the existing `startGateway` helper already in the file):

```js
it('forwards workspaceId and agentPreset on session.create', async () => {
  const { gateway, harness } = await startGateway()
  const value = await gateway.rpc('session.create', {
    workspaceId: 'w1',
    agentPreset: 'standard',
  })
  expect(harness.lastCreate.workspaceId).toBe('w1')
  expect(harness.lastCreate.agentPreset).toBe('standard')
  expect(harness.lastCreate.sessionId).toBe(value.sessionId)
})

it('passes privileged workspace.create through', async () => {
  const { gateway, harness } = await startGateway()
  await gateway.rpc('workspace.create', { path: '/tmp/proj' })
  expect(harness.lastWorkspaceCreate).toEqual({ path: '/tmp/proj' })
})

it('still rejects unknown methods', async () => {
  const { gateway } = await startGateway()
  await expect(gateway.rpc('settings.not-a-method', {})).rejects.toThrow(/unknown method/)
})
```

If the file has no `startGateway`, wrap the existing beforeEach pattern: create fake harness, listen, `createDshGateway({ endpoint, storage, client: createDshClient({ baseUrl }) })`, `await gateway.start()`, return `{ gateway, harness }`, stop after.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/dsh-gateway.test.mjs`
Expected: FAIL — create payload missing `workspaceId` and/or `workspace.create` is unknown method

- [ ] **Step 3: Implement gateway changes**

In `gateway.mjs` replace the `session.create` handler:

```js
'session.create': async ({ workspaceId, agentPreset } = {}) => {
  const sessionId = newId()
  const payload = { sessionId }
  if (workspaceId) payload.workspaceId = workspaceId
  if (agentPreset) payload.agentPreset = agentPreset
  const value = await api.rpc('session.create', payload)
  ensureSession({
    sessionId: value.sessionId,
    blank: true,
    running: false,
    updatedAt: Date.now(),
    origin: 'local-new',
    workspaceId: workspaceId || null,
    agentPreset: value.agentPreset || agentPreset || null,
  })
  broadcastSessionList()
  return value
},
```

After the existing named handlers, add:

```js
const PASSTHROUGH_METHODS = [
  'workspace.list',
  'workspace.create',
  'workspace.rename',
  'workspace.delete',
  'workspace.insertBefore',
  'workspace.insertSessionBefore',
  'workspace.archiveSession',
  'host.pickDirectory',
  'host.openPath',
  'host.listDirectory',
  'host.createDirectory',
  'agentPreset.list',
  'agentPreset.select',
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.remove',
  'agentPreset.openDocument',
  'settings.describe',
  'settings.mutate',
  'settings.update',
  'settings.replace',
  'settings.openDocument',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.providers',
  'llm.models',
  'llm.discoverModels',
  'command.list',
  'command.execute',
  'skill.list',
  'subagent.list',
  'subagent.prompt',
  'subagent.interrupt',
]
for (const method of PASSTHROUGH_METHODS) {
  rpcHandlers[method] = (args = {}) => api.rpc(method, args)
}
```

Add workspace snapshot + broadcast (next to `broadcastSessionList`):

```js
let workspaceSnapshot = { items: [], archivedSessionIds: [] }

async function pullWorkspaces() {
  try {
    const value = await api.rpc('workspace.list', {})
    workspaceSnapshot = {
      items: value?.items || [],
      archivedSessionIds: value?.archivedSessionIds || [],
    }
    broadcast({ type: 'workspaces', ...workspaceSnapshot })
  } catch (error) {
    log('workspace.list failed', error)
  }
}
```

Call `void pullWorkspaces()` from the same place that first pulls `session.list` after streams are up.

In the host-frame switch, replace the `default` cut-line with:

```js
case 'workspace-added':
case 'workspace-removed':
case 'workspace-changed':
case 'host/archived-sessions-changed':
  void pullWorkspaces()
  break
default:
  break
```

On `hello` to a new port, also `port.postMessage({ type: 'workspaces', ...workspaceSnapshot })`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/dsh-gateway.test.mjs`
Expected: PASS (existing reconnect/approval cases still green)

- [ ] **Step 5: Commit**

```bash
git add src/modules/dsh/background/gateway.mjs tests/dsh-gateway.test.mjs
git commit -m "$(cat <<'EOF'
feat(dsh): proxy workspace, preset, and settings RPCs

session.create now carries the workspace and preset the empty state already chose.
EOF
)"
```

---

### Task 7: Adapter port understands workspaces

**Files:**
- Create: `src/modules/dsh/ui/adapter/useGatewayPort.js` (move from `ui/useGatewayPort.js`, add `workspaces` state)
- Modify: every import of `../useGatewayPort.js` or `./useGatewayPort.js` to `../adapter/useGatewayPort.js`
- Delete: `src/modules/dsh/ui/useGatewayPort.js` after the move
- Modify: `src/modules/dsh/ui/port-reconnect.mjs` stays put (adapter imports it via `../port-reconnect.mjs`)

**Interfaces:**
- Consumes: port messages `hello|connection|sessions|session|ledger|workspaces|res`
- Produces: `useGatewayPort()` → existing fields plus `workspaces: { items, archivedSessionIds }`

- [ ] **Step 1: Write the failing test**

Create `tests/dsh-adapter-port.test.mjs` that tests a pure reducer extracted in the same task:

```js
import { describe, expect, it } from 'vitest'
import { applyPortMessage } from '../src/modules/dsh/ui/adapter/port-state.mjs'

describe('applyPortMessage', () => {
  it('replaces the workspace snapshot', () => {
    const prev = {
      connection: { status: 'online' },
      sessions: [],
      sessionUpdates: {},
      workspaces: { items: [], archivedSessionIds: [] },
    }
    const next = applyPortMessage(prev, {
      type: 'workspaces',
      items: [{ workspaceId: 'w1' }],
      archivedSessionIds: ['s9'],
    })
    expect(next.workspaces).toEqual({
      items: [{ workspaceId: 'w1' }],
      archivedSessionIds: ['s9'],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dsh-adapter-port.test.mjs`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement `port-state.mjs` and move the hook**

Create `src/modules/dsh/ui/adapter/port-state.mjs`:

```js
export function emptyPortState() {
  return {
    connection: { status: 'connecting', endpoint: '', version: null, lastError: null },
    sessions: [],
    sessionUpdates: {},
    workspaces: { items: [], archivedSessionIds: [] },
  }
}

export function applyPortMessage(state, message) {
  if (!message || typeof message !== 'object') return state
  switch (message.type) {
    case 'hello':
    case 'connection':
      return {
        ...state,
        connection: {
          status: message.status,
          endpoint: message.endpoint,
          version: message.version,
          lastError: message.lastError,
        },
      }
    case 'sessions':
      return { ...state, sessions: message.items || [], sessionUpdates: {} }
    case 'session':
      return {
        ...state,
        sessionUpdates: {
          ...state.sessionUpdates,
          [message.summary.sessionId]: message.summary,
        },
      }
    case 'workspaces':
      return {
        ...state,
        workspaces: {
          items: message.items || [],
          archivedSessionIds: message.archivedSessionIds || [],
        },
      }
    default:
      return state
  }
}
```

Move `useGatewayPort.js` to `adapter/useGatewayPort.js`. Drive session/connection/workspace state through `applyPortMessage`. Keep ledger listeners and rpc as they are today (`type === 'res'` / `type === 'ledger'`).

Update imports in `Cockpit.jsx` (still present until Task 10) and any other file that imported `./useGatewayPort.js`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/dsh-adapter-port.test.mjs tests/dsh-review-fixes.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/dsh/ui/adapter src/modules/dsh/ui/Cockpit.jsx \
  src/modules/dsh/ui/useGatewayPort.js tests/dsh-adapter-port.test.mjs
git commit -m "$(cat <<'EOF'
feat(dsh): fold workspace snapshots in the UI adapter

The hook stays the only Port consumer; chrome never sees raw frames.
EOF
)"
```

---

### Task 8: Chrome — PresetSelect and WorkspaceEmpty

**Files:**
- Create: `src/modules/dsh/ui/chrome/PresetSelect.jsx`
- Create: `src/modules/dsh/ui/chrome/WorkspaceEmpty.jsx`
- Create: `tests/dsh-chrome-copy.test.mjs` (source scan: no cockpit, uses models)

**Interfaces:**
- Consumes: `pickerPresets` / `presetLabel` / `isPresetLocked` from Task 3; `canCompose` from Task 2
- Produces:
  - `PresetSelect({ list, session, value, onChange })` — disabled when `isPresetLocked(session)`; options from `pickerPresets(list)`; each option shows `presetLabel` + `description`
  - `WorkspaceEmpty({ onAdd, pickerError })` — one button `onAdd`; if `pickerError === 'directory-picker-unavailable'` show that code’s message, no extra button

- [ ] **Step 1: Write the failing test**

Create `tests/dsh-chrome-copy.test.mjs`:

```js
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('chrome controls', () => {
  it('PresetSelect uses the roster model and does not hard-code four modes', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/chrome/PresetSelect.jsx'),
      'utf8',
    )
    expect(src).toMatch(/pickerPresets/)
    expect(src).toMatch(/isPresetLocked/)
    expect(src).not.toMatch(/PTC/)
    expect(src).not.toMatch(/创造模式/)
  })

  it('WorkspaceEmpty has no dead control when the native picker is missing', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/chrome/WorkspaceEmpty.jsx'),
      'utf8',
    )
    expect(src).toMatch(/directory-picker-unavailable/)
    expect(src).not.toMatch(/cockpit/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dsh-chrome-copy.test.mjs`
Expected: FAIL — ENOENT PresetSelect.jsx

- [ ] **Step 3: Write the components**

`src/modules/dsh/ui/chrome/PresetSelect.jsx`:

```jsx
import { isPresetLocked, pickerPresets, presetLabel } from '../models/preset-model.mjs'

export function PresetSelect({ list, session, value, onChange }) {
  const options = pickerPresets(list)
  const locked = isPresetLocked(session)
  if (options.length === 0) return null
  return (
    <label className="dsh-preset">
      <select
        disabled={locked}
        value={value || ''}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {options.map((preset) => (
          <option key={preset.id} value={preset.id} title={preset.description || ''}>
            {presetLabel(preset)}
          </option>
        ))}
      </select>
      {options.find((preset) => preset.id === value)?.description ? (
        <span className="dsh-preset-desc">
          {options.find((preset) => preset.id === value).description}
        </span>
      ) : null}
    </label>
  )
}
```

`src/modules/dsh/ui/chrome/WorkspaceEmpty.jsx`:

```jsx
export function WorkspaceEmpty({ onAdd, pickerError }) {
  if (pickerError === 'directory-picker-unavailable') {
    return (
      <p className="dsh-empty">
        Native folder picking is unavailable on this host. Start `dsh` on a machine with a desktop
        picker.
      </p>
    )
  }
  return (
    <div className="dsh-empty">
      <p>Select a workspace folder to start.</p>
      <button type="button" onClick={() => onAdd?.()}>
        Add workspace
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dsh-chrome-copy.test.mjs tests/dsh-preset-model.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/dsh/ui/chrome tests/dsh-chrome-copy.test.mjs
git commit -m "$(cat <<'EOF'
feat(dsh): add presentational preset and empty-workspace controls

They take props only; the adapter owns pickDirectory and agentPreset.select.
EOF
)"
```

---

### Task 9: Conversation page — DSH Web flow on existing fold blocks

**Files:**
- Create: `src/modules/dsh/ui/pages/conversation/Conversation.jsx`
- Create: `src/modules/dsh/ui/pages/conversation/index.mjs` (registers `id: 'conversation'`)
- Move render logic from `src/modules/dsh/ui/Ledger.jsx` into Conversation.jsx (user blocks as bubbles, tools still expandable, approvals still loud)
- Keep `Ledger.jsx` as a thin re-export of Conversation until Task 10 deletes it, or delete it in this task and fix Cockpit to import Conversation

**Interfaces:**
- Consumes: `{ blocks, lastSeq }` from the existing fold; `rpc`; `session`
- Produces: registered page `{ id: 'conversation', title: 'Chat', render }`

- [ ] **Step 1: Write the failing test**

Create `tests/dsh-conversation-page.test.mjs`:

```js
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPage, listPages, registerPage } from '../src/modules/dsh/ui/pages/registry.mjs'

describe('conversation page', () => {
  it('registers as conversation and renders user blocks as bubbles', async () => {
    await import('../src/modules/dsh/ui/pages/conversation/index.mjs')
    expect(getPage('conversation')?.id).toBe('conversation')
    expect(listPages().some((page) => page.id === 'conversation')).toBe(true)
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/conversation/Conversation.jsx'),
      'utf8',
    )
    expect(src).toMatch(/kind === 'user'/)
    expect(src).toMatch(/dsh-user-bubble/)
    expect(src).not.toMatch(/台账/)
    expect(src).not.toMatch(/cockpit/i)
  })
})
```

Note: `registerPage` throws on duplicate if tests import the module twice in one worker. Guard the registration:

```js
import { getPage, registerPage } from '../registry.mjs'
import { Conversation } from './Conversation.jsx'

if (!getPage('conversation')) {
  registerPage({ id: 'conversation', title: 'Chat', render: Conversation })
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dsh-conversation-page.test.mjs`
Expected: FAIL — cannot find conversation page

- [ ] **Step 3: Implement Conversation.jsx**

Copy `Ledger.jsx` into `Conversation.jsx`. Rename the root class `dsh-ledger` → `dsh-conversation`. For `kind === 'user'` use `className="dsh-user-bubble"` (not `dsh-user-block`). Keep tool / approval / question / turn-end rendering. Register the page as above. Point `Cockpit.jsx` at `Conversation` so the existing full page still boots.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/dsh-conversation-page.test.mjs tests/dsh-turn-fold.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/dsh/ui/pages/conversation src/modules/dsh/ui/Cockpit.jsx \
  src/modules/dsh/ui/Ledger.jsx tests/dsh-conversation-page.test.mjs
git commit -m "$(cat <<'EOF'
feat(dsh): register a conversation page that renders fold blocks as a chat flow

Approvals stay the loudest row; the product metaphor is no longer a ledger.
EOF
)"
```

---

### Task 10: Shell + app mount (replace Cockpit)

**Files:**
- Create: `src/modules/dsh/ui/shell/Shell.jsx`
- Create: `src/modules/dsh/ui/shell/Header.jsx`
- Create: `src/modules/dsh/ui/shell/Sidebar.jsx` (workspace tree using `groupSessionsForSidebar`)
- Create: `src/modules/dsh/ui/tokens.css`
- Create: `src/modules/dsh/ui/app.jsx`
- Modify: `src/modules/dsh/ui/index.jsx` to render `App`
- Modify: `src/modules/dsh/ui/index.html` stylesheet to `tokens.css`
- Modify: `tests/dsh-review-fixes.test.mjs` (`Cockpit.jsx` → `app.jsx` or `shell/Shell.jsx` for `resolveCockpitSelection`)
- Delete: `Cockpit.jsx`, `Sidebar.jsx`, `SessionBar.jsx`, `Ledger.jsx`, `dsh.css` after callers move

**Interfaces:**
- Consumes: `useGatewayPort`, `groupSessionsForSidebar`, `canCompose`, `PresetSelect`, `WorkspaceEmpty`, `getPage('conversation')`
- Produces: full-page App that:
  1. Shows `WorkspaceEmpty` when `canCompose` is false; Add calls `rpc('host.pickDirectory')` then on a string path `rpc('workspace.create', { path })`. Cancel (`null`) is silent. Error code `directory-picker-unavailable` passed to `WorkspaceEmpty`.
  2. New session: `rpc('session.create', { workspaceId, agentPreset })` with current sidebar workspace + preset value.
  3. Header: `DeepSeek Harness`, connection endpoint/version, Settings button (sets `activePage` to `settings`), waiting pill.
  4. Narrow &lt; 520px: sidebar becomes a `<select>` of flattened group rows (same model).

- [ ] **Step 1: Write the failing test**

Add to `tests/dsh-review-fixes.test.mjs` (replace the Cockpit.jsx source read):

```js
describe('harness session query', () => {
  it('uses resolveCockpitSelection so a late ?session= can still win', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/modules/dsh/ui/app.jsx'), 'utf8')
    expect(src).toMatch(/resolveCockpitSelection/)
  })
})
```

Create `tests/dsh-shell.test.mjs`:

```js
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('shell', () => {
  it('never says cockpit and wires workspace create through pickDirectory', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/app.jsx'),
      'utf8',
    )
    expect(src).toMatch(/host\.pickDirectory/)
    expect(src).toMatch(/workspace\.create/)
    expect(src).toMatch(/session\.create/)
    expect(src).toMatch(/agentPreset/)
    expect(src).not.toMatch(/cockpit/i)
    expect(src).not.toMatch(/Cockpit/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/dsh-shell.test.mjs tests/dsh-review-fixes.test.mjs`
Expected: FAIL — app.jsx missing

- [ ] **Step 3: Implement shell and app**

`tokens.css`: copy `dsh.css`, delete `--dsh-waiting-question` duplicate theatrics if unused, rename `.dsh-app` comments to Harness, add `.dsh-user-bubble` (same metrics as old user block), `.dsh-preset`, `.dsh-empty`. No `◆`.

`Header.jsx`: title text `DeepSeek Harness`; health from `connection`; button `Settings` calls `onOpenSettings`; waiting pill when `waitingCount > 0`.

`shell/Sidebar.jsx`: map `groupSessionsForSidebar(...)`. Each workspace is a `<details open>`. Session click → `onSelect(sessionId)`. Header button `+` → `onNewSession`. Search input → `rpc('session.search', { query })` as today.

`app.jsx` outline (must contain the strings the test looks for):

```jsx
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useGatewayPort } from './adapter/useGatewayPort.js'
import { canCompose, groupSessionsForSidebar } from './models/sidebar-model.mjs'
import { defaultPresetId, isPresetLocked } from './models/preset-model.mjs'
import { resolveCockpitSelection } from './session-pick.mjs'
import { PresetSelect } from './chrome/PresetSelect.jsx'
import { WorkspaceEmpty } from './chrome/WorkspaceEmpty.jsx'
import { Header } from './shell/Header.jsx'
import { Sidebar } from './shell/Sidebar.jsx'
import { getPage } from './pages/registry.mjs'
import './pages/conversation/index.mjs'
import './pages/settings/index.mjs'

export function App() {
  const { connection, sessions, sessionUpdates, workspaces, rpc, subscribeLedger } =
    useGatewayPort()
  // merge sessions as Cockpit.jsx does today
  // resolveCockpitSelection for ?session=
  // presetList via rpc('agentPreset.list') on connection.status === 'online'
  // addWorkspace: const path = await rpc('host.pickDirectory'); if (path) await rpc('workspace.create', { path })
  // createSession: await rpc('session.create', { workspaceId, agentPreset })
  // activePage 'conversation' | 'settings' | …
  // render Header, Sidebar, PresetSelect, WorkspaceEmpty or getPage(activePage).render
}
```

Fill in the merged-session `useMemo` by copying the block from current `Cockpit.jsx` (the `byId` merge of `sessions` + `sessionUpdates`). Wire `subscribeLedger` into the conversation page props.

`index.jsx`: `import { App } from './app.jsx'` and `render(<App />, ...)`.

`index.html`: `<link rel="stylesheet" href="tokens.css" />`.

Delete `Cockpit.jsx`, old `Sidebar.jsx`, `SessionBar.jsx`, `Ledger.jsx`, `dsh.css` once nothing imports them. Move SessionBar title/model/auto-approve into `shell/SessionHeader.jsx` (copy the existing SessionBar.jsx body, drop the word cockpit in comments).

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/dsh-shell.test.mjs tests/dsh-review-fixes.test.mjs tests/dsh-conversation-page.test.mjs tests/module-boundary.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/dsh/ui tests/dsh-shell.test.mjs tests/dsh-review-fixes.test.mjs
git commit -m "$(cat <<'EOF'
feat(dsh): replace the full-page mount with a Harness shell

Workspace pick and preset ride session.create; the old Cockpit assembly is gone.
EOF
)"
```

---

### Task 11: Settings page (schema-driven sections + preset roster)

**Files:**
- Create: `src/modules/dsh/ui/pages/settings/SettingsPage.jsx`
- Create: `src/modules/dsh/ui/pages/settings/SchemaForm.jsx`
- Create: `src/modules/dsh/ui/pages/settings/PresetRoster.jsx`
- Create: `src/modules/dsh/ui/pages/settings/index.mjs`

**Interfaces:**
- Consumes: `rpc('settings.describe')`, `rpc('settings.mutate')`, `rpc('credentials.describe'|'set'|'unset')`, `rpc('llm.providers')`, `rpc('llm.discoverModels')`, `rpc('agentPreset.list'|'read'|'copy'|'remove'|'openDocument')`, `fieldsFromDescribe`, `settingsMutatePayload`, `isSettingsConflict`
- Produces: registered page `{ id: 'settings', title: 'Settings', render: SettingsPage }`
- `SchemaForm` on submit: `settings.mutate(settingsMutatePayload({ namespace, ops, expectedRevision }))`. On thrown error with `error.code` — if `isSettingsConflict(error)` reload describe and do not retry automatically.
- Skip a section when describe fails with `settings-not-exposed`.
- Secret fields are `<input type="password">` and send only when the user typed a new value.
- PresetRoster: list all presets including `broken`; Copy dialog `{ from, agentPreset, name? }` → `agentPreset.copy`; system rows have Read (`agentPreset.read`) and no delete; `hasDocument === false` shows path text from `openDocument` `{ opened: false, path }` and no button.

- [ ] **Step 1: Write the failing test**

Create `tests/dsh-settings-page.test.mjs`:

```js
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('settings page', () => {
  it('mutates with expectedRevision and never invents namespaces', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/settings/SettingsPage.jsx'),
      'utf8',
    )
    expect(src).toMatch(/settings\.describe/)
    expect(src).toMatch(/settingsMutatePayload/)
    expect(src).toMatch(/isSettingsConflict/)
    expect(src).not.toMatch(/settings-not-exposed/)
    expect(src).not.toMatch(/cockpit/i)
  })

  it('preset roster copies instead of editing YAML', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/pages/settings/PresetRoster.jsx'),
      'utf8',
    )
    expect(src).toMatch(/agentPreset\.copy/)
    expect(src).toMatch(/agentPreset\.remove/)
    expect(src).toMatch(/hasDocument/)
  })
})
```

The `not.toMatch(/settings-not-exposed/)` is because the page must treat that code as “omit section”, which lives in a helper. Put the helper in `pages/settings/load-sections.mjs`:

```js
export function sectionsFromDescribeResult(result, error) {
  if (error?.code === 'settings-not-exposed') return []
  return result?.sections || result?.items || (result?.namespace ? [result] : [])
}
```

Test that helper in the same file (add an import test) so the string `settings-not-exposed` lives in the helper, not SettingsPage.jsx — **change the SettingsPage scan** to:

```js
expect(src).toMatch(/sectionsFromDescribeResult/)
```

And add:

```js
import { sectionsFromDescribeResult } from '../src/modules/dsh/ui/pages/settings/load-sections.mjs'

it('omits a section the host did not expose', () => {
  expect(sectionsFromDescribeResult(null, { code: 'settings-not-exposed' })).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dsh-settings-page.test.mjs`
Expected: FAIL — ENOENT

- [ ] **Step 3: Implement settings files**

`load-sections.mjs` as above.

`SchemaForm.jsx`: props `{ section, values, onSubmit }`. Render `fieldsFromDescribe(section)`. Submit builds `ops: fields.filter(changed).map(f => ({ kind: 'set', path: f.path, value }))` plus `expectedRevision: section.revision`.

`PresetRoster.jsx`: props `{ rpc }`. `useEffect` → `rpc('agentPreset.list')`. Copy form: inputs `id` and optional `name`, submit `rpc('agentPreset.copy', { from, agentPreset: id, name })`. Delete user rows via `rpc('agentPreset.remove', { agentPreset })`. Open: `const result = await rpc('agentPreset.openDocument', { agentPreset })`; if `result.opened === false` show `result.path`.

`SettingsPage.jsx`: on mount `rpc('settings.describe', {})` then `sectionsFromDescribeResult`. Tabs: General (non-llm namespaces except `agent-presets`), Models (`llm.providers` + matching sections + credentials.describe), Plugins (namespaces matching `agent-loop|bash|web-search|plugin`), Presets (`PresetRoster`). Models tab also offers `llm.discoverModels` with a draft endpoint/key form; it must not persist the key except via `credentials.set` / mutate the user clicked.

`index.mjs`:

```js
import { getPage, registerPage } from '../registry.mjs'
import { SettingsPage } from './SettingsPage.jsx'
if (!getPage('settings')) {
  registerPage({ id: 'settings', title: 'Settings', render: SettingsPage })
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/dsh-settings-page.test.mjs tests/dsh-settings-model.test.mjs tests/module-boundary.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/dsh/ui/pages/settings tests/dsh-settings-page.test.mjs
git commit -m "$(cat <<'EOF'
feat(dsh): add a schema-driven settings page and preset roster

Writes carry revisions; unexposed namespaces never appear.
EOF
)"
```

---

### Task 12: Composer extras — commands, skills, permission, plan, queue edit

**Files:**
- Modify: `src/modules/dsh/ui/Composer.jsx` (or move it to `pages/conversation/Composer.jsx` in this task — if moved, update imports)
- Create: `src/modules/dsh/ui/chrome/PermissionSelect.jsx`
- Create: `src/modules/dsh/ui/chrome/PlanChip.jsx`
- Create: `src/modules/dsh/ui/chrome/CommandMenu.jsx`
- Create: `src/modules/dsh/ui/models/permission-model.mjs`
- Create: `tests/dsh-composer-extras.test.mjs`

**Interfaces:**
- Consumes: projections on the session summary / ledger message: `permissions`, `plan` (`{ active, pending }`), `todos`, `contextPressure`
- Produces:
  - `permissionOptions(projection)` → `{ id, label, danger }[]` from `projection.presets` or `projection.options`; `danger` true when id is `danger-full-access` or `full-access`
  - `planChipVisible(plan)` → `(plan?.pending ? !plan.active : plan?.active) === true`
  - CommandMenu: `rpc('command.list', { sessionId })` then pick → `rpc('command.execute', { sessionId, line })`
  - Skill rows in the same menu from `rpc('skill.list', { sessionId })`; pick inserts `/name ` into the textarea (does not execute)
  - PermissionSelect: safe pick → `command.execute` with line `/permission ${id}`; danger pick opens confirm, then the same
  - PlanChip: visible per `planChipVisible`; click → `command.execute` `{ line: '/plan off' }`
  - Queue: existing remove stays; text-only row gets Edit → `session.updateQueue` with `{ kind: 'replace', content }` **only if** the current Composer already has a queue-remove rpc. Add `session.queue-replace` handler in gateway: `api.rpc('session.updateQueue', { sessionId, itemId, action: { kind: 'replace', content } })`.
  - Empty-draft Cmd/Ctrl+Enter while running: for each queued item oldest-first call existing prompt `mode: 'steer'` with that item’s text, then `session.queue-remove`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/dsh/ui/models/permission-model.mjs` in Step 3. Test file first:

```js
import { describe, expect, it } from 'vitest'
import { permissionOptions, planChipVisible } from '../src/modules/dsh/ui/models/permission-model.mjs'

describe('permission-model', () => {
  it('marks full access as danger', () => {
    const rows = permissionOptions({
      presets: ['workspace-write', 'danger-full-access'],
    })
    expect(rows.find((r) => r.id === 'danger-full-access').danger).toBe(true)
    expect(rows.find((r) => r.id === 'workspace-write').danger).toBe(false)
  })
})

describe('planChipVisible', () => {
  it('follows the host folded pending/active rule', () => {
    expect(planChipVisible({ active: false, pending: true })).toBe(true)
    expect(planChipVisible({ active: true, pending: false })).toBe(true)
    expect(planChipVisible({ active: true, pending: true })).toBe(false)
    expect(planChipVisible(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dsh-composer-extras.test.mjs`
Expected: FAIL — cannot find permission-model

- [ ] **Step 3: Implement models and chrome**

`permission-model.mjs`:

```js
export function permissionOptions(projection) {
  const ids = projection?.presets || projection?.options || []
  return ids.map((id) => ({
    id,
    label: String(id)
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    danger: id === 'danger-full-access' || id === 'full-access',
  }))
}

export function planChipVisible(plan) {
  if (!plan) return false
  return (plan.pending ? !plan.active : plan.active) === true
}
```

`PermissionSelect.jsx`: props `{ projection, onPick }`. Dropdown of `permissionOptions`. Danger → `<dialog>` with checkbox “I understand” enabling Confirm.

`PlanChip.jsx`: if `!planChipVisible(plan)` return null; else button `Plan ×` calling `onTurnOff`.

`CommandMenu.jsx`: props `{ sessionId, rpc, onInsert }`. Button `+`. Open list: commands then skills. Command click `rpc('command.execute', { sessionId, line: command.line || `/${command.name}` })`. Skill click `onInsert(`/${skill.name} `)`.

Composer: render CommandMenu, PermissionSelect, PlanChip in the bottom row; keep attach/send/stop. Add queue edit input for rows whose content is a single text block.

Gateway: add `'session.queue-replace': ({ sessionId, itemId, content }) => api.rpc('session.updateQueue', { sessionId, itemId, action: { kind: 'replace', content } })`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/dsh-composer-extras.test.mjs tests/dsh-gateway.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/dsh/ui/models/permission-model.mjs \
  src/modules/dsh/ui/chrome/PermissionSelect.jsx \
  src/modules/dsh/ui/chrome/PlanChip.jsx \
  src/modules/dsh/ui/chrome/CommandMenu.jsx \
  src/modules/dsh/ui/Composer.jsx \
  src/modules/dsh/background/gateway.mjs \
  tests/dsh-composer-extras.test.mjs
git commit -m "$(cat <<'EOF'
feat(dsh): add command, skill, permission, and plan controls to the composer

Full-access still requires an explicit acknowledgement before /permission runs.
EOF
)"
```

---

### Task 13: Jobs, subagents, trajectory, workflow, todos, goals, deliverables

**Files:**
- Create: `src/modules/dsh/ui/chrome/JobsPopover.jsx`
- Create: `src/modules/dsh/ui/chrome/SubagentCatalog.jsx`
- Create: `src/modules/dsh/ui/pages/trajectory/Trajectory.jsx`
- Create: `src/modules/dsh/ui/pages/trajectory/index.mjs`
- Create: `src/modules/dsh/ui/models/jobs-model.mjs`
- Create: `src/modules/dsh/ui/models/subagent-model.mjs`
- Modify: conversation renderer for `tool-workflow/*` and deliverable locations if the fold already exposes them; otherwise add fold kinds in `turn-fold.mjs` only when events already have `type` strings from the harness (`tool-workflow/run-start`, `todo/write` is a projection — read from ledger message `projections`)
- Create: `tests/dsh-jobs-subagent-model.test.mjs`

**Interfaces:**
- Consumes: session `jobs` array from gateway summarize (already stored as `session.jobs`); session list for children
- Produces:
  - `jobsForPopover(jobs)` → `{ live, settled, badge }` where `badge` = count of `status` in `running|stopping`; live sorted by `startedAt` asc; settled by `finishedAt` desc
  - `JobsPopover` renders only when `jobs.length > 0`
  - `sidebarHidden` already done; `childSessions(parentId, sessions)` → sessions with `parentSessionId === parentId` or `parentId === parentId` and `origin === 'subagent'`
  - Trajectory page registers `id: 'trajectory'`; `app.jsx` shows the tab only when `session.projections?.trajectory` or `session.projections?.tokenUsage` exists
  - Workflow: in Conversation.jsx, if `block.kind === 'workflow-run'` render phase/member list (fold must emit that kind — add in this task)
  - Todo/goal docks: if `projections.todos` / `projections.goal` present, render above composer; hide when empty

- [ ] **Step 1: Write the failing test**

Create `tests/dsh-jobs-subagent-model.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { jobsForPopover } from '../src/modules/dsh/ui/models/jobs-model.mjs'
import { childSessions } from '../src/modules/dsh/ui/models/subagent-model.mjs'

describe('jobsForPopover', () => {
  it('badges live jobs and sorts settled newest finished first', () => {
    const { live, settled, badge } = jobsForPopover([
      { id: 'a', status: 'running', startedAt: 20 },
      { id: 'b', status: 'ok', startedAt: 1, finishedAt: 5 },
      { id: 'c', status: 'ok', startedAt: 2, finishedAt: 9 },
      { id: 'd', status: 'stopping', startedAt: 10 },
    ])
    expect(badge).toBe(2)
    expect(live.map((j) => j.id)).toEqual(['d', 'a'])
    expect(settled.map((j) => j.id)).toEqual(['c', 'b'])
  })

  it('hides the popover data when there are no jobs', () => {
    expect(jobsForPopover([]).badge).toBe(0)
  })
})

describe('childSessions', () => {
  it('returns subagent children of one parent', () => {
    const rows = childSessions('p', [
      { sessionId: 'c1', origin: 'subagent', parentSessionId: 'p' },
      { sessionId: 'c2', origin: 'subagent', parentSessionId: 'other' },
      { sessionId: 'fork', origin: 'fork', parentSessionId: 'p' },
    ])
    expect(rows.map((s) => s.sessionId)).toEqual(['c1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dsh-jobs-subagent-model.test.mjs`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement models and chrome**

`jobs-model.mjs`:

```js
const LIVE = new Set(['running', 'stopping'])

export function jobsForPopover(jobs = []) {
  const live = jobs.filter((job) => LIVE.has(job.status)).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  const settled = jobs
    .filter((job) => !LIVE.has(job.status))
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
  return { live, settled, badge: live.length }
}
```

`subagent-model.mjs`:

```js
export function childSessions(parentSessionId, sessions = []) {
  return sessions.filter(
    (session) =>
      session.origin === 'subagent' &&
      (session.parentSessionId === parentSessionId || session.parentId === parentSessionId),
  )
}
```

`JobsPopover.jsx`: props `{ jobs }`. If `!jobs?.length` return null. List live then settled.

`SubagentCatalog.jsx`: props `{ parentSessionId, sessions, onOpen }`. Map `childSessions`. Click → `onOpen(child.sessionId)`.

`Trajectory.jsx`: dump `projections.trajectory` or token-usage rows as a simple table; register page `trajectory`.

In `app.jsx` Session header: `<JobsPopover jobs={selected.jobs} />` and `<SubagentCatalog … />`. View tabs: Conversation | Trajectory (trajectory tab only if projection present).

In `turn-fold.mjs`, add a case for `event.type === 'tool-workflow/run-start'` pushing `{ kind: 'workflow-run', runId, status: 'running', members: [] }` and update members on `tool-workflow/member-start` / `member-end` / `run-end` (ignore unknown if fields missing). Add a fold unit test in `tests/dsh-turn-fold.test.mjs` with one start + one end event.

Todo dock in Composer: `const todos = session.projections?.todos`; if `Array.isArray(todos) && todos.length` render the list.
Goal dock: `const goal = session.projections?.goal`; if `goal?.text` render one line above the composer.
Deliverables: if a turn-end block has `locations` (array of `{ path }`), render chips after that turn.
Message feedback: if the host lists `feedback.submit`, show 👍/👎 on assistant text blocks calling `rpc('feedback.submit', { sessionId, seq: block.seq, rating })`. Add `'feedback.submit'` to `PASSTHROUGH_METHODS` in this task when missing.
Details: `Shell.jsx` has `detailsOpen` + `detailsChild`, default closed. Tool-row Inspect opens it. Viewport width `< 900` forces it closed.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/dsh-jobs-subagent-model.test.mjs tests/dsh-turn-fold.test.mjs tests/module-boundary.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/dsh/ui/models/jobs-model.mjs \
  src/modules/dsh/ui/models/subagent-model.mjs \
  src/modules/dsh/ui/chrome/JobsPopover.jsx \
  src/modules/dsh/ui/chrome/SubagentCatalog.jsx \
  src/modules/dsh/ui/pages/trajectory \
  src/modules/dsh/turn-fold.mjs \
  src/modules/dsh/ui/app.jsx \
  src/modules/dsh/ui/Composer.jsx \
  tests/dsh-jobs-subagent-model.test.mjs \
  tests/dsh-turn-fold.test.mjs
git commit -m "$(cat <<'EOF'
feat(dsh): surface jobs, subagents, trajectory, and workflow runs

Sidebar stays free of subagent-origin rows; the parent header is the entry.
EOF
)"
```

---

### Task 14: Product docs (D-23) and module comments

**Files:**
- Modify: `docs/product/decisions.md` (append D-23, mark D-13/D-16/D-18 superseded)
- Modify: `docs/product/definition.md` (明确不承诺)
- Modify: `docs/product/ui-console.md` (rewrite title + IA to match the spec wireframe; delete 驾驶舱 from the title)
- Modify: `docs/product/roadmap.md` (终验清单 → spec 成功标准)
- Modify: `src/modules/dsh/module.mjs` comment (remove D-13 “we do not touch settings”)

**Interfaces:**
- Consumes: spec “推翻的旧决策” table
- Produces: D-23 text exactly as below

- [ ] **Step 1: Write the failing test**

Create `tests/dsh-product-copy.test.mjs`:

```js
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('product docs for the full client', () => {
  it('records D-23 and no longer titles the surface 驾驶舱', () => {
    const decisions = readFileSync(path.resolve(process.cwd(), 'docs/product/decisions.md'), 'utf8')
    expect(decisions).toMatch(/### D-23/)
    expect(decisions).toMatch(/被 D-23 取代/)
    const ui = readFileSync(path.resolve(process.cwd(), 'docs/product/ui-console.md'), 'utf8')
    expect(ui.startsWith('# 驾驶舱')).toBe(false)
    expect(ui).toMatch(/DeepSeek Harness/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dsh-product-copy.test.mjs`
Expected: FAIL — no D-23

- [ ] **Step 3: Write the docs**

Append to `decisions.md`:

```md
### D-13 · 明确不做清单
- 状态：**被 D-23 取代**（settings/credentials 写、工作区与 preset 管理改为要做）。

### D-16 · 驾驶舱中栏是台账，不是气泡流
- 状态：**被 D-23 取代**（中栏改为 DSH Web 对话流）。

### D-18 · v1 无第三栏
- 状态：**被 D-23 取代**（允许按需 details）。

### D-23 · 扩展是 DSH Web 的完整客户端
- 决策：本机 `dsh` 仍执行工具。扩展原生重做全部 DSH Web 表面（工作区、Agent Preset、设置/凭据、jobs、skills、subagents、plan、workflow、轨迹）。对外名称是 DeepSeek Harness，不用驾驶舱。浮窗/popup 仍只做对话与审批。
- 理由：使用者不应再打开 :3080。
```

`definition.md` 明确不承诺 first two bullets become:

```md
- 不替代本机 harness 进程——工具执行永远在引擎侧。扩展完整替代 DSH Web 客户端（设置、凭据、工作区、preset）。
- 扩展不执行任何工具——浏览器是眼睛和嘴，不是手。
```

`ui-console.md`: change H1 to `# DeepSeek Harness UI` and replace the layout ascii with the spec’s wireframe. Remove the v1「不做 workspaces…」list; replace with a pointer to the spec surface table.

`roadmap.md` 终验 A 条改为 spec 成功标准四条。

`module.mjs` comment: delete the D-13 sentence about not touching settings/credentials.

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/dsh-product-copy.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/product/decisions.md docs/product/definition.md \
  docs/product/ui-console.md docs/product/roadmap.md \
  src/modules/dsh/module.mjs tests/dsh-product-copy.test.mjs
git commit -m "$(cat <<'EOF'
docs: record D-23 — the extension is the full DSH Web client

Supersede the old settings/ledger/no-third-column cuts.
EOF
)"
```

---

### Task 15: Final verification

**Files:** none new. Touch only if a check fails.

- [ ] **Step 1: Locale and boundary**

Run: `npx vitest run tests/dsh-review-fixes.test.mjs tests/module-boundary.test.mjs tests/dsh-product-copy.test.mjs`
Expected: PASS. `module-boundary` still allows only `../api.mjs` from module internals.

- [ ] **Step 2: Full dsh + related unit suite**

Run: `npx vitest run tests/dsh-*.test.mjs tests/module-boundary.test.mjs tests/sidepanel-path.test.mjs tests/action-badge.test.mjs`
Expected: PASS

- [ ] **Step 3: Source scan leftovers**

Run:

```bash
rg -n "Open the cockpit|Open cockpit|驾驶舱" src/_locales src/modules/dsh/ui src/popup/ChatPanel.jsx src/components/ConversationCard/index.jsx
```

Expected: no matches.

- [ ] **Step 4: Float still isolated**

```bash
rg -n "modules/dsh/ui/pages" src/components src/popup src/background/providers/dsh-bridge.mjs
```

Expected: no matches.

- [ ] **Step 5: Commit only if Step 3/4 forced a fix; otherwise stop**

If a leftover string or import existed, fix and:

```bash
git add -u
git commit -m "$(cat <<'EOF'
fix(dsh): finish leftover cockpit copy and page-import leaks

The full-client surface must stay isolated from the floating card.
EOF
)"
```

---

## Spec coverage

| Spec section | Task |
| --- | --- |
| Naming / no 驾驶舱 | 1, 10, 14, 15 |
| Workspace list/add/rename/archive + pickDirectory | 2, 6, 8, 10 |
| Agent preset picker + lock + roster | 3, 8, 11 |
| session.create with workspace + preset | 6, 10 |
| Privileged settings/credentials/llm | 4, 6, 11 |
| Conversation flow (not 台账) | 9, 10 |
| Commands / skills / permission / plan / queue | 12 |
| Jobs / subagents / trajectory / workflow / todos / goals / deliverables / feedback / details | 13 |
| Float/popup unchanged isolation | 1, 15 |
| D-22 carrier tab unchanged | (no task — do not edit downlink-bridge) |
| Product docs D-23 | 14 |
| Module seam | 5, 15 |
| Default module off | (no change to `dshModuleEnabled`) |

## Type names (do not drift)

`groupSessionsForSidebar`, `canCompose`, `isSubagentSession`, `pickerPresets`, `isPresetLocked`, `presetLabel`, `defaultPresetId`, `settingsMutatePayload`, `isSettingsConflict`, `fieldsFromDescribe`, `sectionsFromDescribeResult`, `applyPortMessage`, `permissionOptions`, `planChipVisible`, `jobsForPopover`, `childSessions`, `registerPage`, `PASSTHROUGH_METHODS`.
