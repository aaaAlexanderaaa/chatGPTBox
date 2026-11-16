---
doc_type: guide
status: current
authority: guidance
last_reconciled: 2026-11-16
projection_of: ["docs/api-server.md", "docs/chatgpt-web-genui.md"]
---

# Drafts actions for ChatGPTBox

Use the same Drafts actions for ChatGPT and Gemini: list conversations, open one,
send a question and collect its answer. The [gateway contract](../api-server.md) owns authentication,
request identity and recovery; the [renderer contract](../chatgpt-web-genui.md)
owns portable answer HTML and supported components.

There are five public actions. For frequent updates on a Mac, initialize the
shared-library installation once, then use the update command below. Maintained
provider code and resources live in
[`scripts/drafts`](../../scripts/drafts/); generated JavaScript lives in
[`scripts`](scripts/). These development files are not additional actions to
install. Each import package includes its own code and resources.

## One-command updates on Mac

After initialization, run this from the repository whenever the code changes:

```bash
npm run drafts:update
```

The five actions load the updated scripts and Preview template the next time
they run. The command generates and copies code, reusing the Preview build when
its inputs are unchanged. It retains the existing **ChatGPTBox Gateway**
Credential and `ChatGPTBox/settings.json`. Routine updates involve no action
editor, import dialog, key entry, regression suite or provider request.

For the one-time initialization of an existing Mac installation:

```bash
npm run drafts:update -- --install
```

Choose **Replace Existing Group** in Drafts. The installer reads existing action
groups to retain action identities, shortcuts and other preferences, prepares
native import packages and opens them through Drafts' normal importer. Group
snapshots are retained with those temporary packages and by native group version
history. Existing List/Get/Send/More/Preview entries become small launchers in
one **ChatGPTBox** group. The database is read only; imports remain owned by the
app. This initialization is already complete on the Mac updated on November 16.

