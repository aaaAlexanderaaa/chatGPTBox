---
doc_type: guide
status: current
authority: guidance
last_reconciled: 2026-11-14
projection_of: ["docs/api-server.md", "docs/chatgpt-web-genui.md"]
---

# Drafts actions for ChatGPTBox

Use Drafts to list existing ChatGPT conversations, open one, send a question and
collect its answer. The [gateway contract](../api-server.md) owns authentication,
request identity and recovery; the [renderer contract](../chatgpt-web-genui.md)
owns portable answer HTML and supported components.

The original five actions continue to use ChatGPT conversation endpoints and
keep their model, photo and Project behavior. Gemini uses the separate actions
below and the common engine/run interface. A Gemini selector is not a supported
`MODEL_OVERRIDE` in the old ChatGPT Send action. The two note formats reject one
another before requests, preventing an accidental send to the wrong provider.

## Install and configure

Update **all five actions together** so their document header and control format
agree. Preserve your gateway address, token and explicit model options when
replacing installed copies.

| Action | Script / package | Purpose |
| --- | --- | --- |
| ChatGPTBox List Conversations | [Action 1](action-1-list-conversations.js) | Replace the note with a cached conversation task list |
| ChatGPTBox Open Checked Conversation (Get) | [Action 2](action-2-open-checked-conversation.js) | Open one checked conversation or refresh the current note |
| ChatGPTBox Send Waiting Reply (Send) | [Action 3](action-3-send-waiting-reply.js) | Create a conversation or send the waiting reply |
| ChatGPTBox Attach Photos | [Action 4](action-4-attach-photos.js), [import package](chatgptbox-attach-photos.draftsAction) | Capture/stage photos for the next send |
| ChatGPTBox Select Project | [Action 5](action-5-select-project.js), [import package](chatgptbox-select-project.draftsAction) | Choose an existing Project for a new conversation |

1. In the extension, open **Advanced → API Server Bridge → Open API Server Bridge**
   and enable **Enable API Server Bridge**.
2. Start the local gateway with `npm run api-server`. The scripts default to
   `http://127.0.0.1:18080`; set `BASE_URL` in **each of actions 1–5** to an address
   reachable from the device running Drafts. Network/authentication options are
   in the gateway guide.
3. Copy the token from `~/.chatgptbox/gateway-api-token` into each action's
   `API_TOKEN`. Keep these edited scripts private.
4. Keep the bridge page open and stay logged in at `https://chatgpt.com`.
5. Enable history synchronization in **ChatGPT Web** settings and choose a
   conservative RPM. List reads that cache; it does not synchronize by itself.

`MODEL_OVERRIDE = null` in Send delegates new conversations to the extension's
current ChatGPT Web default and follow-ups to the conversation's current model
when available. Set a model slug only for an explicit override. The default's
source is `src/config/limits.mjs`; copied actions need no separate default model.

Get and Send annotate each turn with ChatGPT's own thought/work duration when
available, without estimating missing durations. `INCLUDE_THINKING = true` in
both scripts also includes the reasoning blocks; it is independent of the timing
annotation and does not select a model's thinking effort.

## List, open, send and collect

1. Run **List**, check exactly one conversation, then **Get** to open it. Use
   Full Sync in the extension when the cached list needs refreshing.
2. Type inside **Waiting Reply**, between its document-bound start/end comments.
   Run **Send** to submit that question.
3. Send returns after acknowledgement while ChatGPT continues generating. The
   transcript keeps the user question and an `ASSISTANT (pending)` placeholder.
4. Run **Get** on that same note to collect the answer. Listing again is
   unnecessary, and Get preserves any next question already typed.

On a fresh ordinary note, Send treats the note as the first prompt and creates a
conversation with the same pending transcript/anchor. On an opened conversation
with an empty Waiting Reply, Send refreshes instead; Get is the direct refresh
operation. Send refuses a List note before making an HTTP request—open the
intended conversation with Get first.

The version-2 header binds the generated controls to this document. Transcript,
titles, thinking and questions remain data. Edit the Waiting Reply text, not the
header, IDs or operation metadata. Duplicate/damaged controls or conflicting
pending identities stop before requests and preserve the complete note.

Recognizable legacy lists and unique old conversation notes with a matching
Waiting Reply structure can migrate while keeping their identities. Standalone
old photo/new-send comments in ordinary notes, fenced examples and conflicting
controls cannot establish a safe owner. Keep a rejected note and its IDs for
inspection; Get or a freshly generated List/Get note can read the original
conversation. Copying an uncertain question into a new send is not recovery.

