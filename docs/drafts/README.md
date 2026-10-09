# Drafts Actions For ChatGPTBox

These Drafts scripts are currently configured for the ChatGPTBox API gateway at
`http://127.0.0.1:18080`, which is the gateway's default port.

Before running them:

1. Open `Advanced -> API Server Bridge -> Open API Server Bridge` in the extension.
2. Turn on `Enable API Server Bridge`.
3. Start the local gateway with `npm run api-server`.
4. Copy the API token from `~/.chatgptbox/gateway-api-token` into the `API_TOKEN` constant in each action. Keep the edited scripts private.
5. Keep the bridge page open and stay logged in at `https://chatgpt.com`.
6. Enable ChatGPT history synchronization in Advanced settings and choose a conservative RPM, so the cache action 1 reads from stays populated.

If you changed the gateway host or port, update the `BASE_URL` constant in all three action files.
Thinking time is per turn, not per conversation. Every reasoning turn in a snapshot carries its
own `thoughtDurationLabel` / `thoughtDurationText`, so actions 2 and 3 print ChatGPT's own
sentence on that turn's heading (`### ASSISTANT (Worked for 2 minutes 30 seconds)`) even when
`INCLUDE_THINKING` is false. Official timing can be `finished_duration_sec` or the `Worked for` /
`Thought for` sentence on the recap or the answer itself. Turns without either get no annotation
rather than an estimate. If you also want the full ChatGPT
reasoning blocks, set `INCLUDE_THINKING = true` in `action-2-open-checked-conversation.js` and
`action-3-send-waiting-reply.js`.
`action-3-send-waiting-reply.js` delegates its model choice to the gateway by default:

- `MODEL_OVERRIDE = null` omits `model` from requests. New conversations use the extension's current ChatGPT Web default; follow-up replies use the conversation's current model when available.
- Set `MODEL_OVERRIDE` to a model slug if you want this Drafts action to force that model for both new conversations and follow-up replies.
- The default is defined in `src/config/limits.mjs`. Updating the extension and gateway updates Drafts' default behavior without editing a copied Drafts action.

For the September 30 recovery update, replace both Action 2 and Action 3 with the current
scripts. Keep your existing `BASE_URL` and `API_TOKEN` values when replacing them.
Older Action 3 copies may also still send their hardcoded model.

For the October 8 GPT-6 visualization update, replace both Action 2 and Action 3 again,
preserving your `BASE_URL` and `API_TOKEN`. The gateway now converts native card, grid,
table, relationship and citation components into portable HTML. Drafts keeps that HTML in
the transcript; use the HTML Preview template below to see the layout. Hidden answer fragments are omitted
in favor of the complete merged answer. A finished fragment with `endTurn: false` or
`isFinal: false` keeps the pending marker and does not clear the awaited turn.
The extension interprets static component construction rather than executing model-generated
JavaScript. Components outside the supported set use the official Markdown fallback.

## HTML Preview

For iPhone, iPad and Mac, use the self-contained **ChatGPTBox Preview** action:
open [`chatgptbox-preview.draftsAction`](./chatgptbox-preview.draftsAction) in Drafts and
import it. Its single HTML Preview step contains the complete template, styles and
packaged chart runtime. Drafts synchronizes actions through its existing iCloud sync;
after the action and conversation have synchronized, viewing them requires no network
connection, CDN, local gateway, or separate resource files. Get and Send still need
the configured gateway. No API token is stored in the preview action.

