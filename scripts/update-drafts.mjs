/* eslint-env node */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { syncDraftsActions } from './sync-drafts-engines.mjs'
import { syncDraftsPreview } from './sync-drafts-preview.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const cloud = path.join(
  os.homedir(),
  'Library/Mobile Documents/iCloud~com~agiletortoise~Drafts5/Documents',
)
const library = path.join(cloud, 'Library/Scripts/ChatGPTBox')
const digest = (value) => createHash('sha256').update(value).digest('hex')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const entries = [
  ['list', 'action-1-list-conversations.js', ['list gpt conversation']],
  ['get', 'action-2-open-checked-conversation.js', ['get conversation']],
  ['send', 'action-3-send-waiting-reply.js', ['reply conversation']],
  ['preview', null, ['html preview']],
  ['more', 'more.js', ['2 attach-photos', '1 select-project']],
]

function atomicWrite(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(Buffer.from(content))) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const staged = file + '.pending'
  fs.writeFileSync(staged, content)
  fs.renameSync(staged, file)
}

function previewInputs() {
  const files = [
    'scripts/sync-drafts-preview.mjs',
    'scripts/drafts/chatgptbox-preview.source.html',
    'package-lock.json',
  ]
  function visit(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = path.posix.join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else files.push(file)
    }
  }
  visit('src/components/MarkdownRender')
  return digest(
    files
      .sort()
      .map((file) => file + '\0' + read(file))
      .join('\0'),
  )
}

function launcher(entry) {
  return `/* global FileManager, require */
// ChatGPTBox shared-library launcher v1. Update with: npm run drafts:update
const CHATGPTBOX_RELEASE = FileManager.createCloud().readJSON('/Library/Scripts/ChatGPTBox/current.json');
if (CHATGPTBOX_RELEASE?.version !== 1 || !/^[a-f0-9]{64}$/.test(CHATGPTBOX_RELEASE.revision || ''))
  throw new Error('请先运行 npm run drafts:update，并等待 Drafts 的共享脚本完成下载。');
const CHATGPTBOX_ASSET_PATH = '/Library/Scripts/ChatGPTBox/versions/' + CHATGPTBOX_RELEASE.revision;
require('ChatGPTBox/versions/' + CHATGPTBOX_RELEASE.revision + '/${entry}.js');
`
}