The maintained assets live under
`iCloud Drive/Drafts/Library/Scripts/ChatGPTBox`. Native
[`require`](https://scripting.getdrafts.com/functions/require) reads the selected
version. A pointer is switched after all files have been copied, with the
preceding version retained. iCloud action, library-file and credential sync have
their own timing; wait for the library files to download on another device.
Preview remains offline once its files are present. Missing library files call
for downloading them or running the update command again. The updater operates
on its code directory and leaves notes, settings and credentials to their owners.

## Install and configure self-contained packages

Keep List, Get, Send and More in a **ChatGPTBox** action group. Put the large
offline Preview action in another group, such as an existing personal group, to
stay within Drafts' action-group size limit. List, Get and Send are the common
text-conversation entries; Preview and More add reading,
photos, Projects and older native history. No separate Gemini actions, helper
actions or resource-file installation is required.

| Action | Script / package | Purpose |
| --- | --- | --- |
| ChatGPTBox List Conversations | [package](chatgptbox-list.draftsAction), [script](scripts/action-1-list-conversations.js) | List the selected engine's conversations in an empty note |
| ChatGPTBox Get | [package](chatgptbox-get.draftsAction), [script](scripts/action-2-open-checked-conversation.js) | Open one checked conversation, refresh or collect its answer |
| ChatGPTBox Send | [package](chatgptbox-send.draftsAction), [script](scripts/action-3-send-waiting-reply.js) | Create a conversation or send its Waiting Reply |
| ChatGPTBox Preview | [package](chatgptbox-preview.draftsAction) | Read the note with offline layout and charts |
| ChatGPTBox More | [package](chatgptbox-more.draftsAction), [script](scripts/more.js) | Shared settings, supported photos, Project selection and older messages |

1. In the extension, open **Advanced → API Server Bridge → Open API Server Bridge**
   and enable **Enable API Server Bridge**.
2. Start the local gateway with `npm run api-server`.
3. First run **More → 设置**, choose your preferences and tap **保存**. The first
   network action then asks for **Gateway URL** and **Gateway API token**.
   Use the token from `~/.chatgptbox/gateway-api-token`. All actions share the
   **ChatGPTBox Gateway** credential; upgrading scripts retains it. The shared
   settings address takes precedence; if set there, leave the credential's URL
   blank. With neither address set, the default is `http://127.0.0.1:18080`.
   Use an address reachable from every device;
   `127.0.0.1` on an iPhone refers to the iPhone, not the Mac gateway. Drafts
   credentials sync through iCloud when enabled. **More → 设置** manages the shared
   address and preferences, and its **API token 设置说明** explains token
   reconfiguration. No token is stored in a settings file, note or import package.
4. Keep the bridge page open and stay logged in to the selected provider.
5. Enable history synchronization in **ChatGPT Web** settings and choose a
   conservative RPM for ChatGPT history. ChatGPT List reads that cache; it does
   not synchronize by itself. Gemini setup is described below.

For a manual self-contained upgrade:

1. Retain/export the old actions, their address/token and explicit model or
   thinking options before replacement.
2. Create or select the **ChatGPTBox** action group, then import the network
   action packages. Keep Preview in a separate group to avoid the native
   **Action Group Size Limit** warning.
   For List/Get/Send/More, choose **Replace** for the intended existing actions
   after retaining their customizations. Disable/rename any backup copies so you
   cannot accidentally run an older action. Preview is unchanged by the shared
   settings update and need not be imported again for this change.
3. Keep the original shared gateway credential. Run **More → 设置** to enter any
   previous model/display customizations once. Leave its address empty to retain
   the credential's address, or enter that same address explicitly. Import List,
   Get, Send and More together so every copy reads the same settings. Tap **保存**
   once to initialize the settings file, even when using the defaults. Later
   replacements retain the settings file and credential. Common Get can read an
   existing note without creating a question.
4. Disable/remove the old ChatGPT and Gemini entries before sending any new
   prefixed question; an old Send can interpret `:g` as ordinary ChatGPT text.
   Keep existing notes and pending identities.

An extension build does not install or replace actions in the user's Drafts app.

## Choose an engine with a note prefix

On a new, unbound note, use `:c ` for ChatGPT or `:g ` for Gemini at the very
beginning. No selector means ChatGPT. The selector can share the question's
first line or occupy its own first line:

```text
:g 请帮我分析这个问题。
```

For **List**, use an empty note or just `:g ` / `:c `; existing unsent text is
preserved with an error. For a new **Send**, the selector is removed from the
question before submission. **More → 选择 Project** uses the same selection rule;
Gemini does not support Projects or photos, and never redirects those operations
to ChatGPT. Unknown prefixes stop before HTTP and keep the note.

Saving a list, photo/Project preparation or first request binds the note's engine.
All subsequent Get/Send/More operations use that binding. Existing ChatGPT v2 and
recognizable legacy notes remain ChatGPT; Gemini v3 notes remain Gemini. Adding a
conflicting selector before a bound note fails before HTTP and preserves it. Use
a new note for another engine. A selector inside a reply, transcript or any other
body line is ordinary text and cannot change engines.

New saves also retain the gateway URL. Changing it blocks subsequent requests
from that note until the original configuration is restored. Keep the original
gateway and credential when upgrading old notes, which lack this URL field.

The user selected this prefix/binding behavior on 2026-11-15. Its normative owner
is [Drafts engine selection](../api-server.md#drafts-engine-selection).

Get and Send annotate each turn with ChatGPT's own thought/work duration when
available, without estimating missing durations.

## Shared settings in More

Run **More → 设置** from a new, list, conversation or pending note. Edit the
options once and tap **保存**; all List/Get/Send/More actions read the saved values
the next time they run. Opening, cancelling and saving this window makes no HTTP
request and leaves the current note and pending request unchanged.

| Setting | Meaning |
| --- | --- |
| **网关地址** | A reachable HTTP(S) gateway. Leave empty to use the existing shared Credential address, or its `http://127.0.0.1:18080` default. Do not put a token in the URL. Existing bound notes keep their original gateway; restore that address to continue them |
| **ChatGPT 模型** | An explicit model slug for new conversations and follow-ups. Leave empty to use the extension's current default for new conversations and the current conversation's model for replies when available. There is no copied default model to maintain |
| **ChatGPT：显示思考内容** | Include reasoning blocks in Get/Send output. Defaults off; this changes neither timing annotations nor model thinking effort |
| **API token 设置说明** | Keep using the shared **ChatGPTBox Gateway** Credential. To replace a token, Forget that credential in Drafts settings and run a network action to enter it again. The shared settings window does not erase credentials |

The model and reasoning-display options apply to ChatGPT; Gemini keeps its native
model/settings behavior. Already pending requests retain their original complete
payload and key even after settings change. Preview remains offline and separate.

The first explicit save creates `iCloud Drive/Drafts/ChatGPTBox/settings.json`
through Drafts' [FileManager](https://scripting.getdrafts.com/classes/FileManager).
There is no config file to install or action script to edit. The file contains
only the address and preferences; the API token stays in
[Credential](https://scripting.getdrafts.com/classes/Credential). Action upgrades
do not overwrite either store. File sync and action/credential sync are separate:
wait for this file to download on another device before using the actions there.
Concurrent offline edits are not merged.

Missing settings stop the network action before any request: first-time users
must save once through **More → 设置** (the form offers the original defaults).
If you already configured another device, wait for that file to sync/download
instead of creating new defaults. This prevents an unsynced device silently
ignoring your preferences. Existing unreadable or invalid settings also stop
before any request. For
an unreadable file, restore iCloud access/download it and retry. For malformed or
unsupported settings, **More → 设置** offers **重新设置**; the existing file is
replaced only after **保存**. Cancel keeps it. A changed file while the window is
open requires reopening settings. Saving stages and checks the file before
overwriting it with the verified staged text and checking the result; one small
staging file remains for the next save. A failed or unconfirmed save is reported
as an error. The [interface contract](../api-server.md#drafts-shared-settings)
owns these boundaries.

## List, open, send and collect

1. Run **List**, check exactly one conversation, then **Get** to open it. Use
   Full Sync in the extension when the cached list needs refreshing.
2. Type inside **Waiting Reply**, between its document-bound start/end comments.
   Run **Send** to submit that question.
3. Send keeps the question and an `ASSISTANT (pending)` placeholder while the
   provider continues. A request receipt is not a finished answer.
4. Run **Get** on that same note to collect the answer. Listing again is
   unnecessary, and Get preserves any next question already typed.

On a fresh ordinary note, Send treats the note as the first prompt and creates a
conversation with the same pending transcript/anchor. On an opened conversation
with an empty Waiting Reply, Send refreshes instead; Get is the direct refresh
operation. Send refuses a List note before making an HTTP request—open the
intended conversation with Get first.

The ChatGPT version-2 document state binds the generated controls to this document.
New notes start with their title and readable content; document state is kept in
a trailing HTML comment. Older leading comments remain readable and move to the
end on the next save. Transcript, titles, thinking and questions remain data.
Edit the Waiting Reply text and retain the state, IDs and operation metadata. Duplicate/damaged controls or conflicting
pending identities stop before requests and preserve the complete note.

Recognizable legacy lists and unique old conversation notes with a matching
Waiting Reply structure can migrate while keeping their identities. Standalone
old photo/new-send comments in ordinary notes, fenced examples and conflicting
controls cannot establish a safe owner. Keep a rejected note and its IDs for
inspection; Get or a freshly generated List/Get note can read the original
conversation. Copying an uncertain question into a new send is not recovery.

## ChatGPT pending sends and recovery

Send saves an operation ID and the **complete original request** before the HTTP
write. Retrying an unresolved operation reuses that ID, question, model/thinking
options, photos and Project. Text edited afterward remains unsent. Get keeps the
ID/request even if Waiting Reply is emptied. Missing original request data stops
recovery instead of guessing.

| Observation | What Get/Send keeps or does |
| --- | --- |
| No acknowledgement, or submission uncertain | Keep the operation ID and frozen request; inspect the operation/conversation without resending |
| Snapshot does not yet contain the sent question | Keep the user block, pending placeholder and exact awaited message ID |
| Matching question exists but its answer is unfinished | Keep the placeholder and anchor; interim text does not confirm completion |
| Exact matched turn has a finished answer | Replace its placeholder and release that awaited anchor |
| Failure explicitly says `dispatched: false` | Release the unsent operation; a later manual Send may use an edited request |

Turn matching uses `pendingMessageId`, not question text. A finished assistant
reply must belong to that user message before the next user message; a finished
fragment with `endTurn: false` or `isFinal: false` is insufficient. `pending` can
veto completion, but `pending: false` alone cannot prove it. An absent message ID
remains unresolved for inspection. While awaiting an answer, Send preserves the
next question/photos and asks for Get instead of replacing the pending anchor.

If an operation already has a successful acknowledgement, Send recovers it and
leaves later edited text in Waiting Reply. Get the original answer before sending
the edited question. If the outcome is unknown, keep the original ID: changing a
key or question cannot prove the earlier write failed.

Text and photo sends share the gateway's **seven-day recovery window**. Expired
or unknown-age IDs remain available for inspection and cannot be replayed. A full
ledger rejects new keys before submission while existing operations can recover.
An unavailable ledger does not prove a previous send failed. Only a positive
unsent result releases protection; timeouts and stream parsing failures remain
uncertain. The gateway's narrowly identified historical runtime rejection repair
does not turn other old errors into unsent proof.

## Gemini history, requests and continuation

Use the common List/Get/Send actions with `:g ` on a new note. List reads pinned
and ordinary native history; repeating List on its list loads another page.
**More → 加载更早消息** prepends the next native turn page while retaining recent
text and Waiting Reply. The original November 13 v3 note format remains readable.

Enable Gemini in `Settings → Engines`, check its account in `Gemini Web`, and
grant the required generation, append, list and read operations under
`External engine access`. API, MCP and Drafts share that gateway authority.
The [Gemini contract](../gemini-web.md) owns model, account and recovery limits.
Keep the extension bridge connected; the ChatGPT login is not Gemini's login.

Use a new note for List, check one row and Get. Run List again on that list for
the next page; a new empty note starts from the first page. Get retains Waiting
Reply when refreshing. Older refuses to change a note with an unresolved request,
and a changed native head asks for a visible Get refresh before continuing.

Send saves the entire original request and key before HTTP. Its receipt confirms
registration, not provider completion. Get observes that exact run; after a lost
receipt it looks up the original key with `/operations/:key`, never resends the
question. A second Send while pending also only observes the original operation.
Later edits stay in Waiting Reply. Only a verified final result replaces its
pending block; explicit unsent proof retains the original text and allows a later
manual decision. Unknown, expired or missing identities do not authorize replay.

Version-3 Gemini document state binds its generated controls to the note. New
saves place it at the end, while retaining older leading comments on read. Keep
the state and pending metadata intact. Common Get/Send dispatch version-2 ChatGPT
notes to their original adapter. List refuses to replace a conversation, preserving
its transcript, unsent draft and operation identity. Captured account credentials
never enter the note or import packages.

Get refreshes only the marked history region, preserving your title, notes outside
that region, and Waiting Reply. Put personal annotations outside the history
markers. If generated history or pending text was edited, the actions keep the
complete note and stop before HTTP or replacement; use a fresh List/Get note if
you need to retain those edits. The edit checksum detects accidental changes;
it does not authenticate a note or establish device synchronization.

Maintain [the Gemini adapter](../../scripts/drafts/gemini.js.txt), then run
`npm run sync-drafts-engines`; extension builds regenerate scripts and packages.
Repository VM/HTTP tests establish control, payload and recovery behavior. Native
Drafts import and device/iCloud acceptance are tracked separately in the
[delivery record](../plans/2026-11-13-gap-closure.md).

On November 14 the generated scripts also used the real gateway to list/open a
Gemini conversation, append with Hydrogen / Medium, recover a deliberately lost
receipt by its original key, collect the verified final result and load older
native pages. Future Waiting Reply and outside notes survived. This exercised
the scripts in a VM, not an installed Drafts app; the user deferred native
import/device/iCloud acceptance for this round. Existing configured Drafts
copies require importing the common packages and transferring their original
endpoint and credential to the shared credential. This dated VM observation is
not fresh native Drafts acceptance of the November 15 common actions.

<a id="photos-and-projects"></a>

## ChatGPT photos and Projects

1. Create the desired Project/instructions in ChatGPT, then run **More → 选择 Project**
   on a fresh note. This selects an existing Project for its first conversation;
   it does not move an already opened conversation.
2. Run **More → 添加照片** and choose up to four photos. The picker converts them
   to JPEG with a maximum 1600-pixel long side. When no question exists it inserts
   an editable dated meal-record prompt for portions, nutrition ranges and
   uncertainties; you can replace that prompt.
3. Run **Send**, then **Get** to check preparation and collect the acknowledged
   turn. Future unsent photos/text remain separate until the previous send is
   resolved. An unresolved send blocks replacing its original photos.

Pending photo bytes live in JSON files in Drafts' **local private directory**;
only file paths/attachment metadata enter the note. Upload failure retains those
files for retry. They do not sync to another device. Successful staging creates
an independent seven-day gateway copy, usable by another device connected to that
same gateway. Local staging files remain retained; this is not photo-library
management or cross-device offline capture.

Get reads an operation even before a conversation ID exists; successful upload
alone does not mean the question was sent. After a lost photo follow-up
acknowledgement, Get can read the original conversation and confirm the gateway's
exact message ID, preserving the next question. An older identical question or
failed/missing read cannot release the ID. An uncertain new conversation with no
known conversation ID requires manual inspection and is never replayed.

The picker uses [Drafts HTML forms and Drafts.send](https://docs.getdrafts.com/docs/actions/html-forms).
Its HTML contains no gateway token and cannot make network requests. Camera and
chooser behavior still need native device validation. Shortcuts capture can use
the gateway's staging endpoint for base64 JPEG/PNG/WebP and save returned metadata
in the photo control; keep raw bytes out of the editable note. Fields, limits and
expiration are in the gateway guide.

## HTML Preview

Import [ChatGPTBox Preview](chatgptbox-preview.draftsAction) in Drafts. Its single
HTML Preview step packages [the complete HTML](templates/chatgptbox-preview.html), styles
and chart runtime without a gateway token. If package import is unavailable,
create **ChatGPTBox Preview**, add an **HTML Preview** step and use its **Import**
button to load the complete HTML. Leave **Hide interface** off. The package uses
the structure of the [official Preview action](https://actions.getdrafts.com/a/1Ct).

The action is the common iPhone/iPad/Mac entry. After the note and action have
synced, the packaged layout and chart runtime need no network/CDN/gateway or separate resource files;
Get/Send still require the gateway. The optional Mac/iPad live preview window
uses the same complete file under `iCloud Drive/Drafts/Library/Templates`, selected
in that window. iPhone has no separate live preview window. Template-file sync
and action sync are separate; download the template before offline use. See the
[custom-template options](https://docs.getdrafts.com/docs/editor/previews).

The HTML uses `%%[[draft]]%%`, inline styles and the packaged chart script. Keep
HTML enabled in the Markdown parser so the gateway's portable HTML survives.
The reading view hides gateway metadata and supports light/dark appearance,
narrow-screen stacking and table-local scrolling. Supported offline charts have
values, legends, local navigation and a **图表数据** source table; without JavaScript
the table remains open. Missing/negative values retain their meaning. Unsupported
components/properties use official Markdown fallback rather than executing
model-generated code. Precise supported shapes belong to the renderer contract.

## Updating and troubleshooting

For the shared-library installation, run `npm run drafts:update` to deploy the
current action code and Preview together. The following manual-replacement
guidance applies to self-contained copies.

An extension update does not replace installed Drafts scripts or Preview copies.
Replace the affected layer, preserve configuration, then fetch an existing answer
again when its stored transcript needs regeneration.

| Symptom / update | Action |
| --- | --- |
| Document controls differ or a copied action still hardcodes an old model | Replace the common actions together; keep the shared credential and enter prior customizations once through More → 设置 |
| A shared setting is ignored | Replace List/Get/Send/More together and wait for `Drafts/ChatGPTBox/settings.json` to sync/download. Old installed copies do not read it |
| A settings-file error blocks requests | Restore iCloud access/download the file; use More → 设置 for explicit repair of malformed settings. Keep the original gateway for bound notes |
| Runtime/account/verification/network-transport recognition fails | Update/reload the extension and refresh its dedicated ChatGPT proxy and bridge pages. A Drafts-script replacement cannot repair website-runtime recognition; this error alone is not an account-suspension notice |
| An old note contains missing code blocks, chart JSON or incomplete layout | Update/reload the extension, then Get again. For packaged chart interactions also replace Preview; old Markdown cannot acquire lost layout from CSS alone |
| A fresh send is incorrectly called older than seven days | Update Get, Send and More. Current scripts parse saved ISO times with `new Date(value).getTime()` for Drafts compatibility; preserve the marker and original request. Truly expired or invalid ages still block replay |
| A write timed out or lost acknowledgement | Keep its ID and use Get/operation inspection; never generate a new key merely to retry |

Maintain the router, `settings.shared.txt`, provider fragments, `control-document.shared.txt`,
`photo-operation.shared.txt` and `photo-picker.html` under
[`scripts/drafts`](../../scripts/drafts/). `npm run sync-drafts-engines`
regenerates the four common network scripts/packages; `sync-drafts-photos` is a
retained alias. Use `node scripts/sync-drafts-engines.mjs --check` to detect stale
artifacts. Provider fragments are wrapped in separate function scopes, with a
buffered note and explicit durable saves before writes. The alias/operation
registry is in [engine-routing.js.txt](../../scripts/drafts/engine-routing.js.txt);
adding a provider also requires its actual adapter, without capability fallback.
The [document layout](../../scripts/drafts/document-layout.shared.txt) owns reading
leading/trailing state and writing a readable title followed by content and
trailing state. Provider adapters keep their original in-memory envelope; the
common persistence boundary controls the saved layout.

Maintain `scripts/drafts/chatgptbox-preview.source.html`, shared CSS and the
chart runtime; `npm run sync-drafts-preview` regenerates the template/package and protects
script/template delimiters with an exact CSP hash. Extension builds run both
steps. Import regenerated copies into Drafts separately.

Repository tests cover controlled local capture, exact-request recovery and a
synthetic HTTP bridge. Browser previews cover rendered output; camera behavior
and device/iCloud sync require their own native checks.

On November 16, local macOS Drafts 52.0.1 group replacement installed the current
four network actions and Preview while retaining the existing gateway credential and
preferences. More's settings editor saved an existing file after the native
overwrite correction. One List and one Get opened an existing complete answer;
native Preview displayed its text, tables and official thinking durations. The
four personal actions and existing notes were retained, and the disposable
verification note was moved to Trash. No new provider generation was submitted.
The native group size warning was resolved by keeping Preview with the personal
actions and the four network actions in ChatGPTBox. This observes local group
replacement and reading, with phone/tablet, camera, cross-device synchronization
and individual-package import acceptance remaining separate checks.
That earlier settings correction passed 148 focused tests across settings,
engine routing, pending-operation recovery, photos and Gemini on Node.js 22.23.5;
affected JavaScript lint, generated-artifact checks and documentation checks
passed. Documentation retained six existing historical-link advisories.

Later on November 16, the user requested readable note beginnings and a simple
frequent-update command, with regression verification and key automation omitted
from that workflow. The five installed actions were replaced by shared-library
launchers in one group. Two existing leading-state notes were converted through
Drafts after saving native note versions, retaining their original state and
pending request. Native Preview loaded the shared template and displayed the
readable title, text and table. The earlier 148-test result belongs to the
preceding settings change; it is separate from this layout/updater delivery.
The [November 15 delivery record](../plans/2026-11-15-drafts-engine-prefix.md)
records prefix routing, common packages, legacy compatibility and actual checks.
The [shared-settings delivery record](../plans/2026-11-15-drafts-shared-settings.md)
records the settings editor, common file reads and observed verification limits.
The scripts use Drafts' [HTTP](https://scripting.getdrafts.com/classes/HTTP.html)
and [Draft](https://scripting.getdrafts.com/classes/Draft.html) runtime objects.