The action JSON follows the structure of the
[official Preview action](https://actions.getdrafts.com/a/1Ct). Native import and sync
still need verification on devices with Drafts installed; browser validation alone
does not verify Drafts' importer or iCloud behavior. If importing the action file is
unavailable, create an action named **ChatGPTBox Preview**, add one **HTML Preview**
step, and use **Import** to load the HTML template below. Leave **Hide interface** off.

Use [`chatgptbox-preview.html`](./chatgptbox-preview.html) as the template for a Drafts
**HTML Preview** action step. Import the file with the step's **Import** button, or paste
its full contents into the template field. For Mac/iPad live preview, save the file in
`iCloud Drive/Drafts/Library/Templates` and select it in the preview window. These are
the [official custom-template options](https://docs.getdrafts.com/docs/editor/previews).

The template uses Drafts' `%%[[draft]]%%` Markdown conversion and includes its styles
and chart JavaScript inline. It works offline, supports light/dark appearance, stacks cards and charts on narrow
screens, and lets wide tables scroll within the answer. It does not load external scripts,
fonts, or stylesheets. Keep HTML content enabled in your Markdown parser; do not escape
or strip the gateway's `chatgptbox-genui` HTML. The built-in Markdown previews do not
supply the responsive GenUI and theme rules used here. Gateway metadata stays in the
editable note but is hidden from this template's reading view.

The October 9 renderer update also preserves static array-generated legends, numbered
lists, safe source links, and proportional colored bars. Update/reload the extension to
receive these structures through the gateway, then run Get again on the existing note.
Action 2 and Action 3 already preserve the returned HTML; their scripts need no further
changes for this preview update. A template cannot restore layouts from an older gateway
response that has already fallen back to Markdown.

The October 9 offline chart update adds bar, line, area, scatter and pie charts to the
same template. Hover/tap shows values, supported legends toggle series, and scrollable
charts support local panning/zooming. **图表数据** opens the complete source values;
without JavaScript, the table remains open. Missing observations remain gaps and
negative values retain their sign. Unsupported native chart properties still use the
official Markdown fallback. Get an existing conversation again after updating the
extension to obtain its chart descriptors; Action 2 and Action 3 need no script changes.

Maintain `chatgptbox-preview.source.html`, the shared CSS, and the chart runtime as
separate sources. `npm run sync-drafts-preview` generates the complete HTML and action
package; extension builds do this automatically. The regression suite checks both
generated files. The build also protects JavaScript from Drafts' template delimiters
and emits a CSP hash allowing only that exact packaged script. Update the imported
preview action after rebuilding; an extension update does not update Drafts' copy.
See [renderer contracts and supported components](../chatgpt-web-genui.md).

The HTML Preview action works on all three platforms. The separate live preview window
is available on Mac and iPad, not iPhone. To use that window, place the same complete
HTML file in `iCloud Drive/Drafts/Library/Templates`; it needs no `Library/Previews`
assets. This file uses iCloud Drive file synchronization, separate from Drafts' action
sync, and must be downloaded on the device for offline use. The action is the primary
cross-platform preview; the live window is optional.

## Send and recovery

The custom conversation write API requires `Idempotency-Key`. Action 3 handles this internally: it
writes a generated operation ID into the draft before sending a new-conversation or follow-up
request, then reuses that ID if the action is retried after an uncertain result. No manual header or
ID setup is required in Drafts.

The saved ID also keeps the original request parameters. Retrying the same question uses those
parameters even if model/thinking settings changed afterwards. Get preserves both the ID and
the saved request while unsent text remains.

If an edited question encounters an ID belonging to a confirmed successful send, Action 3
recovers that original acknowledgement and leaves the edited question in Waiting Reply.
Run Get before sending the edited question. This recovery does not dispatch a second question.
If the previous result is still uncertain, the ID is kept and the action asks you to inspect the
conversation. A failure explicitly marked `dispatched: false` releases the saved ID, so a later
manual send can use the edited request. The gateway likewise releases only that proven unsent
operation. It also repairs historical records containing the exact old runtime rejection message
when the key is next used; timeouts and stream parsing failures remain protected.

Files:

- `action-1-list-conversations.js`
- `action-2-open-checked-conversation.js`
- `action-3-send-waiting-reply.js`
- `chatgptbox-preview.html`
- `chatgptbox-preview.draftsAction`

Suggested Drafts action names:

- `ChatGPTBox List Conversations`
- `ChatGPTBox Open Checked Conversation`
- `ChatGPTBox Send Waiting Reply`

Expected workflow:

1. Run action 1 to read the cached conversation list and replace the draft with a Markdown task list. Listing does not sync; run Full Sync in the extension when you want fresh data.
2. Check exactly one conversation line, then run action 2 to load that conversation into the note. The script defaults to a compact user/assistant transcript with per-turn `Thought:` annotations; turn on `INCLUDE_THINKING` if you also want the `Thinking` section.
3. Type the next user message between the `chatgptbox-waiting-reply` markers at the bottom of the note, then run action 3 to `POST /chatgpt/conversations/:id/messages`.
4. Run action 2 on the same note whenever you want to collect the answer. You do not need to List first, and you can come back to it much later. Action 2 keeps any unsent text already typed in the waiting-reply block.

Sending is asynchronous by design. The gateway acknowledges the message and ChatGPT keeps generating in
the browser, so action 3 returns immediately instead of holding the connection while a thinking model
works. It does not rewrite the note: your question is appended to the transcript, the answer gets a
`### ASSISTANT (pending)` placeholder, and the waiting-reply metadata records `pendingMessageId` and
`pendingSentAt` for the turn being awaited.

Action 2 resolves that awaited turn against the snapshot it fetches, and keeps the note honest in every
state:

- The snapshot does not contain your question yet (ChatGPT has not stored the send; this is normal for a
  few seconds after action 3 returns). Your `### USER` block and the placeholder stay in the note, the
  header stays `pending`, and the metadata keeps `pendingMessageId` so the next Get is still anchored.
- The snapshot contains the question but no answer. The placeholder stays and so does the anchor.
- The snapshot contains the answer. The placeholder is replaced by the answer and the anchor is dropped.

The turn is matched by `pendingMessageId` when that id is present. Question text is only a fallback
after the id is gone, so sending the same wording again cannot resolve to an earlier turn. A turn is
answered only when that match has a finished assistant reply and the conversation is not still
pending; streaming text does not clear the anchor. `pending` can veto "answered" but never decides
the match by itself, because a snapshot taken right after send can lack both the async status and
the turn. The unsent text in the waiting-reply block survives every Get.

Action 3 also supports two shortcut modes:

- If the note has no `chatgptbox-waiting-reply` block yet, it treats the entire note as a new user prompt, creates a ChatGPT conversation without waiting for the answer, and rewrites the note into a one-turn transcript with the same `### ASSISTANT (pending)` placeholder and anchor a follow-up send would leave.
- If the note already has a `chatgptbox-waiting-reply` block but the block is empty, it refreshes the current conversation instead of sending a new follow-up, with the same anchoring and placeholder handling as action 2. Action 2 is the better "just reload this thread" button after a reply.

The scripts rely on the official Drafts scripting runtime objects documented in the Drafts scripting reference, especially [HTTP](https://scripting.getdrafts.com/classes/HTTP.html) and [Draft](https://scripting.getdrafts.com/classes/Draft.html).