## Pending sends and recovery

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

The November 13 delivery adds these self-contained actions. Import each package,
then set its `BASE_URL` and `API_TOKEN` to your existing gateway address and API
credential. Keep configured copies private. These are separate from the original
five ChatGPT actions; they do not add photos or Projects to Gemini.

| Action | Source / import package | Behavior |
| --- | --- | --- |
| ChatGPTBox Gemini List Conversations | [List](gemini-list.js), [package](chatgptbox-gemini-list.draftsAction) | Read pinned and ordinary native history; run again on a list to load more |
| ChatGPTBox Gemini Get | [Get](gemini-get.js), [package](chatgptbox-gemini-get.draftsAction) | Open one checked conversation, refresh its recent messages, or collect a pending run |
| ChatGPTBox Gemini Send | [Send](gemini-send.js), [package](chatgptbox-gemini-send.draftsAction) | Send an ordinary note as an independent question, or append its Waiting Reply |
| ChatGPTBox Gemini Load Older Turns | [Older](gemini-older.js), [package](chatgptbox-gemini-older.draftsAction) | Prepend the next native history page while retaining recent text and Waiting Reply |

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

Version-3 Gemini headers bind their generated controls to the note. Keep these
headers and pending metadata intact. Use the original ChatGPT actions for version-2
ChatGPT notes. A List action refuses to replace a Gemini conversation, preserving
its transcript, unsent draft and operation identity. Captured account credentials
never enter the note or import packages.

Get refreshes only the marked history region, preserving your title, notes outside
that region, and Waiting Reply. Put personal annotations outside the history
markers. If generated history or pending text was edited, the actions keep the
complete note and stop before HTTP or replacement; use a fresh List/Get note if
you need to retain those edits. The edit checksum detects accidental changes;
it does not authenticate a note or establish device synchronization.

Maintain [the common source](engine-actions.shared.txt), then run
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
copies still require importing the packages and retaining their own endpoint
and credential settings.

<a id="photos-and-projects"></a>

## ChatGPT photos and Projects

1. Create the desired Project/instructions in ChatGPT, then run **Select Project**
   on a fresh note. This selects an existing Project for its first conversation;
   it does not move an already opened conversation.
2. Run **Attach Photos** and choose up to four photos. The picker converts them
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
HTML Preview step packages [the complete HTML](chatgptbox-preview.html), styles
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

An extension update does not replace installed Drafts scripts or Preview copies.
Replace the affected layer, preserve configuration, then fetch an existing answer
again when its stored transcript needs regeneration.

| Symptom / update | Action |
| --- | --- |
| Document controls differ or a copied action still hardcodes an old model | Update all five actions together; preserve URL/token and explicit overrides |
| Runtime/account/verification/network-transport recognition fails | Update/reload the extension and refresh its dedicated ChatGPT proxy and bridge pages. A Drafts-script replacement cannot repair website-runtime recognition; this error alone is not an account-suspension notice |
| An old note contains missing code blocks, chart JSON or incomplete layout | Update/reload the extension, then Get again. For packaged chart interactions also replace Preview; old Markdown cannot acquire lost layout from CSS alone |
| A fresh send is incorrectly called older than seven days | Update Get, Send and Attach Photos. Current scripts parse saved ISO times with `new Date(value).getTime()` for Drafts compatibility; preserve the marker and original request. Truly expired or invalid ages still block replay |
| A write timed out or lost acknowledgement | Keep its ID and use Get/operation inspection; never generate a new key merely to retry |

Maintain `control-document.shared.txt`, `photo-operation.shared.txt` and
`photo-picker.html`; `npm run sync-drafts-photos` regenerates self-contained
scripts/packages. Maintain `chatgptbox-preview.source.html`, shared CSS and the
chart runtime; `npm run sync-drafts-preview` regenerates HTML/package and protects
script/template delimiters with an exact CSP hash. Extension builds run both
steps. Import regenerated copies into Drafts separately.

Repository tests cover controlled local capture, exact-request recovery and a
synthetic HTTP bridge. Browser previews cover rendered output, not native Drafts
import, camera behavior or device/iCloud sync. These limits remain separate from
source/build completion; no native-device acceptance is claimed by this guide.
The scripts use Drafts' [HTTP](https://scripting.getdrafts.com/classes/HTTP.html)
and [Draft](https://scripting.getdrafts.com/classes/Draft.html) runtime objects.