function readInstalledGroups() {
  const database = path.join(
    os.homedir(),
    'Library/Group Containers/GTFQ98J4YG.com.agiletortoise.Drafts/DraftStore.sqlite',
  )
  if (!fs.existsSync(database)) return []
  const source = `import sqlite3,json,sys,pathlib
c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)
c.row_factory=sqlite3.Row
result=[]
for r in c.execute('SELECT * FROM ZMANAGEDACTIONGROUP WHERE ZHIDDEN=0'):
 result.append(dict(name=r['ZNAME'],uuid=r['ZUUID'],actions=json.loads(r['ZACTIONDATA']),changeTag=r['ZCHANGE_TAG'] or '',icon=r['ZICON'],tintColor=r['ZTINT_COLOR'],visibility=r['ZVISIBILITY'],disposition=r['ZDISPOSITION'],hidden=False,createdAt=r['ZCREATED_AT'],modifiedAt=r['ZMODIFIED_AT']))
print(json.dumps(result))`
  return JSON.parse(
    execFileSync('python3', ['-c', source, database], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
  )
}

function prepareInstall() {
  const groups = readInstalledGroups()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-drafts-install-'))
  fs.chmodSync(directory, 0o700)
  const target = groups.find((group) => group.name === 'ChatGPTBox') || {
    name: 'ChatGPTBox',
    uuid: randomUUID().toUpperCase(),
    actions: [],
    icon: 'action_openai',
    tintColor: 'green',
    visibility: 2016,
    disposition: 0,
    hidden: false,
    changeTag: '',
    createdAt: Date.now() / 1000 - 978307200,
    modifiedAt: Date.now() / 1000 - 978307200,
  }
  const packages = entries.map(([entry]) =>
    JSON.parse(read('docs/drafts/chatgptbox-' + entry + '.draftsAction')),
  )
  const owned = new Set(packages.flatMap((action, index) => [action.name, ...entries[index][2]]))
  const installed = groups.flatMap((group) => group.actions)
  const actions = packages.map((action, index) => {
    const entry = entries[index][0]
    const previous =
      installed.find((candidate) => candidate.name === action.name) ||
      installed.find((candidate) => entries[index][2].includes(candidate.name))
    return {
      shouldRequirePro: false,
      backingIsSeparator: false,
      backingPlatforms: 3,
      shortName: '',
      backingAssignFlag: 0,
      keyCommand: {
        commandKey: false,
        input: '',
        shiftKey: false,
        type: 'action',
        controlKey: false,
        optionKey: false,
      },
      ...action,
      ...previous,
      name: action.name,
      groupUUID: target.uuid,
      actionDescription: 'Shared script; update with npm run drafts:update.',
      steps: [
        {
          uuid: previous?.steps[0]?.uuid || randomUUID().toUpperCase(),
          type: 'script',
          platforms: 3,
          isEnabled: true,
          data: { script: launcher(entry), allowAsync: 'false' },
        },
      ],
    }
  })
  const files = []
  function save(name, group) {
    const file = path.join(directory, name + '.draftsActionGroup')
    fs.writeFileSync(file, deflateSync(JSON.stringify(group)), { mode: 0o600 })
    return file
  }
  // Native imports preserve app-managed synchronization and group version history.
  for (const [index, group] of groups.entries()) {
    if (!group.actions.some((action) => owned.has(action.name))) continue
    save('backup-' + index, group)
    if (group !== target)
      files.push(
        save('retain-group-' + index, {
          ...group,
          actions: group.actions.filter((action) => !owned.has(action.name)),
        }),
      )
  }
  files.push(
    save('ChatGPTBox', {
      ...target,
      actions: [...target.actions.filter((action) => !owned.has(action.name)), ...actions],
    }),
  )
  for (const file of files) console.log('初始化导入：' + file)
  if (process.argv.includes('--install')) execFileSync('open', files)
}

async function main() {
  if (process.platform !== 'darwin' || !fs.existsSync(cloud))
    throw new Error('请先在这台 Mac 启动 Drafts 并启用 iCloud Drive，然后重新运行更新命令。')
  fs.mkdirSync(library, { recursive: true })
  await syncDraftsActions()
  const inputs = previewInputs()
  let cache
  try {
    cache = JSON.parse(fs.readFileSync(path.join(library, 'build.json'), 'utf8'))
  } catch {
    /* first update */
  }
  const templateFile = 'docs/drafts/templates/chatgptbox-preview.html'
  if (
    cache?.previewInputs !== inputs ||
    !fs.existsSync(path.join(root, templateFile)) ||
    cache.previewOutput !== digest(read(templateFile))
  )
    await syncDraftsPreview()
  const assets = new Map(
    entries
      .filter((entry) => entry[1])
      .map(([entry, file]) => [entry + '.js', read('docs/drafts/scripts/' + file)]),
  )
  assets.set('preview.html', read(templateFile))
  assets.set('layout.js', read('scripts/drafts/document-layout.shared.txt'))
  assets.set(
    'preview.js',
    `/* global FileManager, HTMLPreview, draft, context, CHATGPTBOX_ASSET_PATH */
const previewTemplate = FileManager.createCloud().readString(CHATGPTBOX_ASSET_PATH + '/preview.html');
if (typeof previewTemplate !== 'string') throw new Error('请等待 Drafts 预览模板下载完成，或运行 npm run drafts:update。');
if (!HTMLPreview.create().show(draft.processTemplate(previewTemplate))) context.cancel();
`,
  )
  const revision = digest([...assets].map(([file, content]) => file + '\0' + content).join('\0'))
  const directory = path.join(library, 'versions', revision)
  for (const [file, content] of assets) atomicWrite(path.join(directory, file), content)
  atomicWrite(path.join(directory, '.chatgptbox-generated'), revision)
  let current
  try {
    current = JSON.parse(fs.readFileSync(path.join(library, 'current.json'), 'utf8'))
  } catch {
    /* first update */
  }
  if (current?.revision !== revision)
    atomicWrite(
      path.join(library, 'current.json'),
      JSON.stringify({ version: 1, revision, previousRevision: current?.revision || null }),
    )
  atomicWrite(
    path.join(library, 'build.json'),
    JSON.stringify({ previewInputs: inputs, previewOutput: digest(assets.get('preview.html')) }),
  )
  const keep = new Set([
    revision,
    current?.revision === revision ? current.previousRevision : current?.revision,
  ])
  for (const entry of fs.readdirSync(path.join(library, 'versions'))) {
    const old = path.join(library, 'versions', entry)
    if (
      /^[a-f0-9]{64}$/.test(entry) &&
      !keep.has(entry) &&
      fs.existsSync(path.join(old, '.chatgptbox-generated'))
    )
      fs.rmSync(old, { recursive: true })
  }
  console.log('Drafts 共享脚本已更新。已初始化的五个动作下次运行即生效。')
  if (process.argv.includes('--install') || process.argv.includes('--prepare-install'))
    prepareInstall()
}

await main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
